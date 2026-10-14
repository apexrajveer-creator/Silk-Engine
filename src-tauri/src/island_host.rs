//! The Windows-facing half of the island (the pure rules are in island.rs): the overlay window, the thread that watches the
//! cursor, the two opt-in workers (clipboard history, app usage) and the commands the island's interface calls.
//!
//! Design notes
//! * The window is transparent, always on top, off the taskbar, and NOT focusable while it is only a peek bar, so it can never
//!   steal the keyboard from whatever you are typing into. It becomes focusable only when you click it open.
//! * It is created the first time it is needed and destroyed after a few idle minutes, so it costs no memory the rest of the time.
//! * Every command accepts calls only from the island's own window (or the Studio), and every system action is a fixed,
//!   named choice: the interface never sends a command line, a path or a URL.

use crate::{clipboard, island, media, power, quick, usage, AppState};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "island";
/// How long the closed island's window is kept around before it is destroyed to give its memory back.
const KEEP_IDLE: Duration = Duration::from_secs(300);
/// The exit animation in the interface lasts this long; the window is hidden just after.
const LEAVE_MS: u64 = 250;

#[derive(Clone, Copy, Serialize)]
pub struct Reveal {
    open: bool,
    generation: u64,
}

pub struct IslandState {
    pub edge: Mutex<island::HotEdge>,
    pub expanded: AtomicBool,
    pub peek_audio: AtomicBool,
    /// A show that was asked for but that the page may have missed (it was still loading): the page collects it when it is ready.
    pub pending: Mutex<Option<Reveal>>,
    /// The monitor the island is on: its rectangle in screen pixels, and its scale.
    pub monitor: Mutex<Option<(island::Rect, f64)>>,
    pub clip: Mutex<clipboard::History>,
    pub clip_on: AtomicBool,
    pub clip_seq: AtomicU32,
    pub usage: Mutex<usage::Usage>,
    pub usage_on: AtomicBool,
    pub usage_dirty: AtomicBool,
    /// Bumped on every show and hide, so a delayed hide can tell it has been overtaken.
    pub generation: AtomicU64,
    pub hidden_since: Mutex<Option<Instant>>,
    /// When the island last opened, and when the hotkey last toggled it (for the grace and debounce rules in island.rs).
    pub opened_at: Mutex<Instant>,
    pub last_toggle: Mutex<Instant>,
    /// Program icons already read (as data URLs), so each is read once.
    pub icons: Mutex<std::collections::HashMap<String, Option<String>>>,
    /// Windows refused to clip the window: fall back to resizing it between bar and panel (the old behaviour) instead of misbehaving.
    pub clip_failed: AtomicBool,
}

impl IslandState {
    pub fn new(clipboard_on: bool, apps_on: bool, dir: &std::path::Path, delay_ms: f64) -> IslandState {
        IslandState {
            edge: Mutex::new(island::HotEdge::new(island::clamp_dwell(delay_ms as i64))),
            expanded: AtomicBool::new(false),
            peek_audio: AtomicBool::new(false),
            pending: Mutex::new(None),
            monitor: Mutex::new(None),
            clip: Mutex::new(clipboard::History::default()),
            clip_on: AtomicBool::new(clipboard_on),
            clip_seq: AtomicU32::new(clipboard::sequence()),
            usage: Mutex::new(if apps_on { usage::load(dir) } else { usage::Usage::default() }),
            usage_on: AtomicBool::new(apps_on),
            usage_dirty: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            hidden_since: Mutex::new(None),
            opened_at: Mutex::new(Instant::now() - Duration::from_secs(3600)),
            last_toggle: Mutex::new(Instant::now() - Duration::from_secs(3600)),
            icons: Mutex::new(std::collections::HashMap::new()),
            clip_failed: AtomicBool::new(false),
        }
    }
}

fn now_secs() -> u64 {
    crate::stability::unix_now()
}

// ------------------------------------------------------------------------------------------ the window

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Create the island window if it does not exist yet. Must run on the main thread.
fn ensure_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = window(app) {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("island.html".into()))
        .title("Silk Engine Island")
        .decorations(false)
        .resizable(false)
        .transparent(true)
        // Keep DWM from exposing an opaque backing bitmap when the peek clip is lifted.
        .no_redirection_bitmap(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        // Every WebView2 window in this app shares one profile folder, and Windows refuses to create a window whose browser
        // arguments differ from the others' ("the resource is not in the correct state"). The Studio and the wallpaper use these.
        .additional_browser_args(crate::BROWSER_ARGS)
        .build()
        .map_err(|e| e.to_string())
}

