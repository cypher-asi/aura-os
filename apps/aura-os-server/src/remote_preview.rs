//! Per-browser SOCKS5 proxy for hosted Preview sessions.
//!
//! Chromium runs beside AURA OS in hosted deployments, while the user's dev
//! server can run in either a separately hosted local harness or a selected
//! swarm agent. A loopback URL must therefore be carried to the harness that
//! owns the development server. Public destinations still connect from AURA OS
//! so normal browsing keeps working.

use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use url::Url;

const SOCKS_VERSION: u8 = 5;
const SOCKS_CONNECT: u8 = 1;
const SOCKS_SUCCESS: u8 = 0;
const SOCKS_GENERAL_FAILURE: u8 = 1;
const SOCKS_CONNECTION_REFUSED: u8 = 5;
const SOCKS_ADDRESS_NOT_SUPPORTED: u8 = 8;
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

pub(crate) struct RemotePreviewProxy {
    pub(crate) proxy_server: String,
    pub(crate) cleanup_token: CancellationToken,
}

#[derive(Clone)]
enum PreviewTunnelTarget {
    Swarm {
        ws_base: String,
        agent_id: String,
        bearer_token: String,
    },
    HostedHarness {
        ws_base: String,
        bearer_token: String,
    },
}

impl PreviewTunnelTarget {
    fn swarm(base_url: &str, agent_id: String, bearer_token: String) -> io::Result<Self> {
        Ok(Self::Swarm {
            ws_base: websocket_base_url(base_url)?,
            agent_id,
            bearer_token,
        })
    }

    fn hosted_harness(base_url: &str, bearer_token: String) -> io::Result<Self> {
        Ok(Self::HostedHarness {
            ws_base: websocket_base_url(base_url)?,
            bearer_token,
        })
    }

    fn url(&self, port: u16) -> String {
        match self {
            Self::Swarm {
                ws_base, agent_id, ..
            } => format!("{ws_base}/v1/agents/{agent_id}/preview/tcp/{port}/ws"),
            Self::HostedHarness { ws_base, .. } => {
                format!("{ws_base}/ws/preview/tcp/{port}")
            }
        }
    }

    fn bearer_token(&self) -> &str {
        match self {
            Self::Swarm { bearer_token, .. } | Self::HostedHarness { bearer_token, .. } => {
                bearer_token
            }
        }
    }
}

impl RemotePreviewProxy {
    /// Route agent-local destinations through the owner-authenticated swarm
    /// gateway to a specific remote agent.
    pub(crate) async fn start(
        swarm_base_url: &str,
        agent_id: String,
        jwt: String,
    ) -> io::Result<Self> {
        Self::start_for_target(PreviewTunnelTarget::swarm(swarm_base_url, agent_id, jwt)?).await
    }

    /// Route agent-local destinations directly to a separately hosted local
    /// harness. The server-to-harness transport token is intentionally used
    /// instead of an end-user JWT because hosted harness auth protects the
    /// deployment hop, while run payloads carry user identity separately.
    pub(crate) async fn start_hosted_harness(
        harness_base_url: &str,
        transport_auth_token: String,
    ) -> io::Result<Self> {
        Self::start_for_target(PreviewTunnelTarget::hosted_harness(
            harness_base_url,
            transport_auth_token,
        )?)
        .await
    }

    async fn start_for_target(target: PreviewTunnelTarget) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        let cleanup_token = CancellationToken::new();
        let listener_lifetime = cleanup_token.clone();

        tokio::spawn(async move {
            loop {
                let accepted = tokio::select! {
                    _ = listener_lifetime.cancelled() => break,
                    accepted = listener.accept() => accepted,
                };
                let (stream, _) = match accepted {
                    Ok(connection) => connection,
                    Err(error) => {
                        warn!(%error, "remote Preview SOCKS listener failed");
                        break;
                    }
                };
                let connection_lifetime = listener_lifetime.clone();
                let connection_target = target.clone();
                tokio::spawn(async move {
                    let result = tokio::select! {
                        _ = connection_lifetime.cancelled() => Ok(()),
                        result = handle_connection(
                            stream,
                            &connection_target,
                            connection_lifetime.clone(),
                        ) => result,
                    };
                    if let Err(error) = result {
                        debug!(%error, "remote Preview SOCKS connection ended");
                    }
                });
            }
        });

