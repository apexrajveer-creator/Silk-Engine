//! The island's Apps tab: the apps you use most.
//!
//! Opt-in. While it is on, the app being used (the foreground window) earns a few seconds every sample; time when you are
//! away from the keyboard does not count. Only the program's file path and a number of seconds are kept, in a small file on
//! this PC. Never window titles, never what you typed, never anything uploaded. Clearing wipes it.
//! Ranking, naming, pruning and the "is it safe to launch" rule are pure and tested; the Windows calls are at the bottom.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const MAX_APPS: usize = 300;
const FILE: &str = "app-usage.json";
const MAX_FILE_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct AppStat {
    pub path: String,
    pub seconds: u64,
    /// Unix seconds of the last time it was in front.
    pub last: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Usage {
    /// Keyed by the lower-cased path, so C:\Foo\App.exe and c:\foo\app.exe are one app.
    pub apps: BTreeMap<String, AppStat>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ranked {
    pub key: String,
    pub name: String,
    pub seconds: u64,
    /// This app's share of the time spent in all tracked apps, 0..100.
    pub share: f32,
}

fn file_stem(path: &str) -> &str {
    let name = path.rsplit(['\\', '/']).next().unwrap_or(path);
    match name.rfind('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    }
}

/// Programs that are the shell or this app itself, not something the user "uses".
pub fn ignored(path: &str) -> bool {
    matches!(
        file_stem(path).to_ascii_lowercase().as_str(),
        "silk-engine" | "silk_engine" | "applicationframehost" | "shellexperiencehost" | "searchhost" | "startmenuexperiencehost" | "lockapp" | "textinputhost"
            | "dwm" | "csrss" | "winlogon" | "logonui" | "taskhostw" | "sihost" | "systemsettingsbroker" | "shellhost" | "searchapp" | "searchui" | "widgets"
            | "msedgewebview2" | "crashpad_handler" | "werfault" | "consent" | "runtimebroker" | "backgroundtaskhost"
    )
}

/// Window classes that mean "the desktop or the taskbar", not an application window.
pub fn ignored_window_class(class: &str) -> bool {
    matches!(
        class,
        "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "NotifyIconOverflowWindow" | "TopLevelWindowForOverflowXamlIsland" | "XamlExplorerHostIslandWindow"
            | "Windows.UI.Core.CoreWindow" | "ForegroundStaging"
    )
}

/// Only plain .exe files are ever started from the list: no scripts, no shortcuts, no relative paths.
pub fn launchable(path: &str) -> bool {
    let p = path.replace('/', "\\");
    p.len() > 6
        && p.to_ascii_lowercase().ends_with(".exe")
        && !p.contains("..")
        && !p.contains('\0')
        && (p.as_bytes().get(1) == Some(&b':') || p.starts_with("\\\\"))
}

/// "SnippingTool" -> "Snipping Tool". A capital after a lower-case letter starts a new word (but never after a single leading
/// letter, so "iTunes" and "eMule" are left alone).
fn split_camel(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len() + 4);
    for (i, &c) in chars.iter().enumerate() {
        if i >= 2 && c.is_uppercase() && chars[i - 1].is_lowercase() {
            out.push(' ');
        }
        out.push(c);
    }
    out
}

/// A readable name for a program: a few well-known ones spelled properly, otherwise the file name in Title Case.
pub fn display_name(path: &str) -> String {
    let stem = file_stem(path);
    let known = match stem.to_ascii_lowercase().as_str() {
        "msedge" => "Microsoft Edge",
        "chrome" => "Google Chrome",
        "firefox" => "Firefox",
        "code" => "Visual Studio Code",
        "devenv" => "Visual Studio",
        "winword" => "Word",
        "excel" => "Excel",
        "powerpnt" => "PowerPoint",
        "outlook" => "Outlook",
        "onenote" => "OneNote",
        "explorer" => "File Explorer",
        "cmd" => "Command Prompt",
        "powershell" | "pwsh" => "PowerShell",
        "windowsterminal" | "wt" => "Windows Terminal",
        "notepad" => "Notepad",
        "mspaint" => "Paint",
        "photoshop" => "Photoshop",
        "vlc" => "VLC",
        "spotify" => "Spotify",
        "discord" => "Discord",
        "steam" => "Steam",
        "taskmgr" => "Task Manager",
        "snippingtool" => "Snipping Tool",
        "calculatorapp" | "calc" => "Calculator",
        "wmplayer" => "Windows Media Player",
        "obs64" | "obs32" | "obs" => "OBS Studio",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_string();
    }
    // a few programs ship under long, awkward file names
    let lower = stem.to_ascii_lowercase();
    for (needle, label) in [("stremio", "Stremio"), ("steamwebhelper", "Steam"), ("epicgameslauncher", "Epic Games"), ("battle.net", "Battle.net")] {
        if lower.contains(needle) {
            return label.to_string();
        }
    }
    let words: Vec<String> = split_camel(stem)
        .replace(['_', '-', '.'], " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) if w.chars().all(|x| !x.is_uppercase()) => f.to_uppercase().collect::<String>() + c.as_str(),
                _ => w.to_string(),
            }
        })
        .collect();
    if words.is_empty() { "Unknown app".into() } else { words.join(" ") }
}

