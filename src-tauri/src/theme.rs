//! Theme sync: set the Windows accent colour (Start, taskbar highlights, title bars, focus rings)
//! from the current wallpaper, and put the user's own colour back when the feature is turned off.
//!
//! Windows has no public API for this. These are the same per-user registry values the Settings
//! app writes, followed by the same "ImmersiveColorSet" broadcast; nothing outside HKCU is touched.
//! The user's original values are captured before the first change and restored exactly.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The user's accent settings before theme sync took over. Every field is optional because any of
/// them may not exist on a given Windows build; a missing value is simply not restored.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AccentBackup {
    pub accent_color: Option<u32>,
    pub colorization_color: Option<u32>,
    pub colorization_afterglow: Option<u32>,
    pub accent_color_menu: Option<u32>,
    pub start_color_menu: Option<u32>,
    pub accent_palette: Option<Vec<u8>>,
    pub auto_colorization: Option<u32>,
    /// "Show accent color on Start and taskbar" (1 = on). Without it the taskbar ignores the accent.
    pub color_prevalence: Option<u32>,
    /// 0 = dark system theme (taskbar/Start). Windows only tints the taskbar in dark mode.
    pub system_uses_light_theme: Option<u32>,
}

/// Parse "#rrggbb".
pub fn parse_hex(s: &str) -> Option<(u8, u8, u8)> {
    let h = s.strip_prefix('#')?;
    if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let n = u32::from_str_radix(h, 16).ok()?;
    Some(((n >> 16) as u8, (n >> 8) as u8, n as u8))
}

/// 0xAABBGGRR, the byte order Windows uses for accent DWORDs.
pub fn abgr(r: u8, g: u8, b: u8) -> u32 {
    0xFF00_0000 | (b as u32) << 16 | (g as u32) << 8 | r as u32
}

/// 0xAARRGGBB with DWM's usual colorization alpha.
pub fn argb(r: u8, g: u8, b: u8) -> u32 {
    0xC400_0000 | (r as u32) << 16 | (g as u32) << 8 | b as u32
}

fn mix(c: (u8, u8, u8), target: f32, t: f32) -> (u8, u8, u8) {
    let f = |x: u8| (x as f32 + (target - x as f32) * t).round().clamp(0.0, 255.0) as u8;
    (f(c.0), f(c.1), f(c.2))
}

/// The 8-entry RGBA palette Windows derives shades from: three lighter, the accent, three darker,
/// then a neutral. Lighter shades mix toward white, darker toward black.
pub fn palette(c: (u8, u8, u8)) -> [u8; 32] {
    let shades = [mix(c, 255.0, 0.54), mix(c, 255.0, 0.36), mix(c, 255.0, 0.18), c, mix(c, 0.0, 0.22), mix(c, 0.0, 0.42), mix(c, 0.0, 0.62), (0x88, 0x88, 0x88)];
    let mut out = [0u8; 32];
    for (i, s) in shades.iter().enumerate() {
        out[i * 4] = s.0;
        out[i * 4 + 1] = s.1;
        out[i * 4 + 2] = s.2;
        out[i * 4 + 3] = 0;
    }
    out
}

/// Registry writes and the system-wide broadcast are not free: at most one every 600 ms,
/// and never for the colour that is already applied. A held-back change is retried by the caller.
type Rgb = (u8, u8, u8);
pub static WRITE: Mutex<()> = Mutex::new(());
static APPLIED: Mutex<Option<String>> = Mutex::new(None);
pub fn remember_applied(color: &str) { if let Ok(mut value) = APPLIED.lock() { *value = Some(color.to_string()); } }
pub fn applied_color() -> Option<String> { APPLIED.lock().ok().and_then(|value| value.clone()) }

static LAST: Mutex<Option<(Instant, Rgb)>> = Mutex::new(None);
const MIN_INTERVAL: Duration = Duration::from_millis(600);

pub fn should_apply(c: (u8, u8, u8)) -> bool {
    let Ok(mut last) = LAST.lock() else { return false };
    if let Some((at, prev)) = *last {
        if prev == c || at.elapsed() < MIN_INTERVAL {
            return false;
        }
    }
    *last = Some((Instant::now(), c));
    true
}