        Ok(Self {
            proxy_server: format!("socks5://{address}"),
            cleanup_token,
        })
    }
}

fn websocket_base_url(raw: &str) -> io::Result<String> {
    let mut url = Url::parse(raw.trim()).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid Preview tunnel base URL: {error}"),
        )
    })?;
    let ws_scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Preview tunnel base URL must use http or https",
            ))
        }
    };
    url.set_scheme(ws_scheme).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "could not convert Preview tunnel base URL to WebSocket",
        )
    })?;
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

#[derive(Debug)]
enum TargetHost {
    Ip(IpAddr),
    Domain(String),
}

impl TargetHost {
    fn is_agent_local(&self) -> bool {
        match self {
            // Dev tools commonly print 0.0.0.0 when listening on every
            // interface; for Preview it means the selected agent, never the
            // hosted AURA container.
            Self::Ip(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_unspecified(),
            Self::Ip(IpAddr::V6(ip)) => {
                ip.is_loopback()
                    || ip.is_unspecified()
                    || ip
                        .to_ipv4_mapped()
                        .is_some_and(|ip| ip.is_loopback() || ip.is_unspecified())
            }
            Self::Domain(host) => host.trim_end_matches('.').eq_ignore_ascii_case("localhost"),
        }
    }
}

async fn handle_connection(
    mut client: TcpStream,
    tunnel_target: &PreviewTunnelTarget,
    lifetime: CancellationToken,
) -> io::Result<()> {
    let (host, port) = tokio::time::timeout(HANDSHAKE_TIMEOUT, async {
        negotiate_no_auth(&mut client).await?;
        read_connect_request(&mut client).await
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "SOCKS handshake timed out"))??;

    if host.is_agent_local() {
        if !is_preview_port_allowed(port) {
            send_socks_reply(&mut client, SOCKS_ADDRESS_NOT_SUPPORTED).await?;
            return Ok(());
        }
        let upstream = match connect_preview_tunnel(tunnel_target, port).await {
            Ok(upstream) => upstream,
            Err(error) => {
                let _ = send_socks_reply(&mut client, SOCKS_CONNECTION_REFUSED).await;
                return Err(error);
            }
        };
        send_socks_reply(&mut client, SOCKS_SUCCESS).await?;
        bridge_websocket(client, upstream, lifetime).await;
        return Ok(());
    }

    let upstream = match connect_public(&host, port).await {
        Ok(upstream) => upstream,
        Err(error) => {
            let _ = send_socks_reply(&mut client, SOCKS_CONNECTION_REFUSED).await;
            return Err(error);
        }
    };
    send_socks_reply(&mut client, SOCKS_SUCCESS).await?;
    bridge_tcp(client, upstream, lifetime).await
}

async fn negotiate_no_auth(client: &mut TcpStream) -> io::Result<()> {
    let mut greeting = [0_u8; 2];
    client.read_exact(&mut greeting).await?;
    if greeting[0] != SOCKS_VERSION || greeting[1] == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid SOCKS5 greeting",
        ));
    }
    let mut methods = vec![0_u8; greeting[1] as usize];
    client.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        client.write_all(&[SOCKS_VERSION, 0xff]).await?;
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "SOCKS client did not offer no-auth",
        ));
    }
    client.write_all(&[SOCKS_VERSION, 0]).await
}