impl Usage {
    /// Give `path` another `secs` seconds of use at time `now`.
    pub fn add(&mut self, path: &str, secs: u64, now: u64) {
        if path.is_empty() || secs == 0 || ignored(path) || !launchable(path) {
            return;
        }
        let key = path.to_ascii_lowercase();
        let e = self.apps.entry(key.clone()).or_default();
        e.path = path.to_string();
        e.seconds = e.seconds.saturating_add(secs);
        e.last = now;
        if self.apps.len() > MAX_APPS {
            // forget the least used (never the one that was just used)
            let mut by_use: Vec<(&String, u64)> = self.apps.iter().filter(|(k, _)| **k != key).map(|(k, v)| (k, v.seconds)).collect();
            by_use.sort_by_key(|(_, s)| *s);
            let drop: Vec<String> = by_use.iter().take(self.apps.len() - MAX_APPS).map(|(k, _)| (*k).clone()).collect();
            for k in drop {
                self.apps.remove(&k);
            }
        }
    }

    pub fn top(&self, n: usize) -> Vec<Ranked> {
        let total: u64 = self.apps.values().map(|a| a.seconds).sum();
        let mut all: Vec<(&String, &AppStat)> = self.apps.iter().collect();
        all.sort_by(|a, b| b.1.seconds.cmp(&a.1.seconds).then(b.1.last.cmp(&a.1.last)).then(a.0.cmp(b.0)));
        all.into_iter()
            .take(n)
            .map(|(k, a)| Ranked { key: k.clone(), name: display_name(&a.path), seconds: a.seconds, share: if total == 0 { 0.0 } else { (a.seconds as f64 / total as f64 * 100.0) as f32 } })
            .collect()
    }

    pub fn path_of(&self, key: &str) -> Option<&str> {
        self.apps.get(key).map(|a| a.path.as_str())
    }

    pub fn clear(&mut self) {
        self.apps.clear();
    }
}

pub fn load(dir: &Path) -> Usage {
    let path = dir.join(FILE);
    match std::fs::metadata(&path) {
        Ok(m) if m.len() <= MAX_FILE_BYTES => std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Usage>(&b).ok()).unwrap_or_default(),
        _ => Usage::default(),
    }
}

pub fn save(dir: &Path, usage: &Usage) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("app-usage.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(usage).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(FILE)).map_err(|e| e.to_string())
}

pub fn delete_file(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(FILE));
}

// ---------------------------------------------------------------------------------------------- Windows

// ---------------------------------------------------------------------------------------------- icons

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xffff_ffffu32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = (c >> 1) ^ (0xedb8_8320 & (0u32.wrapping_sub(c & 1)));
        }
    }
    !c
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &x in data {
        a = (a + x as u32) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut body = kind.to_vec();
    body.extend_from_slice(data);
    out.extend_from_slice(&body);
    out.extend_from_slice(&crc32(&body).to_be_bytes());
}

/// An RGBA image as a PNG (stored, uncompressed blocks: icons are small, and this needs no compression library).
pub fn png_rgba(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    assert_eq!(rgba.len(), (width as usize) * (height as usize) * 4, "the pixel data must match the size");
    let mut raw = Vec::with_capacity(rgba.len() + height as usize);
    if width > 0 {   // (chunks(0) would panic, and a panic ends the whole app)
        for row in rgba.chunks((width as usize) * 4) {
            raw.push(0); // filter: none
            raw.extend_from_slice(row);
        }
    }
    let mut z = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = if raw.is_empty() { vec![&[][..]] } else { raw.chunks(65_535).collect() };
    for (i, b) in blocks.iter().enumerate() {
        z.push(u8::from(i == blocks.len() - 1));
        z.extend_from_slice(&(b.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(b.len() as u16)).to_le_bytes());
        z.extend_from_slice(b);
    }
    z.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]); // 8 bits, RGBA
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &z);
    chunk(&mut out, b"IEND", &[]);
    out
}