/// True when this colour is already the one applied (nothing to retry).
pub fn is_current(c: Rgb) -> bool {
    LAST.lock().map(|l| matches!(*l, Some((_, prev)) if prev == c)).unwrap_or(false)
}

/// Keep the last successful surface palette when a registry write fails; allow the next sample to retry.
pub fn retry_failed(c: Rgb) {
    if let Ok(mut last) = LAST.lock() { if matches!(*last, Some((_, prev)) if prev == c) { *last = None; } }
}

pub fn forget_last() {
    if let Ok(mut value) = APPLIED.lock() { *value = None; }
    if let Ok(mut last) = LAST.lock() {
        *last = None;
    }
}

#[cfg(windows)]
mod imp {
    use super::AccentBackup;
    use std::ffi::c_void;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{ERROR_SUCCESS, LPARAM, WPARAM};
    use windows::Win32::System::Registry::*;
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};

    const DWM: PCWSTR = w!("Software\\Microsoft\\Windows\\DWM");
    const ACCENT: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent");
    const DESKTOP: PCWSTR = w!("Control Panel\\Desktop");
    const PERSONALIZE: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");

    fn get_dword(key: PCWSTR, name: PCWSTR) -> Option<u32> {
        let mut v = 0u32;
        let mut size = 4u32;
        let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, key, name, RRF_RT_REG_DWORD, None, Some(&mut v as *mut u32 as *mut c_void), Some(&mut size)) };
        (r == ERROR_SUCCESS).then_some(v)
    }
    fn get_binary(key: PCWSTR, name: PCWSTR) -> Option<Vec<u8>> {
        let mut buf = vec![0u8; 64];
        let mut size = buf.len() as u32;
        let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, key, name, RRF_RT_REG_BINARY, None, Some(buf.as_mut_ptr() as *mut c_void), Some(&mut size)) };
        if r != ERROR_SUCCESS {
            return None;
        }
        buf.truncate(size as usize);
        Some(buf)
    }
    fn set_dword(key: PCWSTR, name: PCWSTR, v: u32) -> bool {
        unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key, name, REG_DWORD.0, Some(&v as *const u32 as *const c_void), 4) == ERROR_SUCCESS }
    }
    fn set_binary(key: PCWSTR, name: PCWSTR, v: &[u8]) -> bool {
        unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key, name, REG_BINARY.0, Some(v.as_ptr() as *const c_void), v.len() as u32) == ERROR_SUCCESS }
    }

    fn broadcast() {
        let topic: Vec<u16> = "ImmersiveColorSet\0".encode_utf16().collect();
        unsafe {
            let mut res = 0usize;
            SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(topic.as_ptr() as isize), SMTO_ABORTIFHUNG, 1000, Some(&mut res));
        }
            }

    pub fn read_backup() -> AccentBackup {
        AccentBackup {
            accent_color: get_dword(DWM, w!("AccentColor")),
            colorization_color: get_dword(DWM, w!("ColorizationColor")),
            colorization_afterglow: get_dword(DWM, w!("ColorizationAfterglow")),
            accent_color_menu: get_dword(ACCENT, w!("AccentColorMenu")),
            start_color_menu: get_dword(ACCENT, w!("StartColorMenu")),
            accent_palette: get_binary(ACCENT, w!("AccentPalette")),
            auto_colorization: get_dword(DESKTOP, w!("AutoColorization")),
            color_prevalence: get_dword(PERSONALIZE, w!("ColorPrevalence")),
            system_uses_light_theme: get_dword(PERSONALIZE, w!("SystemUsesLightTheme")),
        }
    }

    pub fn apply(c: (u8, u8, u8), notify: impl FnOnce()) -> Result<(), String> {
        let (r, g, b) = c;
        let pal = super::palette(c);
        let dark = (pal[20], pal[21], pal[22]); // the darker shade Windows uses for Start
        // The taskbar and Start only take the accent when "Show accent color on Start and taskbar" is on,
        // and Windows only honours that with a dark system theme. Apps keep their own light/dark choice.
        let ok = set_dword(PERSONALIZE, w!("ColorPrevalence"), 1)
            & set_dword(PERSONALIZE, w!("SystemUsesLightTheme"), 0)
            & set_dword(DESKTOP, w!("AutoColorization"), 0) // stop Windows overriding us from its own wallpaper
            & set_binary(ACCENT, w!("AccentPalette"), &pal)
            & set_dword(ACCENT, w!("AccentColorMenu"), super::abgr(r, g, b))
            & set_dword(ACCENT, w!("StartColorMenu"), super::abgr(dark.0, dark.1, dark.2))
            & set_dword(DWM, w!("AccentColor"), super::abgr(r, g, b))
            & set_dword(DWM, w!("ColorizationColor"), super::argb(r, g, b))
            & set_dword(DWM, w!("ColorizationAfterglow"), super::argb(r, g, b));
        if ok { notify(); }
        broadcast();
        if ok { Ok(()) } else { Err("Windows refused part of the accent change".into()) }
    }

    pub fn restore(b: &AccentBackup) {
        if let Some(v) = &b.accent_palette { set_binary(ACCENT, w!("AccentPalette"), v); }
        if let Some(v) = b.accent_color_menu { set_dword(ACCENT, w!("AccentColorMenu"), v); }
        if let Some(v) = b.start_color_menu { set_dword(ACCENT, w!("StartColorMenu"), v); }
        if let Some(v) = b.accent_color { set_dword(DWM, w!("AccentColor"), v); }
        if let Some(v) = b.colorization_color { set_dword(DWM, w!("ColorizationColor"), v); }
        if let Some(v) = b.colorization_afterglow { set_dword(DWM, w!("ColorizationAfterglow"), v); }
        if let Some(v) = b.auto_colorization { set_dword(DESKTOP, w!("AutoColorization"), v); }
        if let Some(v) = b.color_prevalence { set_dword(PERSONALIZE, w!("ColorPrevalence"), v); }
        if let Some(v) = b.system_uses_light_theme { set_dword(PERSONALIZE, w!("SystemUsesLightTheme"), v); }
        broadcast();
    }
}

