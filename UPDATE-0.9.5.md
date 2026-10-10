# 0.9.5 — Theme sync and tab transitions

## Theme sync
System → Windows → **Match Windows accent colour to wallpaper**.

Start, taskbar highlights, title bars and focus rings take their colour from the wallpaper on your
main display. The current accent is shown as a swatch and hex value next to the switch.

How it works:
- The wallpaper renderer samples its own composited frame (48×27 px, a one-off readback right after
  drawing) 2.5 s after a wallpaper changes, and every 5 minutes for moving scenes. Covered screens and
  web wallpapers are skipped.
- `src/shared/accent.js` picks the colour: colourful areas vote by hue, weighted by saturation and
  brightness, so a large blue silk beats a few red pixels and black or grey areas don't vote. The
  result is kept legible (never neon, never near-black); greyscale wallpapers get a neutral slate.
- `src-tauri/src/theme.rs` writes the same per-user registry values the Windows Settings app uses
  (HKCU only, no admin) and sends the standard `ImmersiveColorSet` broadcast. At most one change every
  15 s, and never for the colour already applied.
- Your own accent is saved before the first change and restored exactly when you turn the feature off.
  Windows' "Automatically pick an accent colour from my background" is switched off while sync is on
  (otherwise Windows overwrites it) and restored with everything else.

Windows has no public API for setting the accent colour. These registry values are stable across
Windows 10 and 11 but undocumented. Test on your PC before relying on it.

## Tab transitions
Changing tabs (Library, Desktops, Widgets, Display, System, About) now animates instead of popping in.
- The new page slides in from the side its dock button is on (right of the current tab → from the
  right), while the old page fades out in place over 0.2 s.
- Transform and opacity only, so it stays on the GPU compositor.
- Interruptible: clicking another tab mid-animation finishes the current one instantly and starts the
  next. Rapid clicking always ends on exactly the last tab you chose.
- Fixed: the old page-enter class was never cleared, so revisiting a tab didn't animate at all.
- Windows "Show animations" off → instant, as before.

Measured (headless Chromium, software rendering): the click handler runs in 6–23 ms and the first
transition frame paints 8–31 ms after the click, the same as instant switching. The second frame
costs more while two pages overlap during the 0.2 s fade; with software rendering that frame took up
to ~90 ms. A real GPU composites this cheaply; your PC is the real test.

## Verification run for this release
- `npm test`: 56 passed, 0 failed, 0 skipped (5 new in tests/accent.test.cjs).
- Rust theme unit tests: 4 passed (hex parsing, Windows byte order, palette shades, rate limiting),
  run on the host from `src-tauri/src/theme.rs`.
- `npm run test:ui`: 8 passed, twice in a row (2 new: transitions incl. rapid clicks and reduced motion;
  theme sync end to end in the browser preview).
- `npm run test:stress`: passes (no leaks or duplicate loops).
- `npm run bench:ui`: idle 60.5 fps and 16.8 ms scroll p95 at 1× and 2×, unchanged from 0.9.4.
- `cargo clippy --target x86_64-pc-windows-msvc`: clean (cross-check; not a Windows build).

## Not verified here
The registry write, the broadcast and the restore have not been run on Windows; the browser preview
records the colour instead. To check on your PC: turn sync on, switch wallpapers, open Start, then turn
sync off and confirm your original accent returns.

## Upgrade
Quit Silk from the tray, extract into a fresh folder, copy your `src/community/config.json`, then
`npm ci` and `npm run build`. Settings carry over; theme sync starts off.
