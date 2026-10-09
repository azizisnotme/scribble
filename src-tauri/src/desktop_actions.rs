//! Actions Scribble AI tasks can take on the desktop: open known apps, find and
//! focus windows, press shortcut keys, and report GPU memory for model sizing.

use std::time::Duration;

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::win_typing::{self, TargetHandle, WindowInfo};

/// Apps a task may open. Only these targets are ever passed to `start`.
/// Word and PowerPoint get their documented switches to skip the start screen.
const APPS: &[(&[&str], &str, &str)] = &[
    (&["notepad"], "notepad", "Notepad"),
    (&["word", "microsoft word", "winword"], "winword /w", "Word"),
    (&["excel", "microsoft excel"], "excel", "Excel"),
    (&["powerpoint", "microsoft powerpoint"], "powerpnt /b", "PowerPoint"),
    (&["outlook", "microsoft outlook"], "outlook", "Outlook"),
    (&["onenote", "microsoft onenote"], "onenote", "OneNote"),
    (&["calculator", "calc"], "calc", "Calculator"),
    (&["paint", "mspaint"], "mspaint", "Paint"),
    (&["file explorer", "explorer", "files"], "explorer", ""),
    (&["settings", "windows settings"], "ms-settings:", "Settings"),
    (&["chrome", "google chrome"], "chrome", "Chrome"),
    (&["edge", "microsoft edge"], "msedge", "Edge"),
    (&["firefox", "mozilla firefox"], "firefox", "Firefox"),
    (&["task manager"], "taskmgr", "Task Manager"),
    (&["spotify"], "spotify:", "Spotify"),
    (&["teams", "microsoft teams"], "msteams:", "Teams"),
    (&["microsoft store", "store"], "ms-windows-store:", "Microsoft Store"),
    (&["photos"], "ms-photos:", "Photos"),
    (&["camera"], "microsoft.windows.camera:", "Camera"),
    (&["clock", "alarms"], "ms-clock:", "Clock"),
];

#[derive(Serialize)]
pub struct LaunchedApp {
    name: String,
    window_hint: String,
}

#[derive(Serialize, Default)]
pub struct GpuMemory {
    name: String,
    dedicated_mb: u64,
    shared_mb: u64,
}

fn scribble_hwnd(app: &AppHandle) -> Option<TargetHandle> {
    let raw = app
        .webview_windows()
        .values()
        .next()
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0);
    win_typing::scribble_hwnd(raw)
}

fn find_app(name: &str) -> Option<&'static (&'static [&'static str], &'static str, &'static str)> {
    let lower = name.trim().to_lowercase();
    let wanted = lower
        .trim_end_matches(".exe")
        .trim_start_matches("the ")
        .trim_end_matches(" app")
        .trim();
    APPS.iter().find(|(aliases, _, _)| aliases.contains(&wanted))
}

pub fn known_app_names() -> Vec<&'static str> {
    APPS.iter().map(|(aliases, _, _)| aliases[0]).collect()
}

#[tauri::command]
pub fn launch_app(name: String) -> Result<LaunchedApp, String> {
    let Some((aliases, target, hint)) = find_app(&name) else {
        return Err(format!(
            "Scribble can open these apps: {}.",
            known_app_names().join(", ")
        ));
    };
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/C", "start", ""]).args(target.split(' '));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn().map_err(|e| format!("Could not open {}: {e}", aliases[0]))?;
    Ok(LaunchedApp {
        name: aliases[0].to_string(),
        window_hint: hint.to_string(),
    })
}

#[tauri::command]
pub fn foreground_window(app: AppHandle) -> Option<WindowInfo> {
    win_typing::foreground_window(scribble_hwnd(&app))
}

#[tauri::command]
pub async fn focus_window(app: AppHandle, title: String) -> Result<WindowInfo, String> {
    let scribble = scribble_hwnd(&app);
    let wanted = title.clone();
    let found = tokio::task::spawn_blocking(move || win_typing::find_window_loose(&wanted, scribble))
        .await
        .map_err(|e| e.to_string())?;
    let Some(window) = found else {
        return Err(format!("No open window has \"{}\" in its title.", title.trim()));
    };
    win_typing::bring_to_front(window.hwnd);
    Ok(window)
}

