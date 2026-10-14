//! The island's media card: what is playing (any app that shows up in Windows' media flyout: Spotify, a browser, VLC, Media
//! Player...), with its artwork, progress and controls.
//!
//! It uses the system media session API. Calls run on a short-lived worker thread with COM set up for it, and anything can be
//! missing (no player open, no artwork, a live stream with no length, a player that cannot skip): a missing piece means the
//! card shows less, never an error. Artwork is read only when the track changes and is kept, so polling stays cheap.
//! The pure parts (track ids, app names, the position arithmetic, base64) are tested without Windows.

use serde::Serialize;

/// Artwork larger than this is not sent to the interface.
pub const MAX_THUMB_BYTES: u64 = 3 * 1024 * 1024;
/// Windows counts time in 100-nanosecond ticks.
const TICKS_PER_SEC: f64 = 10_000_000.0;
/// Seconds between 1601-01-01 (the Windows epoch) and 1970-01-01.
const WINDOWS_TO_UNIX_SECS: u64 = 11_644_473_600;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    /// Something is open in a media player.
    pub active: bool,
    /// A readable name for the app ("Spotify").
    pub app: String,
    pub source_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// "playing" | "paused" | "stopped"
    pub status: String,
    /// Seconds into the track right now, and its length (0 for a live stream).
    pub position: f64,
    pub duration: f64,
    pub can_prev: bool,
    pub can_next: bool,
    pub can_toggle: bool,
    pub can_seek: bool,
    /// Identifies the artwork: it changes when the track does. Empty if there is no track.
    pub thumb_id: String,
}

// ---------------------------------------------------------------------------------------------- pure helpers

