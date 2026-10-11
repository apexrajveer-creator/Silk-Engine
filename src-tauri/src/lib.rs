//! Silk Engine — app core.
//!
//! Two webviews:
//!   * "wallpaper": one window covering the whole virtual desktop, parented behind the icons.
//!     A single WebGL context draws every monitor as a viewport, so three screens cost one
//!     renderer process, not three.
//!   * "studio": the library/settings UI. It is *destroyed* when closed (not hidden), so it
//!     uses no memory while you're not looking at it. The app keeps running from the tray.

mod audio;
mod community;
mod config;
mod desktop;
mod hotkeys;
mod lifestyles;
mod maintenance;
mod metrics;
mod playlist;
mod protocol;
mod theme;
mod watcher;
use community::{community_cancel, community_download};
use maintenance::{diagnostics, export_settings, import_settings, reset_preferences, undo_reset};

use config::{Config, Item, System};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Every webview in the app must share identical browser arguments (WebView2 requirement).
/// Occlusion detection is disabled because a window behind the desktop icons looks "covered"
/// to Chromium and would otherwise stop painting.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,CalculateNativeWinOcclusion \
--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
--autoplay-policy=no-user-gesture-required";

pub struct AppState {
    pub cfg: Mutex<Config>,
    pub persistence: Mutex<()>,
    pub heartbeat: Mutex<std::time::Instant>,
    pub dir: PathBuf,
    pub quitting: AtomicBool,
    pub vis: Mutex<watcher::Visibility>,
    pub wallpaper_hwnd: Mutex<isize>,
    pub parent_hwnd: Mutex<isize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateDto {
    config: Config,
    monitors: Vec<desktop::Monitor>,
    visibility: watcher::Visibility,
    platform: &'static str,
    version: &'static str,
}

fn snapshot(app: &AppHandle) -> StateDto {
    let st = app.state::<AppState>();
    let config = st.cfg.lock().unwrap().clone();
    let visibility = st.vis.lock().unwrap().clone();
    StateDto {
        config,
        monitors: desktop::monitors(),
        visibility,
        platform: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
    }
}

/// Persist and broadcast. Every mutation goes through here.
fn mutate<T>(app: &AppHandle, f: impl FnOnce(&mut Config) -> T) -> Result<T, String> {
    let st = app.state::<AppState>();
    let _write = st
        .persistence
        .lock()
        .map_err(|_| "Settings lock unavailable")?;
    let mut next = st.cfg.lock().map_err(|_| "Settings unavailable")?.clone();
    let result = f(&mut next);
    if let Err(e) = config::save(&st.dir, &next) {
        let _ = app.emit("app-error", format!("Settings could not be saved: {e}"));
        maintenance::record(app, "Settings save failed");
        return Err(e);
    }
    *st.cfg.lock().map_err(|_| "Settings unavailable")? = next.clone();
    let _ = app.emit("state", &next);
    update_tray(app, next.paused);
    Ok(result)
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn get_state(app: AppHandle) -> StateDto {
    snapshot(&app)
}

#[tauri::command]
fn set_widgets(app: AppHandle, widgets: Value) -> Result<(), String> {
    let items = widgets
        .get("items")
        .and_then(Value::as_array)
        .ok_or("Invalid widget layout")?;
    if items.len() > 64
        || serde_json::to_vec(&widgets)
            .map_err(|e| e.to_string())?
            .len()
            > 8 * 1024 * 1024
    {
        return Err("Widget layout exceeds its size limit".into());
    }
    let st = app.state::<AppState>();
    let _write = st.persistence.lock().unwrap();
    let mut next = st.cfg.lock().unwrap().clone();
    next.widgets = widgets;
    config::save(&st.dir, &next)?;
    *st.cfg.lock().unwrap() = next.clone();
    let _ = app.emit("state", &next);
    Ok(())
}

#[tauri::command]
fn widget_metrics() -> Value {
    metrics::sample()
}

#[tauri::command]
fn set_display(app: AppHandle, patch: Value) -> Result<(), String> {
    mutate(&app, |c| config::merge(&mut c.display, &patch))
}

#[tauri::command]
fn set_system(app: AppHandle, system: System) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let st = app.state::<AppState>();
    let _write = st
        .persistence
        .lock()
        .map_err(|_| "Settings lock unavailable")?;
    let mut next = st.cfg.lock().map_err(|_| "Settings unavailable")?.clone();
    let old = next.system.start_with_windows;
    let changed = old != system.start_with_windows;
    let al = app.autolaunch();
    if changed {
        (if system.start_with_windows {
            al.enable()
        } else {
            al.disable()
        })
        .map_err(|e| e.to_string())?;
    }
    // Theme sync: capture the user's own accent before the first change, put it back when off.
    let sync_on = system.theme_sync && !next.system.theme_sync;
    let sync_off = !system.theme_sync && next.system.theme_sync;
    if sync_on && next.accent_backup.is_none() {
        next.accent_backup = Some(theme::read_backup());
    }
    let restore = if sync_off { next.accent_backup.take() } else { None };
    next.system = system;
    if let Err(error) = config::save(&st.dir, &next) {
        if changed {
            (if old { al.enable() } else { al.disable() })
                .map_err(|e| format!("{error}; startup rollback failed: {e}"))?;
        }
        return Err(error);
    }
    *st.cfg.lock().map_err(|_| "Settings unavailable")? = next.clone();
    let _ = app.emit("state", &next);
    if let Some(backup) = restore {
        theme::forget_last();
        std::thread::spawn(move || theme::restore(&backup));
        let _ = app.emit("accent-applied", Option::<String>::None);
    }
    if sync_on {
        theme::forget_last();
        let _ = app.emit_to("wallpaper", "accent-request", ());
    }
    Ok(())
}

/// Called by the wallpaper renderer with the colour it sampled from what is on screen.
/// Ignored unless theme sync is on; rate limited and deduplicated in theme.rs.
#[tauri::command]
fn apply_accent(app: AppHandle, color: String) -> Result<bool, String> {
    let c = theme::parse_hex(&color).ok_or("Expected a #rrggbb colour")?;
    let st = app.state::<AppState>();
    if !st.cfg.lock().map_err(|_| "Settings unavailable")?.system.theme_sync {
        return Ok(true);
    }
    if !theme::should_apply(c) {
        return Ok(theme::is_current(c)); // false = throttled, the renderer will ask again
    }
    let handle = app.clone();
    std::thread::spawn(move || match theme::apply(c) {
        Ok(()) => { let _ = handle.emit("accent-applied", Some(color)); }
        Err(e) => eprintln!("[silk] theme sync: {e}"),
    });
    Ok(true)
}

#[tauri::command]
fn add_paths(app: AppHandle, paths: Vec<String>) -> Result<Vec<Item>, String> {
    if paths.len() > 200 {
        return Err("Import at most 200 paths at once".into());
    }
    let mut added = Vec::new();
    for p in paths {
        added.extend(config::items_from_path(&PathBuf::from(p)));
    }
    let out = added.clone();
    mutate(&app, |c| c.items.extend(added))?;
    Ok(out)
}

#[tauri::command]
fn remove_item(app: AppHandle, id: String) -> Result<(), String> {
    mutate(&app, |c| {
        c.items.retain(|i| i.id != id || i.builtin);
        c.ensure_builtins();
    })
}

#[tauri::command]
fn update_item(
    app: AppHandle,
    id: String,
    name: Option<String>,
    settings: Option<Value>,
) -> Result<(), String> {
    mutate(&app, |c| {
        if let Some(it) = c.items.iter_mut().find(|i| i.id == id) {
            if let Some(n) = name {
                it.name = n.chars().take(80).collect();
            }
            if let Some(s) = settings {
                config::merge(&mut it.settings, &s);
            }
        }
    })
}

/// Save the current look of an item as a new preset (e.g. "Fluid Ink — neon").
#[tauri::command]
fn duplicate_item(app: AppHandle, id: String) -> Result<Option<Item>, String> {
    mutate(&app, |c| {
        let src = c.item(&id)?.clone();
        let it = Item {
            id: config::new_id(),
            name: format!("{} copy", src.name),
            builtin: false,
            ..src
        };
        c.items.push(it.clone());
        Some(it)
    })
}

/// monitor = a monitor key, or "*" for all monitors.
#[tauri::command]
fn assign(app: AppHandle, monitor: String, item_id: String) -> Result<(), String> {
    mutate(&app, |c| {
        if c.item(&item_id).is_none() {
            return;
        }
        if monitor == "*" {
            c.assign.clear();
        }
        c.playlist.enabled = false;
        c.assign.insert(monitor, item_id);
    })
}

#[tauri::command]
fn set_span(app: AppHandle, span: bool) -> Result<(), String> {
    mutate(&app, |c| c.span = span)
}

#[tauri::command]
fn set_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    mutate(&app, |c| c.paused = paused)
}

