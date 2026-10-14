//! On-demand, monitor-local screen capture and freeform in-app Google Lens search.
//! No screenshot is saved to disk or served on a public network interface.
use crate::{AppState, island, desktop};
use serde::{Serialize, Deserialize};
use std::sync::{Mutex, atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering}};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl};
const LABEL: &str = "circle-search";
const RESULTS: &str = "lens-results";
const CONTENT: &str = "lens-content";
const MAX_PIXELS: usize = 16_777_216;
const MAX_CROP: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct SearchState {
    transition: Mutex<()>,
    active: AtomicBool,
    generation: AtomicU64,
    submitting: AtomicBool,
    frame: Mutex<Option<(u64, Vec<u8>)>>,
    opened: Mutex<Option<Instant>>,
    timeout: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    lens_address: Mutex<Option<String>>,
}
impl SearchState { pub fn is_active(&self) -> bool { self.active.load(Ordering::Relaxed) } }
#[derive(Serialize)]
pub struct Ready { session: u64 }
fn from_search(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == LABEL { Ok(()) } else { Err("Only available from Circle to Search".into()) }
}
fn current(app: &AppHandle, session: u64) -> bool {
    let state = app.state::<SearchState>();
    state.active.load(Ordering::SeqCst) && state.generation.load(Ordering::SeqCst) == session
}
fn cancel_with(app: &AppHandle, expected: Option<u64>) {
    let generation = {
        let state = app.state::<SearchState>();
        let _transition = state.transition.lock().unwrap();
        if expected.is_some_and(|value| value != state.generation.load(Ordering::SeqCst)) { return; }
        let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
        state.active.store(false, Ordering::SeqCst); state.submitting.store(false, Ordering::SeqCst);
        if let Ok(mut frame) = state.frame.lock() { *frame = None; }
        if let Ok(mut timer) = state.timeout.lock() { if let Some(tx) = timer.take() { let _ = tx.send(()); } }
        if let Ok(mut opened) = state.opened.lock() { *opened = None; }
        generation
    };
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        if h.state::<SearchState>().generation.load(Ordering::SeqCst) == generation {
            if let Some(window) = h.get_webview_window(LABEL) { let _ = window.destroy(); }
        }
    });
}
pub fn cancel(app: &AppHandle) { cancel_with(app, None); }
pub fn blurred(app: &AppHandle) {
    let state = app.state::<SearchState>();
    if !state.active.load(Ordering::SeqCst) { return; }
    let Some(opened) = state.opened.lock().ok().and_then(|at| *at) else { return; };
    let session = state.generation.load(Ordering::SeqCst);
    let h = app.clone();
    let check = move || {
        if current(&h, session) && h.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_focused().unwrap_or(true)) { cancel_with(&h, Some(session)); }
    };
    if opened.elapsed() >= Duration::from_millis(300) { check(); }
    else {
        let wait = Duration::from_millis(320).saturating_sub(opened.elapsed());
        let h = app.clone();
        std::thread::spawn(move || { std::thread::sleep(wait); let _ = h.run_on_main_thread(check); });
    }
}
pub fn toggle(app: &AppHandle) {
    let state = app.state::<SearchState>();
    let transition = state.transition.lock().unwrap();
    if state.active.swap(true, Ordering::SeqCst) { let session = state.generation.load(Ordering::SeqCst); drop(transition); cancel_with(app, Some(session)); return; }
    let session = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.submitting.store(false, Ordering::SeqCst);
    *state.opened.lock().unwrap() = None;
    let (timeout_tx,timeout_rx) = std::sync::mpsc::channel();
    *state.timeout.lock().unwrap() = Some(timeout_tx);
    drop(transition);
    let h = app.clone();
    std::thread::spawn(move || {
        // Wait for the native hide before capturing, so the Island is not baked into the image.
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let hide_app = h.clone();
        if h.run_on_main_thread(move || {
            let hidden = (|| -> Result<(), String> {
                if !current(&hide_app, session) { return Err("The search session expired".into()); }
                crate::island_host::hide_for_capture(&hide_app)?;
                if let Some(old) = hide_app.get_webview_window(LABEL) { old.hide().map_err(|e| e.to_string())?; }
                Ok(())
            })();
            let _ = tx.send(hidden);
        }).is_err() { fail(&h, session, "Could not schedule screen capture".into()); return; }
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => (),
            Ok(Err(error)) => { fail(&h, session, error); return; }
            Err(_) => { fail(&h, session, "Could not prepare screen capture".into()); return; }
        }
        // Allow the compositor to present the confirmed hidden windows before reading pixels.
        std::thread::sleep(Duration::from_millis(75));
        if !current(&h, session) { return; }
        let result = capture();
        match result {
            Ok((rect, png)) => {
                {
                    let state = h.state::<SearchState>();
                    let _transition = state.transition.lock().unwrap();
                    if !current(&h, session) { return; }
                    *state.frame.lock().unwrap() = Some((session,png));
                }
                // WebView2 builders must run outside synchronous UI callbacks.
                let result = (|| -> Result<(), String> {
                    if !current(&h, session) || h.state::<AppState>().quitting.load(Ordering::Relaxed) { return Ok(()); }
                    if let Some(old) = h.get_webview_window(LABEL) { old.destroy().map_err(|e| e.to_string())?; }
                    let window = WebviewWindowBuilder::new(&h, LABEL, WebviewUrl::App("search.html".into()))
                        .title("Silk — Circle to Search").decorations(false).resizable(false)
                        .transparent(true).no_redirection_bitmap(true).background_color(tauri::window::Color(0,0,0,0))
                        .shadow(false).always_on_top(true).skip_taskbar(true).focused(false).visible(false)
                        .additional_browser_args(crate::BROWSER_ARGS).build().map_err(|e| e.to_string())?;
                    if !current(&h, session) { let _ = window.destroy(); return Ok(()); }
                    window.set_size(tauri::PhysicalSize::new(rect.w as u32, rect.h as u32)).map_err(|e| e.to_string())?;
                    window.set_position(tauri::PhysicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())?;
                    Ok(())
                })();
                if let Err(error) = result { fail(&h, session, error); }
            }
            Err(error) => fail(&h, session, error),
        }
    });
    // A failed page load or abandoned overlay must not retain a capture indefinitely.
    let h = app.clone();
    std::thread::spawn(move || { if matches!(timeout_rx.recv_timeout(Duration::from_secs(180)), Err(std::sync::mpsc::RecvTimeoutError::Timeout)) { cancel_with(&h, Some(session)); } });
}
fn fail(app: &AppHandle, session: u64, error: String) {
    if current(app, session) {
        crate::maintenance::record(app, &format!("Circle to Search: {error}"));
        let _ = app.emit("app-error", format!("Circle to Search: {error}")); cancel_with(app, Some(session));
    }
}

