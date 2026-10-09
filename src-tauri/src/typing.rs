//! Cross-platform keystroke injector with optional Windows focus lock + deletion repair.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use enigo::{Enigo, Keyboard, Settings};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};

use crate::win_typing::{self, TargetHandle};

#[derive(Clone)]
pub struct TypingOptions {
    pub wpm: u32,
    pub start_delay_ms: u64,
    pub lock_focus: bool,
    pub target_window_hwnd: Option<TargetHandle>,
    pub target_window_title: Option<String>,
    pub auto_repair: bool,
    pub mistakes_enabled: bool,
    pub mistake_chance: f32,
    pub thinking_pauses: bool,
}

#[derive(Clone, Serialize)]
pub struct TypingStatus {
    pub running: bool,
    pub paused: bool,
    pub typed: u64,
    pub total: u64,
    pub word_index: u64,
    pub word_total: u64,
    pub current_word: String,
    pub repairs: u64,
}

#[derive(Clone, Serialize)]
struct ProgressEvent {
    typed: u64,
    total: u64,
    word_index: u64,
    word_total: u64,
    current_word: String,
    repairs: u64,
    paused: bool,
}

#[derive(Clone, Serialize)]
struct CountdownEvent {
    remaining_ms: u64,
}

#[derive(Clone, Serialize)]
struct DoneEvent {
    reason: &'static str,
    total: u64,
    repairs: u64,
}

pub struct TypingEngine {
    app: AppHandle,
    inner: Mutex<EngineInner>,
}

struct EngineInner {
    task: Option<JoinHandle<()>>,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    typed: Arc<AtomicU64>,
    repairs: Arc<AtomicU64>,
    total: u64,
    text: String,
}

impl TypingEngine {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            inner: Mutex::new(EngineInner {
                task: None,
                cancel: Arc::new(AtomicBool::new(false)),
                pause: Arc::new(AtomicBool::new(false)),
                typed: Arc::new(AtomicU64::new(0)),
                repairs: Arc::new(AtomicU64::new(0)),
                total: 0,
                text: String::new(),
            }),
        }
    }

    pub async fn status(&self) -> TypingStatus {
        let inner = self.inner.lock().await;
        let running = inner
            .task
            .as_ref()
            .map(|t| !t.is_finished())
            .unwrap_or(false);
        let typed = inner.typed.load(Ordering::Relaxed);
        let chars = inner.text.chars().collect::<Vec<_>>();
        let (word_index, word_total, current_word) = word_stats(&chars, typed as usize);
        TypingStatus {
            running,
            paused: inner.pause.load(Ordering::Relaxed),
            typed,
            total: inner.total,
            word_index,
            word_total,
            current_word,
            repairs: inner.repairs.load(Ordering::Relaxed),
        }
    }

    pub async fn cancel(&self) -> bool {
        let inner = self.inner.lock().await;
        match inner.task.as_ref() {
            Some(t) if !t.is_finished() => {
                inner.cancel.store(true, Ordering::Relaxed);
                inner.pause.store(false, Ordering::Relaxed);
                true
            }
            _ => false,
        }
    }

    pub async fn toggle_pause(&self) -> bool {
        let inner = self.inner.lock().await;
        let running = inner
            .task
            .as_ref()
            .map(|t| !t.is_finished())
            .unwrap_or(false);
        if !running {
            return false;
        }
        let now = !inner.pause.load(Ordering::Relaxed);
        inner.pause.store(now, Ordering::Relaxed);
        let _ = self.app.emit("typing://pause", now);
        now
    }

    pub async fn start(&self, text: String, options: TypingOptions) -> Result<()> {
        if text.is_empty() {
            return Err(anyhow!("nothing to type"));
        }

        let previous = {
            let mut inner = self.inner.lock().await;
            inner.cancel.store(true, Ordering::Relaxed);
            inner.pause.store(false, Ordering::Relaxed);
            inner.task.take()
        };
        if let Some(previous) = previous {
            if timeout(Duration::from_secs(1), previous).await.is_err() {
                return Err(anyhow!("previous typing session did not stop in time"));
            }
        }

        let mut inner = self.inner.lock().await;
        let cancel = Arc::new(AtomicBool::new(false));
        let pause = Arc::new(AtomicBool::new(false));
        let typed = Arc::new(AtomicU64::new(0));
        let repairs = Arc::new(AtomicU64::new(0));
        let total = text.chars().count() as u64;
        let session_text = text.clone();
        let app = self.app.clone();

        let cancel_task = cancel.clone();
        let pause_task = pause.clone();
        let typed_task = typed.clone();
        let repairs_task = repairs.clone();
        let task = tokio::spawn(async move {
            let outcome = run_typing(
                app.clone(),
                text,
                options,
                cancel_task,
                pause_task,
                typed_task.clone(),
                repairs_task.clone(),
            )
            .await;
            let (reason, total) = match outcome {
                Ok(true) => ("completed", typed_task.load(Ordering::Relaxed)),
                Ok(false) => ("cancelled", typed_task.load(Ordering::Relaxed)),
                Err(_) => ("error", typed_task.load(Ordering::Relaxed)),
            };
            let _ = app.emit(
                "typing://done",
                DoneEvent {
                    reason,
                    total,
                    repairs: repairs_task.load(Ordering::Relaxed),
                },
            );
        });

        inner.cancel = cancel;
        inner.pause = pause;
        inner.typed = typed;
        inner.repairs = repairs;
        inner.total = total;
        inner.text = session_text;
        inner.task = Some(task);
        Ok(())
    }
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