#[tauri::command]
fn config_dir(app: AppHandle) -> String {
    app.state::<AppState>().dir.to_string_lossy().into()
}

#[tauri::command]
fn renderer_heartbeat(app: AppHandle) {
    *app.state::<AppState>().heartbeat.lock().unwrap() = std::time::Instant::now();
}

#[tauri::command]
fn report_renderer_error(app: AppHandle, message: String) {
    maintenance::record(&app, &message);
    let _ = app.emit_to(
        "studio",
        "renderer-error",
        message.chars().take(300).collect::<String>(),
    );
}

#[tauri::command]
fn restart_renderer(app: AppHandle) -> Result<(), String> {
    if app.state::<AppState>().quitting.load(Ordering::Relaxed) {
        return Ok(());
    }
    maintenance::record(&app, "Wallpaper renderer restart requested");
    renderer_heartbeat(app.clone());
    if let Some(w) = app.get_webview_window("wallpaper") {
        desktop::set_suspended(&w, false);
        w.reload().map_err(|e| e.to_string())?;
        reattach(&app);
    } else {
        create_wallpaper(&app).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn backup_settings(app: AppHandle) -> Result<(), String> {
    let st = app.state::<AppState>();
    let _write = st.persistence.lock().unwrap();
    let cfg = st.cfg.lock().unwrap().clone();
    config::backup(&st.dir, &cfg, "settings-backup.json")
}

#[tauri::command]
fn restore_settings(app: AppHandle) -> Result<(), String> {
    let st = app.state::<AppState>();
    let mut restored: Config =
        config::parse_import(&config::read_bounded(&st.dir.join("settings-backup.json"))?)?;
    restored.ensure_builtins();
    {
        let _write = st.persistence.lock().unwrap();
        let old = st.cfg.lock().unwrap().clone();
        // Startup registration is an OS preference; restoring appearance must not change it.
        restored.system.start_with_windows = old.system.start_with_windows;
        config::backup(&st.dir, &old, "settings-before-restore.json")?;
        config::save(&st.dir, &restored)?;
        *st.cfg.lock().unwrap() = restored.clone();
    }
    let _ = app.emit("state", &restored);
    update_tray(&app, restored.paused);
    Ok(())
}

/// Step through the library on every display. Entries whose file has gone missing are skipped.
fn step_wallpaper(app: &AppHandle, dir: isize) {
    let _ = mutate(app, |c| {
        let n = c.items.len() as isize;
        if n == 0 {
            return;
        }
        let start = c
            .assign
            .get("*")
            .and_then(|id| c.items.iter().position(|i| &i.id == id))
            .map(|i| i as isize)
            .unwrap_or(if dir > 0 { -1 } else { 0 });
        for step in 1..=n {
            let item = &c.items[(start + dir * step).rem_euclid(n) as usize];
            if item.path.as_ref().is_none_or(|p| std::path::Path::new(p).exists()) {
                let id = item.id.clone();
                c.assign.clear();
                c.assign.insert("*".into(), id);
                return;
            }
        }
    });
}

fn random_wallpaper(app: &AppHandle) {
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.subsec_nanos() as usize) ^ (d.as_secs() as usize).rotate_left(7))
        .unwrap_or(0);
    let _ = mutate(app, |c| {
        let current = c.assign.get("*").cloned();
        let ids: Vec<String> = c
            .items
            .iter()
            .filter(|i| Some(&i.id) != current.as_ref())
            .filter(|i| i.path.as_ref().is_none_or(|p| std::path::Path::new(p).exists()))
            .map(|i| i.id.clone())
            .collect();
        if ids.is_empty() {
            return;
        }
        c.assign.clear();
        c.assign.insert("*".into(), ids[seed % ids.len()].clone());
    });
}

