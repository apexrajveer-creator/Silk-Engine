//! System-wide hotkeys: work whatever app has focus, with Silk Engine running from the tray.
//!
//! * The table of actions and their default shortcuts lives here (the Studio asks for it, so there is one
//!   source of truth; `src/shared/hotkeys.js` mirrors it for the browser preview and a test keeps them equal).
//! * Shortcut parsing and the safety policy are pure functions with unit tests.
//! * On Windows a dedicated thread owns the registrations (`RegisterHotKey` ties a hotkey to the thread that
//!   registered it, which must also unregister it) and runs a message loop; everything else talks to it
//!   through a channel. Conflicts with other apps are reported per action instead of failing silently.

use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

// ------------------------------------------------------------------------------------------ actions

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub id: &'static str,
    pub group: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub default: &'static str,
}

const fn a(id: &'static str, group: &'static str, label: &'static str, hint: &'static str, default: &'static str) -> Action {
    Action { id, group, label, hint, default }
}

/// Defaults use Ctrl+Alt+Shift so they stay clear of everyday shortcuts; every one can be changed.
pub const ACTIONS: &[Action] = &[
    a("next", "Wallpaper", "Next wallpaper", "On every display", "Ctrl+Alt+Shift+Right"),
    a("prev", "Wallpaper", "Previous wallpaper", "On every display", "Ctrl+Alt+Shift+Left"),
    a("random", "Wallpaper", "Random wallpaper", "A different one from your library", "Ctrl+Alt+Shift+N"),
    a("pause", "Wallpaper", "Pause or resume", "Freeze the wallpaper", "Ctrl+Alt+Shift+Space"),
    a("oled", "Look", "Toggle OLED mode", "True blacks on any screen", "Ctrl+Alt+Shift+O"),
    a("brightUp", "Look", "Brighter", "Display brightness +5", "Ctrl+Alt+Shift+Up"),
    a("brightDown", "Look", "Dimmer", "Display brightness -5", "Ctrl+Alt+Shift+Down"),
    a("quality", "Look", "Cycle render quality", "Auto, Eco, Balanced, High, Ultra", "Ctrl+Alt+Shift+Q"),
    a("audio", "Input", "Toggle audio reactivity", "React to system audio", "Ctrl+Alt+Shift+A"),
    a("interactive", "Input", "Toggle cursor reaction", "React to the cursor on the desktop", "Ctrl+Alt+Shift+C"),
    a("studio", "App", "Open Silk Engine", "Bring up the Studio", "Ctrl+Alt+Shift+S"),
    a("widgets", "App", "Show or hide widgets", "All desktop widgets", "Ctrl+Alt+Shift+W"),
    a("restart", "App", "Restart wallpaper", "Reload the renderer", "Ctrl+Alt+Shift+R"),
    a("profile1", "Desktops", "Apply desktop 1", "Your first saved desktop", ""),
    a("profile2", "Desktops", "Apply desktop 2", "Your second saved desktop", ""),
    a("profile3", "Desktops", "Apply desktop 3", "Your third saved desktop", ""),
    a("profile4", "Desktops", "Apply desktop 4", "Your fourth saved desktop", ""),
    a("profile5", "Desktops", "Apply desktop 5", "Your fifth saved desktop", ""),
];

pub fn action(id: &str) -> Option<&'static Action> {
    ACTIONS.iter().find(|x| x.id == id)
}

// ------------------------------------------------------------------------------------------ shortcuts

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Combo {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub win: bool,
    /// Windows virtual-key code.
    pub vk: u32,
}

