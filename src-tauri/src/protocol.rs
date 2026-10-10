//! `wp://` — serves library media to the renderer.
//!
//! * Only paths that belong to a library item can be read (`/<item-id>/...`), so a third-party
//!   web wallpaper can never read arbitrary files from disk.
//! * Byte-range requests are honoured and capped per response, so a 4 GB video is streamed in
//!   small chunks instead of being read into memory.
//! * `Access-Control-Allow-Origin: *` lets WebGL sample the decoded frames (no canvas taint).

use crate::AppState;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

const CHUNK: u64 = 2 * 1024 * 1024;
const MAX_FILE: u64 = 64 * 1024 * 1024;
const MAX_HTML: u64 = 8 * 1024 * 1024;

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn byte_range(r: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 || r.contains(',') {
        return None;
    }
    let (a, b) = r.split_once('-')?;
    let (start, end) = if a.is_empty() {
        let n = b.parse::<u64>().ok()?.min(len);
        if n == 0 {
            return None;
        }
        (len - n, len - 1)
    } else {
        let start = a.parse::<u64>().ok()?;
        let end = if b.is_empty() {
            len - 1
        } else {
            b.parse::<u64>().ok()?.min(len - 1)
        };
        (start, end)
    };
    if start >= len || end < start {
        return None;
    }
    Some((start, end.min(start.saturating_add(CHUNK - 1))))
}

fn bounded_read(file: &mut std::fs::File, max: u64) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    file.take(max + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "File exceeds response limit",
        ));
    }
    Ok(bytes)
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = hex(b[i + 1]).zip(hex(b[i + 2])).map(|(a, b)| a * 16 + b) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn mime(p: &Path) -> &'static str {
    match crate::config::ext_of(p).as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" | "apng" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "jpg" | "jpeg" => "image/jpeg",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "ogv" | "ogg" => "video/ogg",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn error(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap()
}

enum Target {
    File(PathBuf, bool), // path, is the web wallpaper's entry page
    Shim,
}

const SHIM: &str = include_str!("../../src/shared/web-shim.js");
const SHIM_NAME: &str = "__echelon_shim.js";

fn resolve<R: Runtime>(app: &AppHandle<R>, uri_path: &str) -> Option<Target> {
    let path = decode(uri_path);
    if path.contains('\0') || path.contains(':') || path.contains('\\') {
        return None;
    }
    let mut parts = path.trim_start_matches('/').splitn(2, '/');
    let id = parts.next()?;
    let rest = parts.next().unwrap_or("");
    let state = app.state::<AppState>();
    let cfg = state.cfg.lock().ok()?;
    let item = cfg.item(id)?.clone();
    drop(cfg);
    let base = PathBuf::from(item.path.as_ref()?);
    if item.kind != "web" {
        return Some(Target::File(base, false)); // single-file items ignore the rest of the path
    }
    if rest == SHIM_NAME {
        return Some(Target::Shim);
    }
    let entry = item.entry.clone().unwrap_or_else(|| "index.html".into());
    let is_entry = rest.is_empty() || rest == entry;
    let rel = if rest.is_empty() {
        entry
    } else {
        rest.to_string()
    };
    let rel = Path::new(&rel);
    // no "..", no absolute paths, no drive prefixes: stay inside the wallpaper folder
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    let base = base.canonicalize().ok()?;
    let target = base.join(rel).canonicalize().ok()?;
    if !target.starts_with(&base) || !target.is_file() {
        return None;
    }
    Some(Target::File(target, is_entry))
}

/// Put the runtime/compat shim in front of everything else on the entry page.
fn inject(html: Vec<u8>) -> Vec<u8> {
    let tag = format!("<script src=\"{SHIM_NAME}\"></script>");
    let text = String::from_utf8_lossy(&html);
    let lower = text.to_ascii_lowercase();
    let at = lower
        .find("<head")
        .and_then(|i| lower[i..].find('>').map(|j| i + j + 1))
        .or_else(|| {
            lower
                .find("<html")
                .and_then(|i| lower[i..].find('>').map(|j| i + j + 1))
        })
        .unwrap_or(0);
    let mut out = String::with_capacity(text.len() + tag.len());
    out.push_str(&text[..at]);
    out.push_str(&tag);
    out.push_str(&text[at..]);
    out.into_bytes()
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if req.method() != tauri::http::Method::GET && req.method() != tauri::http::Method::HEAD {
        return error(StatusCode::METHOD_NOT_ALLOWED);
    }
    let head = req.method() == tauri::http::Method::HEAD;
    let (path, is_entry) = match resolve(app, req.uri().path()) {
        Some(Target::File(p, e)) => (p, e),
        Some(Target::Shim) => {
            return Response::builder()
                .header(header::CONTENT_TYPE, "text/javascript")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(if head {
                    Vec::new()
                } else {
                    SHIM.as_bytes().to_vec()
                })
                .unwrap()
        }
        None => return error(StatusCode::FORBIDDEN),
    };
    let Ok(mut f) = std::fs::File::open(&path) else {
        return error(StatusCode::NOT_FOUND);
    };
    let Ok(metadata) = f.metadata() else {
        return error(StatusCode::NOT_FOUND);
    };
    if !metadata.is_file() {
        return error(StatusCode::FORBIDDEN);
    }
    let len = metadata.len();
    let ty = mime(&path);
    let range = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .map(|v| v.trim().to_string());

    let builder = Response::builder()
        .header(header::CONTENT_TYPE, ty)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff");

    if head {
        return builder.status(StatusCode::OK).body(Vec::new()).unwrap();
    }

    if is_entry {
        if len > MAX_HTML {
            return error(StatusCode::PAYLOAD_TOO_LARGE);
        }
        let Ok(buf) = bounded_read(&mut f, MAX_HTML) else {
            return error(StatusCode::PAYLOAD_TOO_LARGE);
        };
        return builder.status(StatusCode::OK).body(inject(buf)).unwrap();
    }

    if let Some(r) = range {
        let Some((start, end)) = byte_range(&r, len) else {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(Vec::new())
                .unwrap();
        };
        let mut buf = vec![0u8; (end - start + 1) as usize];
        if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() {
            return error(StatusCode::INTERNAL_SERVER_ERROR);
        }
        return builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .body(buf)
            .unwrap();
    }

    if len > MAX_FILE {
        return error(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let Ok(buf) = bounded_read(&mut f, MAX_FILE) else {
        return error(StatusCode::PAYLOAD_TOO_LARGE);
    };
    builder.status(StatusCode::OK).body(buf).unwrap()
}

#[cfg(test)]
mod hardening_tests {
    use super::*;
    #[test]
    fn ranges_are_bounded_and_checked() {
        assert_eq!(
            byte_range("0-18446744073709551615", u64::MAX),
            Some((0, CHUNK - 1))
        );
        assert_eq!(
            byte_range("18446744073709551614-", u64::MAX),
            Some((u64::MAX - 1, u64::MAX - 1))
        );
        assert_eq!(byte_range("-999999999", 10_000_000), Some((0, CHUNK - 1)));
        for r in ["-0", "9-2", "oops-", "0-1,4-5", "99-"] {
            assert!(byte_range(r, 20).is_none());
        }
        assert!(byte_range("0-", 0).is_none());
    }
    #[test]
    fn malformed_unicode_percent_sequences_never_panic() {
        assert_eq!(decode("%é"), "%é");
        assert_eq!(decode("%2e%2e%2f"), "../");
        assert_eq!(decode("a%20b"), "a b");
    }
}