// ---------------------------------------------------------------- hotkeys

fn flip_display(c: &mut Config, key: &str) {
    if !c.display.is_object() {
        c.display = Value::Object(Default::default());
    }
    let on = c.display.get(key).and_then(Value::as_bool).unwrap_or(false);
    c.display[key] = Value::Bool(!on);
}

/// Everything a hotkey can do. Each action goes through `mutate` (like any setting change), so the Studio, the
/// renderer and the tray all follow along, and the Studio is told which hotkey fired.
fn run_action(app: &AppHandle, id: &str) {
    match id {
        "next" => step_wallpaper(app, 1),
        "prev" => step_wallpaper(app, -1),
        "random" => random_wallpaper(app),
        "pause" => {
            let paused = !app.state::<AppState>().cfg.lock().unwrap().paused;
            let _ = mutate(app, |c| c.paused = paused);
        }
        "oled" => {
            let _ = mutate(app, |c| flip_display(c, "oled"));
        }
        "brightUp" | "brightDown" => {
            let delta = if id == "brightUp" { 5.0 } else { -5.0 };
            let _ = mutate(app, |c| {
                if !c.display.is_object() {
                    c.display = Value::Object(Default::default());
                }
                let now = c.display.get("brightness").and_then(Value::as_f64).unwrap_or(100.0);
                c.display["brightness"] = Value::from((now + delta).clamp(20.0, 150.0).round());
            });
        }
        "quality" => {
            const ORDER: [&str; 5] = ["auto", "eco", "balanced", "high", "ultra"];
            let _ = mutate(app, |c| {
                if !c.display.is_object() {
                    c.display = Value::Object(Default::default());
                }
                let now = c.display.get("quality").and_then(Value::as_str).unwrap_or("auto").to_string();
                let next = ORDER.iter().position(|q| *q == now).map(|i| (i + 1) % ORDER.len()).unwrap_or(0);
                c.display["quality"] = Value::from(ORDER[next]);
            });
        }
        "audio" => {
            let _ = mutate(app, |c| c.system.audio = !c.system.audio);
        }
        "interactive" => {
            let _ = mutate(app, |c| c.system.interactive = !c.system.interactive);
        }
        "widgets" => {
            let _ = mutate(app, |c| {
                if !c.widgets.is_object() {
                    c.widgets = serde_json::json!({"enabled": true, "items": []});
                }
                let on = c.widgets.get("enabled").and_then(Value::as_bool).unwrap_or(true);
                c.widgets["enabled"] = Value::Bool(!on);
            });
        }
        "studio" => {
            let h = app.clone();
            let _ = app.run_on_main_thread(move || open_studio(&h)); // windows are created on the main thread
        }
        "restart" => {
            if let Err(e) = restart_renderer(app.clone()) {
                let _ = app.emit("app-error", e);
            }
        }
        other => {
            if let Some(n) = other.strip_prefix("profile").and_then(|n| n.parse::<usize>().ok()) {
                let _ = mutate(app, |c| {
                    if let Some(p) = c.profiles.get(n.saturating_sub(1)).cloned() {
                        lifestyles::apply_profile(c, p);
                    }
                });
            }
        }
    }
    let _ = app.emit("hotkey", id);
}

