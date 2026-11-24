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

mod browser;
mod terminal;

use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};

/// The engine this app started, stopped when the app quits, and why it could not start (if so).
struct Engine(Mutex<Option<Child>>);
struct EngineError(Mutex<Option<String>>);

/// What the "engine didn't start" screen shows: whether it runs, how it ended, and its log's end.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    /// This app starts the engine itself (false in `tauri dev`, where `npm run dev` does).
    bundled: bool,
    running: bool,
    /// How it ended, when it did: "exit code 1", "killed".
    exit: Option<String>,
    /// Why it could not be started at all (missing file, blocked, no data folder).
    error: Option<String>,
    /// The last lines of engine.log, with the home folder shown as ~.
    log: String,
    log_path: Option<String>,
}

fn engine_log_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("engine.log"))
}

/// The last `lines` lines of the engine's log (at most 16 KB read), home folder as ~.
fn log_tail(path: &std::path::Path, lines: usize) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(16 * 1024)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf).to_string();
    let all: Vec<&str> = text.lines().collect();
    let tail = all[all.len().saturating_sub(lines)..].join("\n");
    match std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        Ok(home) if !home.is_empty() => tail.replace(&home, "~"),
        _ => tail,
    }
}

fn engine_status_of<R: Runtime>(app: &AppHandle<R>) -> EngineStatus {
    let engine = app.state::<Engine>();
    let mut guard = engine.0.lock().unwrap();
    let (running, exit) = match guard.as_mut() {
        None => (false, None),
        Some(child) => match child.try_wait() {
            Ok(None) => (true, None),
            Ok(Some(status)) => (false, Some(status.code().map(|c| format!("exit code {c}")).unwrap_or_else(|| "killed".into()))),
            Err(e) => (false, Some(e.to_string())),
        },
    };
    drop(guard);
    let path = engine_log_path(app);
    EngineStatus {
        bundled: !cfg!(debug_assertions),
        running,
        exit,
        error: app.state::<EngineError>().0.lock().unwrap().clone(),
        log: path.as_deref().map(|p| log_tail(p, 40)).unwrap_or_default(),
        log_path: path.map(|p| p.display().to_string()),
    }
}

/// How the engine is doing, for the window that can't reach it.
#[tauri::command]
fn engine_status(app: AppHandle<Wry>) -> EngineStatus {
    engine_status_of(&app)
}

/// Stop the engine this app started (if it still runs) and start it again.
#[tauri::command]
fn engine_restart(app: AppHandle<Wry>) -> EngineStatus {
    if let Some(mut child) = app.state::<Engine>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let started = start_engine(&app);
    let error = started.as_ref().err().cloned();
    if let Ok(child) = started {
        *app.state::<Engine>().0.lock().unwrap() = child;
    }
    *app.state::<EngineError>().0.lock().unwrap() = error;
    engine_status_of(&app)
}

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
    // The app itself, which the engine serves to people who open a Share link in a web browser.
    cmd.env("MCBOT_WEB_DIR", resources.join("web"));
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

/// The floating island: a small always-on-top window (label `island`) at the top centre of the
/// screen. It shows while no McBot window is in front and something needs the person (or every
/// window is hidden, so it is the way back); a click brings the app forward, its arrow hides it.
struct Island(Mutex<bool>);

fn mcbot_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<tauri::WebviewWindow<R>> {
    app.webview_windows().into_iter().filter(|(l, _)| l != "island").map(|(_, w)| w).collect()
}

fn shown<R: Runtime>(w: &tauri::WebviewWindow<R>) -> bool {
    w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false)
}

/// Show or hide the island by the rules above. Cheap: called on every focus change.
fn refresh_island<R: Runtime>(app: &AppHandle<R>) {
    let Some(pill) = app.get_webview_window("island") else { return };
    let wins = mcbot_windows(app);
    let front = wins.iter().any(|w| shown(w) && w.is_focused().unwrap_or(false));
    let any_shown = wins.iter().any(shown);
    let active = *app.state::<Island>().0.lock().unwrap();
    let want = !wins.is_empty() && !front && (active || !any_shown);
    let _ = if want { pill.show() } else { pill.hide() };
}

/// Check again once the window system has settled (minimize and hide report late).
fn refresh_island_soon<R: Runtime>(app: &AppHandle<R>) {
    refresh_island(app);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        refresh_island(&app);
    });
}