/// A short, stable identifier for a track (FNV-1a over title, artist and album), so the interface fetches artwork only when it changes.
pub fn thumb_id(title: &str, artist: &str, album: &str) -> String {
    if title.is_empty() && artist.is_empty() && album.is_empty() {
        return String::new();
    }
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for part in [title, artist, album] {
        for b in part.bytes().chain(std::iter::once(0)) {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    format!("{h:016x}")
}

/// Standard base64 with padding (RFC 4648), for the artwork data URL.
pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// "Spotify.exe", "chrome.exe", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" -> a name a person would say.
pub fn app_label(aumid: &str) -> String {
    let first = aumid.split('!').next().unwrap_or("");
    let file = first.rsplit(['\\', '/']).next().unwrap_or("");
    let no_ext = if file.to_ascii_lowercase().ends_with(".exe") { &file[..file.len() - 4] } else { file };
    let package = no_ext.split('_').next().unwrap_or("");
    let name = package.rsplit('.').next().unwrap_or("");
    let lower = name.to_ascii_lowercase();
    for (needle, label) in [
        ("spotify", "Spotify"), ("msedge", "Microsoft Edge"), ("edge", "Microsoft Edge"), ("chrome", "Google Chrome"), ("firefox", "Firefox"),
        ("brave", "Brave"), ("opera", "Opera"), ("vlc", "VLC"), ("zunemusic", "Media Player"), ("mediaplayer", "Media Player"), ("zunevideo", "Movies & TV"),
        ("applemusic", "Apple Music"), ("itunes", "iTunes"), ("tidal", "TIDAL"), ("deezer", "Deezer"), ("youtubemusic", "YouTube Music"),
        ("amazonmusic", "Amazon Music"), ("foobar", "foobar2000"), ("musicbee", "MusicBee"), ("winamp", "Winamp"), ("potplayer", "PotPlayer"), ("mpv", "mpv"),
    ] {
        if lower.contains(needle) {
            return label.to_string();
        }
    }
    if name.is_empty() {
        return String::new();
    }
    if name.chars().any(|c| c.is_uppercase()) {
        return name.to_string();
    }
    let mut c = name.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// The playback status code Windows reports, as the word the interface uses.
pub fn status_name(code: i32) -> &'static str {
    match code {
        4 => "playing",
        5 => "paused",
        _ => "stopped", // closed, opened, changing, stopped
    }
}

pub fn ticks_to_secs(ticks: i64) -> f64 {
    ticks as f64 / TICKS_PER_SEC
}

pub fn secs_to_ticks(secs: f64) -> i64 {
    if secs.is_finite() { (secs.max(0.0) * TICKS_PER_SEC).round() as i64 } else { 0 }
}

/// "Now" in Windows ticks (100 ns since 1601), the unit the timeline's "last updated" uses.
pub fn now_windows_ticks() -> i64 {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    ((d.as_secs() + WINDOWS_TO_UNIX_SECS) as i128 * 10_000_000 + (d.subsec_nanos() / 100) as i128) as i64
}

/// Where the track is right now. Players report the position at some moment (`last_updated`) and expect you to add the time
/// that has passed since, while it is playing. The result stays inside the track (`start..=end`); a live stream (no end) only
/// has a lower bound.
pub fn live_position_ticks(position: i64, last_updated: i64, now: i64, playing: bool, start: i64, end: i64) -> i64 {
    let mut p = position;
    if playing && last_updated > 0 && now > last_updated {
        p = p.saturating_add(now - last_updated);
    }
    if end > start { p.clamp(start, end) } else { p.max(start) }
}

/// What the interface may ask the player to do. A fixed list: it names an action, never anything else.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Control {
    Previous,
    Next,
    Toggle,
    Play,
    Pause,
    Seek(f64),
}

pub fn parse_control(action: &str, value: f64) -> Option<Control> {
    Some(match action {
        "prev" => Control::Previous,
        "next" => Control::Next,
        "toggle" => Control::Toggle,
        "play" => Control::Play,
        "pause" => Control::Pause,
        "seek" if value.is_finite() && (0.0..=86_400.0 * 7.0).contains(&value) => Control::Seek(value),
        _ => return None,
    })
}

// ---------------------------------------------------------------------------------------------- Windows

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use windows::core::Interface;
    use windows::Media::Control::{GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager};
    use windows::Storage::Streams::{DataReader, IInputStream};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    fn on_worker<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
        std::thread::spawn(move || {
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok().map_err(|e| e.to_string())?;
            let r = f();
            unsafe { CoUninitialize() };
            r
        })
        .join()
        .map_err(|_| "The media call failed".to_string())?
    }

    fn session() -> Result<Option<Session>, String> {
        let manager = Manager::RequestAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
        Ok(manager.GetCurrentSession().ok())
    }

    /// The artwork of the current track, as a data URL, if there is one and it is a sensible size.
    fn read_thumbnail(session: &Session) -> Option<String> {
        let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let reference = props.Thumbnail().ok()?;
        let stream = reference.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > MAX_THUMB_BYTES {
            return None;
        }
        let input: IInputStream = stream.cast().ok()?;
        let reader = DataReader::CreateDataReader(&input).ok()?;
        reader.LoadAsync(size as u32).ok()?.join().ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;
        let mime = stream.ContentType().ok().map(|h| h.to_string()).filter(|m| m.starts_with("image/")).unwrap_or_else(|| "image/png".into());
        Some(format!("data:{mime};base64,{}", base64(&buf)))
    }

    /// The last artwork read, with the track it belongs to: asking again for the same track costs nothing.
    static CACHE: Mutex<Option<(String, Option<String>, Instant)>> = Mutex::new(None);

    pub fn state() -> Result<MediaState, String> {
        on_worker(|| {
            let Some(s) = session()? else { return Ok(MediaState::default()) };
            let props = s.TryGetMediaPropertiesAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
            let (title, artist, album) = (props.Title().map(|h| h.to_string()).unwrap_or_default(), props.Artist().map(|h| h.to_string()).unwrap_or_default(), props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default());
            let info = s.GetPlaybackInfo().map_err(|e| e.to_string())?;
            let playing_code = info.PlaybackStatus().map(|p| p.0).unwrap_or(0);
            let status = status_name(playing_code);
            let controls = info.Controls().ok();
            let flag = |f: &dyn Fn(&windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackControls) -> windows::core::Result<bool>| controls.as_ref().and_then(|c| f(c).ok()).unwrap_or(false);
            let (mut position, mut duration) = (0.0, 0.0);
            if let Ok(tl) = s.GetTimelineProperties() {
                let start = tl.StartTime().map(|t| t.Duration).unwrap_or(0);
                let end = tl.EndTime().map(|t| t.Duration).unwrap_or(0);
                let pos = tl.Position().map(|t| t.Duration).unwrap_or(0);
                let updated = tl.LastUpdatedTime().map(|t| t.UniversalTime).unwrap_or(0);
                let live = live_position_ticks(pos, updated, now_windows_ticks(), status == "playing", start, end);
                position = ticks_to_secs(live - start);
                duration = if end > start { ticks_to_secs(end - start) } else { 0.0 };
            }
            Ok(MediaState {
                active: true,
                app: s.SourceAppUserModelId().map(|h| app_label(&h.to_string())).unwrap_or_default(),
                source_id: s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default(),
                thumb_id: thumb_id(&title, &artist, &album),
                title,
                artist,
                album,
                status: status.into(),
                position,
                duration,
                can_prev: flag(&|c| c.IsPreviousEnabled()),
                can_next: flag(&|c| c.IsNextEnabled()),
                can_toggle: flag(&|c| c.IsPlayEnabled()) || flag(&|c| c.IsPauseEnabled()),
                can_seek: flag(&|c| c.IsPlaybackPositionEnabled()) && duration > 0.0,
            })
        })
    }

    pub fn thumbnail(id: &str) -> Option<String> {
        if let Some((cached_id, art, at)) = CACHE.lock().ok()?.as_ref() {
            if cached_id == id && (art.is_some() || at.elapsed() < Duration::from_secs(3)) {
                return art.clone();
            }
        }
        let id = id.to_string();
        let art = on_worker(move || {
            let Some(s) = session()? else { return Ok(None) };
            let props = s.TryGetMediaPropertiesAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
            let now = thumb_id(&props.Title().map(|h| h.to_string()).unwrap_or_default(), &props.Artist().map(|h| h.to_string()).unwrap_or_default(), &props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default());
            if now != id {
                return Ok(None); // the track changed while asking: the next poll will ask again
            }
            let art = read_thumbnail(&s);
            if let Ok(mut c) = CACHE.lock() {
                *c = Some((now, art.clone(), Instant::now()));
            }
            Ok(art)
        })
        .ok()?;
        art
    }

    pub fn open(expected_id: String, expected_source: String) -> Result<(), String> {
        on_worker(move || {
            let Some(s) = session()? else { return Err("Nothing is playing".into()) };
            let props = s.TryGetMediaPropertiesAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
            let title = props.Title().map(|v| v.to_string()).unwrap_or_default();
            let artist = props.Artist().map(|v| v.to_string()).unwrap_or_default();
            let album = props.AlbumTitle().map(|v| v.to_string()).unwrap_or_default();
            if thumb_id(&title, &artist, &album) != expected_id { return Err("The media changed. Try again.".into()); }
            let source = s.SourceAppUserModelId().map_err(|e| e.to_string())?.to_string();
            if source != expected_source { return Err("The media source changed. Try again.".into()); }
            crate::media_window::focus(&app_label(&source), &title)
        })
    }

    pub fn control(c: Control) -> Result<(), String> {
        on_worker(move || {
            let Some(s) = session()? else { return Err("Nothing is playing".into()) };
            let ok = match c {
                Control::Previous => s.TrySkipPreviousAsync(),
                Control::Next => s.TrySkipNextAsync(),
                Control::Toggle => s.TryTogglePlayPauseAsync(),
                Control::Play => s.TryPlayAsync(),
                Control::Pause => s.TryPauseAsync(),
                Control::Seek(secs) => {
                    let start = s.GetTimelineProperties().ok().and_then(|t| t.StartTime().ok()).map(|t| t.Duration).unwrap_or(0);
                    s.TryChangePlaybackPositionAsync(start + secs_to_ticks(secs))
                }
            }
            .map_err(|e| e.to_string())?
            .join()
            .map_err(|e| e.to_string())?;
            if ok { Ok(()) } else { Err("The player did not accept that".into()) }
        })
    }
}

