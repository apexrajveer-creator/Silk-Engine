//! Bounded streaming downloads into the app's owned collection.
use crate::{
    config::{self, Item},
    AppState,
};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
#[derive(Default)]
pub struct Downloads {
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
}
struct Transfer {
    app: AppHandle,
    part: std::path::PathBuf,
}
impl Drop for Transfer {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.part);
        if let Ok(mut active) = self.app.state::<Downloads>().active.lock() {
            *active = None;
        }
    }
}
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn valid_url(raw: &str, id: &str, extension: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(raw).map_err(|_| "Invalid media URL")?;
    let host = u.host_str().unwrap_or("");
    let prefix = host.strip_suffix(".supabase.co").unwrap_or("");
    if u.scheme() != "https"
        || prefix.is_empty()
        || !prefix
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
        || !u
            .path()
            .starts_with("/storage/v1/object/sign/silk-wallpapers/")
        || !u.path().ends_with(&format!("/{id}/wallpaper.{extension}"))
        || !u.query_pairs().any(|(k, _)| k == "token")
    {
        return Err("Untrusted media URL".into());
    }
    Ok(u)
}
fn signature(head: &[u8], ext: &str) -> bool {
    match ext {
        "gif" => head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a"),
        "mp4" => head.len() >= 12 && &head[4..8] == b"ftyp",
        "webm" => head.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
        _ => false,
    }
}
#[tauri::command]
pub fn community_cancel(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    if window.label() != "studio" {
        return Err("Studio only".into());
    }
    if let Some((job, abort)) = app
        .state::<Downloads>()
        .active
        .lock()
        .map_err(|_| "Download state unavailable")?
        .as_ref()
    {
        if job == &id {
            abort.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn community_download(
    app: AppHandle,
    window: WebviewWindow,
    url: String,
    id: String,
    title: String,
    extension: String,
    expected_bytes: u64,
    sha256: String,
    apply: bool,
    monitor: String,
) -> Result<Item, String> {
    if window.label() != "studio" {
        return Err("Studio only".into());
    }
    if !valid_id(&id)
        || !["gif", "mp4", "webm"].contains(&extension.as_str())
        || expected_bytes == 0
        || expected_bytes > 50 * 1024 * 1024
        || sha256.len() != 64
        || !sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid download metadata".into());
    }
    let url = valid_url(&url, &id, &extension)?;
    let abort = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<Downloads>();
        let mut active = state
            .active
            .lock()
            .map_err(|_| "Download state unavailable")?;
        if active.is_some() {
            return Err("Another wallpaper is downloading".into());
        }
        *active = Some((id.clone(), abort.clone()));
    }
    let dir = app.state::<AppState>().dir.join("community");
    let part = dir.join(format!("{id}.part"));
    let _transfer = Transfer {
        app: app.clone(),
        part: part.clone(),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Could not connect to wallpaper storage")?;
    if !response.status().is_success() {
        return Err("Wallpaper download unavailable; retry".into());
    }
    if response
        .content_length()
        .is_some_and(|n| n != expected_bytes)
    {
        return Err("Wallpaper size changed; refresh Discover".into());
    }
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut received = 0u64;
    let mut head = Vec::new();
    let mut last = Instant::now();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Download interrupted; retry")?
    {
        if abort.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        received += chunk.len() as u64;
        if received > expected_bytes {
            return Err("Download exceeds its expected size".into());
        }
        if head.len() < 16 {
            head.extend_from_slice(&chunk[..chunk.len().min(16 - head.len())]);
        }
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        if last.elapsed() > Duration::from_millis(100) {
            let _ = app.emit_to(
                "studio",
                "community-progress",
                serde_json::json!({"id":id,"received":received,"total":expected_bytes}),
            );
            last = Instant::now();
        }
    }
    if abort.load(Ordering::Relaxed) {
        return Err("Download cancelled".into());
    }
    if received != expected_bytes
        || format!("{:x}", hash.finalize()) != sha256.to_lowercase()
        || !signature(&head, &extension)
    {
        return Err("Wallpaper integrity check failed".into());
    }
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    let destination = dir.join(format!("{id}.{extension}"));
    std::fs::rename(&part, &destination).map_err(|e| e.to_string())?;
    let item = Item {
        id: format!("community-{id}"),
        name: title.chars().take(120).collect(),
        kind: if extension == "gif" { "image" } else { "video" }.into(),
        path: Some(destination.to_string_lossy().into()),
        ..Default::default()
    };
    let st = app.state::<AppState>();
    let _write = st.persistence.lock().map_err(|_| "Settings unavailable")?;
    let mut next = st.cfg.lock().map_err(|_| "Settings unavailable")?.clone();
    next.items.retain(|i| i.id != item.id);
    next.items.push(item.clone());
    if apply {
        if monitor == "*" {
            next.assign.clear();
        }
        next.assign.insert(monitor, item.id.clone());
    }
    config::save(&st.dir, &next)?;
    *st.cfg.lock().map_err(|_| "Settings unavailable")? = next.clone();
    let _ = app.emit("state", next);
    Ok(item)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_untrusted_destinations() {
        let id = "12345678-1234-1234-1234-123456789abc";
        assert!(valid_url(&format!("https://project.supabase.co/storage/v1/object/sign/silk-wallpapers/owner/{id}/wallpaper.mp4?token=x"),id,"mp4").is_ok());
        for raw in [
            "http://localhost/x",
            "https://project.supabase.co.evil.com/x",
            "https://127.0.0.1/x",
            "file:///tmp/x",
        ] {
            assert!(valid_url(raw, id, "mp4").is_err());
        }
    }
    #[test]
    fn media_headers_are_checked() {
        assert!(signature(b"GIF89atest", "gif"));
        assert!(signature(
            &[0, 0, 0, 20, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm'],
            "mp4"
        ));
        assert!(!signature(b"<html>", "mp4"));
        assert!(!valid_id("../outside"));
    }
}