#[cfg(windows)]
pub use imp::{apply, read_backup, restore};

#[cfg(not(windows))]
pub fn read_backup() -> AccentBackup { AccentBackup::default() }
#[cfg(not(windows))]
pub fn apply(_c: (u8, u8, u8), _notify: impl FnOnce()) -> Result<(), String> { Err("Theme sync is only available on Windows".into()) }
#[cfg(not(windows))]
pub fn restore(_b: &AccentBackup) {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hex_parsing_is_strict() {
        assert_eq!(parse_hex("#ff8000"), Some((255, 128, 0)));
        assert_eq!(parse_hex("ff8000"), None);
        assert_eq!(parse_hex("#ff80"), None);
        assert_eq!(parse_hex("#gg8000"), None);
    }
    #[test]
    fn byte_orders_match_windows() {
        assert_eq!(abgr(0x11, 0x22, 0x33), 0xFF33_2211);
        assert_eq!(argb(0x11, 0x22, 0x33), 0xC411_2233);
    }
    #[test]
    fn palette_brackets_the_accent() {
        let p = palette((40, 120, 200));
        assert_eq!(&p[12..15], &[40, 120, 200]);
        assert!(p[0] > p[4] && p[4] > p[8] && p[8] > 40, "lighter shades get lighter");
        assert!(p[16] < 40 && p[20] < p[16] && p[24] < p[20], "darker shades get darker");
    }
    #[test]
    fn a_near_black_accent_still_makes_a_valid_palette() {
        // what RGB wallpapers pin the taskbar to: lighter shades lift off the dark, darker ones stay at or above black
        let p = palette((27, 27, 29));
        assert_eq!(&p[12..15], &[27, 27, 29]);
        assert!(p[0] > p[4] && p[4] > p[8] && p[8] > 27, "lighter shades still get lighter");
        assert!(p[16] < 27 && p[20] < p[16] && p[24] < p[20], "darker shades still get darker");
    }
    #[test]
    fn rate_limit_rejects_repeats() {
        forget_last();
        assert!(should_apply((1, 2, 3)));
        assert!(!should_apply((1, 2, 3)), "same colour twice");
        assert!(!should_apply((9, 9, 9)), "too soon after the last write");
        forget_last();
    }
}