/// Completed words, total words, and the word currently being typed.
/// Position 0 is always `0 / total`. A word counts once its last character is typed.
fn word_stats(chars: &[char], pos: usize) -> (u64, u64, String) {
    let mut words: Vec<(usize, String)> = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        if index >= chars.len() {
            break;
        }
        let start = index;
        while index < chars.len() && !chars[index].is_whitespace() {
            index += 1;
        }
        words.push((index, chars[start..index].iter().collect()));
    }
    let word_total = words.len() as u64;
    let completed = words.iter().filter(|(end, _)| *end <= pos).count() as u64;
    let current = words
        .iter()
        .find(|(end, _)| pos < *end)
        .map(|(_, text)| text.clone())
        .unwrap_or_default();
    (completed, word_total, current)
}

/// User deleted trailing text: focused field value is a strict prefix of what we intended.
fn detect_user_deletion(actual: &str, expected: &str) -> Option<usize> {
    let actual = actual.trim_end();
    let actual_n = actual.chars().count();
    let expected_n = expected.chars().count();
    if actual.is_empty() || actual_n >= expected_n {
        return None;
    }
    let prefix: String = expected.chars().take(actual_n).collect();
    if actual == prefix {
        return Some(actual_n);
    }
    None
}

async fn wait_while_paused(pause: &AtomicBool, cancel: &AtomicBool) -> Result<()> {
    while pause.load(Ordering::Relaxed) {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        sleep(Duration::from_millis(50)).await;
    }
    Ok(())
}

async fn sleep_interruptible(ms: u64, cancel: &AtomicBool) -> bool {
    let step = 25u64;
    let mut left = ms;
    while left > 0 {
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        let chunk = left.min(step);
        sleep(Duration::from_millis(chunk)).await;
        left -= chunk;
    }
    !cancel.load(Ordering::Relaxed)
}

fn type_char(enigo: &mut Enigo, ch: char) -> Result<()> {
    if ch == '\n' {
        enigo
            .key(enigo::Key::Return, enigo::Direction::Click)
            .map_err(|e| anyhow!("key Return: {e}"))
    } else if ch == '\t' {
        enigo
            .key(enigo::Key::Tab, enigo::Direction::Click)
            .map_err(|e| anyhow!("key Tab: {e}"))
    } else {
        let mut buf = [0u8; 4];
        let s = ch.encode_utf8(&mut buf);
        enigo.text(s).map_err(|e| anyhow!("text {ch:?}: {e}"))
    }
}

fn type_backspace(enigo: &mut Enigo) -> Result<()> {
    enigo
        .key(enigo::Key::Backspace, enigo::Direction::Click)
        .map_err(|e| anyhow!("key Backspace: {e}"))
}