/// Clip the window to `region` (relative to its top-left corner), or lift the clip. A clipped window neither draws nor receives the
/// mouse outside the region, so while only the bar is showing everything around it still clicks through to the apps below.
#[cfg(windows)]
fn set_clip(w: &WebviewWindow, region: Option<island::Rect>) -> bool {
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ};
    let Ok(handle) = w.hwnd() else { return false };
    let hwnd = crate::desktop::hwnd(handle.0 as isize);
    unsafe {
        match region {
            // after this the system owns the region: it must not be deleted here. SetWindowRgn returns 0 on failure.
            Some(r) => {
                let region = CreateRectRgn(r.x, r.y, r.x + r.w, r.y + r.h);
                if region.0.is_null() { return false; }
                let ok = SetWindowRgn(hwnd, Some(region), false) != 0;
                if !ok { let _ = DeleteObject(HGDIOBJ(region.0)); }
                ok
            }
            // WebView2 supplies the next composited frame; do not erase the newly exposed HWND.
            None => SetWindowRgn(hwnd, None, false) != 0,
        }
    }
}

#[cfg(not(windows))]
fn set_clip(_w: &WebviewWindow, _region: Option<island::Rect>) -> bool {
    true
}

fn place(w: &WebviewWindow, r: island::Rect) -> Result<(), String> {
    w.set_size(tauri::PhysicalSize::new(r.w.max(1) as u32, r.h.max(1) as u32)).map_err(|e| e.to_string())?;
    w.set_position(tauri::PhysicalPosition::new(r.x, r.y)).map_err(|e| e.to_string())
}

/// Show the peek bar (or, with `open`, the whole panel) on the given monitor.
pub fn show(app: &AppHandle, mon: island::Rect, scale: f64, open: bool) {
    let generation = app.state::<crate::IslandHolder>().0.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        let st = h.state::<crate::IslandHolder>();
        let state = &st.0;
        if state.generation.load(Ordering::SeqCst) != generation || quitting(&h) { return; }
        let reveal = Reveal { open, generation };
        *state.pending.lock().unwrap() = Some(reveal);
        *state.opened_at.lock().unwrap() = Instant::now();
        *state.monitor.lock().unwrap() = Some((mon, scale));
        *state.hidden_since.lock().unwrap() = None;
        state.expanded.store(open, Ordering::SeqCst);
        state.peek_audio.store(!open, Ordering::Relaxed);
        let w = match ensure_window(&h) {
            Ok(w) => w,
            Err(e) => {
                state.edge.lock().unwrap().hidden_externally();
                state.expanded.store(false, Ordering::SeqCst);
                state.peek_audio.store(false, Ordering::Relaxed);
                *state.pending.lock().unwrap() = None;
                *state.hidden_since.lock().unwrap() = Some(Instant::now());
                // never fail silently: this is what the diagnostics and the log file are for
                crate::maintenance::record(&h, &format!("The island window could not be created: {e}"));
                let _ = h.emit("app-error", format!("The island could not open: {e}"));   // and say so on screen, in the Studio
                return;
            }
        };
        // The window is always panel-sized while it is visible: resizing it during the morph would stretch the page for a few frames.
        if let Err(error) = place(&w, island::window_rect(mon, scale, true)) {
            crate::maintenance::record(&h, &format!("Island placement failed: {error}"));
            state.edge.lock().unwrap().hidden_externally(); hide_now(&h, Some(generation)); return;
        }
        let clipped = set_clip(&w, if open { None } else { Some(island::peek_region(mon, scale)) });
        state.clip_failed.store(!clipped, Ordering::SeqCst);
        if !clipped {
            // Windows would not clip the window: use the bar-sized window instead (the old behaviour) and say so
            crate::maintenance::record(&h, "The island window could not be clipped; using the resizing fallback");
            if let Err(error) = place(&w, island::window_rect(mon, scale, open)) {
                crate::maintenance::record(&h, &format!("Island fallback placement failed: {error}"));
                state.edge.lock().unwrap().hidden_externally(); hide_now(&h, Some(generation)); return;
            }
        }
        if let Err(error) = w.set_focusable(open).and_then(|_| w.show()) {
            crate::maintenance::record(&h, &format!("Island reveal failed: {error}"));
            state.edge.lock().unwrap().hidden_externally(); hide_now(&h, Some(generation)); return;
        }
        if open {
            let _ = w.set_focus();
        }
        let _ = w.emit("island-show", reveal);
        crate::maintenance::record(&h, if open { "Island opened" } else { "Island peek bar shown" });
    });
}

