# 0.9.3 — ECHELON identity page

The About/Info page is now a borderless composition built around the original silver ECHELON bird, oversized outlined SILK lettering, a contrasting italic Engine title, and the explicit creator credit “Imagined & created by Rajveer Raj”.

The title and creator name enter in staggered sequences. The bird responds to pointer position with a small tilt, and clicking it or Take flight plays a short lift/ripple animation. Both controls support Enter and Space. Reduced-motion mode presents the same page without movement. No perpetual animation loop was added: pointer frames are scheduled only on input and cancelled when leaving About. Layouts adapt to narrower windows. Technical information is available in an unboxed App details disclosure.

Existing native scrolling and 0.9.2 navigation improvements are retained. No glass panels are used within the About page.

Validation: frontend JavaScript syntax, CSS parsing, asset links, HTML IDs and version consistency pass; 45 existing JavaScript tests pass. The new browser test is included but was not run here. No Windows visual/runtime verification is claimed.

Upgrade: quit Silk from the tray, extract into a fresh folder, copy your working src/community/config.json, then npm ci and npm run dev. No database change.
