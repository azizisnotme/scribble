//! Windows-only: lock typing to a target window and read focused field text.

use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct WindowInfo {
    pub title: String,
    pub hwnd: isize,
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsWindow,
        IsWindowVisible, SendMessageTimeoutW, SetForegroundWindow, SMTO_ABORTIFHUNG, SMTO_BLOCK,
        WM_GETTEXT, WM_GETTEXTLENGTH,
    };

    use super::WindowInfo;

    pub type TargetHandle = isize;

    pub fn scribble_hwnd(raw: Option<*mut c_void>) -> Option<TargetHandle> {
        raw.map(|p| p as isize)
    }

    fn class_name(hwnd: HWND) -> String {
        unsafe {
            let mut buf = [0u16; 256];
            let read = GetClassNameW(hwnd, &mut buf) as usize;
            if read == 0 {
                return String::new();
            }
            String::from_utf16_lossy(&buf[..read])
        }
    }

    fn is_console_class(class: &str) -> bool {
        matches!(
            class,
            "ConsoleWindowClass" | "CASCADIA_HOSTING_WINDOW_CLASS" | "PseudoConsoleWindow"
        )
    }

    /// A starting terminal does not answer window messages. Waiting on it freezes Scribble.
    fn window_title(hwnd: HWND) -> String {
        unsafe {
            let mut length = 0usize;
            let sent = SendMessageTimeoutW(
                hwnd,
                WM_GETTEXTLENGTH,
                WPARAM(0),
                LPARAM(0),
                SMTO_ABORTIFHUNG | SMTO_BLOCK,
                40,
                Some(&mut length),
            );
            if sent.0 == 0 || length == 0 || length > 400 {
                return String::new();
            }
            let mut buf = vec![0u16; length + 1];
            let mut copied = 0usize;
            let sent = SendMessageTimeoutW(
                hwnd,
                WM_GETTEXT,
                WPARAM(buf.len()),
                LPARAM(buf.as_mut_ptr() as isize),
                SMTO_ABORTIFHUNG | SMTO_BLOCK,
                40,
                Some(&mut copied),
            );
            if sent.0 == 0 || copied == 0 {
                return String::new();
            }
            let end = copied.min(buf.len().saturating_sub(1));
            String::from_utf16_lossy(&buf[..end]).trim().to_string()
        }
    }

    fn is_our_process(hwnd: HWND, scribble_hwnd: Option<TargetHandle>) -> bool {
        unsafe {
            if let Some(ours) = scribble_hwnd {
                if hwnd.0 as isize == ours {
                    return true;
                }
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            pid == GetCurrentProcessId()
        }
    }

    fn is_listable(hwnd: HWND, scribble_hwnd: Option<TargetHandle>) -> bool {
        unsafe {
            if hwnd.0.is_null() || !IsWindowVisible(hwnd).as_bool() {
                return false;
            }
            if is_our_process(hwnd, scribble_hwnd) {
                return false;
            }
            if is_console_class(&class_name(hwnd)) {
                return false;
            }
            !window_title(hwnd).trim().is_empty()
        }
    }

    pub fn list_windows(scribble_hwnd: Option<TargetHandle>) -> Vec<WindowInfo> {
        struct Ctx {
            scribble: Option<TargetHandle>,
            out: Vec<WindowInfo>,
        }

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let ctx = &mut *(lparam.0 as *mut Ctx);
            if is_listable(hwnd, ctx.scribble) {
                ctx.out.push(WindowInfo {
                    title: window_title(hwnd),
                    hwnd: hwnd.0 as isize,
                });
            }
            BOOL::from(true)
        }

        let mut ctx = Ctx {
            scribble: scribble_hwnd,
            out: Vec::new(),
        };
        unsafe {
            let _ = EnumWindows(Some(enum_proc), LPARAM(&mut ctx as *mut _ as _));
        }
        ctx.out.sort_by_key(|item| item.title.to_lowercase());
        ctx.out.dedup_by(|a, b| a.hwnd == b.hwnd);
        ctx.out
    }

    pub fn find_window_by_title(
        title: &str,
        scribble_hwnd: Option<TargetHandle>,
    ) -> Option<TargetHandle> {
        let needle = title.trim();
        if needle.is_empty() {
            return None;
        }
        let windows = list_windows(scribble_hwnd);
        if let Some(w) = windows.iter().find(|w| w.title == needle) {
            return Some(w.hwnd);
        }
        windows
            .iter()
            .find(|w| w.title.contains(needle))
            .map(|w| w.hwnd)
    }

    pub fn capture_target(scribble_hwnd: Option<TargetHandle>) -> Result<TargetHandle, String> {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.0.is_null() {
                return Err(
                    "No active window — click into the document you want to type in, then start."
                        .into(),
                );
            }
            if is_our_process(fg, scribble_hwnd) {
                return Err(
                    "Focus your target document first (Scribble cannot type into itself).".into(),
                );
            }
            Ok(fg.0 as isize)
        }
    }

    pub fn is_valid_window(handle: TargetHandle) -> bool {
        if handle == 0 {
            return false;
        }
        unsafe { IsWindow(HWND(handle as *mut c_void)).as_bool() }
    }

    pub fn resolve_target(
        scribble_hwnd: Option<TargetHandle>,
        target_hwnd: Option<TargetHandle>,
        target_title: Option<&str>,
    ) -> Result<TargetHandle, String> {
        if let Some(hwnd) = target_hwnd {
            if hwnd != 0 {
                if is_valid_window(hwnd) {
                    return Ok(hwnd);
                }
                return Err(
                    "Selected window is no longer open — refresh the list and pick again.".into(),
                );
            }
        }
        if let Some(title) = target_title {
            let trimmed = title.trim();
            if !trimmed.is_empty() {
                if let Some(hwnd) = find_window_by_title(trimmed, scribble_hwnd) {
                    return Ok(hwnd);
                }
                return Err(format!(
                    "Could not find a window titled \"{trimmed}\". Refresh the list and try again."
                ));
            }
        }
        capture_target(scribble_hwnd)
    }

    pub fn refocus_target(handle: TargetHandle) {
        unsafe {
            let hwnd = HWND(handle as *mut c_void);
            let _ = SetForegroundWindow(hwnd);
        }
    }

    pub fn is_target_foreground(handle: TargetHandle) -> bool {
        unsafe { GetForegroundWindow() == HWND(handle as *mut c_void) }
    }

    pub fn foreground_is_console() -> bool {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return false;
            }
            is_console_class(&class_name(hwnd))
        }
    }

    fn with_automation<T>(read: impl FnOnce(&uiautomation::UIAutomation) -> Option<T>) -> Option<T> {
        use std::cell::RefCell;
        thread_local! {
            static AUTO: RefCell<Option<uiautomation::UIAutomation>> = const { RefCell::new(None) };
        }
        AUTO.with(|slot| {
            let mut guard = slot.borrow_mut();
            if guard.is_none() {
                *guard = uiautomation::UIAutomation::new().ok();
            }
            let automation = guard.as_ref()?;
            read(automation)
        })
    }

    pub fn read_focused_text() -> Option<String> {
        use uiautomation::patterns::{UILegacyIAccessiblePattern, UIValuePattern};

        if foreground_is_console() {
            return None;
        }
        with_automation(|automation| {
            let element = automation.get_focused_element().ok()?;
            if let Ok(pattern) = element.get_pattern::<UIValuePattern>() {
                if let Ok(value) = pattern.get_value() {
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
            if let Ok(pattern) = element.get_pattern::<UILegacyIAccessiblePattern>() {
                if let Ok(value) = pattern.get_value() {
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
            None
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::WindowInfo;

    pub type TargetHandle = isize;

    pub fn scribble_hwnd(_raw: Option<*mut std::ffi::c_void>) -> Option<TargetHandle> {
        None
    }

    pub fn list_windows(_scribble_hwnd: Option<TargetHandle>) -> Vec<WindowInfo> {
        Vec::new()
    }

    pub fn find_window_by_title(
        _title: &str,
        _scribble_hwnd: Option<TargetHandle>,
    ) -> Option<TargetHandle> {
        None
    }

    pub fn capture_target(_scribble_hwnd: Option<TargetHandle>) -> Result<TargetHandle, String> {
        Err("Window targeting requires Windows.".into())
    }

    pub fn is_valid_window(_handle: TargetHandle) -> bool {
        false
    }

    pub fn resolve_target(
        _scribble_hwnd: Option<TargetHandle>,
        _target_hwnd: Option<TargetHandle>,
        _target_title: Option<&str>,
    ) -> Result<TargetHandle, String> {
        Err("Window targeting requires Windows.".into())
    }

    pub fn refocus_target(_handle: TargetHandle) {}

    pub fn is_target_foreground(_handle: TargetHandle) -> bool {
        false
    }

    pub fn read_focused_text() -> Option<String> {
        None
    }

    pub fn foreground_is_console() -> bool {
        false
    }
}

pub use imp::*;