/// Let the interface play its exit animation, then hide the window (unless the island came back in the meantime).
pub fn leave(app: &AppHandle) {
    let st = app.state::<crate::IslandHolder>();
    let generation = st.0.generation.fetch_add(1, Ordering::SeqCst) + 1;
    crate::maintenance::record(app, "Island hidden: the cursor moved away");
    if let Some(w) = window(app) {
        let _ = w.emit("island-leave", generation);
    }
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(LEAVE_MS));
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || hide_now(&h2, Some(generation)));
    });
}

/// Hide the window right away. With a generation, only if nothing happened since it was scheduled.
fn hide_now(app: &AppHandle, generation: Option<u64>) {
    let st = app.state::<crate::IslandHolder>();
    let state = &st.0;
    if let Some(g) = generation {
        if state.generation.load(Ordering::SeqCst) != g {
            return;
        }
    }
    state.expanded.store(false, Ordering::SeqCst);
    state.peek_audio.store(false, Ordering::Relaxed);
    *state.pending.lock().unwrap() = None;
    if let Some(w) = window(app) {
        let _ = w.emit("island-hidden", state.generation.load(Ordering::SeqCst));
        let _ = w.set_focusable(false);
        let _ = w.hide();
    }
    *state.hidden_since.lock().unwrap() = Some(Instant::now());
}

/// The user closed it (Esc, clicked away, the hotkey): hide, and do not pop back up while the cursor still rests at the edge.
pub fn dismiss(app: &AppHandle, reason: &str) {
    crate::maintenance::record(app, &format!("Island hidden: {reason}"));
    let st = app.state::<crate::IslandHolder>();
    st.0.edge.lock().unwrap().hidden_externally();
    let generation = st.0.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let h = app.clone();
    let _ = app.run_on_main_thread(move || hide_now(&h, Some(generation)));
}

/// Called on the UI thread at the screen-capture barrier. Do not merely queue a hide:
/// capture must see the actual native window hidden, even when search came from a hotkey.
pub fn hide_for_capture(app: &AppHandle) -> Result<(), String> {
    let st = app.state::<crate::IslandHolder>();
    st.0.edge.lock().unwrap().hidden_externally();
    let generation = st.0.generation.fetch_add(1, Ordering::SeqCst) + 1;
    hide_now(app, Some(generation));
    if let Some(w) = window(app) {
        if w.is_visible().map_err(|e| e.to_string())? {
            return Err("The Island could not hide before screen capture".into());
        }
    }
    Ok(())
}

/// The island window lost focus while open: that means the user clicked somewhere else.
pub fn blurred(app: &AppHandle) {
    let st = app.state::<crate::IslandHolder>();
    if !st.0.expanded.load(Ordering::SeqCst) { return; }
    let since = st.0.opened_at.lock().unwrap().elapsed().as_millis() as u64;
    if island::blur_closes(since) { dismiss(app, "clicked somewhere else"); return; }
    let generation = st.0.generation.load(Ordering::SeqCst);
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(island::BLUR_GRACE_MS.saturating_sub(since) + 20));
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || {
            let state = h2.state::<crate::IslandHolder>();
            if state.0.generation.load(Ordering::SeqCst) == generation && state.0.expanded.load(Ordering::SeqCst)
                && window(&h2).is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_focused().unwrap_or(true)) {
                dismiss(&h2, "focus remained outside the island");
            }
        });
    });
}