#[tauri::command]
pub fn circle_search_ready(app: AppHandle, window: WebviewWindow) -> Result<Ready, String> {
    from_search(&window)?;
    let session = app.state::<SearchState>().generation.load(Ordering::SeqCst);
    if !current(&app, session) { return Err("The search session expired".into()); }
    Ok(Ready { session })
}
#[tauri::command]
pub fn circle_search_frame(app: AppHandle, window: WebviewWindow, session: u64) -> Result<tauri::ipc::Response, String> {
    from_search(&window)?;
    let state = app.state::<SearchState>(); let _transition = state.transition.lock().map_err(|_| "Capture unavailable")?;
    if !current(&app, session) { return Err("The search session expired".into()); }
    let (_,png) = state.frame.lock().map_err(|_| "Capture unavailable")?.take().filter(|(generation,_)| *generation == session).ok_or("Capture already consumed or expired")?;
    Ok(tauri::ipc::Response::new(png))
}
#[tauri::command]
pub fn circle_search_show(app: AppHandle, window: WebviewWindow, session: u64) -> Result<(), String> {
    from_search(&window)?;
    let h = app.clone();
    app.run_on_main_thread(move || {
        if current(&h, session) {
            *h.state::<SearchState>().opened.lock().unwrap() = Some(Instant::now());
            if let Some(window) = h.get_webview_window(LABEL) { let _ = window.show(); let _ = window.set_focus(); }
        }
    }).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn circle_search_cancel(app: AppHandle, window: WebviewWindow, session: Option<u64>) -> Result<(), String> {
    from_search(&window)?;
    cancel_with(&app, session); Ok(())
}
#[tauri::command]
pub async fn circle_search_submit(app: AppHandle, window: WebviewWindow, session: u64, png: String) -> Result<(), String> {
    from_search(&window)?;
    let state = app.state::<SearchState>();
    {
        let _transition = state.transition.lock().map_err(|_| "Search unavailable")?;
        if !current(&app, session) { return Err("The search session expired".into()); }
        if state.submitting.swap(true, Ordering::SeqCst) { return Err("This selection is already being searched".into()); }
    }
    let h = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let bytes = decode_png(&png)?;
        if !current(&h, session) { return Err("The search session expired".into()); }
        open_handoff(&h, session, bytes)
    }).await.map_err(|e| e.to_string()).and_then(|result| result);
    if result.is_ok() { cancel_with(&app, Some(session)); }
    else {
        let _transition = state.transition.lock().map_err(|_| "Search unavailable")?;
        if current(&app, session) {
            state.submitting.store(false, Ordering::SeqCst);
            if let Ok(mut opened) = state.opened.lock() { *opened = Some(Instant::now()); }
        }
    }
    result
}

