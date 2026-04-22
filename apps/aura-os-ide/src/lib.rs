use tao::event_loop::EventLoopWindowTarget;
use tao::window::{Icon, Window, WindowBuilder, WindowId};
use tracing::info;
use wry::{WebView, WebViewBuilder};

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
/// `make_ipc` receives the new window's `WindowId` and must return an IPC
/// handler closure. This lets the caller wire per-window events without
/// knowing the ID ahead of time.
///
/// The caller must keep the returned `(Window, WebView)` alive for as long as
/// the window should remain open.
pub fn open_ide_window<E: 'static>(
    event_loop: &EventLoopWindowTarget<E>,
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

    // WebViewBuilder only keeps the last `with_initialization_script` value, so
    // concatenate the caller-provided bootstrap (auth/host seeding) with the
    // IDE-specific ready notifier into a single script.
    let combined_script = if initialization_script.is_empty() {
        ready_script.to_string()
    } else {
        format!("{initialization_script}\n{ready_script}")
    };

    let webview = WebViewBuilder::new()
        .with_background_color((0, 0, 0, 255))
        .with_url(&url)
        .with_initialization_script(&combined_script)
        .with_ipc_handler(ipc)
        .with_new_window_req_handler(|uri, _features| {
            let _ = open::that(&uri);
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