/// Open or close the island from the hotkey. Opens on the screen the cursor is on.
pub fn toggle(app: &AppHandle) {
    let st = app.state::<crate::IslandHolder>();
    {
        let mut last = st.0.last_toggle.lock().unwrap();
        if !island::toggle_allowed(last.elapsed().as_millis() as u64) {
            return; // a bounced key press, not a second request
        }
        *last = Instant::now();
    }
    let open = st.0.edge.lock().unwrap().is_shown() || window(app).is_some_and(|w| w.is_visible().unwrap_or(false));
    if open {
        dismiss(app, "the hotkey");
        return;
    }
    #[cfg(windows)]
    if let Some((mon, scale)) = win::monitor_under_cursor() {
        st.0.edge.lock().unwrap().shown_externally(now_ms());
        show(app, mon, scale, true);
    }
}

fn now_ms() -> u64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

// ------------------------------------------------------------------------------------------ the workers

pub fn start(app: &AppHandle) {
    #[cfg(windows)]
    {
        let h = app.clone();
        let _ = std::thread::Builder::new().name("silk-island-edge".into()).spawn(move || win::hot_edge_loop(h));
    }
    let h = app.clone();
    let _ = std::thread::Builder::new().name("silk-island-clipboard".into()).spawn(move || clipboard_loop(h));
    let h = app.clone();
    let _ = std::thread::Builder::new().name("silk-island-usage".into()).spawn(move || usage_loop(h));
}

fn quitting(app: &AppHandle) -> bool {
    app.state::<AppState>().quitting.load(Ordering::Relaxed)
}

fn clipboard_loop(app: AppHandle) {
    while !quitting(&app) {
        std::thread::sleep(Duration::from_millis(400));
        let st = app.state::<crate::IslandHolder>();
        let state = &st.0;
        if !state.clip_on.load(Ordering::Relaxed) {
            continue;
        }
        let seq = clipboard::sequence();
        if seq != state.clip_seq.swap(seq, Ordering::Relaxed) {
            if let Some(text) = clipboard::read_text() {
                state.clip.lock().unwrap().push(&text, now_secs());
            }
        }
    }
}

fn usage_loop(app: AppHandle) {
    let mut since_save = 0u32;
    while !quitting(&app) {
        std::thread::sleep(Duration::from_secs(2));
        let st = app.state::<crate::IslandHolder>();
        let state = &st.0;
        if state.usage_on.load(Ordering::Relaxed) && usage::idle_secs() < 120 {
            if let Some(path) = usage::foreground_app() {
                state.usage.lock().unwrap().add(&path, 2, now_secs());
                state.usage_dirty.store(true, Ordering::Relaxed);
            }
        }
        since_save += 2;
        if since_save >= 60 {
            since_save = 0;
            save_usage(&app);
        }
    }
}

/// Write the usage tally to disk if it changed. Also called when the app exits.
pub fn save_usage(app: &AppHandle) {
    let st = app.state::<crate::IslandHolder>();
    if st.0.usage_dirty.swap(false, Ordering::Relaxed) {
        let dir = app.state::<AppState>().dir.clone();
        let _ = usage::save(&dir, &st.0.usage.lock().unwrap());
    }
}

// ------------------------------------------------------------------------------------------ Windows only: cursor and screens

