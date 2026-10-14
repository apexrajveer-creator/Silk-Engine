use crate::{
    config::{self, Config},
    AppState,
};
use serde_json::{json, Value};
use std::{collections::VecDeque, sync::Mutex, time::Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub struct Diagnostics {
    started: Instant,
    events: Mutex<VecDeque<Value>>,
}
impl Default for Diagnostics {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            events: Mutex::new(VecDeque::new()),
        }
    }
}
pub fn record(app: &AppHandle, message: &str) {
    // the same event, kept across restarts (best effort; see stability.rs)
    if let Some(st) = app.try_state::<AppState>() {
        crate::stability::log_line(&st.dir, crate::stability::unix_now(), crate::stability::home_dir().as_deref(), message);
    }
    let d = app.state::<Diagnostics>();
    if let Ok(mut events) = d.events.lock() {
        if events.len() >= 40 {
            events.pop_front();
        }
        events.push_back(json!({"seconds": d.started.elapsed().as_secs(), "message": message.chars().take(400).collect::<String>()}));
    };
}
fn studio(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "studio" {
        Ok(())
    } else {
        Err("Studio only".into())
    }
}
#[tauri::command]
pub fn diagnostics(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    studio(&window)?;
    let st = app.state::<AppState>();
    let cfg = st.cfg.lock().map_err(|_| "Settings unavailable")?;
    let d = app.state::<Diagnostics>();
    Ok(json!({
        "version": env!("CARGO_PKG_VERSION"), "platform": std::env::consts::OS,
        "uptimeSeconds": d.started.elapsed().as_secs(),
        "rendererPresent": app.get_webview_window("wallpaper").is_some(),
        "heartbeatAgeSeconds": st.heartbeat.lock().map_err(|_| "Heartbeat unavailable")?.elapsed().as_secs(),
        "visibility": *st.vis.lock().map_err(|_| "Visibility unavailable")?,
        "wallpapers": cfg.items.len(), "widgets": cfg.widgets.get("items").and_then(Value::as_array).map_or(0, Vec::len),
        "display": cfg.display, "system": cfg.system,
        "startup": {
            "developmentBuild": cfg!(debug_assertions),
            "entry": crate::autostart::registered_command(&app.package_info().name),
            "entryIsDevelopmentBuild": crate::autostart::registered_command(&app.package_info().name).as_deref().is_some_and(crate::autostart::is_dev_path),
        },
        "stability": {
            "safeMode": crate::stability::read_state(&st.dir).safe_mode,
            "crashReports": crate::stability::list_crash_reports(&st.dir),
            "logTail": crate::stability::read_log_tail(&st.dir, 60),
        },
        "monitors": crate::desktop::monitors(),
        "events": *d.events.lock().map_err(|_| "Diagnostics unavailable")?
    }))
}
#[tauri::command]
pub fn export_settings(app: AppHandle, window: WebviewWindow) -> Result<String, String> {
    studio(&window)?;
    let st = app.state::<AppState>();
    let cfg = st.cfg.lock().map_err(|_| "Settings unavailable")?;
    serde_json::to_string_pretty(&*cfg).map_err(|e| e.to_string())
}
fn replace(app: &AppHandle, mut next: Config, backup_name: &str) -> Result<(), String> {
    let st = app.state::<AppState>();
    let _write = st
        .persistence
        .lock()
        .map_err(|_| "Settings lock unavailable")?;
    let old = st.cfg.lock().map_err(|_| "Settings unavailable")?.clone();
    next.system.start_with_windows = old.system.start_with_windows;
    config::backup(&st.dir, &old, backup_name)?;
    config::save(&st.dir, &next)?;
    *st.cfg.lock().map_err(|_| "Settings unavailable")? = next.clone();
    let _ = app.emit("state", &next);
    crate::update_tray(app, next.paused);
    record(app, "Settings restored from import or recovery backup");
    Ok(())
}
#[tauri::command]
pub fn import_settings(
    app: AppHandle,
    window: WebviewWindow,
    contents: String,
) -> Result<(), String> {
    studio(&window)?;
    replace(
        &app,
        config::parse_import(contents.as_bytes())?,
        "settings-before-import.json",
    )
}
#[tauri::command]
pub fn reset_preferences(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    studio(&window)?;
    let st = app.state::<AppState>();
    let _write = st
        .persistence
        .lock()
        .map_err(|_| "Settings lock unavailable")?;
    let old = st.cfg.lock().map_err(|_| "Settings unavailable")?.clone();
    config::backup(&st.dir, &old, "settings-before-reset.json")?;
    let mut next = old.clone();
    next.display = json!({});
    next.system = Default::default();
    next.system.start_with_windows = old.system.start_with_windows;
    next.paused = false;
    next.span = false;
    for item in &mut next.items {
        item.settings = json!({});
    }
    config::save(&st.dir, &next)?;
    *st.cfg.lock().map_err(|_| "Settings unavailable")? = next.clone();
    let _ = app.emit("state", &next);
    crate::update_tray(&app, next.paused);
    record(
        &app,
        "Preferences reset; wallpaper collection and widget layout preserved",
    );
    Ok(())
}
#[tauri::command]
pub fn undo_reset(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    studio(&window)?;
    let bytes = config::read_bounded(
        &app.state::<AppState>()
            .dir
            .join("settings-before-reset.json"),
    )?;
    replace(
        &app,
        config::parse_import(&bytes)?,
        "settings-before-undo-reset.json",
    )
}
