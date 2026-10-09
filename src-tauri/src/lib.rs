//! Scribble — Rust core for the Tauri shell.
//!
//! Three responsibilities:
//!   1. Expose a small typing engine to the frontend (`type_text`,
//!      `cancel_typing`, `typing_status`). The engine is a single
//!      background task; calling `type_text` while one is running
//!      replaces it.
//!   2. Register global F9 / F10 hotkeys so the user can start /
//!      cancel typing from any focused window without alt-tabbing
//!      back to Scribble. Events are emitted to the frontend as
//!      `hotkey://start` and `hotkey://cancel`.
//!   3. Hand the frontend a single `app_info` command for the
//!      "About this build" panel.
//!
//! There is no Python anywhere. OCR runs in the renderer via
//! tesseract.js; analytics live in localStorage; AI inference runs in the
//! WebView via MLC WebLLM (WebGPU). Optional Windows bundled Ollama remains
//! available from legacy commands only.

mod auth_callback;
mod desktop_shell;
mod bundled_ai;
mod typing;
mod win_typing;

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use auth_callback::AuthCallbackState;
use bundled_ai::{BundledAiProbe, BundledAiState};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tokio::sync::Mutex;
use typing::{TypingEngine, TypingOptions, TypingStatus};
use win_typing::WindowInfo;

const CREDENTIAL_SERVICE: &str = "com.scribble.desktop.supabase";
const CREDENTIAL_CHUNK_BYTES: usize = 1_800;
const MAX_TYPING_CHARS: usize = 100_000;

#[derive(Default)]
struct AppState {
    engine: Mutex<Option<Arc<TypingEngine>>>,
}

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    rust_version: &'static str,
    target_triple: &'static str,
}

#[tauri::command]
async fn machine_id() -> String {
    static CACHED: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    if let Some(id) = CACHED.get() {
        return id.clone();
    }
    let id = tokio::task::spawn_blocking(|| {
        let output = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output();
        if let Ok(output) = output {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let mut parts = line.split_whitespace();
                if parts.next() == Some("MachineGuid") {
                    if let Some(id) = parts.last() {
                        if !id.is_empty() {
                            return id.to_string();
                        }
                    }
                }
            }
        }
        "unknown-pc".to_string()
    })
    .await
    .unwrap_or_else(|_| "unknown-pc".to_string());
    CACHED.get_or_init(|| id.clone());
    id
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
        rust_version: env!("CARGO_PKG_RUST_VERSION"),
        target_triple: std::env::consts::ARCH,
    }
}

fn credential_entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, account).map_err(|e| e.to_string())
}

fn validate_credential_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > 256
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
    {
        return Err("Invalid credential storage key".into());
    }
    Ok(())
}

fn credential_chunks(value: &str) -> Vec<String> {
    value
        .as_bytes()
        .chunks(CREDENTIAL_CHUNK_BYTES)
        .map(|chunk| BASE64.encode(chunk))
        .collect()
}

fn validate_typing_length(text: &str) -> Result<(), String> {
    let char_count = text.chars().count();
    if char_count > MAX_TYPING_CHARS {
        return Err(format!(
            "Text is too long ({char_count} characters). The limit is {MAX_TYPING_CHARS} characters per run."
        ));
    }
    Ok(())
}