fn apply_hotkeys(app: &AppHandle) -> BTreeMap<String, hotkeys::Status> {
    let cfg = app.state::<AppState>().cfg.lock().unwrap().hotkeys.clone();
    app.state::<Arc<hotkeys::Service>>().apply(cfg.enabled, &hotkeys::effective(&cfg.bindings))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeysDto {
    enabled: bool,
    bindings: BTreeMap<String, String>,
    defaults: BTreeMap<String, String>,
    actions: &'static [hotkeys::Action],
    status: BTreeMap<String, hotkeys::Status>,
}

fn hotkeys_dto(app: &AppHandle) -> HotkeysDto {
    let cfg = app.state::<AppState>().cfg.lock().unwrap().hotkeys.clone();
    HotkeysDto {
        enabled: cfg.enabled,
        bindings: hotkeys::effective(&cfg.bindings),
        defaults: hotkeys::defaults(),
        actions: hotkeys::ACTIONS,
        status: app.state::<Arc<hotkeys::Service>>().status(),
    }
}

fn studio_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "studio" { Ok(()) } else { Err("Studio only".into()) }
}

#[tauri::command]
fn get_hotkeys(app: AppHandle, window: tauri::WebviewWindow) -> Result<HotkeysDto, String> {
    studio_only(&window)?;
    Ok(hotkeys_dto(&app))
}

