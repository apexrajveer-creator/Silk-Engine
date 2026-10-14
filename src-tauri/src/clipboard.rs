//! The island's Clipboard tab: a history of the last things you copied.
//!
//! Privacy comes first, so:
//! * it is OFF until the user turns it on, and the history lives in memory only: never written to disk, gone when the app exits;
//! * text only, capped in size, and it is cleared the moment the user turns it off;
//! * anything a password manager (or any app that asks Windows to keep it out of clipboard history) copies is skipped, using
//!   the same two clipboard formats Windows' own Win+V history honours.
//!
//! The history itself is a plain, tested ring buffer; the Windows clipboard calls are at the bottom.

use serde::Serialize;
use std::collections::VecDeque;

pub const MAX_ITEMS: usize = 30;
pub const MAX_CHARS: usize = 20_000;
pub const PREVIEW_CHARS: usize = 140;

#[derive(Clone, Debug)]
struct Entry {
    id: u64,
    text: String,
    at: u64,
}

/// What the interface gets: a short preview, never the whole text, until the user picks one.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: u64,
    pub preview: String,
    pub chars: usize,
    pub age_secs: u64,
}

#[derive(Default)]
pub struct History {
    items: VecDeque<Entry>,
    next_id: u64,
}

/// One line: whitespace and line breaks collapsed, cut on a character boundary with an ellipsis.
pub fn preview(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= PREVIEW_CHARS {
        collapsed
    } else {
        collapsed.chars().take(PREVIEW_CHARS).collect::<String>().trim_end().to_string() + "\u{2026}"
    }
}

impl History {
    /// Add something that was copied. Returns true if the list changed (a repeat of what is already on top changes nothing).
    pub fn push(&mut self, text: &str, now: u64) -> bool {
        if text.trim().is_empty() || text.chars().count() > MAX_CHARS {
            return false;
        }
        if let Some(pos) = self.items.iter().position(|e| e.text == text) {
            let mut e = self.items.remove(pos).unwrap_or_else(|| unreachable!());
            e.at = now;
            self.items.push_front(e);
            return pos != 0;
        }
        self.next_id += 1;
        self.items.push_front(Entry { id: self.next_id, text: text.to_string(), at: now });
        self.items.truncate(MAX_ITEMS);
        true
    }

    pub fn get(&self, id: u64) -> Option<&str> {
        self.items.iter().find(|e| e.id == id).map(|e| e.text.as_str())
    }

    pub fn remove(&mut self, id: u64) -> bool {
        let before = self.items.len();
        self.items.retain(|e| e.id != id);
        self.items.len() != before
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn list(&self, now: u64) -> Vec<Item> {
        self.items.iter().map(|e| Item { id: e.id, preview: preview(&e.text), chars: e.text.chars().count(), age_secs: now.saturating_sub(e.at) }).collect()
    }
}

// ---------------------------------------------------------------------------------------------- Windows

#[cfg(windows)]
mod win {
    use super::MAX_CHARS;
    use windows::core::w;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;

    /// Changes every time anything is copied: cheap to poll.
    pub fn sequence() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    fn open() -> bool {
        for _ in 0..8 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(15)); // another program has it for a moment
        }
        false
    }

    /// The text on the clipboard, unless it is too large or an app asked to keep it out of clipboard history.
    pub fn read_text() -> Option<String> {
        if !open() {
            return None;
        }
        let result = (|| unsafe {
            if IsClipboardFormatAvailable(RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"))).is_ok() {
                return None; // a password manager, say
            }
            let can_include = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
            if IsClipboardFormatAvailable(can_include).is_ok() {
                if let Ok(h) = GetClipboardData(can_include) {
                    let g = HGLOBAL(h.0);
                    let p = GlobalLock(g) as *const u32;
                    let allowed = !p.is_null() && GlobalSize(g) >= 4 && *p != 0;
                    let _ = GlobalUnlock(g);
                    if !allowed {
                        return None;
                    }
                }
            }
            if IsClipboardFormatAvailable(CF_UNICODETEXT).is_err() {
                return None; // not text (an image, files): not kept
            }
            let h = GetClipboardData(CF_UNICODETEXT).ok()?;
            let g = HGLOBAL(h.0);
            let bytes = GlobalSize(g);
            if !(2..=(MAX_CHARS + 2) * 4).contains(&bytes) {
                return None;
            }
            let p = GlobalLock(g) as *const u16;
            if p.is_null() {
                return None;
            }
            let units = std::slice::from_raw_parts(p, bytes / 2);
            let len = units.iter().position(|&c| c == 0).unwrap_or(units.len());
            let text = String::from_utf16_lossy(&units[..len]);
            let _ = GlobalUnlock(g);
            Some(text)
        })();
        let _ = unsafe { CloseClipboard() };
        result
    }

    /// Put text on the clipboard (the user picked it from the history).
    pub fn write_text(text: &str) -> Result<(), String> {
        let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        if !open() {
            return Err("The clipboard is busy; try again".into());
        }
        let result = (|| unsafe {
            EmptyClipboard().map_err(|e| e.to_string())?;
            let g = GlobalAlloc(GMEM_MOVEABLE, units.len() * 2).map_err(|e| e.to_string())?;
            let p = GlobalLock(g) as *mut u16;
            if p.is_null() {
                return Err("Could not reserve memory".to_string());
            }
            std::ptr::copy_nonoverlapping(units.as_ptr(), p, units.len());
            let _ = GlobalUnlock(g);
            SetClipboardData(CF_UNICODETEXT, Some(HANDLE(g.0))).map(|_| ()).map_err(|e| e.to_string())
        })();
        let _ = unsafe { CloseClipboard() };
        result
    }
}

