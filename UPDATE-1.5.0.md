# Silk Engine 1.5.0 — Smooth interaction release

This is the complete source package, including the previous Dynamic Island, Circle to Search and Studio fixes. The application version, npm manifests/lock, Tauri manifest and Rust package/lock now agree on **1.5.0**. The saved settings schema and application identity stay compatible with existing installations.

## What changed

| Surface | Behavior in 1.5 |
| --- | --- |
| Island media | Song metadata, artwork and artwork glow crossfade. Live transport/seek buttons remain the same DOM nodes, preserving focus and avoiding duplicate controls. Routine progress polls do not restart the transition. |
| Artwork on reopening | The current decoded cover remains available when Quick closes and reopens on the same song. Late replies from an old view session are still discarded. |
| Island/search/results colors | Registered CSS properties interpolate the accent, glass gradients, highlights and themed sliders over 220 ms. There is no perpetual JavaScript color-animation loop. The capture trace repaints only during the bounded transition. |
| Island expansion/tabs | Expansion takes 320 ms. Tab contents enter over 200 ms with a short stagger; expensive entrance blur is removed. Existing native clipping, focus and generation guards remain. |
| Studio navigation | A 90 ms outgoing / 150 ms incoming fade commits only the latest target. Retargeting, minimization and reduced motion invalidate old callbacks and always restore final opacity. |
| Studio refreshes | Bursts of backend state changes produce one foreground render per frame. Hidden refresh work is deferred until visible. Segmented-control buttons are reused, keeping focus and layout stable. |
| Sheets/rows/entrances | Shorter sheet and conditional-row motion, cancellable close timers, inert closing controls, and capped entrance staggering prevent long delays in large libraries. |
| Hero previews | A decoded hero image stays visible while an updated render is prepared. Replacement images fade in before older ones are removed. Superseded preview object URLs are released. Rapid wallpaper switches do not accumulate outgoing hero layers. |
| Studio backdrop/widgets | Background rendering sleeps between requested frames, stops on hiding/navigation/reduced motion and releases the WebGL context on teardown. Hidden widget surfaces do not schedule drawing from every audio event. |
| Native theme work | One worker retains only the latest pending accent. Windows broadcasts cannot accumulate a thread queue. Failed writes keep the last successful surface palette and allow a later retry. |
| Window opening | Studio remains hidden until its local UI is ready. Lens results now wait for their trusted frame to finish layout, and screen-search WebView2 creation runs on a worker instead of a synchronous UI callback. |
| Action feedback | Repeated pause clicks are guarded. Wallpaper assignment and file-import failures report a message rather than creating unhandled action rejections. |

Crossfade layers are decorative and bounded: at most one outgoing song copy, cover and glow are retained for 240 ms. They are cleared when Quick leaves or reduced motion is enabled. Reduced-motion support also covers pseudo-elements, page navigation and in-flight conditional-row animations.

The previous capture timing barrier, freeform mask, limits, cancellation generations, exact local-webview permissions and isolated Google content are preserved. Google supplies its own actual Lens results and decides whether an AI Overview is available.

## Validation completed here

- **509 Node tests pass**, including rapid navigation retargeting, suspended-frame fallback, failed commit cleanup, render coalescing, media control focus, crossfade cleanup, cover retention and backdrop lifecycle behavior.
- **51 frontend JavaScript files** pass syntax checks. Relative imports, HTML asset references and duplicate IDs were checked.
- All five application version declarations/locks and Windows installer branding image dimensions were checked.
- **89 Playwright tests are discoverable**. The added capture toolbar test checks centering and equal button heights.
- The ZIP is checked for corruption and excludes dependencies, build outputs and test reports.

## Validation still required

This environment has no Windows/Rust toolchain or Chromium installation. Native compilation, installer creation, browser test execution, actual desktop compositing, live Google Lens behavior and frame-time/memory measurements were not performed. No numerical FPS or RAM improvement is claimed.

`npm run verify` is blocked here because its required `css-tree` dependency is not installed. The real verification gate remains in place; it must pass after `npm ci` on the release machine. JavaScript/reference/version/installer-image checks were run separately; that does not substitute for the CSS parser check.

## Build and Windows release check

1. Extract the entire package into your project folder and fully stop the old Silk process.
2. With Node, Rust and the Windows build prerequisites installed, run **verify-windows.cmd**. This installs dependencies and runs the asset/CSS verifier, Node tests, locked Rust checks/tests and Playwright tests.
3. Run **npm run build** for the Windows installer. The included release CI workflow also retains its checks before producing a draft release; a workflow configuration is not evidence of a completed build.
4. Verify cold startup, repeated Studio close/open/minimize/restore, rapid dock clicks, sheet close/reopen, focused sliders during refreshes, scrolling a large library and switching wallpapers while a hero preview is loading.
5. Test Island opening/closing and rapid tab changes, playing/pausing/seeking, consecutive song changes with slow artwork, leaving Quick during a crossfade and reopening the same song. Controls should keep focus and show no duplicated interaction targets.
6. Test accent changes during expansion, switching theme sync off/on and changing reduced-motion preference while a transition is running. Check CPU/GPU while the app is hidden or idle.
7. Test freeform search from the Island and shortcut on multiple monitor scales, cancellation during preparation, repeated Lens searches, result controls and closing results during loading. The Island must be absent from the frozen capture.
8. Confirm disabled/hidden views stop polls, outgoing layers disappear, and memory returns to a stable baseline after repeated interactions. Complete the Windows smoke checks before publishing the compiled release.

## Final 1.5 layout refinements

- Volume has a thumb-free track; media seeking retains its hover thumb. Quick shortcuts are centered.
- The capture toolbar uses equal-width, equal-height pills with centered labels. Results navigation glyphs also use explicit centering.
- The Google pane is positioned from the local `lensViewport` element's measured bounds before first reveal, then refreshed through a serialized layout request when the viewport changes. The old proportional auto-resize is removed. Geometry must fit inside the hosting window and only the trusted local frame can send it. The rectangular content opening matches the native pane rather than claiming CSS can clip a separate native webview. Local frame zoom hotkeys are disabled to keep chrome geometry stable.
- System uses four independent groups in a balanced two-column grid, with one column on narrow windows. Island has a separate capsule icon. Input keeps its cursor icon.
- Island background transparency is saved as `system.islandTransparency`, from 0–80%, default 12%. The small Reset button restores 12%. Text and controls remain opaque. Old configurations receive the serde default; invalid native values are rejected.
- Studio's silk shader now blends toward the dominant color sampled from its decoded wallpaper preview, including refreshed simulation previews. This works without Windows theme sync. It reuses the existing background frames and blends rather than adding a second animation loop. If a preview cannot be sampled, it retains the previous tint.

All 509 Node tests pass. The supplied screenshot paths were unavailable; Windows rendering, native pane bounds at different DPIs, slider interaction and visual alignment still require the release checks above.


## Island app mixer extension

See AUDIO-MIXER.md for the new speaker-button drawer, per-app volume, output selection, player artwork activation, validation and Windows checks. The full Node suite now passes 519 tests. The source ZIP retains all prior v1.5 polish. Native Windows integration is pending live verification.
