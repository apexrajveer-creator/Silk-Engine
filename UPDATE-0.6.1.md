# Silk Engine 0.6.1 — Sharp previews and hardening

## Update

Quit Silk Engine from the tray, extract this source update and run `npm install`, `npm test`, then `npm run dev`. On Windows, `npm run build` creates the installers. The app identity and settings location are unchanged. Preview caches migrate automatically; no manual cache clearing is needed.

## High resolution previews

The Library hero and Widgets wallpaper preview previously enlarged a 480-pixel video/image still; simulation snapshots were 384 × 216. They now request captures based on the visible card dimensions and Windows pixel scaling, up to 3840 pixels wide. Media captures preserve original aspect ratio and do not upscale a low-resolution source. WebP quality increases from 82% to 95% for media. Simulation output is sized to the preview and uses a higher scene quality budget; some simulations still use their internal numerical grids.

Resizing Studio, revealing a tab or changing scaling upgrades the preview when needed. Widget text and graphics use the actual device pixel ratio instead of a 1.5 cap. Canvases retain allocation limits: about 8.3 million pixels for the editor, 4.2 million per desktop widget and 16.8 million across desktop widgets. Unusually large/many widgets can reduce resolution to stay within these limits.

These are sharp still previews, not continuously playing video mirrors. A low-resolution original cannot gain detail through upscaling. Existing hover playback remains available.

## Resource use and lifecycle

- Captures remain serialized and deduplicate concurrent requests for the same item/resolution. Video decoders, timeout handlers and canvas capture buffers are released afterward.
- The memory thumbnail cache is limited to 48 entries / 32 MB of compressed image data; the persistent cache is limited to 96 entries / 64 MB. Decoded DOM images use additional memory. The old low-resolution cache is replaced automatically.
- Object URLs and hover listeners are released when previews are replaced or removed; stale async hover results cannot attach to removed cards.
- Preview observers update only when a higher resolution is needed, with a resize debounce. Simulation snapshots share a context and keep at most 12 cached results.
- The desktop widget canvas budget now covers the entire layout instead of only individual widgets.
- Studio close requests wait for pending widget saves. A failed save keeps Studio open with a retry message. Forced process termination or tray Quit is not a guaranteed save barrier for unsent edits.
- Cancelled/superseded skin imports cannot overwrite a later import result. Dragging is protected against concurrent keyboard edits and incoming layout replacement.

## Security and reliability changes

- Native settings mutations now share the same transaction lock as widget saves and restore, preventing lost settings during concurrent writes. Failed persistence preserves the previous in-memory configuration and reports the error.
- Startup, recovery and restore reads are bounded to 16 MB. Saves/backups also enforce that limit.
- Web wallpaper file paths are canonicalized and must remain inside their registered folder, including when symbolic links or junctions are present. Null bytes, backslashes and colon-containing protocol paths are rejected.
- Percent decoding uses byte operations, avoiding a panic on malformed Unicode escape sequences.
- Media byte ranges validate bounds and use saturating arithmetic. Suffix and open ranges are limited to 2 MB per response. Unranged reads are capped at 64 MB, HTML entry pages at 8 MB. Large media must use byte ranges, as the native video element normally does.
- Protocol serving accepts GET/HEAD only and sends a nosniff header on ordinary file responses.
- The WebView2 argument disabling SmartScreen protection was removed.
- The wallpaper compatibility shim accepts messages only from its parent window and validates audio/cursor values.
- ZIP central-directory lengths and payload bounds are checked. Existing size, count, CRC, duplicate-path and traversal checks remain.
- Rainmeter parsing bounds formula size/token count, variable expansion, includes, section count and style recursion work. DLL/EXE/Lua payloads remain unexecuted.
- Saved widget layouts discard duplicate IDs and malformed skin entries, clamp dangerous numeric values and allow only embedded raster skin image types.
- Release CI now runs frontend tests, Rust tests and Clippy before installer creation. Check CI has read-only repository permissions and cancels superseded runs.

## Verification

26 JavaScript regression tests pass. New checks cover HiDPI sizing and allocation bounds, source-resolution preservation, formula/variable exhaustion, invalid widget data, folder limits, thumbnail deduplication/resolution/decoder/timer cleanup, message sender checks and truncated ZIP directories. Existing rendering, pause, decoder-recovery and widget tests also pass. The included demo ZIP imports successfully. JavaScript syntax and JSON validation pass.

Native Rust tests were added for range overflow/bounds and malformed Unicode decoding. They have not been run here. This environment has no Rust toolchain, Windows runtime or installed browser runtime, so no Windows compilation, pixel-level visual check or hardware performance benchmark is claimed.

This is a targeted hardening pass, not proof that every possible edge case or vulnerability has been eliminated. Dependency vulnerability scanning, signed installer distribution, external security review and broad Windows hardware testing remain release work.

## Windows checks before publishing

1. Open the exact video from the screenshots. Verify the hero and Widgets background are crisp at 100%, 150% and 200% scaling; resize and maximise Studio. Compare with the original file.
2. Test image, video and all simulation previews, including a portrait image, missing file and unsupported codec. Switch tabs and hover cards rapidly; verify no orphan video playback.
3. Add widgets, close immediately after a change, reopen and confirm persistence. Exercise import/cancel/import, undo, drag, lock, duplicate, colours, audio and backup/restore.
4. Play a large video and seek near the end. Test two displays, mixed DPI, fullscreen, lock/unlock, sleep/wake, battery policies and Explorer restart. Repeat the previous release acceptance checks.
5. Run Windows CI and build the installer. Measure all Silk/WebView processes during idle, audio visualization and a long session. Confirm resource usage settles after closing Studio.

API reference used for close handling: https://tauri.app/reference/javascript/api/namespacewindow/.
