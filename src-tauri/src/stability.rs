//! Crash handling for an app that runs all day behind the desktop.
//!
//! The release build is compiled with `panic = "abort"`, no symbols and no console, so without this module any internal
//! error would end the app instantly, silently, with nothing to diagnose it from, and leave the desktop wallpaper-less until
//! the next login. Four things change that:
//!
//! 1. A panic hook writes a crash report and a log line before the process ends.
//! 2. A small state file tells the next launch whether the last run ended cleanly and whether it had been up long enough
//!    (60 s) to count as stable, which separates "crashed at startup" from "crashed after a long happy run".
//! 3. After a crash the app restarts itself, at most a few times in a row (`should_relaunch`).
//! 4. After three rapid crashes it starts in SAFE MODE: simple settings (Living Silk, no hotkeys, widgets, audio or theme
//!    sync), with the user's real settings copied aside first so nothing is lost; the Studio offers to put them back.
//!
//! Everything here is a pure function or plain file I/O, so it is tested without Windows; lib.rs only supplies the wiring.

use crate::config::{self, Config};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// A run that lasts this long is "stable": if it later dies, that is not a startup crash.
pub const STABLE_AFTER_SECS: u64 = 60;
/// This many young crashes in a row start the next run in safe mode.
pub const SAFE_MODE_AFTER: u32 = 3;
pub const MAX_LOG_BYTES: u64 = 256 * 1024;
pub const KEEP_CRASH_REPORTS: usize = 5;
const MAX_LINE: usize = 400;
const STATE_FILE: &str = "stability.json";
const LOG_FILE: &str = "silk-engine.log";
const SAFE_BACKUP: &str = "config.before-safe-mode.json";