const NAMED: &[(&str, u32)] = &[
    ("Left", 0x25), ("Up", 0x26), ("Right", 0x27), ("Down", 0x28), ("Space", 0x20), ("Enter", 0x0D), ("Tab", 0x09),
    ("Backspace", 0x08), ("Delete", 0x2E), ("Insert", 0x2D), ("Home", 0x24), ("End", 0x23), ("PageUp", 0x21), ("PageDown", 0x22),
    ("Comma", 0xBC), ("Period", 0xBE), ("Slash", 0xBF), ("Semicolon", 0xBA), ("Quote", 0xDE), ("BracketLeft", 0xDB),
    ("BracketRight", 0xDD), ("Backslash", 0xDC), ("Minus", 0xBD), ("Equal", 0xBB), ("Backquote", 0xC0),
    ("NumpadAdd", 0x6B), ("NumpadSubtract", 0x6D), ("NumpadMultiply", 0x6A), ("NumpadDivide", 0x6F), ("NumpadDecimal", 0x6E),
];

fn key_table() -> Vec<(String, u32)> {
    let mut v: Vec<(String, u32)> = Vec::new();
    v.extend((b'A'..=b'Z').map(|c| ((c as char).to_string(), c as u32)));
    v.extend((b'0'..=b'9').map(|c| ((c as char).to_string(), c as u32)));
    v.extend((1..=24u32).map(|n| (format!("F{n}"), 0x6F + n)));
    v.extend((0..=9u32).map(|n| (format!("Numpad{n}"), 0x60 + n)));
    v.extend(NAMED.iter().map(|(n, vk)| ((*n).to_string(), *vk)));
    v
}

pub fn key_name(vk: u32) -> Option<String> {
    key_table().into_iter().find(|(_, v)| *v == vk).map(|(n, _)| n)
}

/// Parse "Ctrl+Alt+Shift+Right" (any order, any case; a few aliases). Does not apply the safety policy.
pub fn parse(s: &str) -> Result<Combo, String> {
    let table = key_table();
    let (mut ctrl, mut alt, mut shift, mut win) = (false, false, false, false);
    let mut vk: Option<u32> = None;
    for part in s.split('+') {
        let t = part.trim();
        if t.is_empty() {
            return Err("There is an empty part in this shortcut".into());
        }
        let lower = t.to_ascii_lowercase();
        let slot = match lower.as_str() {
            "ctrl" | "control" => Some(&mut ctrl),
            "alt" | "option" => Some(&mut alt),
            "shift" => Some(&mut shift),
            "win" | "super" | "meta" | "cmd" | "command" => Some(&mut win),
            _ => None,
        };
        if let Some(flag) = slot {
            if *flag {
                return Err(format!("{t} is listed twice"));
            }
            *flag = true;
            continue;
        }
        if vk.is_some() {
            return Err("Use just one key plus modifiers".into());
        }
        let name = lower.strip_prefix("arrow").unwrap_or(&lower).to_string();
        let found = table.iter().find(|(n, _)| n.eq_ignore_ascii_case(&name));
        vk = Some(found.ok_or_else(|| format!("Unknown key \"{t}\""))?.1);
    }
    Ok(Combo { ctrl, alt, shift, win, vk: vk.ok_or("Choose a key")? })
}

/// "Ctrl+Alt+Shift+Right": fixed modifier order and canonical key name.
pub fn canonical(c: &Combo) -> String {
    let mut out = String::new();
    for (on, name) in [(c.ctrl, "Ctrl"), (c.alt, "Alt"), (c.shift, "Shift"), (c.win, "Win")] {
        if on {
            out.push_str(name);
            out.push('+');
        }
    }
    out.push_str(&key_name(c.vk).unwrap_or_default());
    out
}

/// Keep a global hotkey from breaking everyday typing: at least two modifiers (so Ctrl+C or Shift+A can never
/// be taken over), except the rarely used F13-F24 keys, and never combinations Windows itself owns.
pub fn check_policy(c: &Combo) -> Result<(), String> {
    let mods = [c.ctrl, c.alt, c.shift, c.win].iter().filter(|m| **m).count();
    let high_f = (0x7C..=0x87).contains(&c.vk); // F13..F24
    if mods < 2 && !high_f {
        return Err("Use at least two of Ctrl, Alt, Shift and Win, so everyday shortcuts keep working".into());
    }
    if (c.ctrl && c.alt && c.vk == 0x2E) || (c.alt && c.vk == 0x09) || (c.win && c.vk == 0x4C) {
        return Err("Windows reserves this shortcut".into());
    }
    Ok(())
}

