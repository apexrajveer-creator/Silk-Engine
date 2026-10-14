# 1.0.0
- Tab changes: the content fades out (0.14 s), the page swaps while invisible, then fades in (0.24 s). One layer, opacity only, so heavy pages can no longer make the fade stutter. Clicking another tab mid-fade just retargets.
- Creator account sign-in reworked:
  - Two clear steps: email, then the code. The code step appears only after the email is sent.
  - "Send code" shows "Sending…" and a message right under the form says where the code went
    (or what went wrong: invalid email, no connection, wrong or expired code).
  - Resend with a 60-second countdown, "Use a different email", Enter submits each step,
    and the code field accepts digits only.
  - Signed in: an account card with your email and Sign out. Sign out no longer shows while
    signed out.
  - Your sign-in is remembered between launches; an expired session asks you to sign in again.
- The dialog's close button is a centred icon (the × character sat off-centre).
- New app icon: the ECHELON cobalt silk (rendered by the Living Silk shader) with the silver bird on top. Small sizes (16-48 px) use a softened background and a larger bird so it stays readable in the taskbar and tray.
- Widgets tab redesigned:
  - Widget gallery as tiles with an icon, a one-line description and an add button (3 per row).
  - Toolbar: display picker, a Snap to grid switch, undo/redo as icon buttons, a "Saved" pill.
  - The preview is framed like a monitor; a faint grid appears over it while snapping is on, and an
    empty display explains how to start.
  - Selection handles are round and sit on the corners.
  - Layers show each widget's type icon with proper eye and lock icons (locked turns orange,
    hidden layers dim).
  - Calmer inspector fields; audio status sits in a row under the preview.
  - New widgets cascade instead of landing on top of each other.
- Widgets layout: the preview is first, at the top of the main column; "Add a widget" tiles sit directly below it at the same width; Layers and Customise fill the right column and stay in view while scrolling.
- Desktops tab redesigned: profile cards with a monogram, Apply plus icon buttons for update and delete, and a clear empty state; the playlist is a thumbnail picker that numbers your selection in order, with Select all / Clear, compact settings (display, interval, shuffle switch) and a summary bar ("4 wallpapers, changing every 5 minutes") beside Save playlist.
- Display tab redesigned: a live preview of the current wallpaper that shows colour, grain and vignette changes as you drag; one-click Looks (Natural, Vivid, Cinema, Warm, Cool, Muted); groups with icons, Rendering/OLED/Clock/Overlays on the left and Colour/Finish on the right, with Reset links for Colour and Finish.
- System tab redesigned: performance presets as cards (Quiet / Balanced / Smooth) that show which one is active; Power on the left, Input and Windows on the right, with icons; Maintenance split into Troubleshoot, Backup & transfer and Reset lists, each action with an icon and a one-line explanation (reset in red).
- Fixed: "Save playlist" floated over the wallpaper cards on a black bar. It now sits at the end of the
  playlist settings row; the summary line moved under the selection count.
- New performance preset: Max (144 fps, High quality).
- System layout balanced: 4 equal preset cards; Power, Input and Windows in 3 equal columns; the 3
  maintenance lists share the same columns; panels in each row are the same height with evenly spaced rows.
