//! One lightweight background thread that keeps the renderer informed:
//! which monitors are fully covered (so their wallpaper can stop rendering), whether we're on
//! battery, where the cursor is when it's over the desktop, and whether the monitor layout or
//! Explorer changed. It also drives hibernation (suspending the WebView when nothing is visible).

use crate::{desktop, AppState};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Visibility {
    pub covered: Vec<String>,
    pub on_battery: bool,
    pub locked: bool,
    pub hibernating: bool,
    pub all_covered: bool,
}

#[derive(Serialize, Clone, PartialEq)]
struct Cursor {
    x: i32,
    y: i32,
    down: bool,
}

#[cfg(windows)]
mod probe {
    use crate::desktop::Monitor;
    use std::ffi::c_void;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows::Win32::UI::WindowsAndMessaging::*;

    // Read-only desktop identity probe. A secure/locked desktop is not our wallpaper.
    #[allow(non_snake_case)]
    #[link(name = "user32")]
    extern "system" {
        fn OpenInputDesktop(flags: u32, inherit: i32, access: u32) -> *mut c_void;
        fn GetUserObjectInformationW(
            object: *mut c_void,
            index: i32,
            info: *mut c_void,
            len: u32,
            needed: *mut u32,
        ) -> i32;
        fn CloseDesktop(desktop: *mut c_void) -> i32;
    }
    pub fn locked() -> bool {
        unsafe {
            let desk = OpenInputDesktop(0, 0, 0x0001); // DESKTOP_READOBJECTS
            if desk.is_null() {
                return true;
            }
            let mut name = [0u16; 128];
            let mut needed = 0;
            let ok = GetUserObjectInformationW(
                desk,
                2,
                name.as_mut_ptr().cast(),
                std::mem::size_of_val(&name) as u32,
                &mut needed,
            ); // UOI_NAME
            let _ = CloseDesktop(desk);
            if ok == 0 {
                return false;
            } // Don't blank an accessible desktop on a probe error.
            let n = name.iter().position(|c| *c == 0).unwrap_or(name.len());
            !String::from_utf16_lossy(&name[..n]).eq_ignore_ascii_case("default")
        }
    }

    fn class(h: HWND) -> String {
        let mut b = [0u16; 64];
        let n = unsafe { GetClassNameW(h, &mut b) } as usize;
        String::from_utf16_lossy(&b[..n.min(64)])
    }

    struct Ctx<'a> {
        mons: &'a [Monitor],
        vx: i32,
        vy: i32,
        covered: Vec<String>,
    }

    unsafe extern "system" fn cb(h: HWND, lp: LPARAM) -> BOOL {
        let ctx = &mut *(lp.0 as *mut Ctx);
        if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
            return BOOL(1);
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4);
        if cloaked != 0 {
            return BOOL(1);
        }
        let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
        if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0) != 0 {
            return BOOL(1);
        }
        match class(h).as_str() {
            "Progman"
            | "WorkerW"
            | "Shell_TrayWnd"
            | "Shell_SecondaryTrayWnd"
            | "Windows.UI.Core.CoreWindow" => return BOOL(1),
            _ => {}
        }
        let mut r = RECT::default();
        if DwmGetWindowAttribute(
            h,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut r as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
        .is_err()
        {
            let _ = GetWindowRect(h, &mut r);
        }
        let (l, t, rr, b) = (
            r.left - ctx.vx,
            r.top - ctx.vy,
            r.right - ctx.vx,
            r.bottom - ctx.vy,
        );
        const TOL: i32 = 2;
        for m in ctx.mons {
            // A window that spans the monitor's work area (maximized) or the whole monitor
            // (fullscreen game/video) hides the wallpaper completely.
            if l <= m.wx + TOL
                && t <= m.wy + TOL
                && rr >= m.wx + m.ww - TOL
                && b >= m.wy + m.wh - TOL
                && !ctx.covered.contains(&m.key)
            {
                ctx.covered.push(m.key.clone());
            }
        }
        BOOL(1)
    }

    pub fn covered(mons: &[Monitor]) -> Vec<String> {
        let (vx, vy, _, _) = crate::desktop::virtual_rect();
        let mut ctx = Ctx {
            mons,
            vx,
            vy,
            covered: Vec::new(),
        };
        unsafe {
            let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
        }
        ctx.covered
    }

    pub fn on_battery() -> bool {
        let mut s = SYSTEM_POWER_STATUS::default();
        unsafe { GetSystemPowerStatus(&mut s).is_ok() && s.ACLineStatus == 0 }
    }

    /// Cursor position (relative to the virtual desktop) if it is over the desktop itself.
    pub fn cursor_over_desktop() -> Option<(i32, i32, bool)> {
        unsafe {
            let mut p = POINT::default();
            GetCursorPos(&mut p).ok()?;
            let under = WindowFromPoint(p);
            let root = GetAncestor(under, GA_ROOT);
            let c = class(under);
            let rc = class(root);
            let desktop = matches!(
                c.as_str(),
                "SysListView32" | "SHELLDLL_DefView" | "WorkerW" | "Progman"
            ) || matches!(rc.as_str(), "Progman" | "WorkerW");
            if !desktop {
                return None;
            }
            let (vx, vy, _, _) = crate::desktop::virtual_rect();
            let down = (GetAsyncKeyState(0x01) as u16 & 0x8000) != 0;
            Some((p.x - vx, p.y - vy, down))
        }
    }
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("echelon-watcher".into())
        .spawn(move || run(app))
        .ok();
}

