//! Putting a window *behind the desktop icons* on Windows.
//!
//! Classic layout (Windows 10 / 11 before 24H2): sending 0x052C to Progman makes Explorer
//! split the desktop into a WorkerW that hosts SHELLDLL_DefView (the icons) and a second,
//! empty WorkerW behind it. We parent our window to that empty WorkerW.
//!
//! Windows 11 24H2+: SHELLDLL_DefView and the WorkerW are children of Progman. We parent to
//! Progman and slot our window between the icons (above) and the WorkerW (below). The window
//! is made layered because the 24H2 desktop composes its children as layered surfaces.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Monitor {
    pub key: String,
    pub name: String,
    /// Rect in physical pixels relative to the wallpaper window (virtual-desktop origin).
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    /// Work area (screen minus taskbar), same coordinate space.
    pub wx: i32,
    pub wy: i32,
    pub ww: i32,
    pub wh: i32,
    pub scale: f32,
    pub primary: bool,
}

#[cfg(windows)]
mod imp {
    use super::Monitor;
    use std::ffi::c_void;
    use windows::core::{w, BOOL, PCWSTR};
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, ScreenToClient, HDC, HMONITOR, MONITORINFO,
        MONITORINFOEXW,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::*;

    pub fn hwnd(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    pub fn virtual_rect() -> (i32, i32, i32, i32) {
        unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1),
                GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1),
            )
        }
    }

    unsafe extern "system" fn mon_cb(hm: HMONITOR, _: HDC, _: *mut RECT, lp: LPARAM) -> BOOL {
        let out = &mut *(lp.0 as *mut Vec<Monitor>);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(hm, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
            let (vx, vy, _, _) = virtual_rect();
            let r = info.monitorInfo.rcMonitor;
            let wr = info.monitorInfo.rcWork;
            let n = info
                .szDevice
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(info.szDevice.len());
            let key = String::from_utf16_lossy(&info.szDevice[..n]);
            let (mut dx, mut dy) = (96u32, 96u32);
            let _ = GetDpiForMonitor(hm, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
            let idx = out.len() + 1;
            out.push(Monitor {
                name: format!("Display {idx}"),
                key,
                x: r.left - vx,
                y: r.top - vy,
                w: r.right - r.left,
                h: r.bottom - r.top,
                wx: wr.left - vx,
                wy: wr.top - vy,
                ww: wr.right - wr.left,
                wh: wr.bottom - wr.top,
                scale: dx as f32 / 96.0,
                primary: info.monitorInfo.dwFlags & 1 != 0,
            });
        }
        BOOL(1)
    }

    pub fn monitors() -> Vec<Monitor> {
        let mut v: Vec<Monitor> = Vec::new();
        unsafe {
            let _ =
                EnumDisplayMonitors(None, None, Some(mon_cb), LPARAM(&mut v as *mut _ as isize));
        }
        v.sort_by_key(|m| (!m.primary, m.x, m.y));
        for (i, m) in v.iter_mut().enumerate() {
            m.name = if m.primary {
                format!("Display {} · main", i + 1)
            } else {
                format!("Display {}", i + 1)
            };
        }
        v
    }

    unsafe extern "system" fn find_worker(top: HWND, lp: LPARAM) -> BOOL {
        if let Ok(view) = FindWindowExW(Some(top), None, w!("SHELLDLL_DefView"), PCWSTR::null()) {
            if !view.is_invalid() {
                if let Ok(ww) = FindWindowExW(None, Some(top), w!("WorkerW"), PCWSTR::null()) {
                    *(lp.0 as *mut HWND) = ww;
                }
            }
        }
        BOOL(1)
    }

    /// Returns the parent we attached to.
    pub fn attach(raw: isize) -> Result<isize, String> {
        unsafe {
            let me = hwnd(raw);
            let progman = FindWindowW(w!("Progman"), PCWSTR::null())
                .map_err(|e| format!("Progman not found: {e}"))?;
            // Ask Explorer to create the WorkerW behind the icons.
            let mut res = 0usize;
            SendMessageTimeoutW(
                progman,
                0x052C,
                WPARAM(0xD),
                LPARAM(0x1),
                SMTO_NORMAL,
                1000,
                Some(&mut res),
            );

            // Become a borderless, non-activating child.
            let style = GetWindowLongPtrW(me, GWL_STYLE);
            let strip = (WS_POPUP.0
                | WS_CAPTION.0
                | WS_THICKFRAME.0
                | WS_SYSMENU.0
                | WS_MAXIMIZEBOX.0
                | WS_MINIMIZEBOX.0) as isize;
            SetWindowLongPtrW(
                me,
                GWL_STYLE,
                (style & !strip) | (WS_CHILD.0 | WS_VISIBLE.0) as isize,
            );
            let ex = GetWindowLongPtrW(me, GWL_EXSTYLE);
            let mut ex = (ex & !(WS_EX_APPWINDOW.0 as isize))
                | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize;

            let defview =
                FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), PCWSTR::null())
                    .ok()
                    .filter(|h| !h.is_invalid());
            let parent;
            if let Some(defview) = defview {
                // Windows 11 24H2+ "raised desktop" layout
                ex |= WS_EX_LAYERED.0 as isize;
                SetWindowLongPtrW(me, GWL_EXSTYLE, ex);
                let _ = SetLayeredWindowAttributes(me, COLORREF(0), 255, LWA_ALPHA);
                SetParent(me, Some(progman)).map_err(|e| format!("SetParent(Progman): {e}"))?;
                let _ = SetWindowPos(
                    me,
                    Some(defview),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                if let Ok(worker) =
                    FindWindowExW(Some(progman), None, w!("WorkerW"), PCWSTR::null())
                {
                    if !worker.is_invalid() {
                        let _ = SetWindowPos(
                            worker,
                            Some(me),
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                    }
                }
                parent = progman;
            } else {
                SetWindowLongPtrW(me, GWL_EXSTYLE, ex);
                let mut worker = HWND::default();
                let _ = EnumWindows(Some(find_worker), LPARAM(&mut worker as *mut HWND as isize));
                if worker.is_invalid() {
                    worker = progman; // last resort: draws behind icons on most builds
                }
                SetParent(me, Some(worker)).map_err(|e| format!("SetParent(WorkerW): {e}"))?;
                parent = worker;
            }
            fit(raw, parent.0 as isize);
            Ok(parent.0 as isize)
        }
    }

    /// Cover the whole virtual desktop, expressed in the parent's client coordinates.
    pub fn fit(raw: isize, parent: isize) {
        unsafe {
            let (vx, vy, vw, vh) = virtual_rect();
            let mut p = POINT { x: vx, y: vy };
            let _ = ScreenToClient(hwnd(parent), &mut p);
            let _ = SetWindowPos(
                hwnd(raw),
                None,
                p.x,
                p.y,
                vw,
                vh,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }

    pub fn is_attached(raw: isize, parent: isize) -> bool {
        unsafe {
            IsWindow(Some(hwnd(parent))).as_bool()
                && GetParent(hwnd(raw))
                    .map(|p| p.0 as isize == parent)
                    .unwrap_or(false)
        }
    }

    /// Re-apply the user's normal wallpaper so our last frame doesn't stay painted on exit.
    pub fn restore_wallpaper() {
        unsafe {
            let mut buf = [0u16; 512];
            if SystemParametersInfoW(
                SPI_GETDESKWALLPAPER,
                buf.len() as u32,
                Some(buf.as_mut_ptr() as *mut c_void),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
            .is_ok()
            {
                let _ = SystemParametersInfoW(
                    SPI_SETDESKWALLPAPER,
                    0,
                    Some(buf.as_mut_ptr() as *mut c_void),
                    SPIF_SENDCHANGE,
                );
            }
        }
    }

    pub fn detach(raw: isize) {
        unsafe {
            let _ = ShowWindow(hwnd(raw), SW_HIDE);
            let _ = SetParent(hwnd(raw), None);
        }
        restore_wallpaper();
    }
}

#[cfg(windows)]
pub use imp::*;

#[cfg(not(windows))]
pub fn monitors() -> Vec<Monitor> {
    vec![Monitor {
        key: "main".into(),
        name: "Display 1 · main".into(),
        x: 0,
        y: 0,
        w: 1920,
        h: 1080,
        wx: 0,
        wy: 0,
        ww: 1920,
        wh: 1080,
        scale: 1.0,
        primary: true,
    }]
}
#[cfg(not(windows))]
pub fn restore_wallpaper() {}

/// Suspend / resume the wallpaper's WebView2. While suspended the renderer process is frozen
/// and Edge is told to trim memory; this is what "hibernate" does when every screen is covered.
#[cfg(windows)]
pub fn set_suspended<R: tauri::Runtime>(w: &tauri::WebviewWindow<R>, suspend: bool) {
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows::core::Interface;
        let ctrl = wv.controller();
        if !suspend {
            let _ = ctrl.SetIsVisible(true);
        }
        if let Ok(core) = ctrl.CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let _ = c19.SetMemoryUsageTargetLevel(if suspend {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                });
            }
            if suspend {
                let _ = ctrl.SetIsVisible(false);
                if let Ok(c3) = core.cast::<ICoreWebView2_3>() {
                    let h =
                        webview2_com::TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(())));
                    let _ = c3.TrySuspend(&h);
                }
            }
        }
    });
}

#[cfg(not(windows))]
pub fn set_suspended<R: tauri::Runtime>(_w: &tauri::WebviewWindow<R>, _suspend: bool) {}
