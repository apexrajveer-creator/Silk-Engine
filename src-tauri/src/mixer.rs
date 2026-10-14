//! On-demand Core Audio mixer. No Explorer hooks, subprocesses, or background watcher.
use serde::Serialize;
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixerState { pub devices: Vec<Output>, pub apps: Vec<AppVolume> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output { pub id: String, pub name: String, pub default: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVolume { pub device_id: String, pub app_id: String, pub name: String, pub device_name: String, pub volume: f32, pub muted: bool }
pub fn valid_volume(v: f64) -> bool { v.is_finite() && (0.0..=1.0).contains(&v) }
pub fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 4096 && !id.contains('\0') }

#[cfg(windows)]
mod win {
    use super::*;
    use std::{collections::BTreeMap, sync::Mutex};
    use windows::core::{Interface, GUID, HRESULT, IUnknown_Vtbl, PCWSTR, PWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantToStringAlloc, PropVariantClear};
    static LOCK: Mutex<()> = Mutex::new(());
    struct Apartment;
    impl Drop for Apartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
    fn worker<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
        std::thread::spawn(move || {
            let _lock = LOCK.lock().map_err(|_| "Audio mixer is unavailable")?;
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok().map_err(|e| e.to_string())?;
            let _apartment = Apartment;
            f()
        }).join().map_err(|_| "Audio mixer call failed".to_string())?
    }
    unsafe fn owned_text(p: PWSTR) -> String {
        let text = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0.cast())); text
    }
    unsafe fn enumerator() -> Result<IMMDeviceEnumerator, String> { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string()) }
    unsafe fn device_name(device: &IMMDevice) -> String {
        (|| -> windows::core::Result<String> {
            let store = device.OpenPropertyStore(STGM_READ)?;
            let mut prop = store.GetValue(&PKEY_Device_FriendlyName)?;
            let text = PropVariantToStringAlloc(&prop).map(|p| owned_text(p));
            let _ = PropVariantClear(&mut prop);
            text
        })().unwrap_or_else(|_| "Audio output".into())
    }
    unsafe fn group(s: &IAudioSessionControl2) -> (String, String) {
        if s.IsSystemSoundsSession() == HRESULT(0) { return ("system".into(), "System sounds".into()); }
        let pid = s.GetProcessId().unwrap_or(0);
        if let Some(path) = crate::media_window::process_path(pid) {
            return (path.to_ascii_lowercase(), crate::media::app_label(&path));
        }
        let display = s.GetDisplayName().ok().map(|p| owned_text(p)).filter(|s| !s.is_empty());
        (format!("pid:{pid}"), display.unwrap_or_else(|| format!("App {pid}")))
    }
    unsafe fn sessions(device: &IMMDevice) -> windows::core::Result<Vec<IAudioSessionControl2>> {
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let all = manager.GetSessionEnumerator()?;
        let mut result = Vec::new();
        for i in 0..all.GetCount()?.min(256) {
            if let Ok(s) = all.GetSession(i).and_then(|s| s.cast::<IAudioSessionControl2>()) {
                if s.GetState().ok().is_some_and(|state| state == AudioSessionStateActive || state == AudioSessionStateInactive) && s.GetProcessId().unwrap_or(0) != std::process::id() { result.push(s); }
            }
        }
        Ok(result)
    }
    pub fn state() -> Result<MixerState, String> {
        worker(|| unsafe {
            let e = enumerator()?;
            let current = e.GetDefaultAudioEndpoint(eRender, eConsole).ok().and_then(|d| d.GetId().ok()).map(|p| owned_text(p));
            let devices = e.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).map_err(|e| e.to_string())?;
            let mut result = MixerState::default();
            for i in 0..devices.GetCount().map_err(|e| e.to_string())?.min(64) {
                let Ok(device) = devices.Item(i) else { continue };
                let Ok(id) = device.GetId().map(|p| owned_text(p)) else { continue };
                let name = device_name(&device);
                let mut groups = BTreeMap::<String, Vec<(String, f32, bool)>>::new();
                for s in sessions(&device).unwrap_or_default() {
                    let Ok(volume) = s.cast::<ISimpleAudioVolume>() else { continue };
                    let Ok(level) = volume.GetMasterVolume() else { continue };
                    let (key, label) = group(&s);
                    groups.entry(key).or_default().push((label, level, volume.GetMute().map(|v| v.as_bool()).unwrap_or(false)));
                }
                for (app_id, values) in groups {
                    result.apps.push(AppVolume { device_id: id.clone(), app_id, name: values[0].0.clone(), device_name: name.clone(), volume: values.iter().map(|v| v.1).sum::<f32>() / values.len() as f32, muted: values.iter().all(|v| v.2) });
                }
                result.devices.push(Output { default: current.as_ref() == Some(&id), id, name });
            }
            result.apps.sort_by(|a,b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.device_id.cmp(&b.device_id)));
            Ok(result)
        })
    }
    pub fn set_volume(device_id: String, app_id: String, value: f64) -> Result<(), String> {
        if !valid_id(&device_id) || !valid_id(&app_id) || !valid_volume(value) { return Err("Invalid app volume".into()); }
        worker(move || unsafe {
            let e = enumerator()?;
            let id: Vec<u16> = device_id.encode_utf16().chain(Some(0)).collect();
            let device = e.GetDevice(PCWSTR(id.as_ptr())).map_err(|_| "That audio output disconnected")?;
            if device.GetState().ok() != Some(DEVICE_STATE_ACTIVE) { return Err("That audio output disconnected".into()); }
            let mut matched = 0;
            for s in sessions(&device).map_err(|e| e.to_string())? {
                if group(&s).0 != app_id { continue; }
                let volume = s.cast::<ISimpleAudioVolume>().map_err(|e| e.to_string())?;
                volume.SetMasterVolume(value as f32, std::ptr::null()).map_err(|e| e.to_string())?;
                // Raising a muted app's bar should make it audible again.
                if value > 0.0 { volume.SetMute(false, std::ptr::null()).map_err(|e| e.to_string())?; }
                matched += 1;
            }
            if matched == 0 { return Err("That app's audio session has ended".into()); }
            Ok(())
        })
    }

    // Windows has no documented public setter for the system default endpoint.
    // Isolate the legacy PolicyConfig ABI behind one interface; failure leaves Settings available.
    #[repr(transparent)]
    #[derive(Clone)]
    struct IPolicyConfig(windows::core::IUnknown);
    // Same ownership/layout as IUnknown; only the successful, IID-specific COM query
    // constructs this wrapper, and its inner IUnknown releases it on drop.
    unsafe impl Interface for IPolicyConfig {
        type Vtable = PolicyVtbl;
        const IID: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
    }
    #[repr(C)]
    struct PolicyVtbl {
        base: IUnknown_Vtbl,
        // Ten methods from GetMixFormat through SetPropertyValue. Never invoked here.
        unused: [usize; 10],
        set_default: unsafe extern "system" fn(*mut std::ffi::c_void, PCWSTR, ERole) -> HRESULT,
    }
    pub fn set_output(device_id: String) -> Result<(), String> {
        if !valid_id(&device_id) { return Err("Invalid audio output".into()); }
        worker(move || unsafe {
            let e = enumerator()?;
            let wide: Vec<u16> = device_id.encode_utf16().chain(Some(0)).collect();
            let target = PCWSTR(wide.as_ptr());
            let device = e.GetDevice(target).map_err(|_| "That audio output disconnected")?;
            if device.GetState().ok() != Some(DEVICE_STATE_ACTIVE) || device.cast::<IMMEndpoint>().and_then(|d| d.GetDataFlow()).ok() != Some(eRender) { return Err("Choose an available playback output".into()); }
            let old: Vec<_> = [eConsole, eMultimedia].into_iter().map(|role| (role, e.GetDefaultAudioEndpoint(eRender, role).ok().and_then(|d| d.GetId().ok()).map(|p| owned_text(p)))).collect();
            let policy: IPolicyConfig = CoCreateInstance(&GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9), None, CLSCTX_ALL).map_err(|_| "Windows could not switch output. Use Sound settings.")?;
            let set = |id, role| (policy.vtable().set_default)(policy.as_raw(), id, role).ok().map_err(|e| e.to_string());
            let result = (|| -> Result<(), String> {
                set(target, eConsole)?;
                set(target, eMultimedia)?;
                // Communication applications keep their independently selected call device.
                for role in [eConsole, eMultimedia] {
                    let actual = e.GetDefaultAudioEndpoint(eRender, role).and_then(|d| d.GetId()).map(|p| owned_text(p)).map_err(|e| e.to_string())?;
                    if actual != device_id { return Err("Windows did not accept that output".into()); }
                }
                Ok(())
            })();
            if let Err(error) = result {
                for (role, id) in old {
                    if let Some(id) = id { let restore: Vec<u16> = id.encode_utf16().chain(Some(0)).collect(); let _ = set(PCWSTR(restore.as_ptr()), role); }
                }
                return Err(format!("Windows could not switch output: {error}. Use Sound settings."));
            }
            Ok(())
        })
    }
}
#[cfg(windows)] pub use win::{state, set_volume, set_output};
#[cfg(not(windows))] pub fn state() -> Result<MixerState,String> { Ok(MixerState::default()) }
#[cfg(not(windows))] pub fn set_volume(_:String,_:String,_:f64)->Result<(),String>{ Err("Only available on Windows".into()) }
#[cfg(not(windows))] pub fn set_output(_:String)->Result<(),String>{ Err("Only available on Windows".into()) }
#[cfg(test)] mod tests { use super::*; #[test] fn rejects_invalid_inputs(){ assert!(!valid_volume(f64::NAN)); assert!(!valid_volume(1.1)); assert!(valid_volume(0.5)); assert!(!valid_id("")); assert!(!valid_id("a\0b")); } }