fn build_island(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let b = WebviewWindowBuilder::new(app, "island", WebviewUrl::App("index.html".into()))
        .title("McBot")
        .inner_size(240.0, 32.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .visible(false);
    // Windows can draw a see-through window, so the pill's bottom corners are round and it sits fused to the top edge.
    // (macOS needs a private API for that: there it stays a black rectangle flush with the top.)
    #[cfg(windows)]
    let b = b.transparent(true).background_color(tauri::window::Color(0, 0, 0, 0));
    #[cfg(not(windows))]
    let b = b.background_color(tauri::window::Color(0, 0, 0, 255));
    b.build()?;
    Ok(())
}

/// The pill is as big as its content, centred at the top of the primary screen.
#[tauri::command]
fn island_resize(app: AppHandle<Wry>, width: f64, height: f64) {
    let Some(pill) = app.get_webview_window("island") else { return };
    let (w, h) = (width.clamp(160.0, 520.0), height.clamp(24.0, 200.0));
    let _ = pill.set_size(tauri::LogicalSize::new(w, h));
    if let Ok(Some(m)) = app.primary_monitor() {
        let scale = m.scale_factor();
        let x = m.position().x as f64 / scale + (m.size().width as f64 / scale - w) / 2.0;
        let y = m.position().y as f64 / scale;
        let _ = pill.set_position(tauri::LogicalPosition::new(x, y));
    }
}

/// The window says whether something is going on that the person should see from anywhere.
#[tauri::command]
fn island_active(app: AppHandle<Wry>, active: bool) {
    *app.state::<Island>().0.lock().unwrap() = active;
    refresh_island(&app);
}

/// The pill was clicked: bring McBot forward.
#[tauri::command]
fn island_open(app: AppHandle<Wry>) {
    show(&app);
    refresh_island_soon(&app);
}

/// The pill's arrow: hide McBot's windows (the pill stays, the way back).
#[tauri::command]
fn island_toggle_app(app: AppHandle<Wry>) {
    for w in mcbot_windows(&app) {
        let _ = w.hide();
    }
    refresh_island_soon(&app);
}

/// From anywhere on the computer: bring McBot Studio forward with ⌘K open, like a launcher.
/// If another app already holds the combination, McBot keeps working without it.
pub const SUMMON: &str = "CommandOrControl+Shift+Space";

fn summon_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_global_shortcut::ShortcutState;
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                // The window that comes forward (the same one `show` picks) opens ⌘K; a new one just opens.
                let front = app.webview_windows().into_keys().find(|l| l != "island");
                show(app);
                if let Some(label) = front {
                    let _ = app.emit_to(label.as_str(), "summon", ());
                }
            }
        })
        .build()
}

/// Bring a McBot window to the front, opening one if every window was closed.
fn show<R: Runtime>(app: &AppHandle<R>) {
    match app.webview_windows().into_values().find(|w| w.label() != "island") {
        Some(w) => {
            let w = app.webview_windows().into_iter().find(|(l, _)| l != "island").map(|(_, w)| w).unwrap_or(w);
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
        .tooltip("McBot Studio")
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

/// The workbench's browser: one McBot window showing a web page (what an agent built on
/// localhost, a report, any https site), reused for the next page. http(s) only. The page gets
/// no access to McBot (the window's capabilities list only McBot's own windows).
// Async on purpose: building a window inside a synchronous command deadlocks on Windows (Tauri's
// docs), which left a white browser window that could not even be closed.
#[tauri::command]
async fn browser_open(app: AppHandle<Wry>, url: String) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| format!("{url} is not a web address"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https pages open here".into());
    }
    if let Some(w) = app.get_webview_window("browser") {
        w.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = w.show();
        return w.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, "browser", WebviewUrl::External(parsed))
        .title("McBot Studio Browser")
        .inner_size(1200.0, 820.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

static WINDOWS: AtomicUsize = AtomicUsize::new(1);

/// A new window on the same app URL; it joins the same live board.
fn new_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let n = WINDOWS.fetch_add(1, Ordering::SeqCst) + 1;
    let builder = WebviewWindowBuilder::new(app, format!("board-{n}"), WebviewUrl::App("index.html".into()))
        .title("McBot Studio")
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 600.0);
    let builder = builder.theme(Some(tauri::Theme::Dark)).background_color(tauri::window::Color(12, 12, 13, 255));
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 23.0));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    builder.build()?;
    Ok(())
}

fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let new_win = MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+N"))?;
    let app_menu = Submenu::with_items(
        app,
        "McBot Studio",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About McBot Studio"), Some(AboutMetadata::default()))?,
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
        .plugin(summon_plugin())
        .manage(Engine(Mutex::new(None)))
        .manage(EngineError(Mutex::new(None)))
        .manage(Attention(Mutex::new(None)))
        .manage(Island(Mutex::new(false)))
        .manage(terminal::Terminals::default())
        .invoke_handler(tauri::generate_handler![
            engine_status,
            engine_restart,
            set_attention,
            island_resize,
            island_active,
            island_open,
            island_toggle_app,
            browser_open,
            browser::browser_show,
            browser::browser_bounds,
            browser::browser_hide,
            browser::browser_go,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close
        ])
        .setup(|app| {
            let handle = app.handle();
            match start_engine(handle) {
                Ok(child) => *app.state::<Engine>().0.lock().unwrap() = child,
                Err(err) => {
                    eprintln!("mcbot: could not start the engine: {err}");
                    *app.state::<EngineError>().0.lock().unwrap() = Some(err);
                }
            }
            handle.set_menu(menu(handle)?)?;
            if let Err(err) = tray(handle) {
                eprintln!("mcbot: no menu bar icon: {err}");
            }
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(err) = handle.global_shortcut().register(SUMMON) {
                    eprintln!("mcbot: {SUMMON} is taken by another app: {err}");
                }
            }
            if let Err(err) = build_island(handle) {
                eprintln!("mcbot: no floating island: {err}");
            }
            if let Some(main) = app.get_webview_window("main") {
                main.set_focus()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "island" && matches!(event, WindowEvent::Focused(_) | WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) {
                refresh_island_soon(window.app_handle());
            }
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
