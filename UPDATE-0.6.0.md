# Silk Engine 0.6.0 — Widgets

This source update adds a Widgets workspace and a shared desktop/preview renderer. The existing app identity, wallpapers, settings, backups and no-drag-selection behaviour remain in place. No separate Rainmeter installation is required for supported imports.

## Run the update

Quit Silk Engine from its tray menu, extract this project and run `npm install`, `npm test`, then `npm run dev`. Run `npm run build` on Windows to create installers. This archive contains source, not a compiled installer.

## Design your desktop

Open Widgets, choose a display and add a clock, date, calendar, system meter, text or music visualizer. Drag it on the wallpaper preview; resize using the corners. Snapping follows an 8-pixel grid, edges and centre; hold Alt to bypass it. Arrow keys move by one pixel, Shift by ten. Ctrl+Z and Ctrl+Shift+Z undo/redo; Delete removes the selected widget. Position locking blocks movement and resizing.

The sidebar controls monitor assignments, visibility, order, duplication, colour, glass background, opacity and type-specific options. Changes autosave; a failed save exposes Retry save. Widgets can target one display or every display; missing display assignments fall back to the primary monitor. There are up to 64 widgets per layout.

Four visualizer styles are available: bars, mirrored bars, radial and spectrum ribbon. Enable system audio for actual desktop playback. Test visualizer generates explicit preview-only demo audio; it never becomes desktop playback. Colour changes appear immediately in the preview. System readings use Windows CPU and memory counters, not fabricated values; the browser mock shows unavailable counters.

## Import Rainmeter skins

Import `.rmskin`, `.zip` or `.ini`, or choose a skin folder to include its resources. Select the desired INI, review its compatibility report and add the converted skin. Try `examples/Silk-Demo-Skin.zip` for a clock/date/CPU example, or import its unpacked folder.

| Feature | Import behaviour |
|---|---|
| String, Image, Bar meters | Converted to the shared canvas renderer |
| Time, aggregate CPU, physical memory, uptime | Supported readings; memory converts to percentage |
| Calc | Basic arithmetic and named measure references |
| AudioLevel | Limited mapping to Silk’s 32 system audio bands |
| Variables, includes, MeterStyle, relative positions | Supported subset, resolved inside the package |
| PNG/JPEG/WebP/BMP/GIF image resources | Embedded assets; GIF renders as a still image |
| DLL plugins, Lua, shell/bang actions | Reported and never executed |
| Shape, Histogram, WebParser, NowPlaying and other measures/meters | Unsupported; omitted or reported |
| Dynamic actions/variables, full Rainmeter formulas/layouts | Not fully emulated; review the report |

This is a supported-subset conversion, not universal Rainmeter compatibility. Skins can need edits to look correct. Imported meter colours come from the skin; edit its INI and reimport to change them. Installed Windows fonts affect text layout.

Packages are read in memory without extracting executables. Limits: 32 MB compressed input, 2,000 entries, 24 MB retained expanded assets, 8 MB per retained file and 3 MB embedded images per converted skin. Traversal paths, duplicate paths, encrypted/ZIP64 packages and invalid CRCs are rejected. Layout storage is limited to 8 MB; undo history is bounded. Skin assets persist with the layout and are included in settings backups.

## Efficiency

Desktop widgets render only on visible displays. Fully covered/locked desktops stop widget work; existing hibernation releases the renderer. Idle clocks use a one-second timer; system polling runs every two seconds only when needed. Active visualizers cap at 30 fps, or 15 fps on battery, and stop continuous animation after audio fades. Canvases cover only widget bounds and cap pixel density at 1.5. Widgets remain behind desktop icons and do not intercept desktop input. Existing wallpaper/audio power policies still apply.

## Validation

19 Node regression tests pass, including the previous wallpaper/media tests, drag/resize bounds, missing-monitor fallback, compressed RMSKIN reading, traversal/checksum rejection, include/style inheritance, unsupported action reporting, safe formula parsing, measure bindings, canvas-state balance, editor wiring and corrupt-layout filtering. JavaScript syntax and JSON checks pass.

The Windows native build and visual layout have not been tested in this environment: Rust, Windows and a browser runtime are unavailable. Windows CI is configured for Clippy and Rust tests. Before release, check:

1. Build on Windows, open Widgets and verify the screen/sidebar layout at narrow and wide sizes and at 100%, 150% and 200% scaling.
2. Drag, resize, snap, lock, hide, duplicate, reorder, undo and change colour. Restart and verify persistence. Confirm panels/text cannot be selected by dragging while fields remain editable.
3. Enable system audio, play music and compare every visualizer style on preview and desktop. Stop audio, pause, cover displays, lock Windows and unplug power; verify reduced work and correct resume.
4. Import the demo ZIP and a skin with unsupported plugins/actions. Verify the report, images/includes and persistence; test a corrupt package and retry a failed save.
5. Assign widgets across multiple monitors, disconnect one and reconnect it. Check mixed-DPI positioning and desktop icon click-through.
6. Repeat the sleep/wake, Explorer recovery, media playback and backup/restore checks in UPDATE-0.5.0.md.

Rainmeter format references: https://docs.rainmeter.net/manual/meters/ and https://docs.rainmeter.net/manual/measures/.
