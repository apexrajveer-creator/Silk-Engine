# Silk Engine 0.9.1

## Interface fixes
- Removed favourite stars from all wallpaper thumbnails. Open a wallpaper's settings (gear or F2) and use Add to favourites / Remove from favourites.
- Rebuilt the Desktops page shown in the supplied screenshot: responsive profiles/playlist columns, subtle surfaces instead of broad grey glass panels, aligned controls, compact selectable rows, readable names with ellipsis and full-name tooltips, selection count, and a proper profile form (Enter saves).
- Preserved drag-selection blocking throughout the interface and normal editing in text fields.

## Keyboard
- Tab / Shift+Tab: controls, buttons, fields and wallpaper cards; visible focus rings.
- Alt+1 through Alt+6: Library, Desktops, Widgets, Display, System, About.
- Ctrl+F: local wallpaper search. Ctrl+O: add files.
- Arrow keys / Home / End: wallpaper cards, dock, segmented controls and widget palette.
- Enter / Space: activate focused buttons/cards and checkboxes. Native keyboard behavior remains for sliders and selects.
- F2: open focused wallpaper details. Ctrl+Enter: apply from wallpaper settings.
- Escape: close wallpaper settings/dialogs or deselect the widget. Wallpaper settings trap Tab focus and restore focus on closing.
- Ctrl+S: flush settings/widgets; in Desktops save the playlist.
- Widgets: Delete removes selected widget, Ctrl+D duplicates, Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes. Arrow keys move the widget from the preview/layers; Shift moves 10 pixels. Selecting a layer focuses the preview. Shortcuts avoid text fields and open dialogs.
- Enter in Discover email/code fields sends the code/verifies it.
- ? opens the shortcut guide. Also available in System > Keyboard shortcuts.

Also fixed local wallpaper state updates accidentally touching Discover cards, which have different child controls.

## Upgrade and checks
Quit Silk from the tray, extract to a fresh folder, copy your working src/community/config.json, then run npm ci and npm run dev. App-data identity and native behavior are unchanged; no database migration is needed.

This update changes frontend code and app version metadata. JavaScript tests and frontend syntax/CSS/asset verification pass. Browser/Windows runtime verification has not been performed here; browser tests covering favourites and keyboard editing are included for the Windows verification command. Prior 0.9.0 native checks are documented separately and were not rerun for this frontend-only patch.
