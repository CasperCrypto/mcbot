//! The Browser view's page: a real webview inside the McBot window, placed over the view's page
//! area. An iframe cannot do this, because most sites refuse to be framed (X-Frame-Options /
//! frame-ancestors) and show a blank page. One page webview per McBot window, labelled
//! `page-<window>`. Pages are remote URLs, so Tauri gives them no IPC (capabilities are local-only
//! unless they list `remote`); macOS and Windows only (on Linux GTK stacks child webviews instead
//! of placing them, so the view keeps its iframe and the separate browser window there); they only report where they are through `browser:url` events that
//! the shell emits to the McBot window.
use serde::Serialize;
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, WebviewUrl, Window, Wry,
};

#[derive(Clone, Serialize)]
struct Nav {
    url: String,
    loading: bool,
}

fn label(window: &Window<Wry>) -> String {
    format!("page-{}", window.label())
}

fn web_url(url: &str) -> Result<Url, String> {
    let parsed: Url = url.parse().map_err(|_| format!("{url} is not a web address"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https pages open here".into());
    }
    Ok(parsed)
}

fn bounds(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w.max(1.0), h.max(1.0)).into() }
}

/// Show `url` in this window's page, at the view's page area (logical pixels from the window's
/// top left). Makes the page the first time; navigates it after that.
#[tauri::command]
pub async fn browser_show(app: AppHandle<Wry>, window: Window<Wry>, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let parsed = web_url(&url)?;
    if cfg!(target_os = "linux") {
        // GTK packs child webviews in the window's box and ignores their bounds (checked under Xvfb).
        return Err("The embedded page is not available on Linux; use Open in a window".into());
    }
    if let Some(page) = app.get_webview(&label(&window)) {
        page.set_bounds(bounds(x, y, w, h)).map_err(|e| e.to_string())?;
        page.show().map_err(|e| e.to_string())?;
        if page.url().map(|u| u != parsed).unwrap_or(true) {
            page.navigate(parsed).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let parent = window.label().to_string();
    let emitter = app.clone();
    let builder = WebviewBuilder::new(label(&window), WebviewUrl::External(parsed)).on_page_load(move |_page, payload| {
        let url = payload.url().to_string();
        let loading = matches!(payload.event(), PageLoadEvent::Started);
        let _ = emitter.emit_to(parent.as_str(), "browser:url", Nav { url, loading });
    });
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w.max(1.0), h.max(1.0)))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Keep the page over the view's page area when the window or the layout changes.
#[tauri::command]
pub async fn browser_bounds(app: AppHandle<Wry>, window: Window<Wry>, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    match app.get_webview(&label(&window)) {
        Some(page) => page.set_bounds(bounds(x, y, w, h)).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Hide the page (the person left the Browser view, or a sheet covers it). It keeps its place.
#[tauri::command]
pub async fn browser_hide(app: AppHandle<Wry>, window: Window<Wry>) -> Result<(), String> {
    match app.get_webview(&label(&window)) {
        Some(page) => page.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Back, forward or reload, inside the page's own history.
#[tauri::command]
pub async fn browser_go(app: AppHandle<Wry>, window: Window<Wry>, action: String) -> Result<(), String> {
    let Some(page) = app.get_webview(&label(&window)) else { return Ok(()) };
    match action.as_str() {
        "back" => page.eval("history.back()"),
        "forward" => page.eval("history.forward()"),
        "reload" => page.reload(),
        _ => return Err(format!("unknown action {action}")),
    }
    .map_err(|e| e.to_string())
}
