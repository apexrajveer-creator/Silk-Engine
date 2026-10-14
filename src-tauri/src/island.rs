//! The top-edge island: push the cursor to the top-centre of a screen and a small bar slides in; click it and it opens into a
//! full panel (quick settings, clipboard, system stats, most-used apps, wallpapers, power).
//!
//! This file is the PURE half: where the hot zone is, where the window goes, and the state machine that decides when the
//! bar appears and disappears. It is fully unit-tested without Windows. The window itself, the cursor polling thread and the
//! commands live in island_host.rs.
//!
//! The state machine is deliberately conservative, because a bar that pops up at the wrong moment is worse than no bar:
//! * it needs a short DWELL at the edge (not a flick across it),
//! * it never appears while a mouse button is down (dragging a window to the top edge) or while a full-screen app or
//!   presentation is running,
//! * it stays while the cursor is on it or still at the edge, and goes away a moment after the cursor leaves,
//! * once opened it never disappears under the cursor, and if the user dismisses it, it does not pop straight back up while
//!   the cursor is still resting at the edge: the cursor has to leave the zone first.

/// Width of the hot zone along the top edge (logical pixels), centred on the screen.
pub const ZONE_WIDTH: f64 = 300.0;
/// How many pixel rows from the very top count as "at the edge" (physical pixels).
pub const ZONE_HEIGHT: i32 = 2;
/// The peek bar and the open panel (logical pixels).
pub const PILL: (f64, f64) = (268.0, 44.0);
pub const PANEL: (f64, f64) = (580.0, 452.0);
/// Gap between the top of the screen and the bar, and room around it for its shadow (logical pixels).
pub const TOP_GAP: f64 = 8.0;
pub const SHADOW: f64 = 30.0;
/// How long the cursor may be away before the peek bar leaves again.
pub const LINGER_MS: u64 = 900;
/// Windows can report the island losing focus while it is still settling after it opens (it switches from "never takes focus"
/// to "takes focus"). That is not the user clicking away, so blurs inside this window are ignored.
pub const BLUR_GRACE_MS: u64 = 700;
/// A hotkey pressed again this soon after the last time is a bounce, not a second request.
pub const TOGGLE_DEBOUNCE_MS: u64 = 350;
/// How far around the island's window the cursor still counts as "on it", so a slightly shaky hand does not make it leave.
pub const NEAR_MARGIN: i32 = 12;
/// The allowed range of the user's dwell setting.
pub const MIN_DWELL_MS: u64 = 80;
pub const MAX_DWELL_MS: u64 = 1500;
pub const DEFAULT_DWELL_MS: u64 = 250;

/// Should a focus-loss that happened `since_opened_ms` after the island opened close it?
pub fn blur_closes(since_opened_ms: u64) -> bool {
    since_opened_ms >= BLUR_GRACE_MS
}

pub fn toggle_allowed(since_last_ms: u64) -> bool {
    since_last_ms >= TOGGLE_DEBOUNCE_MS
}

pub fn clamp_dwell(ms: i64) -> u64 {
    ms.clamp(MIN_DWELL_MS as i64, MAX_DWELL_MS as i64) as u64
}

/// A rectangle in physical pixels (x, y of the top-left corner).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn new(x: i32, y: i32, w: i32, h: i32) -> Rect {
        Rect { x, y, w, h }
    }
    /// The same rectangle, `by` pixels larger on every side.
    pub fn grown(&self, by: i32) -> Rect {
        Rect { x: self.x - by, y: self.y - by, w: self.w + 2 * by, h: self.h + 2 * by }
    }
    /// Left and top edges are inside, right and bottom edges are not.
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.x + self.w && py >= self.y && py < self.y + self.h
    }
}

fn phys(logical: f64, scale: f64) -> i32 {
    (logical * scale.max(0.5)).round() as i32
}