// ------------------------------------------------------------------------------------------ resolving

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Registered and working.
    Active,
    /// Another application already owns this shortcut.
    InUse,
    /// No shortcut assigned.
    Off,
    /// The shortcut is not allowed or conflicts with another action here.
    Invalid,
    /// Hotkeys are switched off.
    Disabled,
}

pub fn defaults() -> BTreeMap<String, String> {
    ACTIONS.iter().map(|x| (x.id.to_string(), x.default.to_string())).collect()
}

/// What is really bound: the defaults, overridden by whatever the user stored ("" = deliberately unbound).
/// New actions added in a later version therefore pick up their defaults without touching saved settings.
pub fn effective(stored: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    ACTIONS
        .iter()
        .map(|x| {
            let v = match stored.get(x.id) {
                Some(v) => v.trim().to_string(),
                None => x.default.to_string(),
            };
            let v = parse(&v).map(|c| canonical(&c)).unwrap_or(v);
            (x.id.to_string(), v)
        })
        .collect()
}

pub struct Resolved {
    pub id: &'static str,
    /// None = unbound. Err = explains why it can't be used.
    pub combo: Option<Result<Combo, String>>,
}

/// Parse, apply the policy and spot two actions sharing one shortcut (the later action loses).
pub fn resolve(bindings: &BTreeMap<String, String>) -> Vec<Resolved> {
    let mut taken: Vec<(Combo, &'static str)> = Vec::new();
    let mut out = Vec::new();
    for act in ACTIONS {
        let raw = bindings.get(act.id).map(|s| s.trim()).unwrap_or("");
        if raw.is_empty() {
            out.push(Resolved { id: act.id, combo: None });
            continue;
        }
        let res = parse(raw).and_then(|c| check_policy(&c).map(|_| c)).and_then(|c| {
            if let Some((_, other)) = taken.iter().find(|(t, _)| *t == c) {
                let other: &str = other;
                return Err(format!("Already used for \"{}\"", action(other).map(|x| x.label).unwrap_or(other)));
            }
            taken.push((c, act.id));
            Ok(c)
        });
        out.push(Resolved { id: act.id, combo: Some(res) });
    }
    out
}

/// For saving from the Studio: the first problem is reported to the user and nothing is saved.
pub fn resolve_strict(bindings: &BTreeMap<String, String>) -> Result<Vec<(String, Combo)>, String> {
    let mut ok = Vec::new();
    for r in resolve(bindings) {
        match r.combo {
            Some(Ok(c)) => ok.push((r.id.to_string(), c)),
            Some(Err(e)) => return Err(format!("{}: {e}", action(r.id).map(|x| x.label).unwrap_or(r.id))),
            None => {}
        }
    }
    Ok(ok)
}

// ------------------------------------------------------------------------------------------ Windows

#[cfg(windows)]
mod platform {
    use super::{Combo, Status};
    use std::collections::BTreeMap;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY, WM_USER};

    const WM_WAKE: u32 = WM_APP + 1;
    const ERROR_HOTKEY_ALREADY_REGISTERED: u32 = 1409;
    type Reply = mpsc::Sender<BTreeMap<String, Status>>;
    enum Cmd {
        Set(Vec<(String, Combo)>, Reply),
    }

    pub struct Registrar {
        thread_id: u32,
        tx: Mutex<mpsc::Sender<Cmd>>,
    }

    impl Registrar {
        pub fn start(on_action: Arc<dyn Fn(&str) + Send + Sync>) -> Registrar {
            let (tx, rx) = mpsc::channel::<Cmd>();
            let (ready_tx, ready_rx) = mpsc::channel::<u32>();
            let spawned = std::thread::Builder::new().name("silk-hotkeys".into()).spawn(move || unsafe {
                let mut msg: MSG = std::mem::zeroed();
                // Touching the queue creates it, so PostThreadMessage can reach this thread from the start.
                let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
                let _ = ready_tx.send(GetCurrentThreadId());
                let mut registered: Vec<(i32, String)> = Vec::new();
                while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                    match msg.message {
                        WM_HOTKEY => {
                            let id = msg.wParam.0 as i32;
                            if let Some((_, name)) = registered.iter().find(|(i, _)| *i == id) {
                                on_action(name);
                            }
                        }
                        WM_WAKE => {
                            while let Ok(Cmd::Set(combos, reply)) = rx.try_recv() {
                                for (id, _) in registered.drain(..) {
                                    let _ = UnregisterHotKey(None, id);
                                }
                                let mut out = BTreeMap::new();
                                for (n, (name, c)) in combos.into_iter().enumerate() {
                                    let id = 0x5100 + n as i32;
                                    let mut mods = MOD_NOREPEAT; // holding the keys down fires once
                                    if c.ctrl { mods |= MOD_CONTROL; }
                                    if c.alt { mods |= MOD_ALT; }
                                    if c.shift { mods |= MOD_SHIFT; }
                                    if c.win { mods |= MOD_WIN; }
                                    match RegisterHotKey(None, id, mods, c.vk) {
                                        Ok(()) => {
                                            registered.push((id, name.clone()));
                                            out.insert(name, Status::Active);
                                        }
                                        Err(e) => {
                                            let code = (e.code().0 as u32) & 0xFFFF;
                                            out.insert(name, if code == ERROR_HOTKEY_ALREADY_REGISTERED { Status::InUse } else { Status::Invalid });
                                        }
                                    }
                                }
                                let _ = reply.send(out);
                            }
                        }
                        _ => {}
                    }
                }
                for (id, _) in registered {
                    let _ = UnregisterHotKey(None, id);
                }
            });
            let thread_id = if spawned.is_ok() { ready_rx.recv_timeout(Duration::from_secs(3)).unwrap_or(0) } else { 0 };
            Registrar { thread_id, tx: Mutex::new(tx) }
        }

        /// Replace every registration with exactly this set; reports how each one went.
        pub fn set(&self, combos: Vec<(String, Combo)>) -> BTreeMap<String, Status> {
            let failed = |names: Vec<String>| names.into_iter().map(|n| (n, Status::Invalid)).collect::<BTreeMap<_, _>>();
            let names: Vec<String> = combos.iter().map(|(n, _)| n.clone()).collect();
            if self.thread_id == 0 {
                return failed(names);
            }
            let (rtx, rrx) = mpsc::channel();
            let sent = self.tx.lock().map(|tx| tx.send(Cmd::Set(combos, rtx)).is_ok()).unwrap_or(false);
            if !sent {
                return failed(names);
            }
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_WAKE, WPARAM(0), LPARAM(0));
            }
            rrx.recv_timeout(Duration::from_secs(3)).unwrap_or_else(|_| failed(names))
        }
    }
}

