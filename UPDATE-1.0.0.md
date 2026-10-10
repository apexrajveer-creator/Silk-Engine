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