#[cfg(windows)]
mod win {
    use super::*;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows::Win32::UI::Shell::SHQueryUserNotificationState;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    pub fn cursor() -> Option<(i32, i32)> {
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p) }.ok().map(|_| (p.x, p.y))
    }

    /// Every monitor as (rectangle in screen pixels, scale).
    pub fn screens() -> Vec<(island::Rect, f64)> {
        let (vx, vy, _, _) = crate::desktop::virtual_rect();
        crate::desktop::monitors().into_iter().map(|m| (island::Rect::new(m.x + vx, m.y + vy, m.w, m.h), m.scale as f64)).collect()
    }

    pub fn monitor_under_cursor() -> Option<(island::Rect, f64)> {
        let (x, y) = cursor()?;
        let all = screens();
        all.iter().copied().find(|(r, _)| r.contains(x, y)).or_else(|| all.first().copied())
    }

    /// A full-screen app, a game or a presentation is in front (Windows' own "do not disturb" state).
    fn fullscreen_app() -> bool {
        unsafe { SHQueryUserNotificationState() }.is_ok_and(|s| matches!(s.0, 2..=4))
    }

    fn button_down() -> bool {
        unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 | GetAsyncKeyState(VK_RBUTTON.0 as i32) as u16) & 0x8000 != 0 }
    }

    pub fn hot_edge_loop(app: AppHandle) {
        let mut screens_cache: Vec<(island::Rect, f64)> = Vec::new();
        let mut screens_at = Instant::now() - Duration::from_secs(60);
        let (mut suppressed, mut suppressed_at) = (false, Instant::now() - Duration::from_secs(60));
        while !quitting(&app) {
            if app.state::<crate::circle_search::SearchState>().is_active() { std::thread::sleep(Duration::from_millis(100)); continue; }
            let (enabled, delay) = {
                let st = app.state::<AppState>();
                let cfg = st.cfg.lock().unwrap();
                (cfg.system.island, cfg.system.island_delay)
            };
            let holder = app.state::<crate::IslandHolder>();
            let state = &holder.0;
            if !enabled {
                if state.edge.lock().unwrap().is_shown() {
                    dismiss(&app, "turned off in settings");
                }
                std::thread::sleep(Duration::from_millis(300));
                continue;
            }
            if screens_at.elapsed() > Duration::from_secs(2) {
                screens_cache = screens();
                screens_at = Instant::now();
                let moved = state.monitor.lock().unwrap().is_some_and(|(mon, scale)|
                    !screens_cache.iter().any(|(r, s)| *r == mon && (*s - scale).abs() < 0.01));
                if moved && window(&app).is_some_and(|w| w.is_visible().unwrap_or(false)) {
                    dismiss(&app, "display configuration changed");
                }
            }
            if suppressed_at.elapsed() > Duration::from_millis(400) {
                suppressed = fullscreen_app();
                suppressed_at = Instant::now();
            }
            let mut pause = 70;
            if let Some((cx, cy)) = cursor() {
                let here = screens_cache.iter().copied().find(|(r, _)| r.contains(cx, cy));
                let in_zone = here.is_some_and(|(r, s)| island::in_hot_zone(r, s, cx, cy));
                // near the top edge: poll fast so the dwell is accurate; elsewhere: barely at all
                if here.is_some_and(|(r, _)| cy - r.y < 240) {
                    pause = 20;
                }
                // "on the island" means on what is VISIBLE: the bar's area, or the whole panel once it is open (the window itself is
                // always panel-sized, so its own rectangle would count the empty space around the bar)
                let visible = window(&app).is_some_and(|w| w.is_visible().unwrap_or(false));
                let over_island = visible && state.monitor.lock().unwrap().is_some_and(|(mon, scale)| island::window_rect(mon, scale, state.expanded.load(Ordering::Relaxed)).grown(island::NEAR_MARGIN).contains(cx, cy));
                let sample = island::Sample { in_zone, over_island, suppressed, button_down: button_down(), expanded: state.expanded.load(Ordering::Relaxed) };
                let transition = {
                    let mut edge = state.edge.lock().unwrap();
                    edge.set_dwell(island::clamp_dwell(delay as i64));
                    edge.update(now_ms(), sample)
                };
                match (transition, here) {
                    (Some(island::Transition::Show), Some((r, s))) => show(&app, r, s, false),
                    (Some(island::Transition::Show), None) => {}
                    (Some(island::Transition::Hide), _) => leave(&app),
                    (None, _) => {}
                }
            }
            // a closed island's window is destroyed after a while: it is a whole web view
            let idle = state.hidden_since.lock().unwrap().is_some_and(|t| t.elapsed() > KEEP_IDLE);
            if idle {
                let generation = state.generation.load(Ordering::SeqCst);
                let h = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let st = h.state::<crate::IslandHolder>();
                    if st.0.generation.load(Ordering::SeqCst) != generation { return; }
                    let still_idle = st.0.hidden_since.lock().unwrap().is_some_and(|t| t.elapsed() > KEEP_IDLE);
                    if !still_idle { return; }
                    if let Some(w) = window(&h) {
                        if !w.is_visible().unwrap_or(true) {
                            if w.destroy().is_ok() { *st.0.hidden_since.lock().unwrap() = None; }
                        }
                    } else { *st.0.hidden_since.lock().unwrap() = None; }
                });
            }
            std::thread::sleep(Duration::from_millis(pause));
        }
    }
}

// ------------------------------------------------------------------------------------------ commands