/// The strip along the top edge of `mon` that wakes the bar.
pub fn hot_zone(mon: Rect, scale: f64) -> Rect {
    let w = phys(ZONE_WIDTH, scale).min(mon.w);
    Rect::new(mon.x + (mon.w - w) / 2, mon.y, w, ZONE_HEIGHT)
}

pub fn in_hot_zone(mon: Rect, scale: f64, px: i32, py: i32) -> bool {
    hot_zone(mon, scale).contains(px, py)
}

/// The window that holds the bar or the panel: centred on the screen, flush with its top edge (the bar sits `TOP_GAP`
/// below it inside the window), with room on the sides and below for the shadow. Never wider than the screen.
pub fn window_rect(mon: Rect, scale: f64, expanded: bool) -> Rect {
    let (cw, ch) = if expanded { PANEL } else { PILL };
    let w = (phys(cw + SHADOW * 2.0, scale)).min(mon.w);
    let h = (phys(TOP_GAP + ch + SHADOW, scale)).min(mon.h);
    Rect::new(mon.x + (mon.w - w) / 2, mon.y, w, h)
}

/// The window stays panel-sized the whole time it is visible (resizing it during the morph stretches the web content for a few
/// frames). While only the bar is showing it is clipped to the bar's own area instead, so everything around the bar still clicks
/// through to the apps underneath. This is that area, relative to the window's top-left corner.
pub fn peek_region(mon: Rect, scale: f64) -> Rect {
    let (big, small) = (window_rect(mon, scale, true), window_rect(mon, scale, false));
    Rect::new(small.x - big.x, 0, small.w, small.h)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transition {
    Show,
    Hide,
}

/// What is true about the world at one instant.
#[derive(Clone, Copy, Debug, Default)]
pub struct Sample {
    /// The cursor is inside the hot zone.
    pub in_zone: bool,
    /// The cursor is over the island's own window.
    pub over_island: bool,
    /// A full-screen app or presentation is running.
    pub suppressed: bool,
    /// A mouse button is held down (probably dragging something).
    pub button_down: bool,
    /// The panel is open.
    pub expanded: bool,
}

pub struct HotEdge {
    dwell_ms: u64,
    shown: bool,
    entered_at: Option<u64>,
    last_near: u64,
    /// False after the island was dismissed while the cursor still rests in the zone.
    armed: bool,
}

impl HotEdge {
    pub fn new(dwell_ms: u64) -> HotEdge {
        HotEdge { dwell_ms: dwell_ms.clamp(MIN_DWELL_MS, MAX_DWELL_MS), shown: false, entered_at: None, last_near: 0, armed: true }
    }

    pub fn set_dwell(&mut self, ms: u64) {
        self.dwell_ms = ms.clamp(MIN_DWELL_MS, MAX_DWELL_MS);
    }

    pub fn is_shown(&self) -> bool {
        self.shown
    }

    /// Feed one sample; returns what to do about the bar, if anything. `now` is in milliseconds and only has to be monotonic.
    pub fn update(&mut self, now: u64, s: Sample) -> Option<Transition> {
        if self.shown {
            if s.expanded {
                self.last_near = now; // an open panel never leaves by itself
                return None;
            }
            if s.suppressed {
                self.close(false); // a full-screen app took over
                return Some(Transition::Hide);
            }
            if s.over_island || s.in_zone {
                self.last_near = now;
                return None;
            }
            if now.saturating_sub(self.last_near) >= LINGER_MS {
                self.close(true);
                return Some(Transition::Hide);
            }
            return None;
        }
        if !s.in_zone {
            self.entered_at = None;
            self.armed = true; // the cursor left the zone: the next visit counts again
            return None;
        }
        if !self.armed || s.suppressed || s.button_down {
            self.entered_at = None;
            return None;
        }
        let since = *self.entered_at.get_or_insert(now);
        if now.saturating_sub(since) >= self.dwell_ms {
            self.shown = true;
            self.entered_at = None;
            self.last_near = now;
            return Some(Transition::Show);
        }
        None
    }

    /// The island closed for some other reason (the user clicked away, pressed Esc, used the hotkey). It must not pop
    /// straight back up while the cursor is still resting at the edge.
    pub fn hidden_externally(&mut self) {
        self.close(false);
    }

    /// The island was opened some other way (the hotkey).
    pub fn shown_externally(&mut self, now: u64) {
        self.shown = true;
        self.entered_at = None;
        self.last_near = now;
    }

    fn close(&mut self, cursor_is_away: bool) {
        self.shown = false;
        self.entered_at = None;
        self.armed = cursor_is_away;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MON: Rect = Rect { x: 0, y: 0, w: 1920, h: 1080 };
    fn at_edge() -> Sample {
        Sample { in_zone: true, ..Sample::default() }
    }
    fn away() -> Sample {
        Sample::default()
    }

    // ---- geometry
    #[test]
    fn the_hot_zone_is_a_thin_strip_centred_on_the_top_edge() {
        let z = hot_zone(MON, 1.0);
        assert_eq!(z, Rect::new(810, 0, 300, ZONE_HEIGHT));
        assert_eq!(z.x + z.w / 2, 960, "centred");
    }
    #[test]
    fn the_hot_zone_scales_with_display_scaling() {
        assert_eq!(hot_zone(MON, 2.0).w, 600);
        assert_eq!(hot_zone(MON, 1.5).w, 450);
        assert_eq!(hot_zone(MON, 0.0).w, 150, "a nonsense scale is treated as the smallest sane one");
    }
    #[test]
    fn the_hot_zone_follows_a_monitor_anywhere_on_the_virtual_desktop() {
        let left = Rect::new(-1920, 0, 1920, 1080);
        assert!(in_hot_zone(left, 1.0, -960, 0));
        assert!(!in_hot_zone(left, 1.0, 960, 0), "the other screen's centre is not this zone");
        let above = Rect::new(0, -1080, 1920, 1080);
        assert!(in_hot_zone(above, 1.0, 960, -1080));
        assert!(!in_hot_zone(above, 1.0, 960, 0));
    }
    #[test]
    fn the_zone_edges_are_exact() {
        let z = hot_zone(MON, 1.0);
        assert!(z.contains(810, 0) && z.contains(1109, 1));
        assert!(!z.contains(809, 0) && !z.contains(1110, 0), "just outside the sides");
        assert!(!z.contains(960, 2) && !z.contains(960, -1), "just outside the top and bottom");
    }
    #[test]
    fn the_zone_never_exceeds_a_tiny_screen() {
        let tiny = Rect::new(0, 0, 200, 150);
        assert!(hot_zone(tiny, 1.0).w <= 200);
        assert!(hot_zone(tiny, 3.0).w <= 200);
    }
    #[test]
    fn the_window_is_centred_flush_with_the_top_and_roomy_enough_for_its_shadow() {
        let w = window_rect(MON, 1.0, false);
        assert_eq!(w.y, 0, "flush with the top edge of the screen");
        assert_eq!(w.x + w.w / 2, 960, "centred");
        assert_eq!(w.w, (PILL.0 + SHADOW * 2.0) as i32);
        assert_eq!(w.h, (TOP_GAP + PILL.1 + SHADOW) as i32);
    }
    #[test]
    fn the_open_panel_is_larger_than_the_bar_and_scales() {
        let (small, big) = (window_rect(MON, 1.0, false), window_rect(MON, 1.0, true));
        assert!(big.w > small.w && big.h > small.h);
        assert_eq!(window_rect(MON, 2.0, true).w, 2 * big.w);
    }
    #[test]
    fn the_window_stays_inside_a_small_or_offset_screen() {
        let small = Rect::new(100, 50, 400, 300);
        let w = window_rect(small, 2.0, true);
        assert!(w.w <= small.w && w.h <= small.h);
        assert!(w.x >= small.x && w.y == small.y);
    }
    #[test]
    fn the_dwell_setting_is_kept_in_range() {
        assert_eq!(clamp_dwell(0), MIN_DWELL_MS);
        assert_eq!(clamp_dwell(-50), MIN_DWELL_MS);
        assert_eq!(clamp_dwell(250), 250);
        assert_eq!(clamp_dwell(99_999), MAX_DWELL_MS);
    }

    #[test]
    fn a_focus_loss_right_after_opening_is_the_window_settling_not_a_click_away() {
        for ms in [0, 50, 300, 699] {
            assert!(!blur_closes(ms), "{ms} ms after opening");
        }
        assert!(blur_closes(700) && blur_closes(5_000), "a real click away later still closes it");
    }
    #[test]
    fn a_bounced_hotkey_is_ignored_but_a_deliberate_second_press_is_not() {
        assert!(!toggle_allowed(0) && !toggle_allowed(349));
        assert!(toggle_allowed(350) && toggle_allowed(10_000));
    }
    #[test]
    fn near_the_island_includes_a_small_margin_all_round() {
        let r = Rect::new(100, 0, 328, 70);
        assert!(!r.contains(95, 30), "just left of the window");
        let near = r.grown(NEAR_MARGIN);
        assert!(near.contains(95, 30) && near.contains(100 + 328 + 11, 30) && near.contains(200, 70 + 11), "a shaky hand still counts");
        assert!(!near.contains(100 - NEAR_MARGIN - 1, 30) && !near.contains(200, 70 + NEAR_MARGIN + 1), "but not far away");
        assert_eq!(r.grown(0), r);
        assert_eq!(r.grown(5).grown(-5), r, "growing and shrinking by the same amount is a round trip");
    }

    #[test]
    fn while_only_the_bar_shows_the_window_is_clipped_to_the_bars_own_area() {
        let r = peek_region(MON, 1.0);
        let (big, small) = (window_rect(MON, 1.0, true), window_rect(MON, 1.0, false));
        assert_eq!((r.w, r.h), (small.w, small.h), "exactly the size the bar's window used to be");
        assert_eq!(r.y, 0, "flush with the top");
        assert_eq!(big.x + r.x, small.x, "in the same place on screen as the bar's window was");
        assert!(r.x >= 0 && r.x + r.w <= big.w && r.h <= big.h, "inside the window");
    }
    #[test]
    fn the_clip_is_centred_and_scales_with_the_display() {
        let (r1, r2) = (peek_region(MON, 1.0), peek_region(MON, 2.0));
        let big1 = window_rect(MON, 1.0, true);
        assert_eq!(r1.x + r1.w / 2, big1.w / 2, "centred in the window");
        assert_eq!((r2.w, r2.h), (2 * r1.w, 2 * r1.h));
    }
    #[test]
    fn the_clip_stays_inside_the_window_on_a_small_or_offset_screen() {
        for mon in [Rect::new(100, 50, 400, 300), Rect::new(-1920, 0, 1920, 1080), Rect::new(0, 0, 200, 150)] {
            for scale in [1.0, 1.5, 3.0] {
                let (r, big) = (peek_region(mon, scale), window_rect(mon, scale, true));
                assert!(r.x >= 0 && r.y == 0 && r.x + r.w <= big.w && r.h <= big.h, "{mon:?} at {scale}: {r:?} in {big:?}");
            }
        }
    }

    // ---- the state machine
    #[test]
    fn the_bar_appears_only_after_the_cursor_has_rested_at_the_edge() {
        let mut e = HotEdge::new(250);
        assert_eq!(e.update(0, at_edge()), None);
        assert_eq!(e.update(249, at_edge()), None, "not yet");
        assert_eq!(e.update(250, at_edge()), Some(Transition::Show));
        assert!(e.is_shown());
    }
    #[test]
    fn flicking_across_the_edge_does_not_open_it() {
        let mut e = HotEdge::new(250);
        for t in [0, 40, 80, 120] {
            assert_eq!(e.update(t, at_edge()), None);
        }
        assert_eq!(e.update(160, away()), None, "left after 160 ms");
        assert_eq!(e.update(200, at_edge()), None, "and the timer starts over on re-entry");
        assert_eq!(e.update(440, at_edge()), None, "240 ms since re-entry is still not enough");
        assert_eq!(e.update(450, at_edge()), Some(Transition::Show));
    }
    #[test]
    fn jittering_in_and_out_never_opens_it() {
        let mut e = HotEdge::new(250);
        let mut t = 0;
        for _ in 0..200 {
            assert_eq!(e.update(t, at_edge()), None);
            t += 100;
            assert_eq!(e.update(t, away()), None);
            t += 100;
        }
    }
    #[test]
    fn a_zero_dwell_opens_immediately_and_the_minimum_is_enforced() {
        assert_eq!(HotEdge::new(0).update(0, at_edge()), None, "0 is clamped up to the minimum");
        let mut e = HotEdge::new(0);
        assert_eq!(e.update(0, at_edge()), None);
        assert_eq!(e.update(MIN_DWELL_MS, at_edge()), Some(Transition::Show));
    }
    #[test]
    fn a_fullscreen_app_blocks_it() {
        let mut e = HotEdge::new(100);
        let s = Sample { suppressed: true, ..at_edge() };
        for t in (0..2_000).step_by(50) {
            assert_eq!(e.update(t, s), None);
        }
    }
    #[test]
    fn dragging_something_to_the_top_edge_does_not_open_it() {
        let mut e = HotEdge::new(100);
        let s = Sample { button_down: true, ..at_edge() };
        for t in (0..2_000).step_by(50) {
            assert_eq!(e.update(t, s), None);
        }
        assert_eq!(e.update(2_000, at_edge()), None, "the timer only starts once the button is up");
        assert_eq!(e.update(2_100, at_edge()), Some(Transition::Show));
    }
    #[test]
    fn it_stays_while_the_cursor_is_near_and_leaves_after_a_moment() {
        let mut e = HotEdge::new(100);
        e.update(0, at_edge());
        assert_eq!(e.update(100, at_edge()), Some(Transition::Show));
        assert_eq!(e.update(500, Sample { over_island: true, ..away() }), None, "on the bar");
        assert_eq!(e.update(900, at_edge()), None, "still at the edge");
        assert_eq!(e.update(1_000, away()), None, "left, but not for long enough");
        assert_eq!(e.update(1_799, away()), None, "the cursor was last near at 900 ms");
        assert_eq!(e.update(1_800, away()), Some(Transition::Hide), "900 ms after that");
        assert!(!e.is_shown());
    }
    #[test]
    fn coming_back_in_time_keeps_it_open() {
        let mut e = HotEdge::new(100);
        e.update(0, at_edge());
        e.update(100, at_edge());
        assert_eq!(e.update(600, away()), None);
        assert_eq!(e.update(1_000, Sample { over_island: true, ..away() }), None);
        assert_eq!(e.update(1_800, away()), None, "the clock restarted when the cursor came back");
        assert_eq!(e.update(1_900, away()), Some(Transition::Hide));
    }
    #[test]
    fn an_open_panel_never_leaves_under_the_cursor() {
        let mut e = HotEdge::new(100);
        e.update(0, at_edge());
        e.update(100, at_edge());
        let open_far_away = Sample { expanded: true, ..away() };
        for t in (200..60_000).step_by(500) {
            assert_eq!(e.update(t, open_far_away), None, "t={t}");
        }
        assert!(e.is_shown());
        assert_eq!(e.update(60_000, away()), None, "just collapsed: the clock starts now, not 60 s ago");
    }
    #[test]
    fn a_fullscreen_app_starting_hides_the_bar_but_not_an_open_panel() {
        let mut e = HotEdge::new(100);
        e.update(0, at_edge());
        e.update(100, at_edge());
        assert_eq!(e.update(200, Sample { suppressed: true, expanded: true, ..at_edge() }), None, "the user is in the panel");
        assert_eq!(e.update(300, Sample { suppressed: true, ..at_edge() }), Some(Transition::Hide));
    }
    #[test]
    fn after_the_user_dismisses_it_the_cursor_must_leave_before_it_can_return() {
        let mut e = HotEdge::new(100);
        e.update(0, at_edge());
        e.update(100, at_edge());
        e.hidden_externally(); // clicked away / Esc
        assert!(!e.is_shown());
        for t in (200..5_000).step_by(50) {
            assert_eq!(e.update(t, at_edge()), None, "still resting at the edge: must not pop back up (t={t})");
        }
        assert_eq!(e.update(5_000, away()), None, "the cursor left");
        assert_eq!(e.update(5_100, at_edge()), None);
        assert_eq!(e.update(5_200, at_edge()), Some(Transition::Show), "a fresh visit works again");
    }
    #[test]
    fn hiding_because_a_fullscreen_app_started_also_waits_for_the_cursor_to_leave() {
        let mut e = HotEdge::new(100);
        e.update(0, at_edge());
        e.update(100, at_edge());
        assert_eq!(e.update(200, Sample { suppressed: true, ..at_edge() }), Some(Transition::Hide));
        assert_eq!(e.update(300, at_edge()), None, "still at the edge, but not armed");
        assert_eq!(e.update(400, at_edge()), None);
    }
    #[test]
    fn a_hotkey_can_open_it_and_the_normal_rules_then_apply() {
        let mut e = HotEdge::new(100);
        e.shown_externally(10);
        assert!(e.is_shown());
        assert_eq!(e.update(500, away()), None);
        assert_eq!(e.update(910, away()), Some(Transition::Hide), "900 ms after the last time it was near");
    }
    #[test]
    fn changing_the_dwell_takes_effect_and_is_clamped() {
        let mut e = HotEdge::new(1_000);
        e.set_dwell(120);
        e.update(0, at_edge());
        assert_eq!(e.update(120, at_edge()), Some(Transition::Show));
        e.set_dwell(1_000_000);
        e.hidden_externally();
        e.update(10_000, away());
        e.update(10_001, at_edge());
        assert_eq!(e.update(10_001 + MAX_DWELL_MS - 1, at_edge()), None);
        assert_eq!(e.update(10_001 + MAX_DWELL_MS, at_edge()), Some(Transition::Show));
    }
    #[test]
    fn a_clock_that_stalls_or_repeats_cannot_cause_trouble() {
        let mut e = HotEdge::new(100);
        assert_eq!(e.update(500, at_edge()), None);
        assert_eq!(e.update(500, at_edge()), None, "the same instant twice");
        assert_eq!(e.update(400, at_edge()), None, "time going backwards is treated as no time passing");
        assert_eq!(e.update(600, at_edge()), Some(Transition::Show));
    }
    #[test]
    fn whatever_happens_it_only_ever_alternates_show_then_hide() {
        // a deterministic fuzz over random worlds
        let mut seed = 99u64;
        let mut rnd = || { seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (seed >> 33) as u32 };
        let mut e = HotEdge::new(150);
        let mut t = 0u64;
        let mut open = false;
        for _ in 0..50_000 {
            t += (rnd() % 120) as u64;
            let s = Sample { in_zone: rnd() % 3 == 0, over_island: rnd() % 4 == 0, suppressed: rnd() % 25 == 0, button_down: rnd() % 15 == 0, expanded: open && rnd() % 2 == 0 };
            match e.update(t, s) {
                Some(Transition::Show) => { assert!(!open, "two Shows in a row at t={t}"); open = true; }
                Some(Transition::Hide) => { assert!(open, "a Hide without a Show at t={t}"); open = false; }
                None => {}
            }
            assert_eq!(e.is_shown(), open, "is_shown disagrees with the transitions at t={t}");
            if rnd() % 997 == 0 && open { e.hidden_externally(); open = false; }
        }
    }
}
