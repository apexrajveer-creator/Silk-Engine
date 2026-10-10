# 0.9.4 — Studio responsiveness

## The problem
On every launch the Studio ran the Fluid, Reaction–Diffusion and particle simulations offscreen to
make card thumbnails — including the built-in scenes, which already ship with real renders. Previews
rendered at display resolution (up to 1600 px wide at 200 % scaling) with up to 80 simulation steps in
one burst, then read the result back synchronously. The GPU queue the interface also needs was
saturated: one readback blocked the main thread for 10.7 s, and the interface ran at 1–4 fps for the
first ~20 s. Because the global display look was part of the preview cache key, every Display slider
movement (brightness, OLED…) re-ran every simulation. The five browser UI tests failed for this reason:
controls never became stable enough to click.

## The fix (src/studio/previews.js, src/shared/preview-policy.js)
- Built-in scenes at default settings use the bundled renders: no GPU work at all.
- Custom presets render once, at thumbnail size (max 960 px), with steps spread across frames so the
  compositor keeps presenting, and are encoded with `toBlob` (asynchronous) instead of a blocking encode.
- Rendered previews persist in IndexedDB (`silk-engine-previews`): paid once per preset, not per launch.
- The display look is excluded from the preview key and shown on thumbnails with a CSS filter
  (`lookFilter`), so Display sliders update thumbnails instantly with no simulation.
- Glass rims are a 1 px per-side border instead of a masked gradient (masks force an offscreen
  surface per panel). Visual result unchanged in screenshot review.

## Measured (headless Chromium 141, software rendering, 1280×820)
Software rendering is a pessimistic proxy for a weak integrated GPU, not a real Windows measurement.

| | 0.9.3 | 0.9.4 |
|---|---|---|
| Idle frame rate, 1× scaling | 39.5 fps | 60.5 fps |
| Idle frame rate, 2× scaling | 0.5 fps | 61 fps |
| Scroll frame p95, 2× | 4,416 ms | 16.8 ms |
| Long tasks (>50 ms) during run, 2× | 17 | 8 |

Remaining startup cost: ~1 s of short tasks (50–110 ms) during entrance animations and thumbnail
decodes, then steady 60 fps.

## Verification run for this release
- `npm test`: 51 passed, 0 failed, 0 skipped (6 new: tests/previews.test.cjs).
- `npm run test:ui`: 6 passed (was 0 of 5; 1 new startup-starvation regression test).
- `npm run test:stress` (new): 48 rapid wallpaper switches, 30 display changes, 3 hibernate/wake
  cycles — no GPU-allocation growth, orphaned decoders or duplicate animation loops.
- `npm run bench:ui` (new): produced the table above.
- `npm run verify`: 45 assets, version 0.9.4.
- Rust: `cargo clippy --target x86_64-pc-windows-msvc` clean (cross-check; not a Windows build).

Audited without changes needed: Supabase RLS/storage policies, `wp://` path confinement
(canonicalised, symlink-safe), HTML escaping of untrusted text, native passive scrolling, coalesced
settings writes, broken-media fallback, no panics in production Rust paths.

## Not verified here
Native Windows build and installer, real-GPU frame times, multi-monitor/mixed-DPI, sleep/resume and
Explorer restarts. Run `npm run bench:ui` on real hardware for comparable numbers.

## Upgrade
Quit Silk from the tray, extract into a fresh folder, copy your working `src/community/config.json`,
then `npm ci` and `npm run dev`. No settings or database changes. The first launch renders any custom
presets once; built-in scenes render nothing.
For browser tests: `npx playwright install chromium` (or set `SILK_BROWSER_PATH`).
