//! The McBot desktop shell. Deliberately thin: windows, menus, and starting the engine.
//!
//! Everything else — the shared board relay, the compiler's disk writes,
//! launching Hermes, reading memory and cost — lives in the McBot engine
//! (`engine/`), a local process every window talks to over loopback.
//! Two windows on one board are two clients of that engine, which is what
//! makes the board live across windows, tabs and teammates alike.
//!
//! In the installed app the engine ships next to this executable
//! (`mcbot-engine`, built by scripts/build-engine.mjs) and Hermes inside the
//! resources (`hermes/`). `tauri dev` runs the engine itself instead.

mod terminal;

use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder, Wry};

/// The engine this app started, stopped when the app quits.
struct Engine(Mutex<Option<Child>>);

/// Start the bundled engine: Hermes from the resources, McBot's data folder for everything it writes.
fn start_engine<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Child>, String> {
    if cfg!(debug_assertions) {
        return Ok(None); // `tauri dev`: beforeDevCommand already runs the engine
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let name = if cfg!(windows) { "mcbot-engine.exe" } else { "mcbot-engine" };
    let engine = exe.parent().ok_or("no executable folder")?.join(name);
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let log = std::fs::File::create(data.join("engine.log")).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&engine);
    cmd.env("MCBOT_HERMES_BUNDLE", resources.join("hermes"))
        .env("MCBOT_DATA_DIR", &data)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console window
    }
    cmd.spawn().map(Some).map_err(|e| format!("{}: {e}", engine.display()))
}

/// The menu bar icon's "needs you" line, updated by the windows (`set_attention`).
struct Attention(Mutex<Option<MenuItem<Wry>>>);

/// Bring a McBot window to the front, opening one if every window was closed.
fn show<R: Runtime>(app: &AppHandle<R>) {
    match app.webview_windows().into_values().next() {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        None => {
            if let Err(err) = new_window(app) {
                eprintln!("mcbot: could not open a window: {err}");
            }
        }
    }
}

/// The menu bar icon (macOS menu bar, Windows and Linux tray): open McBot, what needs you, quit.
fn tray(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let attention = MenuItem::with_id(app, "attention", "Nothing needs you", false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "Open McBot", true, None::<&str>)?,
            &attention,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "new-window", "New Window", true, None::<&str>)?,
            &PredefinedMenuItem::quit(app, Some("Quit McBot"))?,
        ],
    )?;
    *app.state::<Attention>().0.lock().unwrap() = Some(attention);
    TrayIconBuilder::with_id("mcbot")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("McBot")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(|icon, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if !cfg!(target_os = "macos") {
                    show(icon.app_handle());
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// A window reports how many things need the person (Home's "Needs you"): shown next to the
/// menu bar icon on macOS, and as the tray menu's second line everywhere.
#[tauri::command]
fn set_attention(app: AppHandle<Wry>, count: u32) {
    let text = match count {
        0 => "Nothing needs you".to_string(),
        1 => "1 thing needs you".to_string(),
        n => format!("{n} things need you"),
    };
    if let Some(item) = app.state::<Attention>().0.lock().unwrap().as_ref() {
        let _ = item.set_text(&text);
    }
    if let Some(icon) = app.tray_by_id("mcbot") {
        let _ = icon.set_tooltip(Some(&text));
        #[cfg(target_os = "macos")]
        let _ = icon.set_title(if count > 0 { Some(count.to_string()) } else { None });
    }
}

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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Engine(Mutex::new(None)))
        .manage(Attention(Mutex::new(None)))
        .manage(terminal::Terminals::default())
        .invoke_handler(tauri::generate_handler![
            set_attention,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close
        ])
        .setup(|app| {
            let handle = app.handle();
            match start_engine(handle) {
                Ok(child) => *app.state::<Engine>().0.lock().unwrap() = child,
                Err(err) => eprintln!("mcbot: could not start the engine: {err}"),
            }
            handle.set_menu(menu(handle)?)?;
            if let Err(err) = tray(handle) {
                eprintln!("mcbot: no menu bar icon: {err}");
            }
            if let Some(main) = app.get_webview_window("main") {
                main.set_focus()?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "new-window" => {
                if let Err(err) = new_window(app) {
                    eprintln!("mcbot: could not open a window: {err}");
                }
            }
            "open" => show(app),
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building McBot");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            app.state::<terminal::Terminals>().close_all();
            if let Some(mut child) = app.state::<Engine>().0.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
