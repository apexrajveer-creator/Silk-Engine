//! Persistent configuration. The frontend owns the meaning of per-item `settings` and of
//! `display` (they are schema-driven in src/shared/catalog.js), so Rust stores them as JSON.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    /// "scene" | "video" | "image" | "web"
    pub kind: String,
    /// Built-in simulation id for kind == "scene".
    pub scene: Option<String>,
    /// File (video/image) or folder (web) on disk.
    pub path: Option<String>,
    /// Entry HTML file for web wallpapers, relative to `path`.
    pub entry: Option<String>,
    pub settings: Value,
    pub builtin: bool,
}

impl Default for Item {
    fn default() -> Self {
        Item {
            id: String::new(),
            name: String::new(),
            kind: "scene".into(),
            scene: None,
            path: None,
            entry: None,
            settings: Value::Object(Map::new()),
            builtin: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct System {
    pub pause_when_covered: bool,
    pub hibernate: bool,
    /// "normal" | "eco" | "pause"
    pub battery: String,
    pub audio: bool,
    pub interactive: bool,
    pub start_with_windows: bool,
    /// Match the Windows accent colour to the wallpaper (see theme.rs).
    pub theme_sync: bool,
}

impl Default for System {
    fn default() -> Self {
        System {
            pause_when_covered: false,
            hibernate: false,
            battery: "eco".into(),
            audio: true,
            interactive: true,
            start_with_windows: false,
            theme_sync: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    pub items: Vec<Item>,
    /// monitor key (e.g. "\\\\.\\DISPLAY1") -> item id. Key "*" applies to every monitor without its own entry.
    pub assign: HashMap<String, String>,
    pub span: bool,
    pub paused: bool,
    pub display: Value,
    pub widgets: Value,
    pub system: System,
    pub profiles: Vec<DesktopProfile>,
    pub playlist: Playlist,
    pub favorites: Vec<String>,
    /// The user's own accent colour, captured before theme sync first changed it.
    pub accent_backup: Option<crate::theme::AccentBackup>,
}

impl Default for Config {
    fn default() -> Self {
        let mut assign = HashMap::new();
        assign.insert("*".into(), "builtin-silk".into());
        Config {
            version: 1,
            items: Vec::new(),
            assign,
            span: false,
            paused: false,
            display: Value::Object(Map::new()),
            widgets: serde_json::json!({"enabled": true, "items": []}),
            system: System::default(),
            profiles: Vec::new(),
            playlist: Playlist::default(),
            favorites: Vec::new(),
            accent_backup: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DesktopProfile {
    pub id: String,
    pub name: String,
    pub assign: HashMap<String, String>,
    pub span: bool,
    pub display: Value,
    pub widgets: Value,
    pub settings: HashMap<String, Value>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Playlist {
    pub enabled: bool,
    pub items: Vec<String>,
    pub interval: u64,
    pub shuffle: bool,
    pub monitor: String,
}
impl Default for Playlist {
    fn default() -> Self {
        Self {
            enabled: false,
            items: Vec::new(),
            interval: 300,
            shuffle: false,
            monitor: "*".into(),
        }
    }
}

const BUILTINS: &[(&str, &str)] = &[
    ("silk", "Living Silk"),
    ("fluid", "Fluid Ink"),
    ("lissajous", "Harmonics"),
    ("particles", "Flow Field"),
];

impl Config {
    pub fn ensure_builtins(&mut self) {
        // 0.9.9 replaced Reaction–Diffusion (and the short-lived Glacier and Ferrofluid) with Lissajous: drop the
        // old built-ins, move presets and display assignments across so nobody is left on a missing scene.
        let retired = |s: Option<&str>| matches!(s, Some("reaction") | Some("glacier") | Some("ferrofluid"));
        self.items.retain(|it| !(it.builtin && retired(it.scene.as_deref())));
        for it in self.items.iter_mut().filter(|it| retired(it.scene.as_deref())) {
            it.scene = Some("lissajous".into());
            it.settings = Value::Object(Map::new());
        }
        // 0.9.9: the Lissajous scene gained Cymatics and was named "Visualizer", then "Fabric", then "Harmonics"
        for it in self.items.iter_mut().filter(|it| it.builtin && it.id == "builtin-lissajous" && (it.name == "Lissajous" || it.name == "Visualizer" || it.name == "Fabric")) {
            it.name = "Harmonics".into();
        }
        let swap = |v: &mut String| {
            if v == "builtin-reaction" || v == "builtin-glacier" || v == "builtin-ferrofluid" {
                *v = "builtin-lissajous".into();
            }
        };
        self.assign.values_mut().for_each(swap);
        self.playlist.items.iter_mut().for_each(swap);
        self.favorites.iter_mut().for_each(swap);
        for (i, (scene, name)) in BUILTINS.iter().enumerate() {
            let id = format!("builtin-{scene}");
            if !self.items.iter().any(|it| it.id == id) {
                self.items.insert(
                    i.min(self.items.len()),
                    Item {
                        id,
                        name: (*name).into(),
                        kind: "scene".into(),
                        scene: Some((*scene).into()),
                        builtin: true,
                        ..Default::default()
                    },
                );
            }
        }
        // drop assignments to items that no longer exist
        let ids: Vec<String> = self.items.iter().map(|i| i.id.clone()).collect();
        self.assign.retain(|_, v| ids.contains(v));
        if !self.assign.contains_key("*") {
            self.assign.insert("*".into(), "builtin-silk".into());
        }
    }

    pub fn item(&self, id: &str) -> Option<&Item> {
        self.items.iter().find(|i| i.id == id)
    }
}

/// The app was called "ECHELON Engine" before 0.3. Bring its library and settings across once.
pub fn migrate_from_echelon_engine(dir: &Path) {
    if file_path(dir).exists() {
        return;
    }
    if let Some(old) = dir
        .parent()
        .map(|p| p.join("com.echelon.engine").join("config.json"))
    {
        if old.is_file() && std::fs::create_dir_all(dir).is_ok() {
            let _ = std::fs::copy(old, file_path(dir));
        }
    }
}

/// "Travis_Scott_-_CAN_T_SAY_Official" -> "Travis Scott - CAN T SAY Official"
pub fn pretty_name(stem: &str) -> String {
    let s: String = stem
        .chars()
        .map(|c| if c == '_' { ' ' } else { c })
        .collect();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() {
        "Wallpaper".into()
    } else {
        s.chars().take(80).collect()
    }
}

pub fn file_path(dir: &Path) -> PathBuf {
    dir.join("config.json")
}

const MAX_CONFIG_BYTES: u64 = 16 * 1024 * 1024;
/// Reject malformed backups before they can replace a working configuration.
pub fn parse_import(bytes: &[u8]) -> Result<Config, String> {
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        return Err("Settings exceed 16 MB".into());
    }
    let raw: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if raw.get("version").and_then(Value::as_u64) != Some(1)
        || !raw.get("items").is_some_and(Value::is_array)
        || !raw.get("assign").is_some_and(Value::is_object)
    {
        return Err("Choose a supported Silk settings export (version 1)".into());
    }
    let mut cfg: Config = serde_json::from_value(raw).map_err(|e| e.to_string())?;
    validate(&cfg)?;
    cfg.ensure_builtins();
    Ok(cfg)
}

pub fn validate(cfg: &Config) -> Result<(), String> {
    if cfg.version != 1 || cfg.items.len() > 2000 || cfg.assign.len() > 128 {
        return Err("Unsupported or oversized settings".into());
    }
    if !cfg.display.is_object()
        || !cfg.widgets.is_object()
        || !matches!(cfg.system.battery.as_str(), "normal" | "eco" | "pause")
    {
        return Err("Invalid display, widget or power settings".into());
    }
    if cfg
        .widgets
        .get("items")
        .and_then(Value::as_array)
        .is_some_and(|v| v.len() > 64)
    {
        return Err("A layout supports at most 64 widgets".into());
    }
    if cfg.profiles.len() > 24
        || cfg.favorites.len() > 2000
        || cfg.playlist.items.len() > 2000
        || !(30..=86400).contains(&cfg.playlist.interval)
        || cfg.playlist.monitor.len() > 160
        || cfg.playlist.monitor.is_empty()
        || cfg
            .playlist
            .items
            .iter()
            .any(|id| id.is_empty() || id.len() > 160)
    {
        return Err("Invalid profile or playlist limits".into());
    }
    let mut profile_ids = std::collections::HashSet::new();
    for p in &cfg.profiles {
        if p.id.is_empty()
            || p.id.len() > 160
            || !profile_ids.insert(&p.id)
            || p.name.trim().is_empty()
            || p.name.len() > 160
            || p.assign.len() > 128
            || !p.display.is_object()
            || !p.widgets.is_object()
            || p.settings.len() > 2000
            || p.settings.values().any(|v| !v.is_object())
            || p.widgets
                .get("items")
                .and_then(Value::as_array)
                .is_some_and(|v| v.len() > 64)
        {
            return Err("Invalid desktop profile".into());
        }
    }
    let mut ids = std::collections::HashSet::new();
    for item in &cfg.items {
        if item.id.is_empty()
            || item.id.len() > 160
            || !ids.insert(&item.id)
            || !item.settings.is_object()
            || item.name.len() > 1024
            || !matches!(item.kind.as_str(), "scene" | "video" | "image" | "web")
        {
            return Err("Invalid or duplicate wallpaper entry".into());
        }
        if item.kind == "scene"
            && !BUILTINS
                .iter()
                .any(|(scene, _)| item.scene.as_deref() == Some(*scene))
        {
            return Err("Unknown wallpaper simulation".into());
        }
    }
    Ok(())
}
pub fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    f.take(MAX_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        return Err("Settings exceed 16 MB".into());
    }
    Ok(bytes)
}

pub fn load(dir: &Path) -> Config {
    let mut cfg = [
        file_path(dir),
        dir.join("config.json.bak"),
        dir.join("config.json.tmp"),
    ]
    .iter()
    .find_map(|path| {
        read_bounded(path).ok().and_then(|s| {
            serde_json::from_slice::<Config>(&s)
                .ok()
                .filter(|cfg| validate(cfg).is_ok())
        })
    })
    .unwrap_or_default();
    cfg.ensure_builtins();
    cfg
}

/// Write + sync + replace, keeping the last valid config for recovery.
/// The app serializes calls with its persistence mutex.
pub fn save(dir: &Path, cfg: &Config) -> Result<(), String> {
    use std::io::Write;
    validate(cfg)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("config.json.tmp");
    let data = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;
    if data.len() as u64 > MAX_CONFIG_BYTES {
        return Err("Settings exceed 16 MB".into());
    }
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(&data).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    let dest = file_path(dir);
    if let Ok(old) = read_bounded(&dest) {
        if let Ok(previous) = serde_json::from_slice::<Config>(&old) {
            if validate(&previous).is_ok() {
                backup(dir, &previous, "config.json.bak")?;
            }
        }
    }
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())
}

pub fn backup(dir: &Path, cfg: &Config, name: &str) -> Result<(), String> {
    use std::io::Write;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let data = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;
    if data.len() as u64 > MAX_CONFIG_BYTES {
        return Err("Settings exceed 16 MB".into());
    }
    let tmp = dir.join(format!("{name}.tmp"));
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(&data).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(tmp, dir.join(name)).map_err(|e| e.to_string())
}

/// Shallow-merge `patch` into `target` (both JSON objects).
pub fn merge(target: &mut Value, patch: &Value) {
    if !target.is_object() {
        *target = Value::Object(Map::new());
    }
    if let (Some(t), Some(p)) = (target.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            if v.is_null() {
                t.remove(k);
            } else {
                t.insert(k.clone(), v.clone());
            }
        }
    }
}

pub fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("item-{n:x}-{sequence:x}")
}

const VIDEO: &[&str] = &["mp4", "webm", "m4v", "mov", "ogv", "ogg", "mkv"];
const IMAGE: &[&str] = &[
    "gif", "webp", "png", "apng", "jpg", "jpeg", "bmp", "avif", "svg",
];

pub fn ext_of(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Turn a dropped/picked path into library items. Folders with an index.html become web
/// wallpapers; other folders are scanned (one level) for media.
pub fn items_from_path(p: &Path) -> Vec<Item> {
    let mut out = Vec::new();
    let name = pretty_name(
        p.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Wallpaper"),
    );
    if p.is_dir() {
        if p.join("index.html").is_file() {
            out.push(Item {
                id: new_id(),
                name,
                kind: "web".into(),
                path: Some(p.to_string_lossy().into()),
                entry: Some("index.html".into()),
                ..Default::default()
            });
        } else if let Ok(rd) = std::fs::read_dir(p) {
            let mut files: Vec<PathBuf> = rd
                .take(10000)
                .flatten()
                .map(|e| e.path())
                .filter(|f| f.is_file())
                .collect();
            files.sort();
            for f in files.into_iter().take(200) {
                out.extend(items_from_path(&f));
            }
        }
        return out;
    }
    if !p.is_file() {
        return out;
    }
    let ext = ext_of(p);
    let kind = if VIDEO.contains(&ext.as_str()) {
        "video"
    } else if IMAGE.contains(&ext.as_str()) {
        "image"
    } else if ext == "html" || ext == "htm" {
        "web"
    } else {
        return out;
    };
    let mut it = Item {
        id: new_id(),
        name,
        kind: kind.into(),
        ..Default::default()
    };
    if kind == "web" {
        it.path = p.parent().map(|d| d.to_string_lossy().into());
        it.entry = p.file_name().map(|f| f.to_string_lossy().into());
    } else {
        it.path = Some(p.to_string_lossy().into());
    }
    out.push(it);
    out
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    #[test]
    fn import_rejects_unknown_versions_and_duplicate_ids() {
        assert!(parse_import(br#"{}"#).is_err());
        let mut cfg = Config::default();
        cfg.ensure_builtins();
        cfg.version = 2;
        assert!(parse_import(&serde_json::to_vec(&cfg).unwrap()).is_err());
        cfg.version = 1;
        cfg.items.push(cfg.items[0].clone());
        assert!(parse_import(&serde_json::to_vec(&cfg).unwrap()).is_err());
    }
    #[test]
    fn rejects_invalid_config_without_overwriting_saved_settings() {
        let dir = temp();
        let mut cfg = Config::default();
        cfg.ensure_builtins();
        save(&dir, &cfg).unwrap();
        cfg.display = Value::Null;
        assert!(save(&dir, &cfg).is_err());
        assert!(load(&dir).display.is_object());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn ids_are_unique_without_sleeping() {
        let ids: std::collections::HashSet<_> = (0..10000).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 10000);
    }
    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("silk-config-test-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
    #[test]
    fn replaces_existing_config_and_recovers_from_corruption() {
        let dir = temp();
        let mut cfg = Config::default();
        cfg.ensure_builtins();
        save(&dir, &cfg).unwrap();
        cfg.paused = true;
        save(&dir, &cfg).unwrap();
        assert!(load(&dir).paused);
        std::fs::write(file_path(&dir), b"broken json").unwrap();
        let recovered = load(&dir);
        assert!(!recovered.paused);
        assert_eq!(recovered.items.len(), 4);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn manual_backup_survives_subsequent_saves() {
        let dir = temp();
        let mut cfg = Config::default();
        cfg.ensure_builtins();
        backup(&dir, &cfg, "settings-backup.json").unwrap();
        cfg.paused = true;
        save(&dir, &cfg).unwrap();
        let saved: Config =
            serde_json::from_slice(&std::fs::read(dir.join("settings-backup.json")).unwrap())
                .unwrap();
        assert!(!saved.paused);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn unreadable_destination_returns_error() {
        let dir = temp();
        let file = dir.join("not-a-directory");
        std::fs::write(&file, "x").unwrap();
        assert!(save(&file, &Config::default()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    #[test]
    fn old_settings_default_to_disabled_playlist() {
        let c: Config = serde_json::from_str(r#"{"version":1,"items":[],"assign":{}}"#).unwrap();
        assert!(c.profiles.is_empty());
        assert!(!c.playlist.enabled);
        assert_eq!(c.playlist.interval, 300);
        assert!(validate(&c).is_ok());
    }
    #[test]
    fn reject_tight_intervals_and_duplicate_profiles() {
        let mut c = Config::default();
        c.playlist.interval = 0;
        assert!(validate(&c).is_err());
        c.playlist.interval = 30;
        let p = DesktopProfile {
            id: "a".into(),
            name: "Desk".into(),
            assign: Default::default(),
            span: false,
            display: serde_json::json!({}),
            widgets: serde_json::json!({"items":[]}),
            settings: Default::default(),
        };
        c.profiles = vec![p.clone(), p];
        assert!(validate(&c).is_err());
    }
}
