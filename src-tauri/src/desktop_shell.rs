use std::fs;
use std::time::Duration;

use arboard::Clipboard;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

#[derive(Serialize, Deserialize)]
struct Placement {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
}

pub fn install(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    restore_or_fit(app);
    watch_main_window(app);
    build_tray(app)?;
    build_overlay(app)?;
    watch_clipboard(app.handle().clone());
    Ok(())
}

fn placement_path(app: &tauri::App) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("window.json"))
}

fn placement_is_usable(saved: &Placement) -> bool {
    saved.width >= 480.0
        && saved.height >= 320.0
        && saved.x > -16_000.0
        && saved.y > -16_000.0
        && saved.x < 16_000.0
        && saved.y < 16_000.0
}

fn restore_or_fit(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let mut restored = false;
    if let Some(path) = placement_path(app) {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(saved) = serde_json::from_str::<Placement>(&raw) {
                if placement_is_usable(&saved) {
                    let _ = window.set_size(tauri::Size::Logical(LogicalSize::new(saved.width, saved.height)));
                    let _ = window.set_position(tauri::Position::Logical(LogicalPosition::new(saved.x, saved.y)));
                    if saved.maximized {
                        let _ = window.maximize();
                    }
                    restored = true;
                }
            }
        }
    }
    if !restored {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let scale = monitor.scale_factor();
            let width = monitor.size().width as f64 / scale * 0.9;
            let height = monitor.size().height as f64 / scale * 0.9;
            let _ = window.set_size(tauri::Size::Logical(LogicalSize::new(width, height)));
            let _ = window.center();
        }
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn save_placement(window: &tauri::WebviewWindow) {
    let Ok(app) = window.app_handle().path().app_config_dir() else {
        return;
    };
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let placement = Placement {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        maximized: window.is_maximized().unwrap_or(false),
    };
    if !placement_is_usable(&placement) {
        return;
    }
    let _ = fs::create_dir_all(&app);
    let _ = fs::write(app.join("window.json"), serde_json::to_string(&placement).unwrap_or_default());
}

fn watch_main_window(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let save_target = window.clone();
    window.on_window_event(move |event| {
        match event {
            WindowEvent::CloseRequested { .. } => {
                save_placement(&save_target);
                save_target.app_handle().exit(0);
            }
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => save_placement(&save_target),
            _ => {}
        }
    });
}

fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show Scribble", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("scribble")
        .menu(&menu)
        .tooltip("Scribble")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => reveal(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn build_overlay(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window("countdown").is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "countdown", WebviewUrl::App("index.html?overlay=countdown".into()))
        .title("Scribble countdown")
        .inner_size(400.0, 176.0)
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .shadow(false)
        .build()?;
    Ok(())
}

#[tauri::command]
pub fn overlay_set_visible(app: AppHandle, visible: bool) {
    let Some(window) = app.get_webview_window("countdown") else {
        return;
    };
    if !visible {
        let _ = window.hide();
        return;
    }
    let _ = window.set_size(tauri::Size::Logical(LogicalSize::new(400.0, 176.0)));
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let position = monitor.position();
        let size = monitor.size();
        let width = 400.0 * scale;
        let height = 176.0 * scale;
        let x = position.x as f64 + size.width as f64 - width - 28.0 * scale;
        let y = position.y as f64 + size.height as f64 - height - 72.0 * scale;
        let _ = window.set_position(tauri::Position::Physical(PhysicalPosition::new(x as i32, y as i32)));
    }
    let _ = window.show();
}

fn watch_clipboard(app: AppHandle) {
    std::thread::spawn(move || {
        let mut clipboard = match Clipboard::new() {
            Ok(clipboard) => clipboard,
            Err(error) => {
                eprintln!("[scribble] clipboard watch unavailable: {error}");
                return;
            }
        };
        let mut previous = String::new();
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let window = app.get_webview_window("main");
            let visible = window
                .as_ref()
                .and_then(|window| window.is_visible().ok())
                .unwrap_or(false);
            if !visible || crate::win_typing::foreground_is_console() {
                continue;
            }
            let focused = window
                .and_then(|window| window.is_focused().ok())
                .unwrap_or(false);
            if focused {
                continue;
            }
            let Ok(text) = clipboard.get_text() else {
                continue;
            };
            let trimmed = text.trim();
            if trimmed.is_empty() || trimmed == previous || trimmed.chars().count() > 20_000 {
                continue;
            }
            previous = trimmed.to_string();
            let preview: String = trimmed.chars().take(180).collect();
            let _ = app.emit(
                "clipboard://offer",
                serde_json::json!({ "text": trimmed, "preview": preview }),
            );
        }
    });
}