// ------------------------------------------------------------------------------------------ the state machine

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct RunState {
    /// A run began and has not ended cleanly.
    pub running: bool,
    /// That run survived `STABLE_AFTER_SECS`.
    pub stable: bool,
    /// Consecutive runs that died young.
    pub rapid_crashes: u32,
    pub started_at: u64,
    /// The app is running on safe settings and the user has not yet chosen what to do about it.
    pub safe_mode: bool,
    /// The run ended in a panic (the hook says so). An unclean exit WITHOUT this can simply be a shutdown, a logoff or
    /// the user ending the task, so only this is worth telling the user about.
    pub panicked: bool,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Launch {
    /// The previous run did not end cleanly.
    pub crashed: bool,
    /// ... and it was an actual panic, with a crash report to look at.
    pub panicked: bool,
    pub enter_safe_mode: bool,
}

/// What the state file says when the app starts, and what to write back.
pub fn begin(prev: &RunState, now: u64) -> (RunState, Launch) {
    let crashed = prev.running;
    // A clean previous run, or one that died only after a long healthy stretch, is not a crash loop; a young death counts.
    let mut rapid = if !crashed || prev.stable { 0 } else { prev.rapid_crashes.saturating_add(1) };
    let enter = rapid >= SAFE_MODE_AFTER;
    if enter {
        rapid = 0; // the safe settings are about to be written; the next start is a fresh try
    }
    let next = RunState { running: true, stable: false, rapid_crashes: rapid, started_at: now, safe_mode: prev.safe_mode || enter, panicked: false };
    (next, Launch { crashed, panicked: crashed && prev.panicked, enter_safe_mode: enter })
}

pub fn mark_stable(s: &RunState) -> RunState {
    RunState { stable: true, rapid_crashes: 0, ..s.clone() }
}

pub fn mark_clean_exit(s: &RunState) -> RunState {
    RunState { running: false, stable: false, rapid_crashes: 0, panicked: false, ..s.clone() }
}

/// Called from the panic hook.
pub fn mark_panicked(s: &RunState) -> RunState {
    RunState { panicked: true, ..s.clone() }
}

/// In the panic hook: should the app start itself again? Never while developing, never when no run is recorded, and not
/// beyond the point where safe mode takes over; in safe mode a young crash means giving up rather than looping forever.
pub fn should_relaunch(s: &RunState, debug_build: bool) -> bool {
    if debug_build || !s.running {
        return false;
    }
    if s.safe_mode && !s.stable {
        return false;
    }
    let rapid = if s.stable { 0 } else { s.rapid_crashes.saturating_add(1) };
    rapid <= SAFE_MODE_AFTER
}

// ------------------------------------------------------------------------------------------ safe mode

fn set_text(display: &mut Value, key: &str, value: &str) {
    if !display.is_object() {
        *display = Value::Object(Default::default());
    }
    display[key] = Value::from(value);
}

/// The same settings, made as undemanding as possible: the built-in Living Silk everywhere, no playlist, hotkeys, widgets,
/// audio capture, cursor tracking or theme sync, and eco quality at 30 fps. The library, profiles and favourites are kept.
pub fn safe_config(cfg: &Config) -> Config {
    let mut c = cfg.clone();
    c.assign.clear();
    c.assign.insert("*".into(), "builtin-silk".into());
    c.span = false;
    c.paused = false;
    c.playlist.enabled = false;
    c.hotkeys.enabled = false;
    c.system.audio = false;
    c.system.interactive = false;
    c.system.theme_sync = false;
    set_text(&mut c.display, "quality", "eco");
    set_text(&mut c.display, "fps", "30");
    if !c.widgets.is_object() {
        c.widgets = Value::Object(Default::default());
    }
    c.widgets["enabled"] = Value::Bool(false);
    c.ensure_builtins();
    c
}

pub fn safe_backup_path(dir: &Path) -> PathBuf {
    dir.join(SAFE_BACKUP)
}

/// Copy the user's real settings aside (once: never overwrite them with settings that are already safe), then save the
/// safe ones as the current configuration.
pub fn enter_safe_mode(dir: &Path, cfg: &Config) -> Result<Config, String> {
    if !safe_backup_path(dir).exists() {
        config::backup(dir, cfg, SAFE_BACKUP)?;
    }
    let safe = safe_config(cfg);
    config::save(dir, &safe)?;
    Ok(safe)
}

/// Put the real settings back. The backup is only removed once the restored settings were saved successfully.
pub fn restore_from_safe_mode(dir: &Path) -> Result<Config, String> {
    let path = safe_backup_path(dir);
    let bytes = config::read_bounded(&path).map_err(|_| "There is no backup of your earlier settings".to_string())?;
    let cfg: Config = serde_json::from_slice(&bytes).map_err(|_| "The backup of your earlier settings is damaged".to_string())?;
    config::validate(&cfg)?;
    config::save(dir, &cfg)?;
    let _ = std::fs::remove_file(&path);
    Ok(cfg)
}

/// The user chose to stay on the safe settings: the backup is no longer needed.
pub fn keep_safe_settings(dir: &Path) {
    let _ = std::fs::remove_file(safe_backup_path(dir));
}

// ------------------------------------------------------------------------------------------ the state file

pub fn read_state(dir: &Path) -> RunState {
    match config::read_bounded(&dir.join(STATE_FILE)) {
        Ok(bytes) if bytes.len() < 64 * 1024 => serde_json::from_slice(&bytes).unwrap_or_default(),
        _ => RunState::default(),
    }
}

pub fn write_state(dir: &Path, state: &RunState) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("stability.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(state).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(STATE_FILE)).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------------------------------ time and text helpers

pub fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok().filter(|h| !h.is_empty())
}

/// Days since 1970-01-01 -> (year, month, day), proleptic Gregorian (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// "2026-10-12T10:11:12Z"
pub fn iso8601(unix: u64) -> String {
    let (y, mo, d) = civil_from_days((unix / 86_400) as i64);
    let s = unix % 86_400;
    format!("{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}Z", s / 3_600, s % 3_600 / 60, s % 60)
}

fn compact(unix: u64) -> String {
    iso8601(unix).replace(['-', ':', 'Z'], "").replace('T', "-")
}

fn replace_ci(text: &str, needle: &str, with: &str) -> String {
    if needle.is_empty() {
        return text.to_string();
    }
    let (hay, pat) = (text.to_ascii_lowercase(), needle.to_ascii_lowercase()); // ASCII lowercase keeps every byte offset
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while let Some(i) = hay[at..].find(&pat) {
        out.push_str(&text[at..at + i]);
        out.push_str(with);
        at += i + needle.len();
    }
    out.push_str(&text[at..]);
    out
}

/// One safe, short line: no line breaks, the user's profile folder replaced by `~`, never longer than a few hundred characters.
pub fn sanitize(msg: &str, home: Option<&str>) -> String {
    let mut s: String = msg.chars().map(|c| if matches!(c, '\n' | '\r' | '\t') { ' ' } else { c }).collect();
    if let Some(h) = home.filter(|h| h.chars().count() > 3) {
        s = replace_ci(&s, h, "~");
        s = replace_ci(&s, &h.replace('\\', "/"), "~");
    }
    if s.chars().count() > MAX_LINE {
        s = s.chars().take(MAX_LINE).collect::<String>() + "...";
    }
    s
}

// ------------------------------------------------------------------------------------------ the log

/// Append one line to the log (best effort: logging must never be the reason something fails). Rotates at 256 KB.
pub fn log_line(dir: &Path, now: u64, home: Option<&str>, msg: &str) {
    use std::io::Write;
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join(LOG_FILE);
    if std::fs::metadata(&path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let old = dir.join(format!("{LOG_FILE}.1"));
        let _ = std::fs::remove_file(&old);
        let _ = std::fs::rename(&path, &old);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {}", iso8601(now), sanitize(msg, home));
    }
}

/// The last `n` lines of the log.
pub fn read_log_tail(dir: &Path, n: usize) -> Vec<String> {
    let Ok(bytes) = config::read_bounded(&dir.join(LOG_FILE)) else { return Vec::new() };
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..].iter().map(|l| l.to_string()).collect()
}

