use super::*;
use serde_json::json;

fn sse_frame(event: &str, data: &serde_json::Value) -> String {
    format!("event: {event}\ndata: {}\n\n", data)
}

async fn start_mock_router(body: String, status: u16) -> (String, tokio::task::JoinHandle<()>) {
    use std::convert::Infallible;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    let handle = tokio::spawn(async move {
        let (mut socket, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => return,
        };
        let mut req_buf = vec![0u8; 4096];
        let _ = socket.read(&mut req_buf).await;
        let response = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}"
            );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
        let _: Result<(), Infallible> = Ok(());
    });

    (url, handle)
}

#[tokio::test]
async fn run_generate_image_to_completion_returns_completed_payload() {
    let body = sse_frame(
        "progress",
        &json!({ "percent": 25, "message": "rendering" }),
    ) + &sse_frame(
        "completed",
        &json!({
            "imageUrl": "https://cdn.example.com/img.png",
            "originalUrl": "https://cdn.example.com/img-orig.png",
            "artifactId": "art-1",
        }),
    );

    let (base_url, handle) = start_mock_router(body, 200).await;
    let url = format!("{base_url}/v1/generate-image/stream");

    let result = run_generate_image_to_completion(
        &url,
        "jwt",
        json!({ "prompt": "a cat", "model": "gpt-image-2" }),
        "a cat",
        "gpt-image-2",
    )
    .await
    .expect("should complete");

    assert_eq!(result["imageUrl"], "https://cdn.example.com/img.png");
    assert_eq!(
        result["originalUrl"],
        "https://cdn.example.com/img-orig.png"
    );
    assert_eq!(result["artifactId"], "art-1");
    assert_eq!(result["model"], "gpt-image-2");
    assert_eq!(result["prompt"], "a cat");
    assert_eq!(result["meta"]["model"], "gpt-image-2");
    assert_eq!(result["meta"]["prompt"], "a cat");

    handle.abort();
}

#[tokio::test]
async fn run_generate_image_to_completion_propagates_error_event() {
    let body = sse_frame(
        "error",
        &json!({ "code": "GENERATION_FAILED", "message": "model unavailable" }),
    );

    let (base_url, handle) = start_mock_router(body, 200).await;
    let url = format!("{base_url}/v1/generate-image/stream");

    let err = run_generate_image_to_completion(
        &url,
        "jwt",
        json!({ "prompt": "x", "model": "gpt-image-2" }),
        "x",
        "gpt-image-2",
    )
    .await
    .expect_err("should error");

    let payload = serde_json::to_value(&err.1 .0).unwrap();
    assert_eq!(payload["code"], "bad_gateway");
    assert!(payload["error"]
        .as_str()
        .unwrap()
        .contains("model unavailable"));

    handle.abort();
}

#[tokio::test]
async fn run_generate_image_to_completion_errors_when_no_completed_event() {
    let body = sse_frame("progress", &json!({ "percent": 50 }));

    let (base_url, handle) = start_mock_router(body, 200).await;
    let url = format!("{base_url}/v1/generate-image/stream");

    let err = run_generate_image_to_completion(
        &url,
        "jwt",
        json!({ "prompt": "x", "model": "gpt-image-2" }),
        "x",
        "gpt-image-2",
    )
    .await
    .expect_err("should error without completed event");

    let payload = serde_json::to_value(&err.1 .0).unwrap();
    assert_eq!(payload["code"], "bad_gateway");

    handle.abort();
}