// Strict bounded base64 decode, with a PNG header/dimension check before handing bytes to the browser.
fn decode_png(encoded: &str) -> Result<Vec<u8>, String> {
    if encoded.len() > (MAX_CROP + 2) / 3 * 4 || encoded.len() % 4 != 0 || encoded.is_empty() { return Err("Invalid or oversized selection".into()); }
    let mut out = Vec::with_capacity(encoded.len() / 4 * 3);
    let bytes = encoded.as_bytes();
    let digit = |b: u8| -> Result<u32,String> { Ok(match b { b'A'..=b'Z' => (b-b'A') as u32, b'a'..=b'z' => (b-b'a'+26) as u32, b'0'..=b'9' => (b-b'0'+52) as u32, b'+' => 62, b'/' => 63, _ => return Err("Invalid selection encoding".into()) }) };
    for (i, b) in bytes.chunks_exact(4).enumerate() {
        let final_block = (i+1)*4 == bytes.len();
        let pad = usize::from(b[3] == b'=') + usize::from(b[2] == b'=');
        if pad > 0 && (!final_block || b[3] != b'=' || (b[2] == b'=' && b[3] != b'=')) { return Err("Invalid selection padding".into()); }
        let a = digit(b[0])?; let c = digit(b[1])?;
        let d = if b[2] == b'=' { 0 } else { digit(b[2])? };
        let e = if b[3] == b'=' { 0 } else { digit(b[3])? };
        if (pad == 2 && c & 15 != 0) || (pad == 1 && d & 3 != 0) { return Err("Invalid selection padding bits".into()); }
        let value = (a<<18)|(c<<12)|(d<<6)|e;
        out.push((value>>16) as u8); if pad < 2 { out.push((value>>8) as u8); } if pad == 0 { out.push(value as u8); }
    }
    if out.len() > MAX_CROP || out.len() < 33 || &out[..8] != b"\x89PNG\r\n\x1a\n" || &out[12..16] != b"IHDR" { return Err("The selection must be a PNG image".into()); }
    let w = u32::from_be_bytes(out[16..20].try_into().unwrap()) as usize; let h = u32::from_be_bytes(out[20..24].try_into().unwrap()) as usize;
    if w == 0 || h == 0 || w.checked_mul(h).map_or(true, |n| n > MAX_PIXELS) { return Err("The selection dimensions exceed the limit".into()); }
    Ok(out)
}