async fn read_connect_request(client: &mut TcpStream) -> io::Result<(TargetHost, u16)> {
    let mut header = [0_u8; 4];
    client.read_exact(&mut header).await?;
    if header[0] != SOCKS_VERSION || header[1] != SOCKS_CONNECT || header[2] != 0 {
        let _ = send_socks_reply(client, SOCKS_GENERAL_FAILURE).await;
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unsupported SOCKS5 request",
        ));
    }

    let host =
        match header[3] {
            1 => {
                let mut bytes = [0_u8; 4];
                client.read_exact(&mut bytes).await?;
                TargetHost::Ip(IpAddr::V4(Ipv4Addr::from(bytes)))
            }
            3 => {
                let length = client.read_u8().await? as usize;
                if length == 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "empty SOCKS domain",
                    ));
                }
                let mut bytes = vec![0_u8; length];
                client.read_exact(&mut bytes).await?;
                TargetHost::Domain(String::from_utf8(bytes).map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidData, "invalid SOCKS domain")
                })?)
            }
            4 => {
                let mut bytes = [0_u8; 16];
                client.read_exact(&mut bytes).await?;
                TargetHost::Ip(IpAddr::V6(Ipv6Addr::from(bytes)))
            }
            _ => {
                let _ = send_socks_reply(client, SOCKS_ADDRESS_NOT_SUPPORTED).await;
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "unsupported SOCKS address type",
                ));
            }
        };
    let port = client.read_u16().await?;
    Ok((host, port))
}

async fn send_socks_reply(client: &mut TcpStream, status: u8) -> io::Result<()> {
    client
        .write_all(&[SOCKS_VERSION, status, 0, 1, 0, 0, 0, 0, 0, 0])
        .await
}

async fn connect_preview_tunnel(
    target: &PreviewTunnelTarget,
    port: u16,
) -> io::Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
> {
    let url = target.url(port);
    let mut request = url
        .into_client_request()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", target.bearer_token())
            .parse()
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?,
    );
    tokio_tungstenite::connect_async(request)
        .await
        .map(|(socket, _)| socket)
        .map_err(|error| io::Error::new(io::ErrorKind::ConnectionRefused, error))
}

async fn connect_public(host: &TargetHost, port: u16) -> io::Result<TcpStream> {
    let addresses: Vec<SocketAddr> = match host {
        TargetHost::Ip(ip) => vec![SocketAddr::new(*ip, port)],
        TargetHost::Domain(domain) => tokio::net::lookup_host((domain.as_str(), port))
            .await?
            .collect(),
    };
    let mut last_error = None;
    for address in addresses {
        if is_forbidden_public_address(address.ip()) {
            continue;
        }
        match TcpStream::connect(address).await {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "destination is not a public network address",
        )
    }))
}

fn is_forbidden_public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_broadcast()
                || ip.is_documentation()
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 198 && matches!(octets[1], 18 | 19))
        }
        IpAddr::V6(ip) => {
            let octets = ip.octets();
            let unique_local = octets[0] & 0xfe == 0xfc;
            let link_local = octets[0] == 0xfe && octets[1] & 0xc0 == 0x80;
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || unique_local
                || link_local
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|ip| is_forbidden_public_address(IpAddr::V4(ip)))
        }
    }
}

async fn bridge_tcp(
    mut client: TcpStream,
    mut upstream: TcpStream,
    lifetime: CancellationToken,
) -> io::Result<()> {
    tokio::select! {
        _ = lifetime.cancelled() => Ok(()),
        result = tokio::io::copy_bidirectional(&mut client, &mut upstream) => result.map(|_| ()),
    }
}