fn run(app: AppHandle) {
    let mut last_vis = Visibility::default();
    let mut last_mons = desktop::monitors();
    let mut last_cursor: Option<Cursor> = None;
    let mut all_covered_since: Option<Instant> = None;
    let mut last_loop = Instant::now();
    let mut recovery_window = Instant::now();
    let mut recovery_count = 0;
    let mut last_check = Instant::now() - Duration::from_secs(5);
    let mut playlist_clock = crate::lifestyles::PlaylistClock::default();
    loop {
        playlist_clock.tick(&app);
        let (interactive, pause_covered, hibernate_on, paused, battery_policy, quitting) = {
            let st = app.state::<AppState>();
            let cfg = st.cfg.lock().unwrap();
            (
                cfg.system.interactive,
                cfg.system.pause_when_covered,
                cfg.system.hibernate,
                cfg.paused,
                cfg.system.battery.clone(),
                st.quitting.load(std::sync::atomic::Ordering::Relaxed),
            )
        };
        if quitting {
            return;
        }

        let resumed = last_loop.elapsed() > Duration::from_secs(3);
        last_loop = Instant::now();
        if resumed {
            crate::reattach(&app);
            *app.state::<AppState>().heartbeat.lock().unwrap() = Instant::now();
            if let Some(w) = app.get_webview_window("wallpaper") {
                desktop::set_suspended(&w, false);
            }
            // Rebuild viewports and decoder state after sleep, even with unchanged monitors.
            let _ = app.emit("layout", &last_mons);
        }

        // Cursor: polled at ~30 Hz, sent only when it moves over the desktop.
        #[cfg(windows)]
        if interactive
            && !paused
            && !last_vis.locked
            && !last_vis.all_covered
            && !last_vis.hibernating
            && !(last_vis.on_battery && battery_policy == "pause")
        {
            let c = probe::cursor_over_desktop().map(|(x, y, down)| Cursor { x, y, down });
            if c != last_cursor {
                if let Some(c) = &c {
                    let _ = app.emit_to("wallpaper", "cursor", c.clone());
                } else {
                    let _ = app.emit_to("wallpaper", "cursor-leave", ());
                }
                last_cursor = c;
            }
        }

        // Layout + visibility: twice a second.
        if last_check.elapsed() >= Duration::from_millis(500) {
            last_check = Instant::now();
            let mons = desktop::monitors();
            if mons != last_mons {
                last_mons = mons.clone();
                crate::reattach(&app);
                let _ = app.emit("layout", &mons);
            }
            #[cfg(windows)]
            {
                // Explorer restarted / we lost our parent: put the wallpaper back.
                let st = app.state::<AppState>();
                let (me, parent) = (
                    *st.wallpaper_hwnd.lock().unwrap(),
                    *st.parent_hwnd.lock().unwrap(),
                );
                if me != 0 && (parent == 0 || !desktop::is_attached(me, parent)) {
                    crate::reattach(&app);
                }
            }

            let mut vis = Visibility::default();
            #[cfg(windows)]
            {
                vis.on_battery = probe::on_battery();
                vis.locked = probe::locked();
                if vis.locked {
                    vis.covered = last_mons.iter().map(|m| m.key.clone()).collect();
                } else if pause_covered {
                    vis.covered = probe::covered(&last_mons);
                }
            }
            let all =
                !last_mons.is_empty() && last_mons.iter().all(|m| vis.covered.contains(&m.key));
            vis.all_covered = all;
            all_covered_since = if all {
                all_covered_since.or(Some(Instant::now()))
            } else {
                None
            };
            vis.hibernating = hibernate_on
                && all_covered_since
                    .map(|t| t.elapsed() > Duration::from_secs(10))
                    .unwrap_or(false);

            if resumed {
                all_covered_since = None;
                vis.hibernating = false;
            }
            // Limit recovery to three attempts per ten minutes: never reload-loop a bad file.
            if recovery_window.elapsed() > Duration::from_secs(600) {
                recovery_count = 0;
                recovery_window = Instant::now();
            }
            if !vis.hibernating
                && !last_vis.hibernating
                && recovery_count < 3
                && app.state::<AppState>().heartbeat.lock().unwrap().elapsed()
                    > Duration::from_secs(45)
            {
                recovery_count += 1;
                *app.state::<AppState>().heartbeat.lock().unwrap() = Instant::now();
                let h = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let _ = crate::restart_renderer(h);
                });
            }
            if vis != last_vis || resumed {
                *app.state::<AppState>().vis.lock().unwrap() = vis.clone();
                if vis.hibernating != last_vis.hibernating {
                    if let Some(w) = app.get_webview_window("wallpaper") {
                        if vis.hibernating {
                            // let the renderer free its GPU resources, then freeze the process
                            let _ = app.emit_to("wallpaper", "visibility", &vis);
                            std::thread::sleep(Duration::from_millis(800));
                            desktop::set_suspended(&w, true);
                        } else {
                            *app.state::<AppState>().heartbeat.lock().unwrap() = Instant::now();
                            desktop::set_suspended(&w, false);
                        }
                    }
                }
                let _ = app.emit("visibility", &vis);
                *app.state::<AppState>().vis.lock().unwrap() = vis.clone();
                last_vis = vis;
            }
        }
        // ~30 Hz only while cursor interaction is on; otherwise wake twice a second.
        std::thread::sleep(Duration::from_millis(
            if interactive
                && !paused
                && !last_vis.locked
                && !last_vis.all_covered
                && !last_vis.hibernating
                && !(last_vis.on_battery && battery_policy == "pause")
            {
                if last_vis.on_battery {
                    66
                } else {
                    33
                }
            } else {
                500
            },
        ));
    }
}