#[cfg(windows)]
fn capture() -> Result<(island::Rect, Vec<u8>), String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    use windows::Win32::Graphics::Gdi::*;
    unsafe {
        let mut cursor = POINT::default(); GetCursorPos(&mut cursor).map_err(|e| e.to_string())?;
        let (vx, vy, _, _) = desktop::virtual_rect();
        let monitor = desktop::monitors().into_iter().find(|m| island::Rect::new(m.x+vx,m.y+vy,m.w,m.h).contains(cursor.x,cursor.y)).ok_or("No display under the cursor")?;
        let rect = island::Rect::new(monitor.x+vx,monitor.y+vy,monitor.w,monitor.h);
        if rect.w <= 0 || rect.h <= 0 || (rect.w as usize).checked_mul(rect.h as usize).map_or(true, |n| n > MAX_PIXELS) { return Err("This display exceeds the screen-capture limit".into()); }
        let screen = GetDC(None); if screen.is_invalid() { return Err("Could not access the desktop".into()); }
        let memory = CreateCompatibleDC(Some(screen));
        if memory.is_invalid() { ReleaseDC(None,screen); return Err("Could not create screen capture".into()); }
        let bitmap = CreateCompatibleBitmap(screen,rect.w,rect.h);
        if bitmap.is_invalid() { let _ = DeleteDC(memory); ReleaseDC(None,screen); return Err("Could not allocate screen capture".into()); }
        let old = SelectObject(memory,HGDIOBJ(bitmap.0));
        let result = (|| {
            BitBlt(memory,0,0,rect.w,rect.h,Some(screen),rect.x,rect.y,SRCCOPY | CAPTUREBLT).map_err(|e| e.to_string())?;
            SelectObject(memory,old);
            let mut info = BITMAPINFO { bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: rect.w, biHeight: -rect.h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() }, ..Default::default() };
            let mut rgba = vec![0u8; rect.w as usize * rect.h as usize * 4];
            if GetDIBits(screen,bitmap,0,rect.h as u32,Some(rgba.as_mut_ptr() as *mut _),&mut info,DIB_RGB_COLORS) != rect.h { return Err("Could not read the screen pixels".into()); }
            for p in rgba.chunks_exact_mut(4) { p.swap(0,2); p[3]=255; }
            let mut png = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut png,rect.w as u32,rect.h as u32);
                encoder.set_compression(png::Compression::Fast);
                encoder.set_color(png::ColorType::Rgba); encoder.set_depth(png::BitDepth::Eight);
                let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
                writer.write_image_data(&rgba).map_err(|e| e.to_string())?;
                writer.finish().map_err(|e| e.to_string())?;
            }
            Ok((rect,png))
        })();
        SelectObject(memory,old); let _ = DeleteObject(HGDIOBJ(bitmap.0)); let _ = DeleteDC(memory); ReleaseDC(None,screen); result
    }
}
#[cfg(not(windows))]
fn capture() -> Result<(island::Rect, Vec<u8>),String> { Err("Screen search is currently available on Windows".into()) }