fn remove_credential_chunks(key: &str) -> Result<(), String> {
    let manifest_account = format!("{key}:manifest");
    let manifest = match credential_entry(&manifest_account)?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let count = manifest
        .parse::<usize>()
        .map_err(|_| "Credential manifest is invalid".to_string())?;

    for index in 0..count {
        let account = format!("{key}:part:{index}");
        match credential_entry(&account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    match credential_entry(&manifest_account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn auth_storage_get(key: String) -> Result<Option<String>, String> {
    validate_credential_key(&key)?;
    let manifest = match credential_entry(&format!("{key}:manifest"))?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let count = manifest
        .parse::<usize>()
        .map_err(|_| "Credential manifest is invalid".to_string())?;
    let mut bytes = Vec::new();

    for index in 0..count {
        let encoded = credential_entry(&format!("{key}:part:{index}"))?
            .get_password()
            .map_err(|e| e.to_string())?;
        let mut chunk = BASE64
            .decode(encoded)
            .map_err(|_| "Credential data is invalid".to_string())?;
        bytes.append(&mut chunk);
    }

    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "Credential data is not valid UTF-8".to_string())
}

#[tauri::command]
fn auth_storage_set(key: String, value: String) -> Result<(), String> {
    validate_credential_key(&key)?;
    remove_credential_chunks(&key)?;

    let chunks = credential_chunks(&value);

    for (index, chunk) in chunks.iter().enumerate() {
        credential_entry(&format!("{key}:part:{index}"))?
            .set_password(chunk)
            .map_err(|e| e.to_string())?;
    }
    credential_entry(&format!("{key}:manifest"))?
        .set_password(&chunks.len().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn auth_storage_remove(key: String) -> Result<(), String> {
    validate_credential_key(&key)?;
    remove_credential_chunks(&key)
}

#[tauri::command]
async fn auth_callback_url(state: tauri::State<'_, AuthCallbackState>) -> Result<String, String> {
    for _ in 0..20 {
        if let Some(url) = state.redirect_url.lock().await.clone() {
            return Ok(url);
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    Ok("scribble://auth/callback".into())
}

/// Inject `text` into the currently focused window at roughly `wpm` words
/// per minute. Returns immediately; progress is broadcast on the
/// `typing://progress` event channel and the final result on
/// `typing://done`.
#[tauri::command]
async fn list_target_windows(app: AppHandle) -> Result<Vec<WindowInfo>, String> {
    let raw = app
        .webview_windows()
        .values()
        .next()
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0);
    let scribble = win_typing::scribble_hwnd(raw);
    tokio::task::spawn_blocking(move || win_typing::list_windows(scribble))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn type_text(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    text: String,
    wpm: Option<u32>,
    auto_repair: Option<bool>,
    start_delay_ms: Option<u64>,
    target_window_title: Option<String>,
    target_window_hwnd: Option<i64>,
    mistakes_enabled: Option<bool>,
    mistake_chance: Option<f32>,
    thinking_pauses: Option<bool>,
) -> Result<(), String> {
    validate_typing_length(&text)?;
    let engine = ensure_engine(&app, &state).await;
    #[cfg(windows)]
    let lock_focus = true;
    #[cfg(not(windows))]
    let lock_focus = false;

    let title = target_window_title.filter(|t| !t.trim().is_empty());
    let hwnd = target_window_hwnd.filter(|h| *h != 0).map(|h| h as isize);

    engine
        .start(
            text,
            TypingOptions {
                wpm: wpm.unwrap_or(220).clamp(10, 2000),
                start_delay_ms: start_delay_ms.unwrap_or(0).min(30_000),
                lock_focus,
                target_window_hwnd: hwnd,
                target_window_title: title,
                auto_repair: auto_repair.unwrap_or(true),
                mistakes_enabled: mistakes_enabled.unwrap_or(false),
                mistake_chance: mistake_chance.unwrap_or(0.02).clamp(0.0, 1.0),
                thinking_pauses: thinking_pauses.unwrap_or(false),
            },
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_typing(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let engine = ensure_engine(&app, &state).await;
    Ok(engine.cancel().await)
}

#[tauri::command]
async fn typing_status(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<TypingStatus, String> {
    let engine = ensure_engine(&app, &state).await;
    Ok(engine.status().await)
}

#[tauri::command]
async fn pause_typing(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let engine = ensure_engine(&app, &state).await;
    Ok(engine.toggle_pause().await)
}

#[tauri::command]
fn bundled_ai_probe(app: AppHandle) -> BundledAiProbe {
    bundled_ai::bundled_ai_probe(&app)
}

#[tauri::command]
async fn bundled_ai_download_and_extract(
    app: AppHandle,
    state: tauri::State<'_, BundledAiState>,
) -> Result<(), String> {
    bundled_ai::bundled_ai_download_and_extract(app, state).await
}

#[tauri::command]
async fn bundled_ai_ensure_server(
    app: AppHandle,
    state: tauri::State<'_, BundledAiState>,
) -> Result<(), String> {
    bundled_ai::bundled_ai_ensure_server(app, state).await
}

#[tauri::command]
async fn bundled_ai_stop_server(state: tauri::State<'_, BundledAiState>) -> Result<(), String> {
    bundled_ai::bundled_ai_stop_server(state).await
}

async fn ensure_engine(app: &AppHandle, state: &tauri::State<'_, AppState>) -> Arc<TypingEngine> {
    let mut guard = state.engine.lock().await;
    if let Some(existing) = guard.as_ref() {
        return existing.clone();
    }
    let engine = Arc::new(TypingEngine::new(app.clone()));
    *guard = Some(engine.clone());
    engine
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(handle_global_shortcut)
                .build(),
        )
        .manage(AppState::default())
        .manage(BundledAiState::default())
        .manage(AuthCallbackState::default())
        .setup(|app| {
            auth_callback::spawn(app.handle().clone());
            desktop_shell::install(app)?;
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            app.deep_link().register_all()?;

            // Register F9 = start, F10 = cancel. Failures are non-fatal —
            // the in-app buttons still work. The most common reason a
            // shortcut fails to register is that another app already owns
            // it; in that case we surface the error to the frontend so
            // the Settings panel can show "in use".
            let manager = app.global_shortcut();
            let f9 = Shortcut::new(Some(Modifiers::empty()), Code::F9);
            let f10 = Shortcut::new(Some(Modifiers::empty()), Code::F10);
            let f11 = Shortcut::new(Some(Modifiers::empty()), Code::F11);
            if let Err(e) = manager.register(f9) {
                eprintln!("[scribble] F9 shortcut not registered: {e}");
            }
            if let Err(e) = manager.register(f10) {
                eprintln!("[scribble] F10 shortcut not registered: {e}");
            }
            if let Err(e) = manager.register(f11) {
                eprintln!("[scribble] F11 shortcut not registered: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            machine_id,
            auth_storage_get,
            auth_storage_set,
            auth_storage_remove,
            auth_callback_url,
            desktop_shell::overlay_set_visible,
            list_target_windows,
            type_text,
            cancel_typing,
            pause_typing,
            typing_status,
            bundled_ai_probe,
            bundled_ai_download_and_extract,
            bundled_ai_ensure_server,
            bundled_ai_stop_server,
        ])
        .build(tauri::generate_context!())
        .expect("error while building scribble desktop")
        .run(|handle, event| {
            if let RunEvent::Exit = event {
                let h = handle.clone();
                tauri::async_runtime::block_on(async move {
                    if let Some(st) = h.try_state::<BundledAiState>() {
                        st.shutdown_server().await;
                    }
                });
            }
        });
}

fn handle_global_shortcut(
    app: &AppHandle,
    shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    // Fire on key-down only; key-up would double-trigger.
    if event.state() != ShortcutState::Pressed {
        return;
    }
    if shortcut.matches(Modifiers::empty(), Code::F9) {
        let _ = app.emit("hotkey://start", ());
    } else if shortcut.matches(Modifiers::empty(), Code::F10) {
        let _ = app.emit("hotkey://cancel", ());
    } else if shortcut.matches(Modifiers::empty(), Code::F11) {
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(st) = app_clone.try_state::<AppState>() {
                if let Some(engine) = st.engine.lock().await.as_ref() {
                    engine.toggle_pause().await;
                }
            }
        });
        let _ = app.emit("hotkey://pause", ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_keys_are_narrowly_scoped() {
        assert!(validate_credential_key("sb-project-auth-token:flow-id").is_ok());
        assert!(validate_credential_key("../other-service").is_err());
        assert!(validate_credential_key("").is_err());
    }

    #[test]
    fn large_credentials_round_trip_through_chunks() {
        let original = "session-data-".repeat(700);
        let rebuilt = credential_chunks(&original)
            .into_iter()
            .flat_map(|chunk| BASE64.decode(chunk).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(String::from_utf8(rebuilt).unwrap(), original);
    }

    #[test]
    fn typing_payload_limit_counts_unicode_characters() {
        assert!(validate_typing_length(&"é".repeat(MAX_TYPING_CHARS)).is_ok());
        assert!(validate_typing_length(&"é".repeat(MAX_TYPING_CHARS + 1)).is_err());
    }

    fn display_window_size(avail_w: f64, avail_h: f64) -> (f64, f64) {
        let factor = 0.9;
        (
            (avail_w * factor).clamp(720.0, avail_w),
            (avail_h * factor).clamp(500.0, avail_h),
        )
    }

    #[test]
    fn window_keeps_the_monitor_aspect_ratio() {
        let (width, height) = display_window_size(1920.0, 1080.0);
        assert!((width / height - 1920.0 / 1080.0).abs() < 0.01);
        assert!((width - 1728.0).abs() < 0.01);
        assert!((height - 972.0).abs() < 0.01);
    }
}
