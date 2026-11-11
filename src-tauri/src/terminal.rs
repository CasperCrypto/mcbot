//! The workbench terminal: real shells on this computer, one PTY each (portable-pty, MIT).
//!
//! The window opens a shell in a folder (an agent's workspace or a folder the person opened),
//! writes keystrokes, resizes it and closes it. Output streams back as `terminal-output` events
//! (base64 bytes, so a UTF-8 character split across reads arrives whole); `terminal-exit` says it
//! ended. Shells die with the app. The engine is not involved, so it stays one plain executable.

use base64::Engine as _;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime, State};

struct Shell {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    shells: Mutex<HashMap<u32, Shell>>,
    next: AtomicU32,
}

impl Terminals {
    /// Kill every shell (the app is quitting).
    pub fn close_all(&self) {
        for (_, mut shell) in self.shells.lock().unwrap().drain() {
            let _ = shell.child.kill();
        }
    }
}

#[derive(Clone, Serialize)]
struct Output {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
}

/// The person's own shell: $SHELL (a login shell) on macOS and Linux, PowerShell on Windows.
fn shell_command(cwd: &Path) -> CommandBuilder {
    let mut cmd = if cfg!(windows) {
        CommandBuilder::new("powershell.exe")
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() });
        let mut c = CommandBuilder::new(shell);
        c.arg("-l");
        c
    };
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd
}

#[tauri::command]
pub fn terminal_open<R: Runtime>(app: AppHandle<R>, state: State<'_, Terminals>, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    let dir = Path::new(&cwd);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("{cwd} is not a folder"));
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(shell_command(dir)).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    state.shells.lock().unwrap().insert(id, Shell { master: pair.master, writer, child });

    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app.emit("terminal-output", Output { id, data });
                }
            }
        }
        let _ = app.emit("terminal-exit", Exit { id });
    });
    Ok(id)
}

#[tauri::command]
pub fn terminal_write(state: State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    let mut shells = state.shells.lock().unwrap();
    let shell = shells.get_mut(&id).ok_or("that terminal is closed")?;
    shell.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    shell.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let shells = state.shells.lock().unwrap();
    let shell = shells.get(&id).ok_or("that terminal is closed")?;
    shell.master.resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_close(state: State<'_, Terminals>, id: u32) {
    if let Some(mut shell) = state.shells.lock().unwrap().remove(&id) {
        let _ = shell.child.kill();
    }
}