fn mistake_char(intended: char, rng: &mut impl Rng) -> char {
    const NEIGHBORS: &[(&str, &str)] = &[
        ("a", "sqz"),
        ("b", "vngh"),
        ("c", "xdfv"),
        ("d", "sfertxc"),
        ("e", "wrds"),
        ("f", "dgrtvbc"),
        ("g", "fhtyubv"),
        ("h", "gjyunb"),
        ("i", "uokj"),
        ("j", "hkunim"),
        ("k", "jliom"),
        ("l", "kop"),
        ("m", "njk"),
        ("n", "bmhj"),
        ("o", "ipkl"),
        ("p", "ol"),
        ("q", "wa"),
        ("r", "etfd"),
        ("s", "adewzx"),
        ("t", "rygf"),
        ("u", "yihj"),
        ("v", "cbfg"),
        ("w", "qesa"),
        ("x", "zcsd"),
        ("y", "tugh"),
        ("z", "asx"),
    ];
    let key = intended.to_ascii_lowercase();
    for (k, neighbors) in NEIGHBORS {
        if key == k.chars().next().unwrap_or('\0') {
            let pick = neighbors
                .chars()
                .nth(rng.gen_range(0..neighbors.chars().count()))
                .unwrap_or('a');
            return if intended.is_uppercase() {
                pick.to_ascii_uppercase()
            } else {
                pick
            };
        }
    }
    if intended.is_ascii_alphabetic() {
        let base = rng.gen_range(b'a'..=b'z') as char;
        if intended.is_uppercase() {
            base.to_ascii_uppercase()
        } else {
            base
        }
    } else {
        intended
    }
}

async fn type_mistake_then_correct(
    enigo: &mut Enigo,
    intended: char,
    delay_ms: u64,
    cancel: &AtomicBool,
    rng: &mut impl Rng,
) -> Result<()> {
    let extra = rng.gen_range(1..=2);
    let mut typed_mistakes = Vec::new();
    for _ in 0..extra {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let wrong = mistake_char(intended, rng);
        typed_mistakes.push(wrong);
        type_char(enigo, wrong)?;
        let frac = rng.gen_range(25..46);
        sleep_interruptible((delay_ms * frac) / 100, cancel).await;
    }

    let pause_ms = rng.gen_range(70..160);
    if !sleep_interruptible(pause_ms, cancel).await {
        return Ok(());
    }

    for _ in typed_mistakes.iter().rev() {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        type_backspace(enigo)?;
        sleep_interruptible(rng.gen_range(15..50), cancel).await;
    }

    sleep_interruptible(rng.gen_range(20..80), cancel).await;
    type_char(enigo, intended)?;
    Ok(())
}

async fn run_countdown(app: &AppHandle, total_ms: u64, cancel: &AtomicBool) -> bool {
    if total_ms == 0 {
        return true;
    }
    let started = Instant::now();
    let mut last_emit = total_ms.saturating_add(1);
    while started.elapsed().as_millis() < total_ms as u128 {
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        let elapsed = started.elapsed().as_millis() as u64;
        let remaining = total_ms.saturating_sub(elapsed);
        if remaining / 100 != last_emit / 100 || remaining == 0 {
            last_emit = remaining;
            let _ = app.emit(
                "typing://countdown",
                CountdownEvent {
                    remaining_ms: remaining,
                },
            );
        }
        sleep(Duration::from_millis(50)).await;
    }
    let _ = app.emit("typing://countdown", CountdownEvent { remaining_ms: 0 });
    !cancel.load(Ordering::Relaxed)
}

