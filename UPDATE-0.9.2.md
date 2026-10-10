# 0.9.2 — navigation performance

- Removed custom wheel animation, preventDefault and scrollTop writes. Mouse and precision-touchpad input now use native browser scrolling, independently of JavaScript animation timing.
- Preserved page-edge bounce prevention and horizontal overflow clipping. Cards and panels allow native scroll chaining; dialogs retain their own scroll boundary.
- Removed live backdrop blur from the sticky header, dock and wallpaper-card controls. Glass gradients remain; full-screen scroll no longer needs those blur surfaces to sample moving content.
- Paused the decorative Studio shader and hover videos during scroll/tab navigation. Work resumes after 180 ms idle; video previews require a new hover. Wallpaper output itself is unchanged.
- Deferred simulation preview work during navigation. Library-card previews are requested only as cards approach the visible viewport, rather than decoding the whole library on opening.
- Replaced the delayed 190 ms tab switch and repeated per-letter/per-panel entrance work with immediate navigation and a short opacity entrance. Each tab remembers its scroll position for the current Studio session.
- Keyboard search focuses on the next frame rather than a fixed delay. Existing editing shortcuts and focus rings remain.

Validation: 45 JavaScript tests and frontend CSS/syntax/asset/version checks pass. Superseded wheel-animation tests were replaced by a passive-input and idle-work lifecycle test. Existing browser tests remain included; Windows WebView2 scrolling and frame pacing have not been measured here. Native implementation is unchanged except application version metadata.

Install: quit Silk from the tray, extract to a fresh folder, copy your working src/community/config.json, run npm ci then npm run dev. Existing app-data settings are retained. No SQL migration.