static HANDOFFS: AtomicUsize = AtomicUsize::new(0);
struct HandoffGuard;
impl Drop for HandoffGuard { fn drop(&mut self) { HANDOFFS.fetch_sub(1,Ordering::SeqCst); } }
#[cfg(windows)]
fn open_handoff(app: &AppHandle, session: u64, png: Vec<u8>) -> Result<(), String> {
    use std::io::{Read,Write};
    use std::net::TcpListener;
    use windows::Win32::System::Com::CoCreateGuid;
    if HANDOFFS.fetch_add(1,Ordering::SeqCst) >= 2 { HANDOFFS.fetch_sub(1,Ordering::SeqCst); return Err("A search is still opening. Try again shortly.".into()); }
    let guard = HandoffGuard;
    let token = format!("{:032x}",unsafe { CoCreateGuid() }.map_err(|e| e.to_string())?.to_u128());
    let server = TcpListener::bind(("127.0.0.1",0)).map_err(|e| e.to_string())?;
    let port = server.local_addr().map_err(|e| e.to_string())?.port();
    server.set_nonblocking(true).map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{port}/{token}/");
    *app.state::<SearchState>().lens_address.lock().map_err(|_| "Search unavailable")? = Some(url.clone());
    // Move only the selected image through a one-use loopback form. The remote webview
    // has no capabilities, and can never navigate to an app origin to acquire them.
    std::thread::spawn(move || {
        let _guard = guard; let started = Instant::now(); let mut image = Some(png); let mut image_served = None;
        while started.elapsed() < Duration::from_secs(90) && !image_served.is_some_and(|at: Instant| at.elapsed() > Duration::from_secs(3)) {
            match server.accept() {
                Ok((mut stream,_)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2))); let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                    let mut request=Vec::new(); let mut buf=[0u8;1024];
                    while request.len()<8192 { match stream.read(&mut buf) { Ok(0)|Err(_) => break, Ok(n) => { request.extend_from_slice(&buf[..n]); if request.windows(4).any(|w|w==b"\r\n\r\n") { break; } } } }
                    let text=String::from_utf8_lossy(&request); let first=text.lines().next().unwrap_or("");
                    let host_ok=text.lines().any(|line| line.split_once(':').is_some_and(|(name,value)| name.eq_ignore_ascii_case("host") && value.trim()==format!("127.0.0.1:{port}")));
                    let page = format!("GET /{token}/ HTTP/1.1"); let resource=format!("GET /{token}/image.png HTTP/1.1");
                    let (status,kind,body) = if !host_ok { ("403 Forbidden","text/plain", b"Forbidden".as_slice()) }
                        else if first==page { ("200 OK","text/html; charset=utf-8",include_bytes!("../../src/search/handoff.html").as_slice()) }
                        else if first==resource && image.is_some() { ("200 OK","image/png",image.as_ref().unwrap().as_slice()) }
                        else { ("410 Gone","text/plain",b"This selection has expired".as_slice()) };
                    let header=format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; script-src 'nonce-silk'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; form-action https://lens.google.com https://www.google.com; base-uri 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n",body.len());
                    let sent=stream.write_all(header.as_bytes()).and_then(|_|stream.write_all(body)).is_ok();
                    if sent && first==resource && host_ok { image=None; image_served=Some(Instant::now()); }
                }
                Err(error) if error.kind()==std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
    });
    if !current(app, session) { return Err("The search session expired".into()); }
    // Creating either webview on this blocking worker avoids WebView2 callback deadlocks.
    // Suppress capture blur-cancellation while moving focus to the results window.
    if let Ok(mut opened) = app.state::<SearchState>().opened.lock() { *opened = None; }
    // Reuse an existing results pane; never race destruction against a builder with the same label.
    if let (Some(window), Some(view)) = (app.get_window(RESULTS), app.get_webview(CONTENT)) {
        if !current(app, session) { return Err("The search session expired".into()); }
        view.navigate(url.parse().map_err(|e| format!("Invalid search address: {e}"))?).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let monitor = app.get_webview_window(LABEL).and_then(|w| w.current_monitor().ok().flatten());
    let (width, height) = monitor.as_ref().map(|m| {
        let scale = m.scale_factor();
        ((m.size().width as f64 / scale - 80.0).clamp(480.0, 1040.0),
         (m.size().height as f64 / scale - 100.0).clamp(360.0, 760.0))
    }).unwrap_or((1040.0, 760.0));
    let window = WebviewWindowBuilder::new(app, RESULTS, WebviewUrl::App("lens.html".into()))
        .title("Silk — Google Lens").inner_size(width, height).center().resizable(false)
        .decorations(false).transparent(true).shadow(false).no_redirection_bitmap(true)
        .background_color(tauri::window::Color(0,0,0,0)).theme(Some(tauri::Theme::Dark)).zoom_hotkeys_enabled(false)
        .focused(false).visible(false).additional_browser_args(crate::BROWSER_ARGS).build().map_err(|e| e.to_string())?;
    let build = (|| -> Result<(), String> {
        if let Some(monitor) = &monitor {
            let size = window.outer_size().map_err(|e| e.to_string())?;
            window.set_position(tauri::PhysicalPosition::new(
                monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2,
                monitor.position().y + (monitor.size().height as i32 - size.height as i32) / 2,
            )).map_err(|e| e.to_string())?;
        }
        if !current(app, session) { return Err("The search session expired".into()); }
        let host = app.get_window(RESULTS).ok_or("Results window unavailable")?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let w = size.width as f64 / scale; let h = size.height as f64 / scale;
        let navigation = app.clone(); let handle = app.clone();
        let child = tauri::webview::WebviewBuilder::new(CONTENT, WebviewUrl::External(url.parse().map_err(|e| format!("Invalid search address: {e}"))?))
            .additional_browser_args(crate::BROWSER_ARGS).background_color(tauri::window::Color(18,20,26,255))
            .on_navigation(move |target| {
                let host = target.host_str().unwrap_or("");
                let public_https = target.scheme() == "https" && host != "localhost" && !host.ends_with(".localhost") && host != "127.0.0.1" && host != "[::1]";
                public_https || navigation.state::<SearchState>().lens_address.lock().map(|address| address.as_deref() == Some(target.as_str())).unwrap_or(false)
            })
            .on_new_window(move |target, _| {
                // Links requesting a new tab stay inside the same isolated results pane.
                if target.scheme() == "https" {
                    let handle = handle.clone();
                    std::thread::spawn(move || { if let Some(view) = handle.get_webview(CONTENT) { let _ = view.navigate(target); } });
                }
                tauri::webview::NewWindowResponse::Deny
            });
        let content = host.add_child(child, tauri::LogicalPosition::new(20.0,76.0), tauri::LogicalSize::new(w-40.0,h-96.0)).map_err(|e| e.to_string())?;
        content.set_zoom(((w-40.0)/1120.0).clamp(0.65, 1.0)).map_err(|e| e.to_string())?;
        if !current(app, session) { return Err("The search session expired".into()); }
        // lens_ready reveals only after the trusted frame has completed layout.
        Ok(())
    })();
    if build.is_err() { let _ = window.destroy(); }
    build
}
#[cfg(not(windows))]
fn open_handoff(_: &AppHandle, _: u64, _: Vec<u8>) -> Result<(), String> { Err("Only available on Windows".into()) }


