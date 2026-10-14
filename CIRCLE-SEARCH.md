Current v1.5 behavior and validation: see [UPDATE-1.5.0.md](UPDATE-1.5.0.md). The notes below record the initial implementation and subsequent repairs.

# Circle to Search + compact Dynamic Island update

## Use

Rebuild and fully restart Silk Engine. Press **Ctrl + Shift + Alt + 0** (top-row zero), or open **Quick → Circle to Search** in the Dynamic Island. You can change the binding in **Settings → Hotkeys**.

Silk freezes the display under your cursor. Hold the left mouse button and draw any outline around the object or text you want to find. Your real cursor trace is the selection boundary; it is not replaced by a circle, ellipse or rectangle. Releasing the mouse closes the outline and previews the selection. Choose **Search with Lens** (or Enter while the drawing surface has focus) to open Google Lens inside Silk’s centered glass results window. Use **Redraw**, draw another outline, or press **Esc** to cancel. Pressing the shortcut again also cancels the mode.

Capture is local to the monitor under the cursor. This keeps DPI mapping accurate and avoids allocating a capture of every connected display. Very small or straight-line traces are rejected because they do not enclose an area.

## Compact Island and motion

The compact Island keeps its 268×44 logical-pixel shape, displaying the clock, battery icon/percentage and eight small audio bars. CPU/RAM readings remain available in the expanded System section. Desktops without a battery show **AC**; unavailable battery data is not fabricated. Charging and low-battery status have distinct indicators.

The visualizer uses Silk's existing system-audio stream. It does not simulate audio. Bars stay flat in silence, when audio reactivity is disabled, or when the battery-pause policy prevents capture. The existing audio worker can run for the visible peek even if the wallpaper itself is covered/paused, and relinquishes that demand when the Island opens or hides. There is no second audio stream and no idle visualizer animation loop.

Expansion is now 400 ms (previously 580 ms). The tab indicator moves in 260 ms; tab content entrances use 270 ms with shorter stagger/delay. Reduced-motion support remains in place.

## Colors

The Island's glass, glow, primary controls, focus indicators and audio bars, and the screen-search toolbar/selection trace, derive from the same accent Silk actually applies to Windows. A newly created surface reads the last successfully applied accent, then follows **accent-applied** events. A late initial read cannot overwrite a newer event. Disabling theme sync restores the default surface palette. Battery warnings, charging and destructive-action colors retain their semantic meaning.

## Search handoff and resource lifetime

The full frozen capture stays in the app. The outlined region is cropped at the original screenshot resolution; pixels outside the traced polygon are transparent. Only the selected PNG is handed off after the user presses Search. No screenshot is written to disk or hosted on a public image service.

The selected image goes through a temporary, token-protected loopback form inside an isolated native child webview. Google Lens then loads directly inside a centered Silk window with an accent-tinted liquid glass frame. There is no default-browser launch or separate blue handoff page. Back, forward, reload and close controls remain in the trusted local frame; links requesting a new tab stay in the content pane. Repeated searches reuse the existing pane. Its size is bounded to the capture monitor, and DPI changes resize the content with the window.

Only the local frame has an exact-webview capability. Remote content receives no app capabilities and cannot navigate to Silk’s local app origin. The application CSP stays restricted; Google is not embedded in an iframe. The one-use local image response has no-store headers and releases its bytes after successful delivery; an unclaimed upload expires after 90 seconds, with at most two simultaneous listeners.

The content pane displays Google's real interface, including images, links and AI Overviews **when Google provides them**. Silk does not generate or scrape a replacement overview. Google may show consent, captcha, sign-in or unsupported-browser messages; its embedded-webview support and live upload endpoint remain external dependencies. The embedded pane has its own WebView2 session, so it does not inherit the default browser’s sign-in. Retry is available if the local transfer fails. Reloading an expired one-use upload requires a new selection.

Captures are compressed using the already-resolved png 0.18.1 crate in fast mode and capped at 16,777,216 pixels; the selected upload is capped at 8 MiB. The screenshot frame is transferred as binary rather than a full-screen base64 data URL. The overlay and capture are released on search, cancellation, focus loss, window close, shutdown, or a 3-minute abandoned-session timeout. Queued work is guarded by session IDs so an old operation cannot consume or close a newer selection. The Island's hot edge is suppressed while search is active.

## Validation