async fn run_typing(
    app: AppHandle,
    text: String,
    opts: TypingOptions,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    typed: Arc<AtomicU64>,
    repairs: Arc<AtomicU64>,
) -> Result<bool> {
    let chars: Vec<char> = text.chars().collect();
    let total = chars.len() as u64;
    let delay_ms = ((60_000.0 / (opts.wpm as f64 * 5.0)).max(1.0)) as u64;

    let scribble = scribble_hwnd(&app);

    if !run_countdown(&app, opts.start_delay_ms, &cancel).await {
        return Ok(false);
    }

    let target = if opts.lock_focus {
        let title_ref = opts.target_window_title.as_deref();
        win_typing::resolve_target(scribble, opts.target_window_hwnd, title_ref)
            .map_err(|e| anyhow!(e))?
    } else {
        0isize
    };

    if opts.lock_focus && target != 0 {
        win_typing::refocus_target(target);
        sleep(Duration::from_millis(120)).await;
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| anyhow!("enigo init: {e}"))?;
    let mut rng = StdRng::from_entropy();
    let mut pos: usize = 0;
    let mut last_repair = Instant::now();
    let mut last_refocus = Instant::now();
    let typing_started = Instant::now();

    let emit_progress = |app: &AppHandle, pos: usize, repairs_n: u64, paused: bool| {
        let (word_index, word_total, current_word) = word_stats(&chars, pos);
        let _ = app.emit(
            "typing://progress",
            ProgressEvent {
                typed: pos as u64,
                total,
                word_index,
                word_total,
                current_word,
                repairs: repairs_n,
                paused,
            },
        );
    };

    emit_progress(&app, 0, 0, false);

    while pos < chars.len() {
        if cancel.load(Ordering::Relaxed) {
            return Ok(false);
        }
        wait_while_paused(&pause, &cancel).await?;
        if cancel.load(Ordering::Relaxed) {
            return Ok(false);
        }

        if opts.lock_focus
            && target != 0
            && !win_typing::is_target_foreground(target)
            && last_refocus.elapsed() >= Duration::from_secs(1)
        {
            win_typing::refocus_target(target);
            last_refocus = Instant::now();
        }

        // Only treat a *shorter strict prefix* as a user deletion — UIA often returns
        // partial/wrong values; comparing loosely used to rewind pos without backspacing,
        // which duplicated text and never finished.
        if opts.auto_repair
            && !opts.mistakes_enabled
            && pos > 0
            && typing_started.elapsed() >= Duration::from_millis(500)
            && last_repair.elapsed() >= Duration::from_millis(400)
        {
            if let Some(actual) = win_typing::read_focused_text() {
                let expected: String = chars.iter().take(pos).collect();
                if let Some(typed_len) = detect_user_deletion(&actual, &expected) {
                    if typed_len + 2 < pos {
                        let rewind = pos - typed_len;
                        for _ in 0..rewind {
                            if cancel.load(Ordering::Relaxed) {
                                return Ok(false);
                            }
                            type_backspace(&mut enigo)?;
                            if !sleep_interruptible(12, &cancel).await {
                                return Ok(false);
                            }
                        }
                        pos = typed_len;
                        repairs.fetch_add(1, Ordering::Relaxed);
                        emit_progress(
                            &app,
                            pos,
                            repairs.load(Ordering::Relaxed),
                            pause.load(Ordering::Relaxed),
                        );
                    }
                }
            }
            last_repair = Instant::now();
        }

        let ch = chars[pos];

        if opts.thinking_pauses && rng.gen::<f32>() < 0.015 {
            let pause_ms = rng.gen_range(150..450);
            if !sleep_interruptible(pause_ms, &cancel).await {
                return Ok(false);
            }
        }

        if opts.mistakes_enabled
            && ch.is_alphabetic()
            && rng.gen::<f32>() < opts.mistake_chance.clamp(0.0, 1.0)
        {
            type_mistake_then_correct(&mut enigo, ch, delay_ms, &cancel, &mut rng).await?;
        } else if let Err(e) = type_char(&mut enigo, ch) {
            let _ = app.emit("typing://error", e.to_string());
            return Err(e);
        }

        pos += 1;
        typed.store(pos as u64, Ordering::Relaxed);
        let finished_word = !ch.is_whitespace()
            && (pos == chars.len() || chars.get(pos).is_some_and(|next| next.is_whitespace()));

        if pos == chars.len() || finished_word {
            emit_progress(
                &app,
                pos,
                repairs.load(Ordering::Relaxed),
                pause.load(Ordering::Relaxed),
            );
        }

        if !sleep_interruptible(delay_ms, &cancel).await {
            return Ok(false);
        }
    }

    emit_progress(&app, chars.len(), repairs.load(Ordering::Relaxed), false);
    typed.store(total, Ordering::Relaxed);

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_only_strict_prefix_deletions() {
        assert_eq!(detect_user_deletion("hello", "hello world"), Some(5));
        assert_eq!(detect_user_deletion("hello world", "hello world"), None);
        assert_eq!(detect_user_deletion("hullo", "hello world"), None);
        assert_eq!(detect_user_deletion("", "hello"), None);
    }

    #[test]
    fn word_stats_follow_character_position() {
        let chars = "one two three".chars().collect::<Vec<_>>();
        let (done, total, current) = word_stats(&chars, 0);
        assert_eq!(done, 0);
        assert_eq!(total, 3);
        assert_eq!(current, "one");
        let (done, _, current) = word_stats(&chars, 7);
        assert_eq!(done, 2);
        assert_eq!(current, "three");
        let (done, total, _) = word_stats(&chars, chars.len());
        assert_eq!(done, total);
    }
}
