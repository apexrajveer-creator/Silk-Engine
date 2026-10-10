# Silk Engine 0.6.2 — Widget preview recovery

This hotfix addresses blank-preview failure paths seen while investigating saved widget layers with selection handles but no visible content. The exact Windows failure from the screenshot has not been reproduced locally.

- Editor activation now happens after its tab is revealed, replacing the arbitrary delayed repaint. Zero-sized canvases retry, and returning to Studio resets stale frame requests.
- The editor shows and allows arranging the layout even when desktop widget output is disabled. The footer explicitly reads “Desktop widgets off · preview only”; use the Widgets switch at the top to enable actual desktop output.
- Each widget restores canvas state in a finally block. A failing widget does not stop the remaining widgets or the redraw loop. The preview footer reports the failing widget and error instead of failing silently.
- Context restoration schedules a repaint. A missing context is reported and retried. Rounded rectangles have a path fallback for runtimes without roundRect.
- High-resolution sizing and existing saved layouts are retained.

29 JavaScript tests pass, including editor integration checks for disabled desktop output, hidden-to-visible activation and canvas-state restoration after an exception. An additional local Canvas2D raster check produced nontransparent clock pixels through the editor. These checks do not reproduce Windows WebView2 composition. Windows build and visual verification remain outstanding.

Quit Silk Engine from the tray, replace the project source with this folder, then run npm install and npm run dev. No settings reset is required. If the preview remains blank, report the exact preview footer message and whether widgets appear on the actual desktop.

See UPDATE-0.6.1.md for the preceding resolution and hardening changes.