/// Save the full set of shortcuts. Anything the safety policy refuses, or that two actions share, is rejected
/// with an explanation and nothing is changed.
#[tauri::command]
fn set_hotkeys(
    app: AppHandle,
    window: tauri::WebviewWindow,
    enabled: bool,
    bindings: BTreeMap<String, String>,
) -> Result<HotkeysDto, String> {
    studio_only(&window)?;
    let mut stored = BTreeMap::new();
    for (id, v) in bindings {
        if hotkeys::action(&id).is_none() {
            return Err("Unknown hotkey action".into());
        }
        let v = v.trim().to_string();
        let v = if v.is_empty() { v } else { hotkeys::canonical(&hotkeys::parse(&v)?) };
        stored.insert(id, v);
    }
    hotkeys::resolve_strict(&hotkeys::effective(&stored))?;
    mutate(&app, |c| {
        c.hotkeys.enabled = enabled;
        c.hotkeys.bindings = stored;
    })?;
    apply_hotkeys(&app);
    Ok(hotkeys_dto(&app))
}

/// The Studio pauses all hotkeys while it records a new one, so the current shortcuts don't eat the key presses.
#[tauri::command]
fn hotkeys_suspend(app: AppHandle, window: tauri::WebviewWindow, suspended: bool) -> Result<HotkeysDto, String> {
    studio_only(&window)?;
    app.state::<Arc<hotkeys::Service>>().suspend(suspended);
    Ok(hotkeys_dto(&app))
}

// ---------------------------------------------------------------- windows

fn create_wallpaper(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("wallpaper").is_some() {
        return Ok(());
    }
    let w = WebviewWindowBuilder::new(app, "wallpaper", WebviewUrl::App("renderer.html".into()))
        .title("Silk Engine Wallpaper")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .shadow(false)
        .visible(false)
        .additional_browser_args(BROWSER_ARGS)
        .build()?;
    #[cfg(windows)]
    {
        let raw = w.hwnd()?.0 as isize;
        *app.state::<AppState>().wallpaper_hwnd.lock().unwrap() = raw;
        match desktop::attach(raw) {
            Ok(parent) => *app.state::<AppState>().parent_hwnd.lock().unwrap() = parent,
            Err(e) => eprintln!("[silk] desktop attach failed: {e}"),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = w.set_fullscreen(true);
    }
    #[cfg(windows)]
    if *app.state::<AppState>().parent_hwnd.lock().unwrap() != 0 {
        w.show()?;
    }
    #[cfg(not(windows))]
    w.show()?;
    Ok(())
}

/// Called when monitors change or Explorer restarts.
pub fn reattach(app: &AppHandle) {
    #[cfg(windows)]
    {
        let st = app.state::<AppState>();
        let raw = *st.wallpaper_hwnd.lock().unwrap();
        if raw != 0 {
            if let Ok(parent) = desktop::attach(raw) {
                *st.parent_hwnd.lock().unwrap() = parent;
                if let Some(w) = app.get_webview_window("wallpaper") {
                    let _ = w.show();
                }
            }
        }
    }
    let _ = app;
}

fn open_studio(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("studio") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "studio", WebviewUrl::App("index.html".into()))
        .title("Silk Engine")
        .inner_size(1280.0, 820.0)
        .min_inner_size(920.0, 620.0)
        .center()
        // the Studio draws its own liquid-glass title bar; keep the native shadow + rounded corners
        .decorations(false)
        .shadow(true)
        .additional_browser_args(BROWSER_ARGS)
        .build();
}

struct TrayItems {
    pause: Mutex<Option<MenuItem<tauri::Wry>>>,
}

fn update_tray(app: &AppHandle, paused: bool) {
    if let Some(t) = app.try_state::<TrayItems>() {
        if let Some(item) = t.pause.lock().unwrap().as_ref() {
            let _ = item.set_text(if paused {
                "Resume wallpaper"
            } else {
                "Pause wallpaper"
            });
        }
    }
}

fn quit(app: &AppHandle) {
    let st = app.state::<AppState>();
    st.quitting.store(true, Ordering::Relaxed);
    #[cfg(windows)]
    {
        let raw = *st.wallpaper_hwnd.lock().unwrap();
        if raw != 0 {
            desktop::detach(raw);
        }
    }
    app.exit(0);
}