/// Elsewhere (developing on another OS) nothing is registered; the rest of the app still works.
#[cfg(not(windows))]
mod platform {
    use super::{Combo, Status};
    use std::collections::BTreeMap;
    use std::sync::Arc;
    pub struct Registrar;
    impl Registrar {
        pub fn start(_on_action: Arc<dyn Fn(&str) + Send + Sync>) -> Registrar {
            Registrar
        }
        pub fn set(&self, combos: Vec<(String, Combo)>) -> BTreeMap<String, Status> {
            combos.into_iter().map(|(n, _)| (n, Status::Active)).collect()
        }
    }
}

// ------------------------------------------------------------------------------------------ service

struct State {
    enabled: bool,
    bindings: BTreeMap<String, String>,
    suspended: bool,
    status: BTreeMap<String, Status>,
    /// Bumped on every suspend, so an old auto-resume timer can tell it has been superseded.
    generation: u64,
}

pub struct Service {
    reg: platform::Registrar,
    state: Mutex<State>,
}

impl Service {
    pub fn start(on_action: impl Fn(&str) + Send + Sync + 'static) -> Arc<Service> {
        Arc::new(Service {
            reg: platform::Registrar::start(Arc::new(on_action)),
            state: Mutex::new(State { enabled: false, bindings: BTreeMap::new(), suspended: false, status: BTreeMap::new(), generation: 0 }),
        })
    }