#[cfg(windows)]
pub use win::{control, open, state, thumbnail};

#[cfg(not(windows))]
pub fn state() -> Result<MediaState, String> {
    Ok(MediaState::default())
}
#[cfg(not(windows))]
pub fn thumbnail(_: &str) -> Option<String> {
    None
}
#[cfg(not(windows))]
pub fn control(_: Control) -> Result<(), String> {
    Err("Only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_rfc_4648_test_vectors() {
        for (input, want) in [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")] {
            assert_eq!(base64(input.as_bytes()), want, "{input:?}");
        }
    }
    #[test]
    fn base64_handles_binary_data_of_every_length() {
        assert_eq!(base64(&[0xff, 0xfe, 0xfd]), "//79");
        assert_eq!(base64(&[0, 0, 0]), "AAAA");
        assert_eq!(base64(&[0xfb, 0xff]), "+/8=");
        for n in 0..64usize {
            let data: Vec<u8> = (0..n).map(|i| (i * 37 + 11) as u8).collect();
            let s = base64(&data);
            assert_eq!(s.len(), n.div_ceil(3) * 4, "length {n}");
            assert!(s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/' || c == b'='));
        }
    }
    #[test]
    fn a_track_id_is_stable_and_changes_with_any_part_of_the_track() {
        let a = thumb_id("Midnight City", "M83", "Hurry Up, We're Dreaming");
        assert_eq!(a, thumb_id("Midnight City", "M83", "Hurry Up, We're Dreaming"));
        assert_eq!(a.len(), 16);
        for other in [thumb_id("Midnight Cit", "M83", "Hurry Up, We're Dreaming"), thumb_id("Midnight City", "M84", "Hurry Up, We're Dreaming"), thumb_id("Midnight City", "M83", "")] {
            assert_ne!(a, other);
        }
    }
    #[test]
    fn moving_text_between_fields_makes_a_different_track() {
        assert_ne!(thumb_id("ab", "c", ""), thumb_id("a", "bc", ""), "the fields are separated, not just joined");
    }
    #[test]
    fn no_track_means_no_id() {
        assert_eq!(thumb_id("", "", ""), "");
        assert_ne!(thumb_id("x", "", ""), "");
    }
    #[test]
    fn app_names_are_readable() {
        for (aumid, want) in [
            ("Spotify.exe", "Spotify"), ("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Spotify"), ("chrome.exe", "Google Chrome"), ("msedge.exe", "Microsoft Edge"),
            ("firefox.exe", "Firefox"), ("vlc.exe", "VLC"), ("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", "Media Player"), ("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App", "Apple Music"),
            ("C:\\Program Files\\Foo\\myplayer.exe", "Myplayer"), ("MyPlayer.exe", "MyPlayer"), ("", ""),
        ] {
            assert_eq!(app_label(aumid), want, "{aumid:?}");
        }
    }
    #[test]
    fn playback_codes_map_to_three_words() {
        assert_eq!(status_name(4), "playing");
        assert_eq!(status_name(5), "paused");
        for code in [0, 1, 2, 3, 99, -1] {
            assert_eq!(status_name(code), "stopped", "{code}");
        }
    }
    #[test]
    fn ticks_and_seconds_convert_both_ways() {
        assert_eq!(ticks_to_secs(10_000_000), 1.0);
        assert_eq!(ticks_to_secs(15_000_000), 1.5);
        assert_eq!(secs_to_ticks(1.5), 15_000_000);
        assert_eq!(secs_to_ticks(-5.0), 0);
        assert_eq!(secs_to_ticks(f64::NAN), 0);
        assert_eq!(secs_to_ticks(f64::INFINITY), 0);
        assert_eq!(ticks_to_secs(secs_to_ticks(123.4)), 123.4);
    }
    #[test]
    fn the_windows_clock_is_after_the_year_2020() {
        let ticks_2020 = (1_577_836_800u64 + WINDOWS_TO_UNIX_SECS) as i64 * 10_000_000;
        assert!(now_windows_ticks() > ticks_2020);
    }
    const S: i64 = 10_000_000;
    #[test]
    fn a_playing_track_moves_on_by_the_time_since_the_player_last_reported() {
        assert_eq!(live_position_ticks(30 * S, 100 * S, 105 * S, true, 0, 200 * S), 35 * S);
    }
    #[test]
    fn a_paused_track_stays_where_it_is() {
        assert_eq!(live_position_ticks(30 * S, 100 * S, 105 * S, false, 0, 200 * S), 30 * S);
    }
    #[test]
    fn the_position_never_leaves_the_track() {
        assert_eq!(live_position_ticks(199 * S, 100 * S, 150 * S, true, 0, 200 * S), 200 * S, "cannot pass the end");
        assert_eq!(live_position_ticks(-5 * S, 0, 0, true, 0, 200 * S), 0, "cannot be before the start");
        assert_eq!(live_position_ticks(50 * S, 100 * S, 105 * S, true, 40 * S, 60 * S), 55 * S, "a track that starts at 40 s");
    }
    #[test]
    fn an_unknown_report_time_or_a_clock_that_went_back_adds_nothing() {
        assert_eq!(live_position_ticks(30 * S, 0, 105 * S, true, 0, 200 * S), 30 * S);
        assert_eq!(live_position_ticks(30 * S, 110 * S, 105 * S, true, 0, 200 * S), 30 * S);
    }
    #[test]
    fn a_live_stream_has_no_end_but_still_moves() {
        assert_eq!(live_position_ticks(30 * S, 100 * S, 110 * S, true, 0, 0), 40 * S);
        assert_eq!(live_position_ticks(i64::MAX - 1, 1, i64::MAX, true, 0, 0), i64::MAX, "huge values do not overflow");
    }
    #[test]
    fn only_named_actions_are_accepted_and_a_seek_needs_a_sane_time() {
        assert_eq!(parse_control("prev", 0.0), Some(Control::Previous));
        assert_eq!(parse_control("next", 0.0), Some(Control::Next));
        assert_eq!(parse_control("toggle", 0.0), Some(Control::Toggle));
        assert_eq!(parse_control("play", 0.0), Some(Control::Play));
        assert_eq!(parse_control("pause", 0.0), Some(Control::Pause));
        assert_eq!(parse_control("seek", 83.5), Some(Control::Seek(83.5)));
        for bad in ["", "Prev", "stop", "volume", "seek ", "next;calc", "\0"] {
            assert_eq!(parse_control(bad, 1.0), None, "{bad:?}");
        }
        for t in [-1.0, f64::NAN, f64::INFINITY, 1e12] {
            assert_eq!(parse_control("seek", t), None, "seek to {t}");
        }
    }
    #[test]
    fn nothing_playing_is_a_calm_default() {
        let s = MediaState::default();
        assert!(!s.active && s.title.is_empty() && s.duration == 0.0 && !s.can_toggle && s.thumb_id.is_empty());
    }
}

#[cfg(not(windows))]
pub fn open(_: String, _: String) -> Result<(), String> { Err("Only available on Windows".into()) }
