use tao::event_loop::EventLoopWindowTarget;
use tao::window::{Icon, Window, WindowBuilder, WindowId};
use tracing::{info, warn};
use wry::{WebContext, WebView, WebViewBuilder};

/// Forward a webview new-window request to the OS default browser, but only
/// for real external links. Page scripts that call `window.open()` without a
/// URL surface here as `about:blank`; handing that to the OS makes Windows
/// show a "Get an app to open this 'about' link" picker dialog. Mirrors the
/// helper in the `aura-os-desktop` crate.
fn open_external_uri(uri: &str) {
    let lowered = uri.trim().to_ascii_lowercase();
    let allowed = lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || lowered.starts_with("mailto:");
    if !allowed {
        warn!(%uri, "ignoring new-window request with non-external scheme");
        return;
    }
    if let Err(err) = open::that_detached(uri) {
        warn!(%uri, %err, "failed to open external link in OS browser");
    }
}

fn filename_from_path(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn build_app_url(base_url: &str, route: &str, params: &[(&str, &str)]) -> String {
    let (base, existing_query) = match base_url.split_once('?') {
        Some((base, query)) => (base, Some(query)),
        None => (base_url, None),
    };

    let mut url = format!(
        "{}/{}",
        base.trim_end_matches('/'),
        route.trim_start_matches('/')
    );

    let mut query_parts = Vec::new();
    if let Some(query) = existing_query.filter(|value| !value.trim().is_empty()) {
        query_parts.push(query.to_string());
    }

    for (key, value) in params {
        query_parts.push(format!("{key}={}", urlencoding::encode(value)));
    }

    if !query_parts.is_empty() {
        url.push('?');
        url.push_str(&query_parts.join("&"));
    }

    url
}

/// Spawn a new IDE window that loads the interface IDE route for the given file.
///
/// `web_context` is the same `WebContext` used by the main window, so the IDE
/// webview shares localStorage / cookies / IndexedDB with it. That sharing is
/// load-bearing: it means the IDE inherits the parent's live `aura-jwt` /
/// `aura-session` localStorage entries directly, and every API call from the
/// IDE webview gets an `Authorization: Bearer …` header without any per-window
/// init-script auth bake-in. With an isolated WebContext, the IDE's
/// localStorage starts empty and the per-window auth bootstrap was not
/// landing reliably on Windows WebView2, leaving the file tree blank with
/// "ApiClientError: missing authorization token".
///
/// `make_ipc` receives the new window's `WindowId` and must return an IPC
/// handler closure. This lets the caller wire per-window events without
/// knowing the ID ahead of time.
///
/// The caller must keep the returned `(Window, WebView)` alive for as long as
/// the window should remain open.
pub fn open_ide_window<E: 'static>(
    event_loop: &EventLoopWindowTarget<E>,
    web_context: &mut WebContext,
    base_url: &str,
    file_path: &str,
    root_path: Option<&str>,
    icon: Option<Icon>,
    initialization_script: &str,
    make_ipc: impl FnOnce(WindowId) -> Box<dyn Fn(wry::http::Request<String>) + 'static>,
) -> Result<(Window, WebView), Box<dyn std::error::Error>> {
    let filename = filename_from_path(file_path);
    let title = format!("{filename} \u{2014} AURA IDE");

    let mut wb = WindowBuilder::new()
        .with_title(&title)
        .with_decorations(false)
        .with_visible(false)
        .with_inner_size(tao::dpi::LogicalSize::new(1100.0, 750.0));

    if let Some(ic) = icon {
        wb = wb.with_window_icon(Some(ic));
    }

    let window = wb.build(event_loop)?;
    let ipc = make_ipc(window.id());

    let mut params = vec![("file", file_path)];
    if let Some(root) = root_path {
        params.push(("root", root));
    }
    let url = build_app_url(base_url, "ide", &params);
    info!(%url, "opening IDE window");

    let ready_script = "\
        if (document.readyState === 'loading') { \
            document.addEventListener('DOMContentLoaded', function() { window.ipc.postMessage('ready'); }); \
        } else { \
            window.ipc.postMessage('ready'); \
        }";

    // The shared WebContext already carries the live auth/host state, so the
    // caller-provided bootstrap is mostly redundant. We still concatenate it
    // (kept as a defensive belt-and-braces seed for first-run scenarios where
    // localStorage hasn't been mirrored yet) and append the IDE-specific
    // ready notifier into a single script — WebViewBuilder only keeps the
    // last `with_initialization_script` value.
    let combined_script = if initialization_script.is_empty() {
        ready_script.to_string()
    } else {
        format!("{initialization_script}\n{ready_script}")
    };

    let webview = WebViewBuilder::new_with_web_context(web_context)
        .with_background_color((0, 0, 0, 255))
        .with_url(&url)
        .with_initialization_script(&combined_script)
        .with_ipc_handler(ipc)
        .with_new_window_req_handler(|uri, _features| {
            open_external_uri(&uri);
            wry::NewWindowResponse::Deny
        })
        .build(&window)?;

    Ok((window, webview))
}

#[cfg(test)]
mod tests {
    use super::build_app_url;

    #[test]
    fn builds_route_url_from_plain_base_url() {
        let url = build_app_url("http://127.0.0.1:5173", "ide", &[("file", "src/main.rs")]);
        assert_eq!(url, "http://127.0.0.1:5173/ide?file=src%2Fmain.rs");
    }

    #[test]
    fn preserves_existing_query_parameters() {
        let url = build_app_url(
            "http://127.0.0.1:5173?host=http://127.0.0.1:19847",
            "ide",
            &[("file", "src/main.rs"), ("root", "C:/code/aura-os")],
        );
        assert_eq!(
            url,
            "http://127.0.0.1:5173/ide?host=http://127.0.0.1:19847&file=src%2Fmain.rs&root=C%3A%2Fcode%2Faura-os"
        );
    }
}
