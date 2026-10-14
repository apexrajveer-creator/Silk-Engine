//! The island's Quick tab: Wi-Fi and Bluetooth, the volume, and shortcuts into the Windows Settings pages.
//!
//! The radios use the Windows Runtime radio API and the volume uses Core Audio. Both are called on a short-lived worker thread
//! with COM initialised for it (calling them on the main UI thread can deadlock), and every call can fail without consequence:
//! a missing adapter, a desktop PC with no Bluetooth, a policy that blocks it. A failure means "unavailable" in the interface,
//! never an error dialog.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuickState {
    /// None = this PC has no such radio (or Windows would not say).
    pub wifi: Option<bool>,
    pub bluetooth: Option<bool>,
    /// 0..1
    pub volume: Option<f32>,
    pub muted: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Radio {
    Wifi,
    Bluetooth,
}

impl Radio {
    pub fn parse(s: &str) -> Option<Radio> {
        match s {
            "wifi" => Some(Radio::Wifi),
            "bluetooth" => Some(Radio::Bluetooth),
            _ => None,
        }
    }
}

/// The Settings pages the Quick tab can open. Fixed table: the webview names a page, never a URL.
pub fn settings_uri(page: &str) -> Option<&'static str> {
    Some(match page {
        "network" => "ms-settings:network-wifi",
        "bluetooth" => "ms-settings:bluetooth",
        "sound" => "ms-settings:sound",
        "display" => "ms-settings:display",
        "power" => "ms-settings:powersleep",
        "notifications" => "ms-settings:notifications",
        _ => return None,
    })
}

pub fn clamp_volume(v: f64) -> f32 {
    if v.is_finite() { v.clamp(0.0, 1.0) as f32 } else { 0.0 }
}

#[cfg(windows)]
mod win {
    use super::{QuickState, Radio};
    use windows::Devices::Radios::{Radio as WinRadio, RadioAccessStatus, RadioKind, RadioState};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

    /// Run `f` on its own thread with COM set up for it.
    fn on_worker<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
        std::thread::spawn(move || {
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            let r = f();
            unsafe { CoUninitialize() };
            r
        })
        .join()
        .map_err(|_| "The system call failed".to_string())?
    }

    fn radio_kind(r: Radio) -> RadioKind {
        match r {
            Radio::Wifi => RadioKind::WiFi,
            Radio::Bluetooth => RadioKind::Bluetooth,
        }
    }

    fn radio_on(kind: RadioKind) -> Result<Option<bool>, String> {
        let radios = WinRadio::GetRadiosAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
        for r in radios {
            if r.Kind().map_err(|e| e.to_string())? == kind {
                return Ok(Some(r.State().map_err(|e| e.to_string())? == RadioState::On));
            }
        }
        Ok(None)
    }

    fn endpoint() -> Result<IAudioEndpointVolume, String> {
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|e| e.to_string())?;
            device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).map_err(|e| e.to_string())
        }
    }

    pub fn state() -> QuickState {
        on_worker(|| {
            let wifi = radio_on(RadioKind::WiFi).ok().flatten();
            let bluetooth = radio_on(RadioKind::Bluetooth).ok().flatten();
            let (mut volume, mut muted) = (None, None);
            if let Ok(ep) = endpoint() {
                volume = unsafe { ep.GetMasterVolumeLevelScalar() }.ok();
                muted = unsafe { ep.GetMute() }.ok().map(|m| m.as_bool());
            }
            Ok(QuickState { wifi, bluetooth, volume, muted })
        })
        .unwrap_or_default()
    }

    pub fn set_radio(which: Radio, on: bool) -> Result<(), String> {
        on_worker(move || {
            let access = WinRadio::RequestAccessAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
            if access != RadioAccessStatus::Allowed {
                return Err("Windows did not allow changing this. Use Settings instead.".into());
            }
            let kind = radio_kind(which);
            let radios = WinRadio::GetRadiosAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
            for r in radios {
                if r.Kind().map_err(|e| e.to_string())? == kind {
                    let status = r.SetStateAsync(if on { RadioState::On } else { RadioState::Off }).map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
                    return if status == RadioAccessStatus::Allowed { Ok(()) } else { Err("Windows did not allow changing this. Use Settings instead.".into()) };
                }
            }
            Err("This PC has no such adapter".into())
        })
    }

    pub fn set_volume(v: f32) -> Result<(), String> {
        on_worker(move || unsafe { endpoint()?.SetMasterVolumeLevelScalar(v, std::ptr::null()) }.map_err(|e| e.to_string()))
    }

    pub fn set_muted(m: bool) -> Result<(), String> {
        on_worker(move || unsafe { endpoint()?.SetMute(m, std::ptr::null()) }.map_err(|e| e.to_string()))
    }

    pub fn open_settings(uri: &str) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer").arg(uri).creation_flags(0x0800_0000).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
