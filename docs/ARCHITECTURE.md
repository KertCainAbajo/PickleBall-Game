# Architecture

The game is plain JavaScript modules with no build step. PeerJS loads from a CDN; there are no other dependencies. The whole site is static files, so any static host can serve it.

```
index.html           screens, HUD, touch controls
style.css
js/
  engine/            game logic; never touches the DOM
    constants.js     court geometry, physics constants, helpers
    scoring.js       pure scoring state machine (side-out / rally, singles / doubles)
    world.js         deterministic physics: players, ball, net, bounces, paddle contact
    match.js         referee + match flow + statistics (the central engine)
    ai.js            CPU players (same intents and buttons as humans)
    practice.js      ball-machine drills with their own referee
    tournament.js    8-entry single-elimination bracket
  app/
    view.js          read-only view models for the HUD, renderer and results
    lessons.js       tutorial content
  render/render2d.js 2D canvas renderer (perspective court, no WebGL)
  main.js            app controller: screens, sessions, input, HUD, online
  net.js             PeerJS room create/join
  audio.js           procedural Web Audio sound effects
tests/               browser test runner + engine tests
```

## Data flow

```
input / AI ──intents, shot buttons──▶ match.js ──▶ world.js (physics)
                                         ▲               │ events (hit, bounce, net, body, net touch)
                                         └── referee ◀───┘
                                         │
                            scoring.js (pure state machine)
                                         │
                     view.js (hudModel / sceneModel / resultsModel)
                                         │
                   HUD (DOM)        render/render2d.js (canvas)
```

## Key rules for keeping state consistent
- **The world reports, the referee decides.** `world.js` only reports physical events. The referee in `match.js` turns them into faults. Practice drills plug a different referee into the same world.
- **Scores change in one place.** `fault()` in `match.js` is the only code that ends a rally. It returns early unless a rally is live, so a rally can't be scored twice. It calls the pure `rallyWon()` in `scoring.js`, which returns new state and never mutates the old.
- **The UI never computes scores.** The HUD and results screen render `hudModel()` and `resultsModel()`.
- **Humans and AI use the same interface.** Both set `player.intent` (movement and aim) and call `playerShot` / `playerDrop`. The referee doesn't know who is controlling a player.
- **Physics is deterministic.** It runs on a fixed 1/120 s step with no randomness. Shot accuracy depends on contact quality, meaning how close the ball passes to the paddle's sweet spot. Randomness lives only in the AI's decisions, never in rule outcomes.

## Shots
`world.launch()` picks a landing point from the shot type and the player's aim, then solves a ballistic arc to it. If the arc wouldn't clear the net, the flight time is lengthened up to a per-shot limit. If even that fails, the ball hits the net. This is why driving a low ball from near the kitchen tends to find the net, while a dink clears.

## Online play
The host runs the full match. The guest sends intents and button presses about 60 times a second and receives compact snapshots: player and ball positions, the landing marker, the serve box, and the HUD model every third frame. The guest renders from the far baseline. Nothing is scored on the guest.

## Rendering
`render/render2d.js` draws the scene model on a plain 2D canvas, so it runs smoothly without a graphics card. A fixed broadcast camera projects the court in perspective. Static scenery (sky, grass, stands, fences, court and lines) is painted once into an offscreen canvas and redrawn only on resize. Each frame blits that image, then draws shadows, players, ball and net in depth order. The far view for an online guest is the same picture rotated 180 degrees. Physics runs at 120 Hz and positions are interpolated between steps, so motion is smooth on any refresh rate.

## Performance design

Measurements and fixes are recorded in [TESTING.md](TESTING.md#performance).

- **Simulation and rendering are separate.** The fixed 120 Hz physics step and the AI cost about 0.01 ms per frame. Renderers draw interpolated positions, so motion stays smooth at any refresh rate or frame-pacing level.
- **Input is never blocked.** Key presses call the engine directly. Movement is read every frame before the physics step. The HUD rebuilds at 15 Hz and never drives the simulation.
- **2D renderer.** Canvases are CPU-rasterized (`willReadFrequently`). Without a real GPU, "accelerated" canvas runs on an emulated GPU and was 10–30× slower. Static scenery is painted once into an offscreen canvas.
- **3D renderer.**
  - Loads in the background while 2D keeps running, with a progress bar.
  - `prepare()` compiles every shader, including a warm-up player, before the 3D view is shown, so nothing compiles mid-match.
  - Static scenery is merged by material and skips per-frame matrix updates.
  - The crowd is instanced, low-poly and doesn't cast shadows.
  - Paddle, ring and shadow geometry is shared. Scratch vectors are reused.
  - Removed players free their cloned materials, skeleton bone textures and mixer caches.
- **Graphics levels.**
  - High: 2048 shadows, up to 2× resolution.
  - Medium: 1024 shadows, up to 1.25× resolution.
  - Low: no real-time shadows (blob shadows instead), 0.8× resolution, half the crowd, no reflections.
  - Lite 2D.
  - Auto starts at Medium (Lite 2D without a GPU). It steps down only after two bad 2-second windows (average over 19 ms or p90 over 30 ms), with a cooldown, so it never oscillates.
- **Frame pacing.** If the browser can't present 60 FPS (two 2-second windows averaging over 24 ms), the game draws every other display frame for an even 30 FPS. It locks once per session. While paused, nothing is redrawn.
- **Developer monitor** (Settings → Developer mode, or F3). Shows current, average and minimum FPS, frame time, simulation and render CPU time, renderer and GPU, draw calls, triangles, GPU geometries and textures, JS heap, and player count.