/// Windows hands back pixels as blue, green, red, alpha: swap to red, green, blue, alpha in place.
pub fn bgra_to_rgba(px: &mut [u8]) {
    for p in px.chunks_mut(4) {
        if p.len() == 4 {
            p.swap(0, 2);
        }
    }
}

/// Icons from before alpha existed carry a separate 1-bit mask instead (0 = visible). If the colour pixels have no alpha at all,
/// build it from the mask. `mask` is one value per pixel, in the same order.
pub fn alpha_from_mask(px: &mut [u8], mask: &[u8]) {
    if px.chunks(4).any(|p| p.len() == 4 && p[3] != 0) {
        return; // it has real alpha
    }
    for (p, m) in px.chunks_mut(4).zip(mask) {
        if p.len() == 4 {
            p[3] = if *m == 0 { 255 } else { 0 };
        }
    }
}

/// The program's own icon as a PNG (up to 64 px), if Windows can find one.
#[cfg(windows)]
pub fn icon_png(path: &str) -> Option<Vec<u8>> {
    use windows::Win32::Graphics::Gdi::{DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, PrivateExtractIconsW, HICON, ICONINFO};
    let units: Vec<u16> = path.encode_utf16().collect();
    if units.is_empty() || units.len() >= 260 {
        return None;
    }
    let mut file = [0u16; 260];
    file[..units.len()].copy_from_slice(&units);
    unsafe {
        let mut icons = [HICON::default()];
        let found = PrivateExtractIconsW(&file, 0, 64, 64, Some(&mut icons), None, 0);
        if found == 0 || found == u32::MAX || icons[0].is_invalid() {
            return None;
        }
        let icon = icons[0];
        let mut info = ICONINFO::default();
        let result = (|| {
            GetIconInfo(icon, &mut info).ok()?;
            let mut bmp = BITMAP::default();
            if GetObjectW(HGDIOBJ(info.hbmColor.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bmp as *mut _ as *mut _)) == 0 {
                return None;
            }
            let (w, h) = (bmp.bmWidth, bmp.bmHeight);
            if w <= 0 || h <= 0 || w > 256 || h > 256 {
                return None;
            }
            let dc = GetDC(None);
            let read = |bitmap: HBITMAP| -> Option<Vec<u8>> {
                let mut bi = BITMAPINFO { bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() }, ..Default::default() };
                let mut buf = vec![0u8; (w * h * 4) as usize];
                let rows = GetDIBits(dc, bitmap, 0, h as u32, Some(buf.as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS);
                (rows != 0).then_some(buf)
            };
            let colour = read(info.hbmColor);
            let mask = if info.hbmMask.is_invalid() { None } else { read(info.hbmMask) };
            ReleaseDC(None, dc);
            let mut px = colour?;
            if let Some(m) = mask {
                let per_pixel: Vec<u8> = m.chunks(4).filter(|p| p.len() == 4).map(|p| p[0]).collect();
                alpha_from_mask(&mut px, &per_pixel);
            }
            bgra_to_rgba(&mut px);
            Some(png_rgba(w as u32, h as u32, &px))
        })();
        if !info.hbmColor.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
        }
        if !info.hbmMask.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
        }
        let _ = DestroyIcon(icon);
        result
    }
}

#[cfg(not(windows))]
pub fn icon_png(_path: &str) -> Option<Vec<u8>> {
    None
}

/// The program in front right now, unless it is the desktop or the taskbar.
#[cfg(windows)]
pub fn foreground_app() -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut class = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut class);
        if n > 0 && ignored_window_class(&String::from_utf16_lossy(&class[..n as usize])) {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Seconds since the last key press or mouse movement.
#[cfg(windows)]
pub fn idle_secs() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    if unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        (unsafe { GetTickCount() }.wrapping_sub(info.dwTime) / 1000) as u64
    } else {
        0
    }
}

