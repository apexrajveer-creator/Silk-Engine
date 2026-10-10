use crate::playlist::next_wallpaper;
// Desktop presets and low-frequency playlist scheduling, independent of Studio.
use crate::{
    config::{DesktopProfile, Playlist},
    AppState,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};
fn studio(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "studio" {
        Ok(())
    } else {
        Err("Studio only".into())
    }
}
#[tauri::command]
pub fn profile_action(
    app: AppHandle,
    window: WebviewWindow,
    action: String,
    id: String,
    name: String,
) -> Result<(), String> {
    studio(&window)?;
    if !matches!(action.as_str(), "save" | "apply" | "delete") {
        return Err("Unknown profile action".into());
    }
    if action == "save" && (name.trim().is_empty() || name.len() > 160) {
        return Err("Use a profile name under 160 bytes".into());
    }
    let cfg = app
        .state::<AppState>()
        .cfg
        .lock()
        .map_err(|_| "Settings unavailable")?
        .clone();
    if action != "save" && !cfg.profiles.iter().any(|p| p.id == id) {
        return Err("Profile no longer exists".into());
    }
    crate::mutate(&app, |c| match action.as_str() {
        "save" => {
            let p = DesktopProfile {
                id: if id.is_empty() {
                    crate::config::new_id()
                } else {
                    id.clone()
                },
                name: name.trim().into(),
                assign: c.assign.clone(),
                span: c.span,
                display: c.display.clone(),
                widgets: c.widgets.clone(),
                settings: c
                    .items
                    .iter()
                    .map(|i| (i.id.clone(), i.settings.clone()))
                    .collect(),
            };
            c.profiles.retain(|v| v.id != p.id);
            c.profiles.push(p);
        }
        "delete" => c.profiles.retain(|p| p.id != id),
        _ => {
            if let Some(p) = c.profiles.iter().find(|p| p.id == id).cloned() {
                c.assign = p.assign;
                c.span = p.span;
                c.display = p.display;
                c.widgets = p.widgets;
                for i in &mut c.items {
                    if let Some(s) = p.settings.get(&i.id) {
                        i.settings = s.clone();
                    }
                }
                c.playlist.enabled = false;
                c.ensure_builtins();
            }
        }
    })
}
#[tauri::command]
pub fn set_playlist(
    app: AppHandle,
    window: WebviewWindow,
    playlist: Playlist,
) -> Result<(), String> {
    studio(&window)?;
    crate::mutate(&app, |c| c.playlist = playlist)
}
#[tauri::command]
pub fn set_favorite(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    favorite: bool,
) -> Result<(), String> {
    studio(&window)?;
    crate::mutate(&app, |c| {
        c.favorites.retain(|v| v != &id);
        if favorite && c.item(&id).is_some() {
            c.favorites.push(id);
        }
    })
}
#[derive(Default)]
pub struct PlaylistClock {
    checked: Option<Instant>,
    changed: Option<Instant>,
    signature: String,
}
impl PlaylistClock {
    pub fn tick(&mut self, app: &AppHandle) {
        if self
            .checked
            .is_some_and(|t| t.elapsed() < Duration::from_secs(1))
        {
            return;
        }
        self.checked = Some(Instant::now());
        let st = app.state::<AppState>();
        let cfg = match st.cfg.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let p = &cfg.playlist;
        let signature = serde_json::to_string(p).unwrap_or_default();
        if signature != self.signature {
            self.signature = signature;
            self.changed = Some(Instant::now());
        }
        let hidden = st
            .vis
            .lock()
            .map(|v| {
                v.locked
                    || v.hibernating
                    || v.all_covered
                    || (v.on_battery && cfg.system.battery == "pause")
            })
            .unwrap_or(true);
        if !p.enabled || cfg.paused || hidden {
            self.changed = Some(Instant::now());
            return;
        }
        if self
            .changed
            .is_none_or(|t| t.elapsed() < Duration::from_secs(p.interval))
        {
            return;
        }
        self.changed = Some(Instant::now());
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos() as usize;
        let Some(id) = next_wallpaper(&cfg, seed) else {
            return;
        };
        let p = p.clone();
        drop(cfg);
        if crate::mutate(app, |c| {
            if serde_json::to_string(&c.playlist).unwrap_or_default() != self.signature
                || !c.playlist.enabled
                || c.paused
            {
                return;
            }
            if p.monitor == "*" {
                c.assign.clear();
            }
            c.assign.insert(p.monitor.clone(), id);
        })
        .is_err()
        {
            crate::maintenance::record(app, "Playlist change could not be saved");
        }
    }
}
