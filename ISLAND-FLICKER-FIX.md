# Dynamic Island stability pass

This source package includes the earlier expansion white-flash and content-flicker fixes plus a broader stability pass. Rebuild and restart Silk Engine for native changes to take effect.

## Transitions and native window lifecycle

- Transparent window backing and region changes avoid forced opaque background repaints.
- Native show, hide, expand, leave, and idle-destruction requests carry generation guards. Stale queued work cannot hide or destroy a newer reveal.
- Expansion and region/focus changes run together on the native main thread. Missing/hidden windows, placement failures, and focus failures are handled rather than silently reporting success.
- Pending first-load reveals are published before window creation; duplicate first-load/event reveals are idempotent.
- Closing while an expansion is pending cancels the frontend transition. Old native events are ignored.
- Focus loss during the opening grace period is rechecked afterward. Monitor removal, resolution changes, and scaling changes dismiss the old placement so the next reveal uses current geometry.
- Repeated selected-tab clicks do not restart animations or timers. Hidden panels and inactive tabs are inert to keyboard navigation; Home/End work on the tab row, and slider keys stay with their controls.
- Small/highly scaled work areas constrain the panel dimensions and allow scrolling; reduced-motion support is preserved.

## Refreshes and controls

- Each data poller permits one outstanding read, coalesces manual refreshes, and schedules the next read after completion. Stops, restarts, and user actions invalidate stale answers.
- Hidden tabs/windows stop polling; returning resumes the selected view once. Final page teardown removes subscriptions and observers.
- Unchanged clipboard entries, app buttons/icons, wallpaper tiles, and media icons are preserved. Real list changes preserve focus and scrolling where the focused item still exists.
- Media commands and repeated list/wallpaper commands are guarded against duplicate clicks. Quick-setting failures roll back the affected setting.
- Volume writes are serialized and coalesced, and pending input is flushed when interaction ends. Idle sliders synchronize external volume changes even while focused. Failed writes restore the last confirmed volume.
- Failed play/pause and seek commands roll back their optimistic state. Delayed media work and power-action dismissal cannot act on a newer panel session.
- Clipboard remove-button keyboard events no longer also copy the parent entry.
- Wallpaper selection displays success only after a successful command. Failed reads retain valid contents; wallpaper reads retry while the tab remains open.
- Native media-read failures propagate as errors rather than a false "nothing playing" state. COM initialization errors are handled. Artwork retries are bounded, and transient native no-art results expire.

## Resources

- Wallpaper thumbnails load near the visible scroll area, using 360-pixel captures suitable for the normal HiDPI tile size.
- Local thumbnail storage is capped at 24 entries / 8 MiB. App-icon storage is capped at 32 entries and concurrent requests for the same icon are deduplicated.
- Leaving the wallpaper tab revokes object URLs and clears its in-memory thumbnail caches. Queued captures check whether the tab still needs them before starting; active decoders retain the shared pipeline's existing timeout and release behavior.
- Late thumbnails/artwork cannot paint a departed view. Artwork requests are serialized and stale results are discarded; missing/corrupt artwork keeps the placeholder, with at most three attempts per track in a tab session.

## Validation and limits

- 474 Node tests pass, including 28 new lifecycle/controller regression tests using deterministic clocks and a minimal DOM adapter.
- All frontend JavaScript passes syntax checks; relative imports and HTML asset references resolve.
- 69 Island Playwright tests are discoverable, including the content-preservation regressions. They were not executed here: Chromium is unavailable and its download failed in this environment.
- No Rust/Windows toolchain is available here. The native build, actual WebView2/DWM behavior, mixed-DPI layouts, and display-change/focus handling must still be verified on Windows. This is a source update, not a prebuilt installer.
- Read serialization prevents accumulating duplicate work; it does not forcibly cancel a Windows system API call that never returns.

## Run on Windows

From the extracted project folder, run `npm install`, then `npm run dev` to check the update. Run `npm run build` for an installer. Fully restart an existing app instance.

Verify repeated peek-to-panel expansion; Esc during opening; rapid close/reopen; early click-away; all six tabs; external volume changes; media pause/seek; clipboard updates/removal; wallpaper switching and scrolling; reduced motion; and 100%, 125%, 150% scaling/display disconnect if available.
