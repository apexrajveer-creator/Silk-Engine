# Silk Engine 0.9.0 — desktop profiles and everyday controls

Built from the supplied 0.8.0 Discover-fix archive. This is the first 0.9 implementation, not the completion of every feature in the larger roadmap.

## Included

- **Desktops tab:** save up to 24 named profiles containing per-monitor wallpaper assignments, spanning, display colours and overlays, per-wallpaper appearance, and widget layouts. Apply, update, delete and undo the most recent apply. Applying a profile stops a running playlist. Profiles reference existing local wallpaper files; they do not bundle media.
- **Background playlists:** choose library wallpapers, a display or all displays, an interval from 30 seconds to one day, and sequential or shuffle playback. Scheduling runs in the native watcher, including while Studio is closed. Missing library entries and unavailable local files are skipped. Shuffle avoids the current wallpaper.
- **Manual control wins:** choosing a wallpaper stops the playlist. Re-enable it from Desktops when wanted.
- **Power behavior:** playlists wait while manually paused, locked, hibernating, fully covered, or paused by the battery policy. The interval restarts after these states; the app does not catch up with a burst of changes.
- **Library controls:** favourites on wallpaper cards, local wallpaper search, favourites-only filtering and name sorting. The Simulations row stays separate from My wallpapers.
- **Performance presets:** Quiet (Eco/24 fps), Balanced (Adaptive/30 fps), Smooth (High/60 fps). These set rendering options; actual frame rates depend on hardware and workload.
- Existing Discover fetch correction and schema fix retained.

## Upgrade

1. Quit Silk from its tray menu.
2. Extract this ZIP to a new folder. Do not overwrite your old source folder.
3. Copy your working `src/community/config.json` into the new folder if you configured Discover. The supplied archive's connection file was blank; no project credentials were invented.
4. Open a terminal inside `silk-engine` and run `npm ci`, then `npm run dev`.
5. Your existing app-data settings are read automatically. New profiles, favourites and playlist fields default safely. The app identifier is unchanged.
6. In System, export your settings before experimenting with profiles. Undo apply restores the complete settings snapshot from before the most recent apply in the current Studio session, including other changes made since then. It asks for confirmation.

No new Supabase migration is required.

## Validation

- Frontend JavaScript syntax, CSS parsing, local asset references, HTML IDs, version consistency and lockfile verification.
- 42 JavaScript tests, including the Discover fetch fix and profile persistence/manual-play behavior.
- 10 native tests executed through a small Linux harness importing the actual configuration and playlist modules: persistence recovery, invalid imports, 0.8 migration, profile limits, playlist ordering, missing entries, wraparound and shuffle.
- Windows target compile/Clippy results are recorded in the packaged verification report.
- Browser automation tests include the new Desktops workflow. They could not be executed here because Playwright's browser download was corrupt. Run `verify-windows.cmd` on Windows before treating this as a release candidate.
- No Windows installer/runtime, Explorer recovery, suspend/resume, docking, or live Supabase end-to-end verification was performed in this environment.

## Remaining roadmap

Time/power/monitor-triggered profile rules, desktop packs, new task/focus widgets, global hotkeys, folders/tags, creator pages, and expanded monitor-layout recall remain future work. They are not represented as completed features in this build.