pub use win::{open_settings, set_muted, set_radio, set_volume, state};

#[cfg(not(windows))]
pub fn state() -> QuickState {
    QuickState::default()
}
#[cfg(not(windows))]
pub fn set_radio(_: Radio, _: bool) -> Result<(), String> {
    Err("Only available on Windows".into())
}
#[cfg(not(windows))]
pub fn set_volume(_: f32) -> Result<(), String> {
    Err("Only available on Windows".into())
}
#[cfg(not(windows))]
pub fn set_muted(_: bool) -> Result<(), String> {
    Err("Only available on Windows".into())
}
#[cfg(not(windows))]
pub fn open_settings(_: &str) -> Result<(), String> {
    Err("Only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_pages_map_to_fixed_uris_and_nothing_else() {
        assert_eq!(settings_uri("network"), Some("ms-settings:network-wifi"));
        assert_eq!(settings_uri("bluetooth"), Some("ms-settings:bluetooth"));
        assert_eq!(settings_uri("sound"), Some("ms-settings:sound"));
        assert_eq!(settings_uri("display"), Some("ms-settings:display"));
        assert_eq!(settings_uri("power"), Some("ms-settings:powersleep"));
        for bad in ["", "Network", "ms-settings:network", "http://evil.example", "file:///c:/windows/system32/cmd.exe", "network ", "../x", "cmd /c calc"] {
            assert_eq!(settings_uri(bad), None, "{bad:?}");
        }
    }
    #[test]
    fn every_settings_uri_is_a_plain_ms_settings_link() {
        for page in ["network", "bluetooth", "sound", "display", "power", "notifications"] {
            let uri = settings_uri(page).unwrap();
            assert!(uri.starts_with("ms-settings:") && uri.chars().all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '-'), "{uri}");
        }
    }
    #[test]
    fn radios_are_named_exactly() {
        assert_eq!(Radio::parse("wifi"), Some(Radio::Wifi));
        assert_eq!(Radio::parse("bluetooth"), Some(Radio::Bluetooth));
        for bad in ["", "WiFi", "wi-fi", "cellular", "airplane", "wifi "] {
            assert_eq!(Radio::parse(bad), None, "{bad:?}");
        }
    }
    #[test]
    fn the_volume_is_always_a_sane_fraction() {
        assert_eq!(clamp_volume(0.5), 0.5);
        assert_eq!(clamp_volume(-3.0), 0.0);
        assert_eq!(clamp_volume(7.0), 1.0);
        assert_eq!(clamp_volume(f64::NAN), 0.0);
        assert_eq!(clamp_volume(f64::INFINITY), 0.0);
        assert_eq!(clamp_volume(f64::NEG_INFINITY), 0.0);
    }
    #[test]
    fn an_unavailable_pc_reports_nothing_instead_of_failing() {
        let s = QuickState::default();
        assert_eq!((s.wifi, s.bluetooth, s.volume, s.muted), (None, None, None, None));
    }
}