    fn refresh(&self, st: &mut State) {
        let resolved = resolve(&st.bindings);
        let live = st.enabled && !st.suspended;
        let combos: Vec<(String, Combo)> = if live {
            resolved.iter().filter_map(|r| match &r.combo { Some(Ok(c)) => Some((r.id.to_string(), *c)), _ => None }).collect()
        } else {
            Vec::new()
        };
        let registered = self.reg.set(combos);
        st.status = resolved
            .iter()
            .map(|r| {
                let s = match &r.combo {
                    None => Status::Off,
                    Some(Err(_)) => Status::Invalid,
                    Some(Ok(_)) if !st.enabled => Status::Disabled,
                    Some(Ok(_)) if st.suspended => Status::Off,
                    Some(Ok(_)) => registered.get(r.id).copied().unwrap_or(Status::Invalid),
                };
                (r.id.to_string(), s)
            })
            .collect();
    }

    /// Make this the full set of hotkeys (`bindings` is the effective map). Returns each action's status.
    pub fn apply(&self, enabled: bool, bindings: &BTreeMap<String, String>) -> BTreeMap<String, Status> {
        let mut st = self.state.lock().unwrap();
        st.enabled = enabled;
        st.bindings = bindings.clone();
        self.refresh(&mut st);
        st.status.clone()
    }

    pub fn status(&self) -> BTreeMap<String, Status> {
        self.state.lock().unwrap().status.clone()
    }

    /// Let the Studio record a new shortcut without the current ones swallowing the key presses. If the Studio
    /// never says it is done (it was closed, or crashed), the hotkeys come back by themselves after 30 s.
    pub fn suspend(self: &Arc<Self>, yes: bool) -> BTreeMap<String, Status> {
        let generation = {
            let mut st = self.state.lock().unwrap();
            st.generation += 1;
            st.suspended = yes;
            self.refresh(&mut st);
            st.generation
        };
        if yes {
            let me = Arc::clone(self);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(30));
                let mut st = me.state.lock().unwrap();
                if st.suspended && st.generation == generation {
                    st.suspended = false;
                    me.refresh(&mut st);
                }
            });
        }
        self.status()
    }
}