#[derive(Deserialize)]
pub struct LensBounds { x: f64, y: f64, width: f64, height: f64 }
fn place_lens(app: &AppHandle, window: &tauri::Window, bounds: LensBounds) -> Result<(), String> {
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let w = size.width as f64 / scale; let h = size.height as f64 / scale;
    if ![bounds.x,bounds.y,bounds.width,bounds.height].iter().all(|v| v.is_finite())
        || bounds.x < 8.0 || bounds.y < 60.0 || bounds.width < 100.0 || bounds.height < 100.0
        || bounds.x + bounds.width > w - 6.0 || bounds.y + bounds.height > h - 6.0 {
        return Err("Invalid results viewport".into());
    }
    let content = app.get_webview(CONTENT).ok_or("Results are still opening")?;
    content.set_bounds(tauri::Rect { position: tauri::LogicalPosition::new(bounds.x,bounds.y).into(), size: tauri::LogicalSize::new(bounds.width,bounds.height).into() }).map_err(|e| e.to_string())?;
    content.set_zoom((bounds.width/1120.0).clamp(0.65,1.0)).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn lens_layout(app: AppHandle, webview: tauri::Webview, bounds: LensBounds) -> Result<(), String> {
    if webview.label() != RESULTS { return Err("Only available from the Silk results frame".into()); }
    place_lens(&app, &webview.window(), bounds)
}

#[tauri::command]
pub async fn lens_ready(app: AppHandle, webview: tauri::Webview, bounds: Option<LensBounds>) -> Result<(), String> {
    if webview.label() != RESULTS { return Err("Only available from the Silk results frame".into()); }
    let window = webview.window();
    tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        while app.get_webview(CONTENT).is_none() {
            if start.elapsed() > Duration::from_secs(2) || app.state::<AppState>().quitting.load(Ordering::Relaxed) { return Err("Results could not finish opening".into()); }
            std::thread::sleep(Duration::from_millis(16));
        }
        if app.state::<AppState>().quitting.load(Ordering::Relaxed) { return Err("Silk is closing".into()); }
        if let Some(bounds) = bounds { place_lens(&app, &window, bounds)?; }
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lens_control(app: AppHandle, webview: tauri::Webview, action: String) -> Result<(), String> {
    if webview.label() != RESULTS { return Err("Only available from the Silk results frame".into()); }
    let window = webview.window();
    match action.as_str() {
        "close" => window.destroy().map_err(|e| e.to_string()),
        "drag" => window.start_dragging().map_err(|e| e.to_string()),
        "back" | "forward" | "reload" => {
            let view = app.get_webview(CONTENT).ok_or("Results are still opening")?;
            if action == "reload" { return view.reload().map_err(|e| e.to_string()); }
            let script = if action == "back" { "history.back()" } else { "history.forward()" };
            view.eval(script).map_err(|e| e.to_string())
        }
        _ => Err("Unknown results action".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn encoded_png_validation_is_bounded() {
        let png=crate::usage::png_rgba(1,1,&[1,2,3,255]);
        assert_eq!(decode_png(&crate::media::base64(&png)).unwrap(),png);
        for bad in ["", "AAAA", "AA=A", "!!!!", "aGVsbG8="] { assert!(decode_png(bad).is_err()); }
        assert!(decode_png(&"A".repeat((MAX_CROP+2)/3*4+4)).is_err());
    }
}