// ------------------------------------------------------------------------------------------ crash reports

pub struct CrashInfo<'a> {
    pub version: &'a str,
    pub os: &'a str,
    pub thread: &'a str,
    pub message: &'a str,
    pub location: &'a str,
    pub backtrace: &'a str,
}

pub fn format_report(info: &CrashInfo, now: u64, home: Option<&str>) -> String {
    let bt: String = info.backtrace.chars().take(8_000).collect();
    format!(
        "Silk Engine crash report\nVersion: {}\nPlatform: {}\nTime (UTC): {}\nThread: {}\nMessage: {}\nLocation: {}\n\nBacktrace:\n{}\n",
        info.version,
        info.os,
        iso8601(now),
        sanitize(info.thread, home),
        sanitize(info.message, home),
        sanitize(info.location, home),
        bt.lines().map(|l| sanitize(l, home)).collect::<Vec<_>>().join("\n")
    )
}

fn crash_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with("crash-") && n.ends_with(".txt")).collect())
        .unwrap_or_default();
    names.sort();
    names
}

/// Newest first.
pub fn list_crash_reports(dir: &Path) -> Vec<String> {
    let mut v = crash_files(dir);
    v.reverse();
    v
}

/// Save a report and keep only the newest few.
pub fn write_crash_report(dir: &Path, now: u64, info: &CrashInfo, home: Option<&str>) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let base = format!("crash-{}", compact(now));
    let mut path = dir.join(format!("{base}.txt"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base}-{n}.txt"));
        n += 1;
    }
    std::fs::write(&path, format_report(info, now, home)).map_err(|e| e.to_string())?;
    let all = crash_files(dir);
    for old in all.iter().take(all.len().saturating_sub(KEEP_CRASH_REPORTS)) {
        let _ = std::fs::remove_file(dir.join(old));
    }
    Ok(path)
}

fn payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "(no message)".into()
    }
}

/// From now on a panic leaves a crash report and a log line, and (in a release build, when allowed) starts the app again.
/// Nothing in the hook may panic or block: the process is about to end.
pub fn install_panic_hook(dir: PathBuf, version: &'static str, home: Option<String>) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let now = unix_now();
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed");
        let message = payload_message(info.payload());
        let location = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_default();
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let crash = CrashInfo { version, os: std::env::consts::OS, thread: name, message: &message, location: &location, backtrace: &backtrace };
        let _ = write_crash_report(&dir, now, &crash, home.as_deref());
        log_line(&dir, now, home.as_deref(), &format!("PANIC in thread {name}: {message} at {location}"));
        let state = read_state(&dir);
        let _ = write_state(&dir, &mark_panicked(&state));
        if should_relaunch(&state, cfg!(debug_assertions)) {
            relaunch();
        }
        previous(info);
    }));
}