- All 497 Node tests pass, including new geometry, DPI mapping, palette, battery/visualizer, Quick-action and upload-script and results-controller tests, plus the prior Island stability regressions.
- Frontend JavaScript syntax and relative imports/HTML assets are checked. The lockfile already contains png 0.18.1; it is now also an explicit Windows dependency.
- 72 Island/search Playwright tests are discoverable, including a real-canvas polygon transparency test, but were not executed because Chromium is unavailable in this environment.
- A Windows/Rust toolchain is unavailable here. Windows compilation, actual GDI capture, embedded WebView2 navigation and Google's live upload response still require a Windows test. This package contains source, not a prebuilt installer.

On Windows, run **npm install**, then **npm run dev** to test or **npm run build** for an installer. Check the shortcut, freeform/concave selections, Esc during loading/submission, retry after failure, multiple displays/scales, audio on/off, battery/AC behavior and theme-sync on/off. Capturing protected video or secure desktops remains subject to Windows restrictions.

## Glass results and Island refinements

The capture panel now contains only **Search with Lens**, **Redraw**, and **Esc to cancel**. It has no star, title, arrow or close icon. Redraw is disabled until an outline exists; errors appear only when needed.

Quick now includes **Open Studio**. Media progress and volume tracks/thumbs follow the shared accent. Surface notifications happen after successful registry writes, before Windows’ slow broadcast completes. Native writes/restoration are serialized, and queued obsolete colors are discarded. Wallpaper changes begin sampling after 100 ms, with bounded follow-up samples; moving scenes sample every five seconds instead of thirty. Unchanged colors still skip writes.

The Island shell uses rounded gradients and inset glass highlights without an outer box shadow or native-desktop CSS backdrop-filter. This removes the likely rectangular compositor/shadow artifact. Screenshot attachments were unavailable here, so the visual diagnosis and native result need confirmation on Windows.

The results pane uses Tauri’s `unstable` multi-webview feature. No additional Google service, API key, server deployment or public image hosting is required. This source package has not been compiled or visually tested on Windows in this environment.

## Results controls and Studio launch repair

The local results frame now accepts `tauri::Webview` in its native commands and resolves the hosting window from that caller. Tauri rejects the previous `WebviewWindow` command argument after a second webview is added (`current webview is not a WebviewWindow`); the old signature prevented the control actions and accent read from running. The exact local-frame label is still required, so the remote Lens pane cannot operate window controls. Reload now uses native webview navigation.

The Google content pane has consistent 20 px side/bottom insets and a 76 px header offset, aligned with the glass frame. Its initial zoom fits a 1120 px desktop layout to the available width, bounded from 65% to 100%. The capture toolbar uses a centered 300 px two-column grid, equal 40 px button heights, and a full-width centered Esc hint, with a viewport-width cap.

Studio creation runs on a serialized worker from all entry points. A new Studio starts hidden and unfocused with a black native background. Its local startup helper signals `studio_ready` after layout, then fades in the UI; a 50 ms fallback avoids waiting forever for suspended animation frames in a hidden WebView2. Startup failures use the same reveal path to keep the error/retry screen accessible. Opening an already loaded Studio restores/focuses it. The Island uses its existing animated dismissal when Studio opens. The readiness command checks the trusted Studio caller and shutdown state.

497 Node tests pass, including the actual startup-helper readiness/hidden-frame tests and local-controller regression tests. Frontend syntax/imports and HTML asset references are checked. Native Windows compilation and visual testing remain unavailable here; supplied screenshot paths were missing.

## Capture timing and dock icon repair

Quick → Circle to Search now disables duplicate clicks, completes the existing Island dismissal, then requests search only if the Island is still closed. Reopening the Island during the exit cancels that pending button action.

Capture preparation now runs a synchronous hide barrier on the native UI thread: it hides the Island and any previous search overlay, confirms the Island is no longer visible, and acknowledges success before the compositor settling interval and GDI capture. Capture fails safely if hiding or scheduling fails. The barrier also covers the global shortcut, and ignores expired search sessions. The previous acknowledgement confirmed only the old search overlay's hide, leaving the Island hide as separate queued work.

The Desktops dock icon is now layered workspace windows with the same rounded, outlined geometry as the other dock icons. Display retains its monitor/stand icon.

All 497 Node tests pass; the actual Island controller timing test verifies no early capture request and one search for a double click. Native Windows compilation and visual testing remain pending.
