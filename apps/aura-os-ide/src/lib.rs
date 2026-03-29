use tao::event_loop::EventLoopWindowTarget;
use tao::window::{Icon, Window, WindowBuilder, WindowId};
use tracing::info;
use wry::{WebView, WebViewBuilder};

fn filename_from_path(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
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

    let encoded_path = urlencoding::encode(file_path);
    let mut url = format!("{base_url}/ide?file={encoded_path}");
    if let Some(root) = root_path {
        url.push_str(&format!("&root={}", urlencoding::encode(root)));
    }
    info!(%url, "opening IDE window");

    let ready_script = "\
        if (document.readyState === 'loading') { \
            document.addEventListener('DOMContentLoaded', function() { window.ipc.postMessage('ready'); }); \
        } else { \
            window.ipc.postMessage('ready'); \
        }";

    let webview = WebViewBuilder::new()
        .with_background_color((0, 0, 0, 255))
        .with_url(&url)
        .with_initialization_script(ready_script)
        .with_ipc_handler(ipc)
        .with_new_window_req_handler(|uri, _features| {
            let _ = open::that(&uri);
            wry::NewWindowResponse::Deny
        })
        .build(&window)?;

    Ok((window, webview))
}