#[tauri::command]
pub fn focus_hwnd(hwnd: i64) -> bool {
    win_typing::bring_to_front(hwnd as isize)
}

fn parse_key(token: &str) -> Option<Key> {
    let key = match token {
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "space" | "spacebar" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "up" | "uparrow" => Key::UpArrow,
        "down" | "downarrow" => Key::DownArrow,
        "left" | "leftarrow" => Key::LeftArrow,
        "right" | "rightarrow" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "pgup" => Key::PageUp,
        "pagedown" | "pgdn" => Key::PageDown,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        other => {
            let mut chars = other.chars();
            let first = chars.next()?;
            if chars.next().is_some() {
                return None;
            }
            Key::Unicode(first)
        }
    };
    Some(key)
}

fn press_combo(enigo: &mut Enigo, combo: &str) -> Result<(), String> {
    let mut modifiers = Vec::new();
    let mut main = None;
    for part in combo.split('+').map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()) {
        match part.as_str() {
            "ctrl" | "control" => modifiers.push(Key::Control),
            "shift" => modifiers.push(Key::Shift),
            "alt" => modifiers.push(Key::Alt),
            "win" | "windows" | "meta" | "super" | "cmd" => modifiers.push(Key::Meta),
            other => main = Some(parse_key(other).ok_or_else(|| format!("Unknown key \"{other}\"."))?),
        }
    }
    for key in &modifiers {
        enigo.key(*key, Direction::Press).map_err(|e| e.to_string())?;
    }
    let pressed = main.map(|key| enigo.key(key, Direction::Click).map_err(|e| e.to_string()));
    for key in modifiers.iter().rev() {
        let _ = enigo.key(*key, Direction::Release);
    }
    pressed.unwrap_or(Ok(()))
}

/// Press shortcuts like `ctrl+s`, or several separated by commas: `ctrl+a, ctrl+c`.
#[tauri::command]
pub async fn press_keys(keys: String, hwnd: Option<i64>) -> Result<(), String> {
    if let Some(handle) = hwnd.filter(|h| *h != 0) {
        win_typing::bring_to_front(handle as isize);
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    tokio::task::spawn_blocking(move || {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        for combo in keys.split(',').map(str::trim).filter(|c| !c.is_empty()) {
            press_combo(&mut enigo, combo)?;
            std::thread::sleep(Duration::from_millis(120));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn read_gpu_memory() -> GpuMemory {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};

    let mut best = GpuMemory::default();
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
            return best;
        };
        let mut index = 0;
        while let Ok(adapter) = factory.EnumAdapters1(index) {
            index += 1;
            let Ok(desc) = adapter.GetDesc1() else {
                continue;
            };
            if desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
                continue;
            }
            let dedicated = (desc.DedicatedVideoMemory / 1_048_576) as u64;
            let shared = (desc.SharedSystemMemory / 1_048_576) as u64;
            if dedicated > best.dedicated_mb || (best.name.is_empty() && shared > best.shared_mb) {
                let end = desc.Description.iter().position(|c| *c == 0).unwrap_or(desc.Description.len());
                best = GpuMemory {
                    name: String::from_utf16_lossy(&desc.Description[..end]),
                    dedicated_mb: dedicated,
                    shared_mb: shared,
                };
            }
        }
    }
    best
}

#[cfg(not(windows))]
fn read_gpu_memory() -> GpuMemory {
    GpuMemory::default()
}

#[tauri::command]
pub async fn gpu_memory() -> GpuMemory {
    tokio::task::spawn_blocking(read_gpu_memory).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_names_are_matched_loosely() {
        assert_eq!(find_app("Notepad").map(|a| a.1), Some("notepad"));
        assert_eq!(find_app("the Microsoft Word app").map(|a| a.1), Some("winword /w"));
        assert_eq!(find_app("notepad.exe").map(|a| a.1), Some("notepad"));
        assert!(find_app("powershell").is_none());
        assert!(find_app("cmd /c del").is_none());
    }

    #[test]
    fn shortcut_tokens_parse() {
        assert_eq!(parse_key("enter"), Some(Key::Return));
        assert_eq!(parse_key("s"), Some(Key::Unicode('s')));
        assert_eq!(parse_key("f12"), Some(Key::F12));
        assert_eq!(parse_key("bogus"), None);
    }
}