// ---------------------------------------------------------------- entry

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            open_studio(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .register_asynchronous_uri_scheme_protocol("wp", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(protocol::handle(&app, request)));
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            apply_accent,
            get_hotkeys,
            set_hotkeys,
            hotkeys_suspend,
            lifestyles::profile_action,
            lifestyles::set_playlist,
            lifestyles::set_favorite,
            diagnostics,
            export_settings,
            import_settings,
            reset_preferences,
            undo_reset,
            community_download,
            community_cancel,
            set_widgets,
            widget_metrics,
            set_display,
            set_system,
            add_paths,
            remove_item,
            update_item,
            duplicate_item,
            assign,
            set_span,
            set_paused,
            config_dir,
            renderer_heartbeat,
            report_renderer_error,
            restart_renderer,
            backup_settings,
            restore_settings
        ])
        .setup(|app| {
            let dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            config::migrate_from_echelon_engine(&dir);
            let cfg = config::load(&dir);
            app.manage(community::Downloads::default());
            app.manage(maintenance::Diagnostics::default());
            app.manage(AppState {
                cfg: Mutex::new(cfg),
                persistence: Mutex::new(()),
                heartbeat: Mutex::new(std::time::Instant::now()),
                dir,
                quitting: AtomicBool::new(false),
                vis: Mutex::new(Default::default()),
                wallpaper_hwnd: Mutex::new(0),
                parent_hwnd: Mutex::new(0),
            });

            let handle = app.handle().clone();
            let service = hotkeys::Service::start({
                let h = handle.clone();
                move |id| run_action(&h, id)
            });
            app.manage(service);
            apply_hotkeys(&handle);
            let studio = MenuItem::with_id(app, "studio", "Open Studio", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause wallpaper", true, None::<&str>)?;
            let next = MenuItem::with_id(
                app,
                "next",
                "Next wallpaper (all displays)",
                true,
                None::<&str>,
            )?;
            let restart =
                MenuItem::with_id(app, "restart", "Restart wallpaper", true, None::<&str>)?;
            let backup = MenuItem::with_id(app, "backup", "Back up settings", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Silk Engine", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&studio, &pause, &next, &restart, &backup, &sep, &quit_i],
            )?;
            app.manage(TrayItems {
                pause: Mutex::new(Some(pause)),
            });
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Silk Engine")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "studio" => open_studio(app),
                    "pause" => {
                        let p = !app.state::<AppState>().cfg.lock().unwrap().paused;
                        let _ = mutate(app, |c| c.paused = p);
                    }
                    "next" => step_wallpaper(app, 1),
                    "restart" => {
                        if let Err(e) = restart_renderer(app.clone()) {
                            let _ = app.emit("app-error", e);
                        }
                    }
                    "backup" => {
                        if let Err(e) = backup_settings(app.clone()) {
                            let _ = app.emit("app-error", e);
                        }
                    }
                    "quit" => quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = e
                    {
                        open_studio(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            update_tray(
                &handle,
                handle.state::<AppState>().cfg.lock().unwrap().paused,
            );

            create_wallpaper(&handle)?;
            watcher::spawn(handle.clone());
            audio::spawn(handle.clone());
            if !std::env::args().any(|a| a == "--hidden") {
                open_studio(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Silk Engine");

    app.run(|app, event| match event {
        // Closing the Studio must not quit: the wallpaper keeps running from the tray.
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() && !app.state::<AppState>().quitting.load(Ordering::Relaxed) {
                api.prevent_exit();
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } if label == "studio" => {
            if let Some(s) = app.try_state::<Arc<hotkeys::Service>>() {
                s.suspend(false);
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } if label == "wallpaper" => {
            // Explorer took our parent down with it (e.g. explorer.exe restart). Rebuild.
            if !app.state::<AppState>().quitting.load(Ordering::Relaxed) {
                *app.state::<AppState>().wallpaper_hwnd.lock().unwrap() = 0;
                let h = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let h2 = h.clone();
                    let _ = h.run_on_main_thread(move || {
                        if !h2.state::<AppState>().quitting.load(Ordering::Relaxed) {
                            let _ = create_wallpaper(&h2);
                        }
                    });
                });
            }
        }
        RunEvent::Exit => desktop::restore_wallpaper(),
        _ => {}
    });
}