async fn bridge_websocket(
    client: TcpStream,
    upstream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    lifetime: CancellationToken,
) {
    let (mut client_read, mut client_write) = client.into_split();
    let (mut ws_write, mut ws_read) = upstream.split();
    let client_to_ws = async {
        let mut buffer = vec![0_u8; 16 * 1024];
        loop {
            match client_read.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if ws_write
                        .send(Message::Binary(buffer[..read].to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        let _ = ws_write.close().await;
    };
    let ws_to_client = async {
        while let Some(message) = ws_read.next().await {
            match message {
                Ok(Message::Binary(bytes)) => {
                    if client_write.write_all(&bytes).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Text(_)) => {}
                Ok(Message::Frame(_)) => {}
            }
        }
        let _ = client_write.shutdown().await;
    };

    tokio::select! {
        _ = lifetime.cancelled() => {}
        _ = client_to_ws => {}
        _ = ws_to_client => {}
    }
}

pub(crate) fn is_preview_port_allowed(port: u16) -> bool {
    matches!(
        port,
        3000 | 3001
            | 3002
            | 3003
            | 3030
            | 4000
            | 4200
            | 4321
            | 5000
            | 5173
            | 5174
            | 5500
            | 5501
            | 5555
            | 6006
            | 7000
            | 7070
            | 8000
            | 8001
            | 8080
            | 8081
            | 8088
            | 8888
            | 9000
            | 9001
            | 9090
    )
}

#[cfg(test)]
mod tests {
    use super::{
        is_forbidden_public_address, is_preview_port_allowed, websocket_base_url,
        RemotePreviewProxy, TargetHost,
    };
    use aura_os_browser::{
        BrowserConfig, BrowserManager, CdpBackend, CdpBackendConfig, ClientMsg, InspectionKind,
        ServerEvent, SpawnOptions,
    };
    use axum::extract::ws::{Message as AxumMessage, WebSocketUpgrade};
    use axum::http::HeaderMap;
    use axum::response::IntoResponse;
    use axum::routing::get;
    use axum::Router;
    use futures_util::StreamExt;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    use std::sync::Arc;
    use std::time::Duration;
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    #[test]
    fn recognizes_agent_local_spellings() {
        assert!(TargetHost::Domain("localhost".into()).is_agent_local());
        assert!(TargetHost::Domain("LOCALHOST.".into()).is_agent_local());
        assert!(TargetHost::Ip(IpAddr::V4(Ipv4Addr::LOCALHOST)).is_agent_local());
        assert!(TargetHost::Ip(IpAddr::V4(Ipv4Addr::UNSPECIFIED)).is_agent_local());
        assert!(TargetHost::Ip(IpAddr::V6(Ipv6Addr::LOCALHOST)).is_agent_local());
        assert!(!TargetHost::Domain("example.com".into()).is_agent_local());
    }

    #[test]
    fn port_policy_blocks_services_outside_preview() {
        assert!(is_preview_port_allowed(5173));
        assert!(is_preview_port_allowed(8080));
        assert!(!is_preview_port_allowed(22));
        assert!(!is_preview_port_allowed(5432));
    }

    #[test]
    fn public_fallback_blocks_private_and_metadata_networks() {
        for ip in ["10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254"] {
            assert!(is_forbidden_public_address(ip.parse().unwrap()), "{ip}");
        }
        assert!(!is_forbidden_public_address("1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn converts_only_http_preview_bases_to_websockets() {
        assert_eq!(
            websocket_base_url("https://harness.example/base/?ignored=yes#fragment").unwrap(),
            "wss://harness.example/base"
        );
        assert_eq!(
            websocket_base_url("http://127.0.0.1:8080").unwrap(),
            "ws://127.0.0.1:8080"
        );
        assert!(websocket_base_url("file:///tmp/harness").is_err());
    }

    #[tokio::test]
    async fn carries_localhost_http_and_hmr_bytes_through_authenticated_agent_websocket() {
        async fn tunnel(ws: WebSocketUpgrade, headers: HeaderMap) -> impl IntoResponse {
            assert_eq!(
                headers
                    .get("authorization")
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer test-token")
            );
            ws.on_upgrade(|mut socket| async move {
                let Some(Ok(AxumMessage::Binary(request))) = socket.next().await else {
                    return;
                };
                assert!(request.starts_with(b"GET / HTTP/1.1\r\n"));
                if request
                    .windows(b"Upgrade: websocket".len())
                    .any(|window| window.eq_ignore_ascii_case(b"Upgrade: websocket"))
                {
                    let switching = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
                    if socket
                        .send(AxumMessage::Binary(switching.to_vec()))
                        .await
                        .is_err()
                    {
                        return;
                    }
                    let Some(Ok(AxumMessage::Binary(frame))) = socket.next().await else {
                        return;
                    };
                    assert_eq!(&frame[..], b"hmr-ping");
                    let _ = socket
                        .send(AxumMessage::Binary(b"hmr-pong".to_vec()))
                        .await;
                    return;
                }
                let response = b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\n\r\nremote-agent";
                let _ = socket.send(AxumMessage::Binary(response.to_vec())).await;
            })
        }

        let gateway_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let gateway_address = gateway_listener.local_addr().unwrap();
        let app = Router::new().route("/v1/agents/agent-1/preview/tcp/5173/ws", get(tunnel));
        let gateway = tokio::spawn(async move {
            axum::serve(gateway_listener, app).await.unwrap();
        });

        let proxy = RemotePreviewProxy::start(
            &format!("http://{gateway_address}"),
            "agent-1".to_string(),
            "test-token".to_string(),
        )
        .await
        .unwrap();
        let proxy_address = proxy
            .proxy_server
            .strip_prefix("socks5://")
            .unwrap()
            .to_string();
        let mut client = connect_test_socks(&proxy_address, 5173).await;

        client
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost:5173\r\n\r\n")
            .await
            .unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        assert!(response.ends_with(b"remote-agent"));

        let mut hmr = connect_test_socks(&proxy_address, 5173).await;
        hmr.write_all(
            b"GET / HTTP/1.1\r\nHost: localhost:5173\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        )
        .await
        .unwrap();
        let switching = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
        let mut switching_response = vec![0_u8; switching.len()];
        hmr.read_exact(&mut switching_response).await.unwrap();
        assert_eq!(&switching_response, switching);
        hmr.write_all(b"hmr-ping").await.unwrap();
        let mut hmr_response = [0_u8; 8];
        hmr.read_exact(&mut hmr_response).await.unwrap();
        assert_eq!(&hmr_response, b"hmr-pong");

        proxy.cleanup_token.cancel();
        gateway.abort();
    }

    #[tokio::test]
    async fn carries_localhost_through_authenticated_hosted_local_harness() {
        async fn tunnel(ws: WebSocketUpgrade, headers: HeaderMap) -> impl IntoResponse {
            assert_eq!(
                headers
                    .get("authorization")
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer hosted-transport-token")
            );
            ws.on_upgrade(|mut socket| async move {
                let Some(Ok(AxumMessage::Binary(request))) = socket.next().await else {
                    return;
                };
                assert!(request.starts_with(b"GET / HTTP/1.1\r\n"));
                let response = b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\n\r\nhosted-local";
                let _ = socket.send(AxumMessage::Binary(response.to_vec())).await;
            })
        }

        let harness_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let harness_address = harness_listener.local_addr().unwrap();
        let app = Router::new().route("/ws/preview/tcp/5173", get(tunnel));
        let harness = tokio::spawn(async move {
            axum::serve(harness_listener, app).await.unwrap();
        });

        let proxy = RemotePreviewProxy::start_hosted_harness(
            &format!("http://{harness_address}"),
            "hosted-transport-token".to_string(),
        )
        .await
        .unwrap();
        let proxy_address = proxy
            .proxy_server
            .strip_prefix("socks5://")
            .unwrap()
            .to_string();
        let mut client = connect_test_socks(&proxy_address, 5173).await;

        client
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost:5173\r\n\r\n")
            .await
            .unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        assert!(response.ends_with(b"hosted-local"));

        proxy.cleanup_token.cancel();
        harness.abort();
    }

    #[tokio::test]
    #[ignore = "launches real Chromium; run locally for visual Preview verification"]
    async fn visually_renders_hosted_local_preview_in_real_chromium() {
        async fn tunnel(ws: WebSocketUpgrade, headers: HeaderMap) -> impl IntoResponse {
            assert_eq!(
                headers
                    .get("authorization")
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer hosted-visual-token")
            );
            ws.on_upgrade(|mut socket| async move {
                let Some(Ok(AxumMessage::Binary(request))) = socket.next().await else {
                    return;
                };
                assert!(request.starts_with(b"GET "));
                let body = br#"<!doctype html><title>Hosted Preview</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#080b12;color:#f3f6ff;font-family:system-ui}.card{border:1px solid #6c74ff;border-radius:22px;padding:46px 60px;box-shadow:0 24px 90px #000a;background:linear-gradient(145deg,#11172a,#0a0e19)}.eyebrow{color:#8d94ff;font-size:13px;letter-spacing:.2em}h1{margin:14px 0 8px;font-size:38px}p{margin:0;color:#aeb8d2}</style><main class="card"><div class="eyebrow">HOSTED LOCAL PREVIEW</div><h1>localhost reached the harness</h1><p>AURA Web rendered this through its authenticated tunnel.</p></main>"#;
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let mut response = head.into_bytes();
                response.extend_from_slice(body);
                let _ = socket.send(AxumMessage::Binary(response)).await;
            })
        }

        let harness_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let harness_address = harness_listener.local_addr().unwrap();
        let harness = tokio::spawn(async move {
            axum::serve(
                harness_listener,
                Router::new().route("/ws/preview/tcp/5173", get(tunnel)),
            )
            .await
            .unwrap();
        });
        let proxy = RemotePreviewProxy::start_hosted_harness(
            &format!("http://{harness_address}"),
            "hosted-visual-token".to_string(),
        )
        .await
        .unwrap();

        let dir = tempdir().unwrap();
        let config = BrowserConfig::default().with_settings_root(dir.path().to_path_buf());
        let backend = Arc::new(CdpBackend::with_config(CdpBackendConfig {
            disable_sandbox: true,
            ..CdpBackendConfig::default()
        }));
        let manager = BrowserManager::with_backend(config, backend);
        let mut options = SpawnOptions::new(720, 480);
        let page_url = "http://localhost:5173/";
        options.initial_url = Some(page_url.parse().unwrap());
        options.proxy_server = Some(proxy.proxy_server.clone());
        options.proxy_bypass_list = Some("<-loopback>".to_string());
        options.cleanup_token = Some(proxy.cleanup_token.clone());
        let spawned = manager.spawn(options).await.unwrap();
        let mut events = manager.take_events(spawned.id).unwrap();

        let screenshot = tokio::time::timeout(Duration::from_secs(20), async {
            let mut inspection_sent = false;
            let mut inspected_page = false;
            loop {
                match events.recv().await {
                    Some(ServerEvent::Nav(state))
                        if state.url == page_url && !state.loading && !inspection_sent =>
                    {
                        inspection_sent = true;
                        manager
                            .dispatch(
                                spawned.id,
                                ClientMsg::Inspect {
                                    request_id: 314,
                                    kind: InspectionKind::Select,
                                    x: 360.0,
                                    y: 235.0,
                                },
                            )
                            .await
                            .unwrap();
                    }
                    Some(ServerEvent::Inspection(result)) if result.request_id == 314 => {
                        let element = result.element.expect("hosted Preview card element");
                        assert_eq!(element.tag_name, "h1");
                        assert!(element.text.contains("localhost reached the harness"));
                        inspected_page = true;
                        // Force a fresh screencast frame after DOM inspection
                        // proves that the tunneled document, not a Chromium
                        // error page or initial blank frame, is visible.
                        manager
                            .dispatch(
                                spawned.id,
                                ClientMsg::Resize {
                                    width: 721,
                                    height: 480,
                                },
                            )
                            .await
                            .unwrap();
                    }
                    Some(ServerEvent::Frame { seq, jpeg, .. }) => {
                        manager.ack_frame(spawned.id, seq).await.unwrap();
                        if inspected_page {
                            break jpeg;
                        }
                    }
                    Some(_) => {}
                    None => panic!("browser session closed before hosted Preview rendered"),
                }
            }
        })
        .await
        .expect("hosted local Preview rendered within 20 seconds");

        assert!(screenshot.starts_with(&[0xff, 0xd8]));
        if let Ok(path) = std::env::var("AURA_HOSTED_PREVIEW_SCREENSHOT") {
            tokio::fs::write(path, screenshot).await.unwrap();
        }

        manager.kill(spawned.id).await.unwrap();
        harness.abort();
    }

    async fn connect_test_socks(address: &str, port: u16) -> TcpStream {
        let mut client = TcpStream::connect(address).await.unwrap();
        client.write_all(&[5, 1, 0]).await.unwrap();
        let mut greeting = [0_u8; 2];
        client.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 0]);

        let host = b"localhost";
        let mut request = vec![5, 1, 0, 3, host.len() as u8];
        request.extend_from_slice(host);
        request.extend_from_slice(&port.to_be_bytes());
        client.write_all(&request).await.unwrap();
        let mut reply = [0_u8; 10];
        client.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[1], 0);
        client
    }
}