// ------------------------------------------------------------------------------------------ tests

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(s: &str) -> Combo {
        let c = parse(s).unwrap_or_else(|e| panic!("{s}: {e}"));
        check_policy(&c).unwrap_or_else(|e| panic!("{s}: {e}"));
        c
    }

    #[test]
    fn parses_any_order_case_and_aliases() {
        let want = Combo { ctrl: true, alt: true, shift: true, win: false, vk: 0x27 };
        assert_eq!(parse("Ctrl+Alt+Shift+Right").unwrap(), want);
        assert_eq!(parse("shift + alt + CONTROL + arrowright").unwrap(), want);
        assert_eq!(parse("Ctrl+Win+F13").unwrap(), Combo { ctrl: true, alt: false, shift: false, win: true, vk: 0x7C });
        assert_eq!(parse("Ctrl+Alt+Numpad5").unwrap().vk, 0x65);
    }

    #[test]
    fn canonical_form_is_stable() {
        assert_eq!(canonical(&parse("shift+ctrl+alt+s").unwrap()), "Ctrl+Alt+Shift+S");
        assert_eq!(canonical(&parse("win+alt+arrowup").unwrap()), "Alt+Win+Up");
        for a in ACTIONS.iter().filter(|a| !a.default.is_empty()) {
            assert_eq!(canonical(&parse(a.default).unwrap()), a.default, "default for {} is not canonical", a.id);
        }
    }

    #[test]
    fn rejects_malformed_shortcuts() {
        for bad in ["", "Ctrl+", "Ctrl+Alt", "Ctrl+Ctrl+A", "Ctrl+A+B", "Ctrl+Alt+Nope", "+A"] {
            assert!(parse(bad).is_err(), "{bad:?} should not parse");
        }
    }

    #[test]
    fn policy_protects_everyday_typing_and_windows() {
        for bad in ["Ctrl+C", "Shift+A", "Alt+F4", "A", "Ctrl+Alt+Delete", "Alt+Tab", "Ctrl+Alt+Tab", "Win+L", "Win+Shift+L", "Ctrl+Win+L"] {
            if let Ok(c) = parse(bad) {
                assert!(check_policy(&c).is_err(), "{bad} must be refused");
            }
        }
        for good in ["Ctrl+Alt+S", "Ctrl+Shift+F9", "Alt+Shift+Left", "Ctrl+Win+Z", "F13", "F24", "Ctrl+F20"] {
            ok(good);
        }
    }

    #[test]
    fn every_default_is_valid_and_unique() {
        let all = defaults();
        let resolved = resolve(&all);
        assert_eq!(resolved.len(), ACTIONS.len());
        for r in resolved {
            if let Some(res) = r.combo {
                assert!(res.is_ok(), "default for {} is refused: {:?}", r.id, res.err());
            }
        }
        let ids: std::collections::HashSet<_> = ACTIONS.iter().map(|x| x.id).collect();
        assert_eq!(ids.len(), ACTIONS.len(), "duplicate action ids");
    }

    #[test]
    fn key_names_are_unique_and_round_trip() {
        let t = key_table();
        let mut names = std::collections::HashSet::new();
        let mut vks = std::collections::HashSet::new();
        for (n, vk) in &t {
            assert!(names.insert(n.to_ascii_lowercase()), "duplicate name {n}");
            assert!(vks.insert(*vk), "duplicate virtual key for {n}");
            assert_eq!(parse(&format!("Ctrl+Alt+{n}")).unwrap().vk, *vk);
        }
    }

    #[test]
    fn stored_bindings_override_defaults_and_empty_means_unbound() {
        let mut stored = BTreeMap::new();
        stored.insert("next".to_string(), "alt+ctrl+shift+n".to_string());
        stored.insert("prev".to_string(), String::new());
        let eff = effective(&stored);
        assert_eq!(eff["next"], "Ctrl+Alt+Shift+N");
        assert_eq!(eff["prev"], "");
        assert_eq!(eff["pause"], "Ctrl+Alt+Shift+Space", "untouched actions keep their default");
        assert_eq!(eff.len(), ACTIONS.len());
    }

    #[test]
    fn duplicates_are_caught_and_the_earlier_action_wins() {
        let mut b = defaults();
        b.insert("prev".into(), b["next"].clone());
        let r = resolve(&b);
        let next = r.iter().find(|x| x.id == "next").unwrap();
        let prev = r.iter().find(|x| x.id == "prev").unwrap();
        assert!(matches!(next.combo, Some(Ok(_))));
        assert!(prev.combo.as_ref().unwrap().as_ref().unwrap_err().contains("Next wallpaper"));
        assert!(resolve_strict(&b).unwrap_err().contains("Previous wallpaper"));
    }

    #[test]
    fn strict_resolution_names_the_problem() {
        let mut b = defaults();
        b.insert("oled".into(), "Ctrl+C".into());
        assert!(resolve_strict(&b).unwrap_err().starts_with("Toggle OLED mode:"));
        b.insert("oled".into(), "Ctrl+Alt+Banana".into());
        assert!(resolve_strict(&b).unwrap_err().contains("Unknown key"));
    }

    #[test]
    fn service_reports_status_for_every_action() {
        let svc = Service::start(|_| {});
        let st = svc.apply(true, &defaults());
        assert_eq!(st.len(), ACTIONS.len());
        assert_eq!(st["profile1"], Status::Off, "unbound actions are Off");
        assert_ne!(st["next"], Status::Off);
        let off = svc.apply(false, &defaults());
        assert_eq!(off["next"], Status::Disabled);
        assert_eq!(off["profile1"], Status::Off);
    }
}