#[cfg(windows)]
pub use win::{read_text, sequence, write_text};

#[cfg(not(windows))]
pub fn sequence() -> u32 {
    0
}
#[cfg(not(windows))]
pub fn read_text() -> Option<String> {
    None
}
#[cfg(not(windows))]
pub fn write_text(_: &str) -> Result<(), String> {
    Err("Only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(h: &History) -> Vec<String> {
        h.list(0).into_iter().map(|i| i.preview).collect()
    }

    #[test]
    fn the_newest_copy_is_first() {
        let mut h = History::default();
        for (i, t) in ["one", "two", "three"].into_iter().enumerate() {
            assert!(h.push(t, i as u64));
        }
        assert_eq!(texts(&h), ["three", "two", "one"]);
    }
    #[test]
    fn copying_something_again_moves_it_to_the_top_instead_of_duplicating_it() {
        let mut h = History::default();
        h.push("a", 1);
        h.push("b", 2);
        h.push("c", 3);
        assert!(h.push("a", 4), "moved up: the list changed");
        assert_eq!(texts(&h), ["a", "c", "b"]);
        assert_eq!(h.len(), 3);
        assert!(!h.push("a", 5), "already on top: nothing changed");
    }
    #[test]
    fn only_the_newest_thirty_are_kept() {
        let mut h = History::default();
        for i in 0..100 {
            h.push(&format!("item {i}"), i);
        }
        assert_eq!(h.len(), MAX_ITEMS);
        assert_eq!(texts(&h)[0], "item 99");
        assert_eq!(texts(&h)[MAX_ITEMS - 1], "item 70");
    }
    #[test]
    fn empty_and_blank_copies_are_ignored() {
        let mut h = History::default();
        for t in ["", " ", "\n\n", "\t \r\n"] {
            assert!(!h.push(t, 1), "{t:?}");
        }
        assert!(h.is_empty());
    }
    #[test]
    fn huge_copies_are_ignored_and_the_limit_is_exact() {
        let mut h = History::default();
        assert!(h.push(&"x".repeat(MAX_CHARS), 1), "exactly at the limit is fine");
        assert!(!h.push(&"x".repeat(MAX_CHARS + 1), 2), "one over is refused");
        assert!(!h.push(&"é".repeat(MAX_CHARS + 1), 3), "characters are counted, not bytes");
        assert!(h.push(&"é".repeat(MAX_CHARS), 4));
        assert_eq!(h.len(), 2);
    }
    #[test]
    fn the_preview_is_one_short_line() {
        assert_eq!(preview("hello   world\n\tsecond line"), "hello world second line");
        assert_eq!(preview("  padded  "), "padded");
        assert_eq!(preview("short"), "short");
        let p = preview(&"word ".repeat(100));
        assert!(p.chars().count() <= PREVIEW_CHARS + 1 && p.ends_with('\u{2026}'), "{p}");
    }
    #[test]
    fn the_preview_never_splits_a_character() {
        let p = preview(&"😀".repeat(500));
        assert_eq!(p.chars().filter(|c| *c == '😀').count(), PREVIEW_CHARS);
        let q = preview(&"日本語のテキスト ".repeat(60));
        assert!(q.ends_with('\u{2026}') && q.chars().count() <= PREVIEW_CHARS + 1);
    }
    #[test]
    fn items_can_be_found_by_id_and_removed() {
        let mut h = History::default();
        h.push("alpha", 1);
        h.push("beta", 2);
        let ids: Vec<u64> = h.list(0).iter().map(|i| i.id).collect();
        assert_eq!(h.get(ids[0]), Some("beta"));
        assert_eq!(h.get(ids[1]), Some("alpha"));
        assert_eq!(h.get(9_999), None);
        assert!(h.remove(ids[0]) && !h.remove(ids[0]), "removed once");
        assert_eq!(texts(&h), ["alpha"]);
    }
    #[test]
    fn ids_are_unique_and_never_reused() {
        let mut h = History::default();
        let mut seen = std::collections::HashSet::new();
        for i in 0..200 {
            h.push(&format!("t{i}"), i);
            for item in h.list(0) {
                if item.preview == format!("t{i}") {
                    assert!(seen.insert(item.id), "id {} reused", item.id);
                }
            }
        }
        let before = h.list(0)[0].id;
        h.clear();
        h.push("fresh", 1);
        assert!(h.list(0)[0].id > before, "an id from before the clear is never handed out again");
    }
    #[test]
    fn a_repeated_copy_keeps_its_id() {
        let mut h = History::default();
        h.push("keep", 1);
        let id = h.list(0)[0].id;
        h.push("other", 2);
        h.push("keep", 3);
        assert_eq!(h.list(0)[0].id, id);
    }
    #[test]
    fn clearing_forgets_everything() {
        let mut h = History::default();
        h.push("secret", 1);
        h.clear();
        assert!(h.is_empty() && h.list(0).is_empty());
        assert_eq!(h.get(1), None, "the text is really gone");
    }
    #[test]
    fn the_interface_gets_previews_ages_and_lengths_not_full_text() {
        let mut h = History::default();
        h.push(&format!("{} END", "x".repeat(5_000)), 100);
        let item = &h.list(160)[0];
        assert!(item.preview.chars().count() <= PREVIEW_CHARS + 1);
        assert_eq!(item.chars, 5_004);
        assert_eq!(item.age_secs, 60);
        assert_eq!(h.list(50)[0].age_secs, 0, "a clock that went backwards gives age 0, not a huge number");
    }
}