#[cfg(not(windows))]
pub fn foreground_app() -> Option<String> {
    None
}
#[cfg(not(windows))]
pub fn idle_secs() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHROME: &str = r"C:\Program Files\Google\Chrome\Application\chrome.exe";
    const CODE: &str = r"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe";
    const NOTE: &str = r"C:\Windows\System32\notepad.exe";

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("silk-usage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn time_adds_up_per_app_and_ignores_the_case_of_the_path() {
        let mut u = Usage::default();
        u.add(CHROME, 2, 10);
        u.add(&CHROME.to_uppercase(), 3, 20);
        assert_eq!(u.apps.len(), 1);
        assert_eq!(u.apps.values().next().unwrap().seconds, 5);
        assert_eq!(u.apps.values().next().unwrap().last, 20);
    }
    #[test]
    fn the_most_used_app_ranks_first_with_its_share() {
        let mut u = Usage::default();
        u.add(CHROME, 600, 1);
        u.add(CODE, 300, 2);
        u.add(NOTE, 100, 3);
        let top = u.top(10);
        assert_eq!(top.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["Google Chrome", "Visual Studio Code", "Notepad"]);
        assert_eq!(top[0].seconds, 600);
        assert!((top[0].share - 60.0).abs() < 0.01 && (top[1].share - 30.0).abs() < 0.01);
        assert!((top.iter().map(|r| r.share).sum::<f32>() - 100.0).abs() < 0.1);
    }
    #[test]
    fn ties_are_broken_by_who_was_used_most_recently_then_by_name() {
        let mut u = Usage::default();
        u.add(CHROME, 50, 5);
        u.add(CODE, 50, 9);
        assert_eq!(u.top(2)[0].name, "Visual Studio Code", "same time, used more recently");
        let mut v = Usage::default();
        v.add(r"C:\a\bbb.exe", 10, 1);
        v.add(r"C:\a\aaa.exe", 10, 1);
        assert_eq!(v.top(2)[0].name, "Aaa", "same time and moment: alphabetical, so the order never flickers");
    }
    #[test]
    fn top_never_returns_more_than_asked_and_handles_nothing() {
        let mut u = Usage::default();
        assert!(u.top(8).is_empty());
        for i in 0..20 {
            u.add(&format!(r"C:\apps\app{i}.exe"), 10 + i, i);
        }
        assert_eq!(u.top(8).len(), 8);
        assert_eq!(u.top(0).len(), 0);
        assert_eq!(u.top(1000).len(), 20);
    }
    #[test]
    fn the_shell_and_this_app_are_never_counted() {
        let mut u = Usage::default();
        for p in [r"C:\Program Files\Silk Engine\silk-engine.exe", r"C:\Windows\System32\ApplicationFrameHost.exe", r"C:\Windows\SystemApps\ShellExperienceHost.exe", r"C:\Windows\System32\dwm.exe", r"C:\x\LockApp.exe"] {
            u.add(p, 100, 1);
        }
        assert!(u.apps.is_empty());
    }
    #[test]
    fn nothing_is_recorded_for_empty_zero_or_unlaunchable_input() {
        let mut u = Usage::default();
        u.add("", 5, 1);
        u.add(CHROME, 0, 1);
        u.add("notepad", 5, 1);
        u.add(r"C:\scripts\run.bat", 5, 1);
        u.add(r"..\evil.exe", 5, 1);
        assert!(u.apps.is_empty());
    }
    #[test]
    fn the_list_is_capped_and_the_least_used_are_forgotten_first() {
        let mut u = Usage::default();
        for i in 0..(MAX_APPS as u64 + 50) {
            u.add(&format!(r"C:\apps\app{i}.exe"), i + 1, i);
        }
        assert_eq!(u.apps.len(), MAX_APPS);
        assert!(u.apps.contains_key(&format!(r"c:\apps\app{}.exe", MAX_APPS as u64 + 49)), "the newest stays");
        assert!(!u.apps.contains_key(r"c:\apps\app0.exe"), "the least used went");
        assert_eq!(u.top(1)[0].seconds, MAX_APPS as u64 + 50);
    }
    #[test]
    fn a_brand_new_app_survives_pruning_even_with_the_least_time() {
        let mut u = Usage::default();
        for i in 0..MAX_APPS as u64 {
            u.add(&format!(r"C:\apps\old{i}.exe"), 1_000 + i, i);
        }
        u.add(r"C:\apps\fresh.exe", 1, 9_999);
        assert!(u.apps.contains_key(r"c:\apps\fresh.exe"));
        assert_eq!(u.apps.len(), MAX_APPS);
    }
    #[test]
    fn clearing_forgets_everything() {
        let mut u = Usage::default();
        u.add(CHROME, 10, 1);
        u.clear();
        assert!(u.apps.is_empty() && u.top(5).is_empty());
    }
    #[test]
    fn desktop_and_taskbar_windows_are_not_apps() {
        for c in ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow"] {
            assert!(ignored_window_class(c), "{c}");
        }
        for c in ["Chrome_WidgetWin_1", "Notepad", "CabinetWClass", ""] {
            assert!(!ignored_window_class(c), "{c}");
        }
    }
    #[test]
    fn only_plain_exe_files_with_absolute_paths_can_be_launched() {
        assert!(launchable(CHROME) && launchable(r"D:\games\game.EXE") && launchable(r"\\server\share\tool.exe") && launchable("C:/Tools/x.exe"));
        for bad in ["", "chrome.exe", r"C:\x\run.bat", r"C:\x\run.cmd", r"C:\x\link.lnk", r"C:\x\..\evil.exe", r"C:\x\a.exe.txt", "C:\\x\\a\0.exe", "cmd /c calc.exe", r".\x.exe", r"x.exe"] {
            assert!(!launchable(bad), "{bad:?}");
        }
    }
    #[test]
    fn windows_own_helper_programs_are_not_apps_you_use() {
        for p in [r"C:\Windows\System32\ShellHost.exe", r"C:\Windows\SystemApps\SearchApp.exe", r"C:\Windows\System32\RuntimeBroker.exe", r"C:\Program Files\Edge\msedgewebview2.exe"] {
            assert!(ignored(p), "{p}");
        }
        for p in [CHROME, NOTE, r"C:\Windows\System32\SnippingTool.exe"] {
            assert!(!ignored(p), "{p}");
        }
    }
    #[test]
    fn camel_case_words_are_split_only_where_it_makes_sense() {
        assert_eq!(split_camel("SnippingTool"), "Snipping Tool");
        assert_eq!(split_camel("iTunes"), "iTunes");
        assert_eq!(split_camel("VLC"), "VLC");
        assert_eq!(split_camel("lower"), "lower");
        assert_eq!(split_camel(""), "");
        assert_eq!(split_camel("日本語アプリ"), "日本語アプリ");
    }
    #[test]
    fn names_are_readable() {
        assert_eq!(display_name(CHROME), "Google Chrome");
        assert_eq!(display_name(r"C:\Windows\explorer.exe"), "File Explorer");
        assert_eq!(display_name(r"C:\a\my_app-pro.exe"), "My App Pro");
        assert_eq!(display_name(r"C:\a\MyApp.EXE"), "My App", "words run together in CamelCase are separated");
        assert_eq!(display_name(r"C:\a\iTunesHelper.exe"), "iTunes Helper", "a single leading lower-case letter is not a word");
        assert_eq!(display_name(r"C:\Windows\System32\SnippingTool.exe"), "Snipping Tool");
        assert_eq!(display_name(r"C:\Program Files\Stremio\stremio-shell-ng.exe"), "Stremio");
        assert_eq!(display_name(r"C:\a\app.v2.exe"), "App V2");
        assert_eq!(display_name(r"C:\a\日本語.exe"), "日本語");
        assert_eq!(display_name(""), "Unknown app");
        assert_eq!(display_name(r"C:\a\.exe"), "Exe");
    }
    // ---- icons: the PNG encoder
    /// Pull the chunks out of a PNG and check everything a decoder would: signature, order, lengths and checksums.
    fn chunks(png: &[u8]) -> Vec<(String, Vec<u8>)> {
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
        let (mut at, mut out) = (8, Vec::new());
        while at < png.len() {
            let len = u32::from_be_bytes(png[at..at + 4].try_into().unwrap()) as usize;
            let kind = &png[at + 4..at + 8];
            let data = &png[at + 8..at + 8 + len];
            let crc = u32::from_be_bytes(png[at + 8 + len..at + 12 + len].try_into().unwrap());
            assert_eq!(crc, crc32(&png[at + 4..at + 8 + len]), "checksum of {}", String::from_utf8_lossy(kind));
            out.push((String::from_utf8_lossy(kind).into_owned(), data.to_vec()));
            at += 12 + len;
        }
        out
    }
    /// Undo the stored-block zlib stream and the row filters: the pixels that went in.
    fn decode(png: &[u8]) -> (u32, u32, Vec<u8>) {
        let cs = chunks(png);
        assert_eq!(cs.iter().map(|c| c.0.as_str()).collect::<Vec<_>>(), ["IHDR", "IDAT", "IEND"]);
        let ihdr = &cs[0].1;
        let (w, h) = (u32::from_be_bytes(ihdr[0..4].try_into().unwrap()), u32::from_be_bytes(ihdr[4..8].try_into().unwrap()));
        assert_eq!(&ihdr[8..], &[8, 6, 0, 0, 0]);
        let z = &cs[1].1;
        assert_eq!(&z[..2], &[0x78, 0x01]);
        let (mut at, mut raw) = (2, Vec::new());
        loop {
            let last = z[at] == 1;
            let len = u16::from_le_bytes([z[at + 1], z[at + 2]]) as usize;
            assert_eq!(u16::from_le_bytes([z[at + 3], z[at + 4]]), !(len as u16), "block length check");
            raw.extend_from_slice(&z[at + 5..at + 5 + len]);
            at += 5 + len;
            if last { break; }
        }
        assert_eq!(u32::from_be_bytes(z[at..at + 4].try_into().unwrap()), adler32(&raw), "zlib checksum");
        let mut px = Vec::new();
        for row in raw.chunks((w * 4 + 1) as usize) {
            assert_eq!(row[0], 0, "filter byte");
            px.extend_from_slice(&row[1..]);
        }
        (w, h, px)
    }
    #[test]
    fn the_checksums_match_their_published_values() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
        assert_eq!(crc32(b""), 0);
        assert_eq!(adler32(b"Wikipedia"), 0x11e6_0398);
        assert_eq!(adler32(b""), 1);
    }
    #[test]
    fn a_png_decodes_back_to_exactly_the_pixels_that_went_in() {
        let px: Vec<u8> = (0..4 * 3 * 4).map(|i| (i * 17 + 3) as u8).collect();
        assert_eq!(decode(&png_rgba(4, 3, &px)), (4, 3, px));
    }
    #[test]
    fn a_large_image_is_split_into_valid_blocks() {
        let px: Vec<u8> = (0..64 * 64 * 4).map(|i| (i % 251) as u8).collect();   // 16 KB of rows: one block
        assert_eq!(decode(&png_rgba(64, 64, &px)).2, px);
        let big: Vec<u8> = (0..200 * 100 * 4).map(|i| (i * 7 % 256) as u8).collect();   // 80 KB: more than one block
        assert_eq!(decode(&png_rgba(200, 100, &big)).2, big);
    }
    #[test]
    fn the_smallest_images_work_too() {
        assert_eq!(decode(&png_rgba(1, 1, &[10, 20, 30, 255])), (1, 1, vec![10, 20, 30, 255]));
        let (w, h, px) = decode(&png_rgba(0, 0, &[]));
        assert_eq!((w, h, px.len()), (0, 0, 0));
    }
    #[test]
    fn windows_blue_green_red_becomes_red_green_blue() {
        let mut px = vec![1, 2, 3, 4, 10, 20, 30, 40];
        bgra_to_rgba(&mut px);
        assert_eq!(px, [3, 2, 1, 4, 30, 20, 10, 40]);
    }
    #[test]
    fn an_old_style_icon_gets_its_transparency_from_the_mask() {
        let mut px = vec![9, 9, 9, 0, 8, 8, 8, 0];   // no alpha anywhere
        alpha_from_mask(&mut px, &[0, 255]);          // first pixel visible, second transparent
        assert_eq!((px[3], px[7]), (255, 0));
    }
    #[test]
    fn an_icon_that_already_has_alpha_is_left_alone() {
        let mut px = vec![9, 9, 9, 128, 8, 8, 8, 0];
        alpha_from_mask(&mut px, &[255, 0]);
        assert_eq!((px[3], px[7]), (128, 0));
    }
    #[test]
    fn the_usage_file_round_trips_and_survives_damage() {
        let d = tmp("file");
        assert!(load(&d).apps.is_empty(), "no file yet");
        let mut u = Usage::default();
        u.add(CHROME, 77, 5);
        save(&d, &u).unwrap();
        assert_eq!(load(&d).apps.values().next().unwrap().seconds, 77);
        std::fs::write(d.join(FILE), b"{ not json").unwrap();
        assert!(load(&d).apps.is_empty(), "damaged file");
        std::fs::write(d.join(FILE), vec![b'x'; MAX_FILE_BYTES as usize + 1]).unwrap();
        assert!(load(&d).apps.is_empty(), "oversized file is not even read");
        std::fs::write(d.join(FILE), br#"{"apps":{"c:\\a.exe":{"path":"C:\\a.exe","seconds":3,"future":1}},"newField":1}"#).unwrap();
        assert_eq!(load(&d).apps.len(), 1, "unknown fields from a newer version are ignored");
        delete_file(&d);
        assert!(!d.join(FILE).exists());
    }
}