- Reaction–Diffusion is replaced by Glacier: cascading curtains of glossy liquid glass (layered sine folds lit as a surface with a key light, sharp specular highlights and gentle relief). Palettes: Glacier blue, Aurora, Ember, Amethyst, Silver or a custom colour; speed, waviness, wave size, detail, gloss, brightness and cursor ripples; reacts to audio. It is cheap enough to render near display resolution, so it stays sharp. Existing Reaction–Diffusion assignments, presets, favourites and playlist entries move to Glacier automatically.
- Glacier is replaced by Ferrofluid: mirror-black magnetic liquid in a dark studio. Invisible magnets drift under the pool and the liquid rises into hexagonally packed needle spikes where the field is strong enough; the surface is lit only by reflections (softbox panels, a strip light and a key light), so it reads as wet black liquid. Finish: Ink black, Graphite or Liquid chrome; magnets, drift speed, spike size and height, reflections, brightness and a cursor magnet (spikes rise under your mouse). Spikes leap on the beat with audio reactivity. Rendered as a height-field raymarch with the magnetic field precomputed into a small texture each frame. Anything that used Reaction-Diffusion or Glacier moves to Ferrofluid automatically.
- Ferrofluid is replaced by Lissajous: a slowly turning 3D Lissajous figure traced like an oscilloscope, drawn as real antialiased geometry so it is sharp at any resolution, with two faint echo strands for depth, a 16-bit phosphor trail and a subtle halftone dot background. It morphs between classic frequency ratios over time; with audio on, bass breathes the size, highs lift the glow and the beat kicks the phase. Colours: Phosphor white, Silver, Cobalt, Amber CRT, Green CRT, Spectrum or custom; motion, line weight, glow, trail, audio response, halftone and brightness. Anything that used Reaction-Diffusion, Glacier or Ferrofluid moves to Lissajous automatically.
- Lissajous now draws your audio: with sound playing, it becomes a live XY oscilloscope like the synth (each waveform sample plotted against the sample a quarter of the buffer later), with smooth Catmull-Rom curves between samples, automatic gain so the figure fills the frame, and brighter strokes where the signal is strong. When silent it eases back to the turning 3D figure. New "Draws" setting: your audio when playing (default), audio only, or figure only. The Rust audio thread now sends a 512-point waveform aligned to a rising zero crossing with each update (~3 KB).
- Fixed: simulations looked low-resolution in the Library hero (the 960 px card thumbnail was stretched
  full width). The hero now gets a real render at its actual pixel size (up to 2560 px, Ultra internal
  quality), cached permanently and crossfaded in over the thumbnail.
- Lissajous with real music: the waveform is low-passed (wide Gaussian, twice) so hi-hats and cymbals
  no longer turn the trace into a scribble; each new waveform blends with the previous one so the
  figure flows; one clean strand with a finer core, tighter glow and shorter trail in audio mode;
  auto-gain uses the smoothed signal so the figure fills the frame; the halftone recedes under bright
  light instead of showing through the glow.
- Lissajous is now "Visualizer", with a new Cymatics mode: sand on a vibrating plate gathering along the still lines of real Chladni-plate patterns (square or round plate), drawn as crisp antialiased sand ridges with fine grain. Pitch picks the pattern (bass-heavy music gives simple figures, brighter music intricate ones), patterns melt into each other, and the sand jumps on the beat; when silent it drifts through the patterns. Settings: Mode (Lissajous / Cymatics), Plate, Sand grain, plus the existing colour, motion, line weight, glow, trail and halftone. Existing installs rename the built-in automatically.
- Cymatics reworked: the flat plate now fills the whole screen, and instead of cycling a fixed list of
  patterns the sand field is a live blend of 12 vibration modes, each driven by its own slice of the
  music's spectrum, so the pattern follows the music; silent, the mode strengths drift on unrelated slow
  rhythms and never repeat. The round plate is now a slowly turning sphere carrying spherical vibration
  patterns, with the flat field glowing faintly behind it and pulsing with the music.
- Visualizer, Lissajous mode rebuilt as a silk strand field: a family of up to ~240 hairline (~1 px,
  antialiased) 3D Lissajous strands, each a small phase step from its neighbour, so together they form
  translucent folded sheets; low-opacity strands accumulate additively so overlaps become the bright
  regions. Shapes: Silk fold (default), Orbital knot, Harmonic bloom, Ethereal veil, or slowly cycle all;
  everything moves by continuous parameter drift on slow unrelated oscillators, never jumping. Music:
  bass breathes the size, mids deepen the folds, treble adds a fine shimmer, beats send a soft fold
  impulse. One instanced GPU draw; strand count follows Render quality and the new Strand density
  setting. Colours: Pure white (default), Silver, Ice blue, Cobalt, Violet, Cherry, Forest, Amber or
  custom. The raw XY audio scope (the "scribble") is no longer the default.
