# 0.9.6 — Cinematic Library hero

The top of the Library is now one full-bleed frame instead of a boxed card and a dashboard.
- Starts behind the title bar, about 2.39:1, and dissolves into the silk background.
- Title card on the lower third, lined up with the grid: kicker (NOW PLAYING · DISPLAY 1), a clean
  title ("Cat In The Swamp Live Wallpaper 4K Dark Animated Background" -> "Cat In The Swamp"; the
  full name stays as a tooltip), and a short credits line.
- Customise plus previous / pause / next controls. ECHELON moved to the bottom-right as a studio mark.
- Ambient light: the wallpaper's dominant colour glows faintly into the page below.
- Motion: fade up from black on open, a dip to black between wallpapers, one slow 16 s push-in per
  wallpaper that then holds still, and scroll parallax. All off with Windows "Show animations" off.
- The Displays block only appears with two or more screens. Quick controls are a slim strip under
  the frame. The Add button is now white instead of blue so the picture leads.
- The eagle toggle now covers only the bird's area, not the whole frame.

Performance: measured in software rendering, idle and scrolling stay at 0.9.5 levels after the
push-in settles. The frame-rate test now lives in tests/browser/performance.spec.js with trace
recording off, because recording frames distorts frame timing.

Tests: 59 unit (3 new for titles), 10 browser (2 new for the hero), all passing.
