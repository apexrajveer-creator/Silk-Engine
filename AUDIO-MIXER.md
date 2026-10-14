# Silk Engine 1.5.0 — Island audio mixer

Click the speaker beside the Quick tab's master volume to expand the audio drawer below it. Each app with a current Windows audio session gets its own volume bar. Sessions from the same executable on the same output share one bar; changing it adjusts all those sessions. Apps routed to different outputs have separately labelled rows. System sounds have their own row. Paused/inactive sessions remain adjustable until Windows expires them. Raising a muted app's volume unmutes that app.

The Output control lists connected playback devices. Selection changes the Windows console and multimedia default outputs; the separate communications default is preserved. Apps with an explicit output assignment, exclusive audio, or no automatic stream routing may need to change output within that app. Sound settings remains available for those cases and for Windows builds that do not support the output setter.

The mixer reads Core Audio only while the drawer and Quick tab are visible. Reads are serialized, stale responses are discarded, and slider writes are coalesced. Existing slider DOM nodes and focus survive refreshes. Pending edits flush when the drawer closes. Device/app disappearance is handled without relaunching any process. The wallpaper/compact Island loopback reconnects after an output switch.

Click media artwork to restore/focus an existing window for the displayed Windows media session. Native code checks both track and source identity again before acting, matches the app by executable/window AppUserModelID, and prefers a window whose title contains the track/video title. It never launches an executable or URL provided by the interface. If a browser's media tab is in the background, Windows does not expose its tab identity through this media API: the matching browser window is brought forward, but automatic selection of that exact hidden tab is not guaranteed. Unsupported/no-window players report a short message.

## Validation

- 519 Node tests passed, including ten real-controller tests for drawer lifecycle, stable sliders, ordered writes, final-edit flushing, output switching, disappearing sessions, rollback UI and media-click failure.
- Browser tests added for drawer geometry/accessibility, keyboard volume and artwork activation. Browser runtime is unavailable here; these tests are not claimed as executed.
- Rust/Windows build, live Core Audio volume/output switching and foreground-window activation require Windows verification. This environment has no Cargo/Rust or Windows runtime.
- The original full verifier requires css-tree, which is unavailable here. JavaScript syntax/import/HTML references were checked separately.
- The system default output setter uses a narrowly scoped legacy IPolicyConfig COM interface because Windows exposes no documented public setter. It validates a connected render endpoint, verifies both updated defaults and attempts to restore previous defaults on failure. No Explorer injection, registry editing, process spawning, elevation or new dependencies are used.

## Windows checks before distributing a build

1. Run npm install, npm run verify, npm test, then cargo test --manifest-path src-tauri/Cargo.toml and npm run build.
2. Open Spotify, a browser playing YouTube, and another app with audio. Change each bar and confirm other apps and master volume are unaffected. Confirm keyboard control, muted app behaviour and paused sessions.
3. Switch between speakers, wired/Bluetooth headphones and HDMI. Confirm selection, master-volume refresh and wallpaper/Island visualizer reconnect. Unplug an output during selection; confirm recovery and Sound settings access.
4. Drag a slider while its app closes and while switching tabs/hiding the Island. Reopen; confirm no stale rows, flashing values or polling while closed.
5. Click artwork with Spotify restored/minimized and YouTube in one/multiple browser windows. Confirm title-matched window activation; test a hidden browser tab and recognize the documented tab-selection limit.
6. Check the drawer at 100%, 125%, 150% and 200% DPI, including the smaller Island layout. Verify list scrolling, button alignment, focus outlines, theme/opacity inheritance and reduced motion.

Build correction: PROPERTYKEY is imported from Win32::Foundation in windows 0.62.2. This resolves the reported E0432 import error; Windows recompilation remains required.