- Theme sync is much faster to react. Before: the wallpaper was sampled 2.5 s after a change, Rust
  refused any change within 15 s of the last one and silently dropped it, and moving scenes refreshed
  every 5 minutes. Now: the first sample is ~0.35 s after a change, followed by two more at ~1.6 s and
  ~4.2 s (simulations start nearly empty, so the first frame isn't always the final look); Rust's
  throttle is 600 ms and a held-back change is retried instead of lost; moving scenes refresh every
  30 s; changes too small to see are skipped so Windows isn't broadcast to for nothing.
- The "Visualizer" wallpaper is now called "Harmonics" (existing installs rename automatically), and it opens in Cymatics mode on the Sphere plate by default. The
  "Visualizer" audio widget on the Widgets tab keeps its name.
- Cymatics reacts far more visibly to music. The existing lines themselves morph (nothing is added on
  top, so lines and grains never overlap): each of the 12 vibration modes now has its own morph phase
  that advances with its slice of the spectrum and takes a kick on every onset in that slice, so a new
  note makes its part of the pattern flow immediately; the pattern's scale follows the pitch (the
  spectral centre: low sounds open into big bold shapes, high sounds tighten into fine lace); beats
  make the whole field swell and the sphere pulse; a smooth warp bends the lines, deepening with
  loudness with its ripple speed following the treble; faster attack and release, sharper contrast
  between bands, a slow automatic gain so quiet and loud passages both use the full range, and line
  weight that swells slightly with loudness. In a synthetic-song test the picture changed up to ~9x
  more than in silence. "Audio response" scales all of it (default 70; raise it for more).

- Theme sync now reliably tints the taskbar and Start. Windows only does that when "Show accent color
  on Start and taskbar" is on and the system theme is dark, which theme sync never switched on before, so
  only title bars and highlights changed. It now turns both on (apps keep their own light/dark choice) and
  puts your original values back when theme sync is turned off.
