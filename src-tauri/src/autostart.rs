//! "Start with Windows", done the way Steam and other well-behaved startup apps do it: one entry under
//! `HKCU\...\Run` that launches the installed app with `--hidden`, so it comes up silently in the tray and the
//! wallpaper starts, without a console window or a Studio window.
//!
//! The one way this goes wrong is when the entry points at the wrong exe. A development build (`cargo run`,
//! `tauri dev`) lives under `target\debug`; it keeps a console window open and has no interface of its own (it needs
//! the dev server), so if Windows starts it at login you get an empty black console and a blank app. A development
//! build must therefore never be a startup item, and any such entry found later is repaired. The rules are pure
//! functions (tested below); lib.rs applies them.

/// True for the command line of a development build (anything running out of `...\target\...\debug\...`).
pub fn is_dev_path(command: &str) -> bool {
    let p = command.replace('/', "\\").to_ascii_lowercase();
    p.contains("\\target\\") && p.contains("\\debug\\")
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Plan {
    /// Leave the startup entry alone.
    Nothing,
    /// Write the entry again, pointing at this exe (fixes a stale or moved path).
    Enable,
    /// Remove the entry.
    Disable,
    /// Remove the entry and switch the setting off too (a development build set it, so it must not claim to be on).
    DisableAndClear,
}

/// What to do about the startup entry when the app launches.
/// * `debug_build`: this process is a development build.
/// * `wanted`: the user's "Start with Windows" setting.
/// * `entry`: the command currently registered under the Run key, if any.
pub fn plan(debug_build: bool, wanted: bool, entry: Option<&str>) -> Plan {
    let stale_dev = entry.is_some_and(is_dev_path);
    if debug_build {
        // A development build only ever cleans up after itself; it never touches an installed app's entry.
        return match (stale_dev, wanted) {
            (true, true) => Plan::DisableAndClear,
            (true, false) => Plan::Disable,
            _ => Plan::Nothing,
        };
    }
    if wanted {
        Plan::Enable // refreshed on every launch: heals a development path left behind, or an app that was moved
    } else if stale_dev {
        Plan::Disable
    } else {
        Plan::Nothing
    }
}

/// The command line Windows will run at login for this app, read back from the registry.
#[cfg(windows)]
pub fn registered_command(app_name: &str) -> Option<String> {
    use std::ffi::c_void;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

    let key = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let name: Vec<u16> = app_name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut size = 0u32;
    let probe = unsafe { RegGetValueW(HKEY_CURRENT_USER, key, PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, None, Some(&mut size)) };
    if probe != ERROR_SUCCESS || size < 2 {
        return None;
    }
    let mut buf = vec![0u16; (size as usize).div_ceil(2)];
    let read = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, key, PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut c_void), Some(&mut size))
    };
    if read != ERROR_SUCCESS {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

#[cfg(not(windows))]
pub fn registered_command(_app_name: &str) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEV: &str = r#""D:\projects\silk\src-tauri\target\debug\silk-engine.exe" --hidden"#;
    const INSTALLED: &str = r#""C:\Users\me\AppData\Local\Silk Engine\silk-engine.exe" --hidden"#;

    #[test]
    fn recognises_a_development_build_by_its_path() {
        assert!(is_dev_path(DEV));
        assert!(is_dev_path(r#"D:\projects\silk\src-tauri\target\x86_64-pc-windows-msvc\debug\silk-engine.exe"#), "cross-compiled target folders too");
        assert!(is_dev_path("D:/projects/silk/src-tauri/target/debug/silk-engine.exe"), "forward slashes");
        assert!(is_dev_path(r#""d:\PROJECTS\SILK\SRC-TAURI\TARGET\DEBUG\SILK-ENGINE.EXE""#), "case does not matter");
        assert!(!is_dev_path(INSTALLED));
        assert!(!is_dev_path(r#""D:\projects\silk\src-tauri\target\release\silk-engine.exe" --hidden"#), "a release build is a fine startup item");
        assert!(!is_dev_path(r#""C:\Program Files\Silk Engine\silk-engine.exe""#));
        assert!(!is_dev_path(r#""C:\Users\me\debug\silk-engine.exe""#), "a folder merely called debug is not a build folder");
    }

    #[test]
    fn an_installed_app_keeps_its_entry_fresh_and_removes_a_stale_development_one() {
        assert_eq!(plan(false, true, Some(INSTALLED)), Plan::Enable);
        assert_eq!(plan(false, true, Some(DEV)), Plan::Enable, "a development path left behind is overwritten with the real one");
        assert_eq!(plan(false, true, None), Plan::Enable, "wanted but missing: write it");
        assert_eq!(plan(false, false, Some(DEV)), Plan::Disable, "not wanted, and the entry is a leftover development build");
        assert_eq!(plan(false, false, Some(INSTALLED)), Plan::Nothing, "never remove an entry the user may have made elsewhere");
        assert_eq!(plan(false, false, None), Plan::Nothing);
    }

    #[test]
    fn a_development_build_never_registers_itself_and_never_touches_an_installed_entry() {
        assert_eq!(plan(true, true, Some(DEV)), Plan::DisableAndClear);
        assert_eq!(plan(true, false, Some(DEV)), Plan::Disable);
        assert_eq!(plan(true, true, Some(INSTALLED)), Plan::Nothing, "the installed app's startup entry is not ours to change");
        assert_eq!(plan(true, true, None), Plan::Nothing);
        assert_eq!(plan(true, false, None), Plan::Nothing);
        for entry in [Some(DEV), Some(INSTALLED), None] {
            for wanted in [true, false] {
                assert_ne!(plan(true, wanted, entry), Plan::Enable, "a development build must never enable autostart");
            }
        }
    }
}