fn from_island(window: &WebviewWindow) -> Result<(), String> {
    match window.label() {
        LABEL | "studio" => Ok(()),
        _ => Err("Not available from here".into()),
    }
}

/// The page calls this once it has loaded and subscribed to events. If a show was requested while it was still loading (the
/// very first time the window exists), the answer says so, so the first reveal is never lost.
#[tauri::command]
pub fn island_ready(app: AppHandle, window: WebviewWindow) -> Result<Option<Reveal>, String> {
    from_island(&window)?;
    Ok(app.state::<crate::IslandHolder>().0.pending.lock().unwrap().take())
}

/// Open or close the panel (lift the clip and change keyboard focus; resize only in the fallback).
#[tauri::command]
pub async fn island_expand(app: AppHandle, window: WebviewWindow, expanded: bool, expected_generation: Option<u64>) -> Result<u64, String> {
    from_island(&window)?;
    let requested = expected_generation.unwrap_or_else(|| app.state::<crate::IslandHolder>().0.generation.load(Ordering::SeqCst));
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let h = app.clone();
    app.run_on_main_thread(move || {
        let result: Result<u64, String> = (|| {
            let st = h.state::<crate::IslandHolder>();
            if st.0.generation.load(Ordering::SeqCst) != requested { return Err("The island transition was cancelled".into()); }
            if quitting(&h) { return Err("Silk Engine is closing".into()); }
            let w = self::window(&h).ok_or("The island window is no longer available")?;
            if !w.is_visible().map_err(|e| e.to_string())? { return Err("The island is hidden".into()); }
            let (mon, scale) = (*st.0.monitor.lock().unwrap()).ok_or("The island monitor is unavailable")?;
            // Supersede an edge-leave timer before changing the window or its focus.
            let generation = st.0.generation.fetch_add(1, Ordering::SeqCst) + 1;
            *st.0.pending.lock().unwrap() = None;
            let result = (|| {
                let ok = set_clip(&w, if expanded { None } else { Some(island::peek_region(mon, scale)) });
                if !ok || st.0.clip_failed.load(Ordering::SeqCst) {
                    st.0.clip_failed.store(true, Ordering::SeqCst);
                    if !set_clip(&w, None) { return Err("The island window region could not be reset".into()); }
                    place(&w, island::window_rect(mon, scale, expanded))?;
                }
                w.set_focusable(expanded).map_err(|e| e.to_string())?;
                st.0.expanded.store(expanded, Ordering::SeqCst);
                st.0.peek_audio.store(!expanded, Ordering::Relaxed);
                if expanded {
                    *st.0.opened_at.lock().unwrap() = Instant::now();
                    st.0.edge.lock().unwrap().shown_externally(now_ms());
                    w.set_focus().map_err(|e| e.to_string())?;
                }
                Ok(generation)
            })();
            if result.is_err() { st.0.edge.lock().unwrap().hidden_externally(); hide_now(&h, Some(generation)); }
            result
        })();
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or_else(|_| Err("The island window task was cancelled".into())))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn island_hide(app: AppHandle, window: WebviewWindow, expected_generation: Option<u64>) -> Result<(), String> {
    from_island(&window)?;
    let requested = expected_generation.unwrap_or_else(|| app.state::<crate::IslandHolder>().0.generation.load(Ordering::SeqCst));
    let h = app.clone();
    app.run_on_main_thread(move || {
        if h.state::<crate::IslandHolder>().0.generation.load(Ordering::SeqCst) == requested {
            dismiss(&h, "closed from the island (Esc, or after an action)");
        }
    }).map_err(|e| e.to_string())
}

/// The few wallpaper and display actions the island offers, run exactly like their hotkeys.
#[tauri::command]
pub fn island_action(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    from_island(&window)?;
    if !["next", "prev", "random", "pause", "oled", "widgets", "audio", "interactive", "circleSearch", "studio"].contains(&id.as_str()) {
        return Err("Unknown action".into());
    }
    crate::run_action(&app, &id);
    Ok(())
}

#[tauri::command]
pub async fn quick_state(window: WebviewWindow) -> Result<quick::QuickState, String> {
    from_island(&window)?;
    Ok(tauri::async_runtime::spawn_blocking(quick::state).await.unwrap_or_default())
}

#[tauri::command]
pub async fn quick_set(window: WebviewWindow, what: String, value: f64) -> Result<(), String> {
    from_island(&window)?;
    tauri::async_runtime::spawn_blocking(move || match what.as_str() {
        "wifi" | "bluetooth" => quick::set_radio(quick::Radio::parse(&what).ok_or("Unknown radio")?, value >= 0.5),
        "volume" => quick::set_volume(quick::clamp_volume(value)),
        "mute" => quick::set_muted(value >= 0.5),
        _ => Err("Unknown setting".into()),
    })
    .await
    .map_err(|_| "The system call failed".to_string())?
}

#[tauri::command]
pub fn quick_open(window: WebviewWindow, page: String) -> Result<(), String> {
    from_island(&window)?;
    quick::open_settings(quick::settings_uri(&page).ok_or("Unknown page")?)
}

/// What is playing right now (any app in Windows' media flyout), without the artwork.
#[tauri::command]
pub async fn media_state(window: WebviewWindow) -> Result<media::MediaState, String> {
    from_island(&window)?;
    tauri::async_runtime::spawn_blocking(media::state).await.map_err(|_| "The media worker failed".to_string())?
}

/// The artwork for the track with this id (the id comes from media_state), as a data URL; none if it has none.
#[tauri::command]
pub async fn media_thumb(window: WebviewWindow, id: String) -> Result<Option<String>, String> {
    from_island(&window)?;
    Ok(tauri::async_runtime::spawn_blocking(move || media::thumbnail(&id)).await.unwrap_or(None))
}

/// Previous, next, play/pause, or seek to `value` seconds. Only those words are accepted.
#[tauri::command]
pub async fn media_control(window: WebviewWindow, action: String, value: f64) -> Result<(), String> {
    from_island(&window)?;
    let control = media::parse_control(&action, value).ok_or("Unknown media action")?;
    tauri::async_runtime::spawn_blocking(move || media::control(control)).await.map_err(|_| "The media call failed".to_string())?
}

#[tauri::command]
pub async fn mixer_state(window: WebviewWindow) -> Result<crate::mixer::MixerState, String> {
    from_island(&window)?;
    tauri::async_runtime::spawn_blocking(crate::mixer::state).await.map_err(|_| "Audio mixer worker failed".to_string())?
}
#[tauri::command]
pub async fn mixer_volume(window: WebviewWindow, device_id: String, app_id: String, volume: f64) -> Result<(), String> {
    from_island(&window)?;
    tauri::async_runtime::spawn_blocking(move || crate::mixer::set_volume(device_id, app_id, volume)).await.map_err(|_| "Audio mixer worker failed".to_string())?
}
#[tauri::command]
pub async fn mixer_output(window: WebviewWindow, device_id: String) -> Result<(), String> {
    from_island(&window)?;
    tauri::async_runtime::spawn_blocking(move || { let result = crate::mixer::set_output(device_id); crate::audio::output_changed(); result }).await.map_err(|_| "Audio mixer worker failed".to_string())?
}
#[tauri::command]
pub async fn media_open(window: WebviewWindow, id: String, source_id: String) -> Result<(), String> {
    from_island(&window)?;
    if id.len() > 64 || source_id.len() > 4096 { return Err("Invalid media identity".into()); }
    tauri::async_runtime::spawn_blocking(move || media::open(id, source_id)).await.map_err(|_| "Media worker failed".to_string())?
}

#[tauri::command]
pub fn power_do(window: WebviewWindow, action: String, confirmed: bool) -> Result<(), String> {
    from_island(&window)?;
    power::perform(&action, confirmed)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipState {
    enabled: bool,
    items: Vec<clipboard::Item>,
}

#[tauri::command]
pub fn clip_state(app: AppHandle, window: WebviewWindow) -> Result<ClipState, String> {
    from_island(&window)?;
    let st = app.state::<crate::IslandHolder>();
    let items = st.0.clip.lock().unwrap().list(now_secs());
    Ok(ClipState { enabled: st.0.clip_on.load(Ordering::Relaxed), items })
}

/// Turning it off wipes the history at once; turning it on starts from what is copied next (never from what is there now).
#[tauri::command]
pub fn clip_enable(app: AppHandle, window: WebviewWindow, enabled: bool) -> Result<(), String> {
    from_island(&window)?;
    let st = app.state::<crate::IslandHolder>();
    if !enabled {
        st.0.clip.lock().unwrap().clear();
    }
    st.0.clip_seq.store(clipboard::sequence(), Ordering::Relaxed);
    st.0.clip_on.store(enabled, Ordering::Relaxed);
    crate::mutate(&app, |c| c.island.clipboard = enabled).map(|_| ())
}

/// Put one of the remembered texts back on the clipboard.
#[tauri::command]
pub fn clip_use(app: AppHandle, window: WebviewWindow, id: u64) -> Result<(), String> {
    from_island(&window)?;
    let st = app.state::<crate::IslandHolder>();
    let text = st.0.clip.lock().unwrap().get(id).map(str::to_owned).ok_or("That item is gone")?;
    clipboard::write_text(&text)
}

#[tauri::command]
pub fn clip_remove(app: AppHandle, window: WebviewWindow, id: u64) -> Result<(), String> {
    from_island(&window)?;
    app.state::<crate::IslandHolder>().0.clip.lock().unwrap().remove(id);
    Ok(())
}

#[tauri::command]
pub fn clip_clear(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    from_island(&window)?;
    app.state::<crate::IslandHolder>().0.clip.lock().unwrap().clear();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsState {
    enabled: bool,
    items: Vec<usage::Ranked>,
}

#[tauri::command]
pub fn apps_state(app: AppHandle, window: WebviewWindow) -> Result<AppsState, String> {
    from_island(&window)?;
    let st = app.state::<crate::IslandHolder>();
    let items = st.0.usage.lock().unwrap().top(8);
    Ok(AppsState { enabled: st.0.usage_on.load(Ordering::Relaxed), items })
}

#[tauri::command]
pub fn apps_enable(app: AppHandle, window: WebviewWindow, enabled: bool) -> Result<(), String> {
    from_island(&window)?;
    let st = app.state::<crate::IslandHolder>();
    st.0.usage_on.store(enabled, Ordering::Relaxed);
    crate::mutate(&app, |c| c.island.apps = enabled).map(|_| ())
}

#[tauri::command]
pub fn apps_clear(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    from_island(&window)?;
    let st = app.state::<crate::IslandHolder>();
    st.0.usage.lock().unwrap().clear();
    st.0.usage_dirty.store(false, Ordering::Relaxed);
    usage::delete_file(&app.state::<AppState>().dir);
    Ok(())
}

/// Start one of the listed apps. Only a path that is in the tally, is a plain .exe and still exists is ever run.
/// The program's own icon as a PNG data URL, read once and kept; none if Windows has no icon for it. Only apps in the tally.
#[tauri::command]
pub async fn apps_icon(app: AppHandle, window: WebviewWindow, key: String) -> Result<Option<String>, String> {
    from_island(&window)?;
    let (cached, path) = {
        let st = app.state::<crate::IslandHolder>();
        let cached = st.0.icons.lock().unwrap().get(&key).cloned();
        let path = st.0.usage.lock().unwrap().path_of(&key).map(str::to_owned);
        (cached, path)
    };
    if let Some(hit) = cached {
        return Ok(hit);
    }
    let path = path.ok_or("That app is not in the list")?;
    if !usage::launchable(&path) {
        return Ok(None);
    }
    let icon = tauri::async_runtime::spawn_blocking(move || usage::icon_png(&path).map(|png| format!("data:image/png;base64,{}", media::base64(&png)))).await.unwrap_or(None);
    let st = app.state::<crate::IslandHolder>();
    let mut cache = st.0.icons.lock().unwrap();
    if cache.len() >= 96 {
        cache.clear();
    }
    cache.insert(key, icon.clone());
    Ok(icon)
}

#[tauri::command]
pub fn apps_launch(app: AppHandle, window: WebviewWindow, key: String) -> Result<(), String> {
    from_island(&window)?;
    let st = app.state::<crate::IslandHolder>();
    let path = st.0.usage.lock().unwrap().path_of(&key).map(str::to_owned).ok_or("That app is not in the list")?;
    if !usage::launchable(&path) || !std::path::Path::new(&path).is_file() {
        return Err("That program is no longer there".into());
    }
    let mut cmd = std::process::Command::new(&path);
    if let Some(dir) = std::path::Path::new(&path).parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}