- Harmonics now defaults to a blue (#0e54d8) Cymatics sphere, and its thumbnail and Library hero show it
  (they were still the old white Lissajous image). New "RGB (reacts to music)" colour: the hue cycles
  round the wheel, faster with loudness and nudged along on every beat.
- Harmonics reacts to music much more closely. A new analysis stage auto-levels the 32-band spectrum and
  smooths it like an equaliser (fast attack, slower release), then derives bass / mid / high envelopes,
  loudness, an onset envelope and a music clock. Lissajous: every strand of the silk glows and ripples with
  its own slice of the spectrum, onsets send ripples of light across the sheet, bass breathes the size,
  mids twist the folds, highs shimmer the filaments, louder music turns it faster, and a big hit changes the
  figure. Cymatics: no more per-beat jitter; the sphere spins and swells smoothly with loudness and bass.
- New very subtle "Stars & nebula" background (slider, default 70%): a faint flowing nebula in the wallpaper's colours plus
  three layers of twinkling stars. Each star has its own rate and listens to its own part of the spectrum
  (bass stars swell, treble stars sparkle), and the nebula flows faster and glows brighter with the music.
- "Pause screens that are covered" and "Hibernate when every screen is covered" are now off by default (existing installs keep their current choice).
- Living Silk no longer reacts to sound: its speed, glow and beat ripples are steady. The cursor still
  disturbs it.
- CI fix: the "About has creator attribution, keyboard bird interaction" browser test was flaky (it
  failed on the v1.0.0 tag run and passed on main for the same commit). Tab changes fade out and
  swap pages ~140 ms later, and the bird only wakes up once About is the visible page; the test
  focused the bird without waiting for that, so on a fast runner the Enter key went to a hidden
  page. The test now waits for About to be visible. Reproduced by stretching the fade to 900 ms
  (the test failed with the exact CI error), then verified passing under the same condition.
  playwright.config.js also retries failed tests twice on CI, so a one-off hiccup on a noisy runner
  shows up as "flaky" in the report instead of blocking a release.
- Harmonics: the default plate is Sphere (Full screen is one click away in the Plate setting). The sideways part of the cymatics
  warp is cut to ~1/7 (it swayed lines up to ~100 px left-right at 1080p on loud passages) and the
  beat jitter is almost purely vertical; the vertical morph is unchanged. The card thumbnail matches
  the default, and cached previews are refreshed (PREVIEW_VERSION p4).
- README rewritten for 1.0.0: new header and screenshots (rendered from the real app), the four
  built-in wallpapers (Reaction-Diffusion is gone; Harmonics is documented), the Studio tour, install
  and build instructions with the correct 1.0.0 file names, tests, releases, the web wallpaper API,
  project layout and an honest status section. The old docs/*.png images (they showed retired
  scenes and the old interface) are replaced by docs/*.webp.
- The installers now carry the app's identity. Tauri's setup program and MSI do not use the app icon
  by themselves, so tauri.conf.json now sets: `installerIcon` and `uninstallerIcon` (the cobalt-and-bird
  icon.ico), a branded header and sidebar for the setup wizard (`headerImage`, `uninstallerHeaderImage`,
  `sidebarImage`), and a banner and dialog image for the MSI (`bannerPath`, `dialogImagePath`). The four
  BMPs live in src-tauri/installer/ (150x57, 164x314, 493x58, 493x312). `npm run verify` now checks that
  they exist and have exactly those sizes, so a bad image fails the quick check instead of the end of a
  long release build.
- Installer images reworked. The MSI banner decoration is now a narrow 54 px tile at the far right
  (it was 150 px wide and the page description, up to ~370 px long, ran across it). The MSI images are
  supplied at 2x (986x58*2 and 986x624) with identical proportions, which Windows scales to the dialog,
  so they stay sharp at 100%, 125% and 200% display scaling; the setup-wizard images keep their exact
  fixed sizes (150x57 and 164x314). Everything is drawn at 4x and downsampled for smooth text. The
  sidebar and welcome panel now read: SILK ENGINE / BY RAJVEER RAJ / AN ECHELON PRODUCT.
  `npm run verify` enforces the sizes (exact for the wizard, whole multiples for the MSI).
- New wallpaper: Spectral Terrain, a ridgeline plot of the music in the manner of a famous pulsar chart.
  Every row is a moment of the spectrum; rows slide back and each hides the ones behind it with a black
  fill. Hairline antialiased lines at native resolution, a pulsar layout (lows in the middle) or a
  spectrum layout, and it keeps producing pulsar-style bursts in silence. Settings: layout, colour,
  rows, scroll speed, peak height, roughness, audio response, width, perspective, fade into the
  distance, peak highlight and line weight. It is the fifth built-in and existing libraries get it on
  first launch. The simulation cards now always share one row.
- New: global hotkeys, system-wide and working with Silk Engine in the tray. Next, previous and random
  wallpaper, pause, OLED, brightness, render quality, audio and cursor reactions, open the Studio,
  widgets, restart and apply desktops 1-5. Defaults are Ctrl+Alt+Shift plus a key; all are rebindable in
  System -> Hotkeys, where a shortcut is recorded by pressing it. A shortcut must use at least two of
  Ctrl, Alt, Shift and Win (so Ctrl+C can never be taken over), Windows-reserved combinations are
  refused, duplicates are caught and named, and a shortcut another app already owns shows "In use by
  another app" instead of failing silently. While recording, the live hotkeys pause; they resume by
  themselves after 30 s or when the Studio closes. Registration runs on its own Windows thread
  (src-tauri/src/hotkeys.rs); the Studio's copy of the rules is checked against it by a test.
- Fixed: the renderer stress script still referenced the retired Reaction-Diffusion wallpaper.
- Tests: 69 unit tests (10 new for hotkeys, Rust parity and the terrain), 12 browser tests (2 new), and
  Rust tests for shortcut parsing, the safety rules, defaults, config compatibility and the new built-in.
- New wallpaper: Cell Garden, Conway's Game of Life as an arcade cabinet shot like a film. A GPU cellular
  automaton (one pass per generation, a fixed number of generations per second whatever the frame rate)
  with the picture cross-fading between generations so births brighten and deaths fade. Six rule sets
  (Life, HighLife, Day & Night, Seeds, Coral growth, Brian's Brain). Arcade squares, LED tiles or round
  dots over a faintly lit dead grid; white-hot births cooling into a settled colour; afterglow; a tight
  and a wide bloom, horizontal anamorphic lens streaks, CRT scanlines, vignette, filmic highlight roll-off
  and a slow camera drift with a punch on the bass. Palettes: phosphor, amber, arcade, Game Boy, embers,
  ice, cobalt, RGB, custom. The music plants the garden (beats launch glider volleys, onsets plant the
  R-pentomino, acorn, spaceships and the odd glider gun, treble scatters sparks); a once-a-second health
  check replants anything dead or frozen; the cursor paints and a click plants a seed with four gliders;
  mirror or four-fold symmetry keeps the garden an exact mandala; an optional pixel-font readout shows
  generation and population. It is the sixth built-in; existing libraries get it on first launch.
- The Library's built-in row now fits six cards; longer names such as "Spectral Terrain" wrap onto a second
  line instead of being cut off.
- Fixed before release: Cell Garden's once-a-second check used a field named `health`, which hid the `health()`
  method the renderer's heartbeat calls on every scene (only the video scene has one), so the packaged app
  showed "gr.scene?.health is not a function". The field is renamed, and a new contract test fails if any scene
  ever gives a field the name of a method the renderer calls (the heartbeat only runs inside the real app,
  which is why the browser tests never saw it).
- Tests: 84 unit tests (12 new for Cell Garden, 3 for the scene contract: the pattern library is checked against an independent
  reference implementation of Life: glider headings, the R-pentomino settling at 116 cells after 1103
  generations, the acorn at 633 after 5206, the diehard vanishing after 130, the Gosper gun adding a
  glider every 30 generations; plus rules, symmetry, wrapping, planting and gardener logic), 12 browser
  tests, 25 Rust tests.
- Fixed: starting with Windows could open an empty black console window and a blank app. Cause: switching on
  "Start with Windows" while running a development build (`tauri dev`) registered that development exe under
  target\debug as the startup item; Windows then ran it at login, and a development build keeps a console open and
  needs the dev server for its interface. Now: a development build refuses to register itself (with an explanation,
  and the switch goes back); on every launch the app reads back its own startup entry (autostart.rs) and removes a
  leftover development entry, or, in an installed app with the setting on, rewrites the entry with the real path;
  the diagnostics report shows what Windows will launch at login. The installed app still starts the way Steam
  does: `--hidden`, silently into the tray with the wallpaper running, no console, and it keeps retrying the
  desktop attach every half second until Explorer is ready. To clear an old entry, start any new build once (or
  switch it off in Task Manager -> Startup apps).
- New: in an RGB colour mode (Harmonics, Spectral Terrain, Cell Garden) theme sync pins the Windows accent to a
  dark grey (#1b1b1d), so the taskbar and Start go dark and stay put instead of chasing the cycling colours (and
  hammering the registry); other palettes follow the picture as before. The pin is a pure, tested function
  (accent.js); a test fails if a new RGB mode is added without a decision about it.
- Tests: 88 unit tests (3 for the startup rules in Rust, 4 for the RGB accent, plus the scene contract), 29 Rust tests.
- New: the top-edge island (see README). Cursor to the top-centre of a screen and a bar slides in (time, CPU, memory);
  click it and it opens into a liquid-glass panel with Quick settings (Wi-Fi, Bluetooth, volume, wallpaper switches,
  Settings shortcuts), Clipboard history, System stats, most-used Apps, Wallpapers and Power (second tap to confirm
  sign out, restart and shut down). The hot-edge decision is a tested state machine (dwell, never during a drag or a
  full-screen app, stays while near, no instant re-pop after dismissing). The window is non-focusable until clicked
  open, created on demand and destroyed after five idle minutes. Clipboard history and app usage are opt-in,
  in-memory / local only, and explained in the island. New hotkey Ctrl+Alt+Shift+I; System -> Island has the switch
  and the reveal delay.
- New: crash handling. Panics write a crash report and a log line, the app restarts itself (bounded), three rapid
  crashes start safe mode with the user's settings backed up, and the Studio offers to restore them.
- Fixed (found by the new tests): Fluid Ink and Cell Garden could be frozen by an absurd time step or audio level (a
  loop of billions of iterations); audio is now sanitised once at the renderer's entry (src/shared/audio-input.js) and
  both scenes bound their work. Also fixed: palette colours could be NaN, schemaFor accepted inherited names such as
  "constructor", smoothBands choked on non-numeric history, Cell Garden's glider volleys scattered instead of flying
  in formation, and the Library card titles were cut off.
- Tests: 418 unit tests (catalog, archive attacks, formulas, all six scenes with GPU-leak checks, island model, audio
  sanitiser, ...), 115 pure-logic Rust tests runnable anywhere plus the platform ones in CI, 46 browser tests.
- Fixed: the island opened an invisible window. Tauri 2 only lets a window use the event system if its label is in a
  capability file, and "island" was missing from src-tauri/capabilities, so its page could never hear "show yourself" and
  stayed fully transparent. Now it has its own minimal capability (core:default only). Also fixed: on the very first reveal
  the app's "show" could arrive before the page had loaded (the page now asks for a missed show with island_ready), a
  failure to create the island window is written to the log and the diagnostics instead of being swallowed, and the armed
  Power button now glows instead of pulsing in size, so a confirmation never moves under your finger.
- New safeguard: tests/contracts.test.cjs reads the real Rust and the real page and checks that every window the app creates
  has a capability, every event the app emits is one the page listens for (and vice versa), and every command the island
  calls is registered. The browser preview pretends all of these exist, which is how the missing capability slipped through;
  putting the bug back makes three of these tests fail.
- Tests: 430 unit tests, 30 island browser tests, 15 Studio browser tests.
- Fixed (the real reason the island never appeared, neither by hotkey nor by cursor): WebView2 shares one profile folder
  between all of the app's windows and refuses to create a window whose browser arguments differ from the others'
  ("the resource is not in the correct state"). The Studio and the wallpaper pass BROWSER_ARGS; the island did not, so its
  window could never be created. It now does. A failure to create the island window is now also shown on screen in the Studio
  (an app-error toast and the diagnostics log), not only written to the log. tests/contracts.test.cjs now fails if any window
  is built without the shared BROWSER_ARGS (verified by removing the line).
- Island: removed the pointer-following highlight (it read as a large halo around the cursor). Fixed the appear-and-disappear
  blink: the page's "show" handling is now idempotent and only ever moves forward (hidden, peek, open), so a repeated show
  message (the first reveal sends one as an event and one from the page's own "did I miss one?" check) no longer restarts the
  fade; a focus-loss in the first 700 ms after opening is ignored (the window is settling, it is not a click away); a bounced
  hotkey press within 350 ms is ignored; the cursor counts as "on the island" with a 12 px margin; and every hide now writes
  its reason to the log ("the cursor moved away", "clicked somewhere else", "the hotkey", ...) so a surviving blink can be
  diagnosed. Verified by putting the old logic back: the page went peek > hidden > peek > hidden > peek, and the new test fails.
- Tests: 432 unit tests, 118 pure-logic Rust tests, 35 island browser tests.
- Island: the Quick tab now has a media card. It shows whatever is playing in any app that appears in Windows' media flyout
  (title, artist, the app's name, the artwork, with a blurred copy of the artwork glowing behind the card), a progress bar that
  moves smoothly between polls and can be dragged to seek, and previous, play/pause and next; it answers a tap at once and
  confirms with the player a moment later. Artwork is read once per track and cached; the player is only polled while the Quick tab
  is on screen. With nothing playing it shows a calm empty state with the controls dimmed; a player that cannot skip or seek has
  those controls dimmed; a live stream shows "Live". The six switches shrank into one compact row (their state is in the tooltip and
  for screen readers), the volume bar is slimmer, and the panel is slightly taller. Found while building it: a clipped container
  can still be scrolled by focus, which shifted the card's contents after a track change; the card and shell now use overflow: clip.
- Tests: 444 unit tests, 134 pure-logic Rust tests, 51 island browser tests.
- Island, three fixes. (1) The morph from the bar into the panel is smooth: the window used to be resized at the moment you
  clicked, which stretched the page for a few frames, and the panel's contents re-laid-out on every frame of the growth. Now the
  window keeps one size for as long as it is visible (while only the bar shows, it is clipped to the bar with SetWindowRgn so the
  rest still clicks through, and if Windows refuses the clip it falls back to the old resizing and logs it), and the panel and bar
  keep their final layout and are revealed by the growing glass. Tests sample the glass every frame (centred, steady, one settle, panel
  width constant) and fail on the old layout. (2) Apps are bubble buttons with each program's real icon (read with
  PrivateExtractIconsW, encoded as a PNG by a small encoder that an independent decoder confirmed pixel for pixel, kept after the first
  read; only for programs in the tally and plain .exe files), a neutral glyph when there is none (never a letter), friendlier names
  ("Snipping Tool", "Stremio") and Windows' own helper processes (ShellHost, SearchApp...) filtered out. (3) The Wallpapers tab no
  longer overlaps its tiles (fixed row height), shows real thumbnails for videos and images through the Studio's own thumbnail module
  and cache, and no scrolling area shows a default scrollbar any more (scrolling still works).
- Also fixed while testing: the PNG encoder could panic on a zero-sized image (a panic ends the app in a release build).
- Tests: 446 unit tests, 146 pure-logic Rust tests, 65 island browser tests.
