//! The McBot desktop shell. Deliberately thin: windows and menus only.
//!
//! Everything else — the shared board relay, the compiler's disk writes,
//! launching Hermes, reading memory and cost — lives in the McBot engine
//! (`engine/`), a local Node process every window talks to over loopback.
//! Two windows on one board are two clients of that engine, which is what
//! makes the board live across windows, tabs and teammates alike.

use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

static WINDOWS: AtomicUsize = AtomicUsize::new(1);

/// A new window on the same app URL; it joins the same live board.
fn new_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let n = WINDOWS.fetch_add(1, Ordering::SeqCst) + 1;
    let builder = WebviewWindowBuilder::new(app, format!("board-{n}"), WebviewUrl::App("index.html".into()))
        .title("McBot")
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 600.0);
    let builder = builder.theme(Some(tauri::Theme::Dark)).background_color(tauri::window::Color(21, 21, 22, 255));
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 23.0));
    builder.build()?;
    Ok(())
}

fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let new_win = MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+N"))?;
    let app_menu = Submenu::with_items(
        app,
        "McBot",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About McBot"), Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(app, "File", true, &[&new_win, &PredefinedMenuItem::close_window(app, None)?])?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &window])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            handle.set_menu(menu(handle)?)?;
            if let Some(main) = app.get_webview_window("main") {
                main.set_focus()?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "new-window" {
                if let Err(err) = new_window(app) {
                    eprintln!("mcbot: could not open a window: {err}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running McBot");
}