/// Start a fresh copy that waits a few seconds first (main.rs), so the dying process has released the single-instance lock.
#[cfg(windows)]
fn relaunch() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new(exe).args(["--hidden", "--relaunch"]).creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS).spawn();
    }
}

#[cfg(not(windows))]
fn relaunch() {}

// ------------------------------------------------------------------------------------------ tests

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("silk-stability-{name}-{}-{}", std::process::id(), unix_now()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn running(rapid: u32, stable: bool) -> RunState {
        RunState { running: true, stable, rapid_crashes: rapid, started_at: 1, safe_mode: false, panicked: false }
    }

    // ---- state machine
    #[test]
    fn a_first_launch_and_a_launch_after_a_clean_exit_are_just_launches() {
        let (s, l) = begin(&RunState::default(), 100);
        assert_eq!(l, Launch { crashed: false, panicked: false, enter_safe_mode: false });
        assert!(s.running && !s.stable && s.rapid_crashes == 0 && s.started_at == 100);
        let clean = mark_clean_exit(&s);
        let (_, l2) = begin(&clean, 200);
        assert!(!l2.crashed && !l2.enter_safe_mode);
    }
    #[test]
    fn dying_young_counts_and_three_in_a_row_enter_safe_mode() {
        let (s1, l1) = begin(&running(0, false), 10);
        assert!(l1.crashed && !l1.enter_safe_mode && s1.rapid_crashes == 1);
        let (s2, l2) = begin(&running(1, false), 20);
        assert!(l2.crashed && !l2.enter_safe_mode && s2.rapid_crashes == 2);
        let (s3, l3) = begin(&running(2, false), 30);
        assert!(l3.enter_safe_mode, "the third young crash in a row starts safe mode");
        assert!(s3.safe_mode && s3.rapid_crashes == 0, "and the next start is a fresh try");
    }
    #[test]
    fn a_crash_after_a_long_healthy_run_is_not_a_crash_loop() {
        let (s, l) = begin(&running(2, true), 10);
        assert!(l.crashed && !l.enter_safe_mode);
        assert_eq!(s.rapid_crashes, 0);
    }
    #[test]
    fn staying_up_resets_the_count_and_a_clean_exit_resets_everything() {
        let s = mark_stable(&running(2, false));
        assert!(s.stable && s.rapid_crashes == 0 && s.running);
        let c = mark_clean_exit(&s);
        assert!(!c.running && !c.stable && c.rapid_crashes == 0);
    }
    #[test]
    fn safe_mode_stays_flagged_until_the_user_decides() {
        let prev = RunState { safe_mode: true, ..RunState::default() };
        let (s, _) = begin(&prev, 5);
        assert!(s.safe_mode, "a later launch must not forget that safe settings are in force");
        assert!(mark_clean_exit(&mark_stable(&s)).safe_mode);
    }
    #[test]
    fn only_a_real_panic_is_reported_to_the_user() {
        let died = running(0, true); // ended unclean after a long run: could be a shutdown or a logoff
        assert!(!begin(&died, 5).1.panicked, "an unclean exit alone is not worth a warning");
        let panicked = mark_panicked(&died);
        let (next, launch) = begin(&panicked, 6);
        assert!(launch.crashed && launch.panicked);
        assert!(!next.panicked, "and it is reported once, not on every later launch");
        assert!(!begin(&mark_clean_exit(&panicked), 7).1.panicked, "a clean exit clears it");
        assert!(!begin(&RunState { panicked: true, running: false, ..RunState::default() }, 8).1.panicked, "a stale flag without an unclean run means nothing");
    }
    #[test]
    fn relaunch_rules() {
        assert!(!should_relaunch(&running(0, false), true), "never while developing");
        assert!(!should_relaunch(&RunState::default(), false), "no run is recorded");
        assert!(should_relaunch(&running(0, false), false), "first young crash");
        assert!(should_relaunch(&running(2, false), false), "the third young crash still restarts (and then safe mode takes over)");
        assert!(!should_relaunch(&running(3, false), false), "beyond that, stop");
        assert!(should_relaunch(&running(9, true), false), "a crash after a long run always restarts");
        let safe = RunState { safe_mode: true, ..running(0, false) };
        assert!(!should_relaunch(&safe, false), "dying young in safe mode: give up, do not loop");
        assert!(should_relaunch(&RunState { stable: true, ..safe }, false), "but a stable safe-mode run that later dies restarts");
    }
    #[test]
    fn a_program_that_crashes_on_every_start_restarts_a_bounded_number_of_times() {
        // simulate the worst case: every run dies young
        let mut state = RunState::default();
        let (mut relaunches, mut safe_runs) = (0, 0);
        for i in 0..50u64 {
            let (next, launch) = begin(&state, i * 10);
            state = next;
            if launch.enter_safe_mode { safe_runs += 1; }
            if should_relaunch(&state, false) { relaunches += 1 } else { break; } // the panic hook decides
        }
        assert!(relaunches <= 5, "{relaunches} relaunches is not bounded");
        assert_eq!(safe_runs, 1, "safe mode is tried once, then the app stops");
    }
    #[test]
    fn state_survives_garbage_and_round_trips() {
        let d = tmp("state");
        assert_eq!(read_state(&d), RunState::default(), "missing file");
        std::fs::write(d.join(STATE_FILE), b"\xff\xfe not json").unwrap();
        assert_eq!(read_state(&d), RunState::default(), "garbage");
        std::fs::write(d.join(STATE_FILE), vec![b'a'; 100_000]).unwrap();
        assert_eq!(read_state(&d), RunState::default(), "oversized");
        let s = RunState { running: true, stable: true, rapid_crashes: 2, started_at: 77, safe_mode: true, panicked: true };
        write_state(&d, &s).unwrap();
        assert_eq!(read_state(&d), s);
        std::fs::write(d.join(STATE_FILE), br#"{"running":true,"someFutureField":1}"#).unwrap();
        assert!(read_state(&d).running, "unknown fields from a newer version are ignored");
    }

    // ---- safe mode
    fn sample_config() -> Config {
        let mut c = Config::default();
        c.ensure_builtins();
        c.assign.insert("*".into(), "builtin-life".into());
        c.assign.insert("MON2".into(), "builtin-fluid".into());
        c.span = true;
        c.paused = true;
        c.playlist.enabled = true;
        c.system.audio = true;
        c.system.interactive = true;
        c.system.theme_sync = true;
        c.system.start_with_windows = true;
        c.hotkeys.bindings.insert("next".into(), "Ctrl+Alt+Shift+N".into());
        c.favorites.push("builtin-life".into());
        c
    }
    #[test]
    fn safe_settings_are_as_undemanding_as_possible_and_still_valid() {
        let safe = safe_config(&sample_config());
        assert_eq!(safe.assign.len(), 1);
        assert_eq!(safe.assign["*"], "builtin-silk");
        assert!(!safe.span && !safe.paused && !safe.playlist.enabled && !safe.hotkeys.enabled);
        assert!(!safe.system.audio && !safe.system.interactive && !safe.system.theme_sync);
        assert_eq!(safe.display["quality"], "eco");
        assert_eq!(safe.display["fps"], "30");
        assert_eq!(safe.widgets["enabled"], false);
        assert!(safe.item("builtin-silk").is_some());
        config::validate(&safe).expect("safe settings must always be valid");
    }
    #[test]
    fn safe_mode_keeps_what_belongs_to_the_user() {
        let c = sample_config();
        let safe = safe_config(&c);
        assert_eq!(safe.items.len(), c.items.len());
        assert_eq!(safe.favorites, c.favorites);
        assert_eq!(safe.hotkeys.bindings, c.hotkeys.bindings, "custom shortcuts are kept, just switched off");
        assert!(safe.system.start_with_windows, "it must still start at login");
    }
    #[test]
    fn safe_settings_cope_with_broken_values() {
        let mut c = sample_config();
        c.display = Value::Null;
        c.widgets = Value::Array(vec![]);
        let safe = safe_config(&c);
        assert_eq!(safe.display["quality"], "eco");
        assert_eq!(safe.widgets["enabled"], false);
        config::validate(&safe).unwrap();
        assert_eq!(safe_config(&safe), safe, "applying it twice changes nothing");
    }
    #[test]
    fn entering_safe_mode_backs_up_once_and_never_overwrites_the_real_settings() {
        let d = tmp("enter");
        let real = sample_config();
        let safe = enter_safe_mode(&d, &real).unwrap();
        assert_eq!(config::load(&d).assign["*"], "builtin-silk", "the safe settings are now current");
        assert!(safe_backup_path(&d).exists());
        let kept = std::fs::read(safe_backup_path(&d)).unwrap();
        enter_safe_mode(&d, &safe).unwrap(); // a second entry, with settings that are already safe
        assert_eq!(std::fs::read(safe_backup_path(&d)).unwrap(), kept, "the backup of the real settings is untouched");
    }
    #[test]
    fn restoring_brings_back_exactly_the_real_settings_and_removes_the_backup() {
        let d = tmp("restore");
        let real = sample_config();
        enter_safe_mode(&d, &real).unwrap();
        let back = restore_from_safe_mode(&d).unwrap();
        assert_eq!(back, real);
        assert_eq!(config::load(&d), real);
        assert!(!safe_backup_path(&d).exists());
    }
    #[test]
    fn restoring_fails_clearly_when_the_backup_is_missing_or_damaged() {
        let d = tmp("restore-bad");
        assert!(restore_from_safe_mode(&d).unwrap_err().contains("no backup"));
        std::fs::write(safe_backup_path(&d), b"{ nope").unwrap();
        assert!(restore_from_safe_mode(&d).unwrap_err().contains("damaged"));
        assert!(safe_backup_path(&d).exists(), "a damaged backup is not deleted: it may still be recoverable by hand");
    }
    #[test]
    fn keeping_the_safe_settings_discards_the_backup() {
        let d = tmp("keep");
        enter_safe_mode(&d, &sample_config()).unwrap();
        keep_safe_settings(&d);
        assert!(!safe_backup_path(&d).exists());
        keep_safe_settings(&d); // and doing it again is harmless
    }

    // ---- time and text
    #[test]
    fn dates_are_right_across_leap_years_and_centuries() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(951_782_400), "2000-02-29T00:00:00Z", "2000 is a leap year");
        assert_eq!(iso8601(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601(1_709_164_800), "2024-02-29T00:00:00Z");
        assert_eq!(iso8601(1_709_251_200), "2024-03-01T00:00:00Z");
        assert_eq!(iso8601(4_102_444_800), "2100-01-01T00:00:00Z");
        assert_eq!(iso8601(4_107_542_400), "2100-03-01T00:00:00Z", "2100 is not a leap year");
        assert_eq!(iso8601(86_399), "1970-01-01T23:59:59Z");
        assert_eq!(compact(1_700_000_000), "20231114-221320");
    }
    #[test]
    fn log_lines_are_single_short_and_free_of_the_users_folder() {
        assert_eq!(sanitize("a\nb\r\nc\td", None), "a b  c d");
        let msg = r"Could not open C:\Users\Rajveer\Videos\clip.mp4 and c:/users/rajveer/other.mp4";
        let clean = sanitize(msg, Some(r"C:\Users\Rajveer"));
        assert!(!clean.to_lowercase().contains("rajveer"), "{clean}");
        assert!(clean.contains(r"~\Videos\clip.mp4") && clean.contains("~/other.mp4"));
        let long = sanitize(&"é".repeat(1_000), None);
        assert!(long.chars().count() <= MAX_LINE + 3 && long.ends_with("..."), "truncates on a character boundary");
        assert_eq!(sanitize("abc", Some("")), "abc");
        assert_eq!(sanitize("C:\\ x", Some("C:\\")), "C:\\ x", "a home that short is ignored rather than eating every path");
    }
    #[test]
    fn the_log_appends_rotates_and_reads_back_its_tail() {
        let d = tmp("log");
        assert!(read_log_tail(&d, 5).is_empty());
        for i in 0..8 { log_line(&d, 1_700_000_000 + i, None, &format!("event {i}")); }
        let tail = read_log_tail(&d, 3);
        assert_eq!(tail.len(), 3);
        assert!(tail[2].ends_with("event 7") && tail[2].starts_with("2023-11-14T22:13:27Z"));
        assert_eq!(read_log_tail(&d, 100).len(), 8);
        let big = "x".repeat(MAX_LINE);
        for _ in 0..800 { log_line(&d, 1_700_000_100, None, &big); }
        assert!(d.join("silk-engine.log.1").exists(), "rotated once it passed the limit");
        assert!(std::fs::metadata(d.join(LOG_FILE)).unwrap().len() <= MAX_LOG_BYTES + 1024);
        assert!(!read_log_tail(&d, 2).is_empty());
    }
    #[test]
    fn logging_never_fails_loudly() {
        let d = tmp("log-fail");
        std::fs::write(d.join("blocker"), b"a file, not a folder").unwrap();
        log_line(&d.join("blocker").join("inside"), 1, None, "this cannot be written"); // must simply do nothing
        assert!(read_log_tail(&d.join("nowhere"), 5).is_empty());
    }

    // ---- crash reports
    fn info<'a>(msg: &'a str, loc: &'a str, bt: &'a str) -> CrashInfo<'a> {
        CrashInfo { version: "1.0.0", os: "windows", thread: "silk-hotkeys", message: msg, location: loc, backtrace: bt }
    }
    #[test]
    fn a_crash_report_has_what_you_need_and_nothing_private() {
        let r = format_report(&info(r"index out of bounds at C:\Users\Rajveer\x", "src/lib.rs:10:5", "frame 0\nframe 1 C:\\Users\\Rajveer\\app"), 1_700_000_000, Some(r"C:\Users\Rajveer"));
        for needle in ["Silk Engine crash report", "Version: 1.0.0", "Platform: windows", "2023-11-14T22:13:20Z", "Thread: silk-hotkeys", "src/lib.rs:10:5", "Backtrace:", "frame 0"] {
            assert!(r.contains(needle), "missing {needle}");
        }
        assert!(!r.to_lowercase().contains("rajveer"), "{r}");
    }
    #[test]
    fn only_the_newest_crash_reports_are_kept_and_listed_newest_first() {
        let d = tmp("crashes");
        for i in 0..9u64 { write_crash_report(&d, 1_700_000_000 + i * 100, &info("boom", "x", ""), None).unwrap(); }
        let names = list_crash_reports(&d);
        assert_eq!(names.len(), KEEP_CRASH_REPORTS);
        assert!(names[0] > names[1] && names[1] > names[4], "newest first: {names:?}");
        assert_eq!(names[0], "crash-20231114-222640.txt", "1_700_000_000 + 8 x 100 s = 22:26:40 UTC");
        assert!(std::fs::read_to_string(d.join(&names[0])).unwrap().contains("boom"));
    }
    #[test]
    fn two_crashes_in_the_same_second_do_not_overwrite_each_other() {
        let d = tmp("crashes-same");
        let a = write_crash_report(&d, 1_700_000_000, &info("first", "x", ""), None).unwrap();
        let b = write_crash_report(&d, 1_700_000_000, &info("second", "x", ""), None).unwrap();
        assert_ne!(a, b);
        assert!(std::fs::read_to_string(a).unwrap().contains("first") && std::fs::read_to_string(b).unwrap().contains("second"));
        assert_eq!(list_crash_reports(&d).len(), 2);
    }
    #[test]
    fn the_panic_message_is_found_whatever_type_it_is() {
        let s: Box<dyn std::any::Any + Send> = Box::new("static text");
        assert_eq!(payload_message(&*s), "static text");
        let o: Box<dyn std::any::Any + Send> = Box::new(String::from("owned text"));
        assert_eq!(payload_message(&*o), "owned text");
        let n: Box<dyn std::any::Any + Send> = Box::new(42u8);
        assert_eq!(payload_message(&*n), "(no message)");
    }
}
