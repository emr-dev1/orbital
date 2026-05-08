# ORBITAL

Browser-based n-body solar system sandbox. No build step. Open `index.html` in any modern browser, or serve the directory.

## What it does

- Simulates the Sun, eight planets, and the Moon with **velocity Verlet** integration in SI units.
- Procedural planet textures (Earth continents, Jupiter bands + Great Red Spot, Mars polar caps, Moon maria, Saturn rings) with correct axial tilt and rotation direction (Venus and Uranus retrograde).
- Time warp from 1 minute/sec up to 20 years/sec.
- **Asteroid launches** — pick mass and velocity, drag in scene to aim, watch the predicted dashed trajectory, release to fire.
- **Impact analysis** — relative velocity, kinetic energy, TNT-equivalent yield, crater diameter, reference event, and a verdict (city-killer through planet-cracker).
- Camera dock + keyboard nav between bodies.

## Stack

- Three.js (r128, via importmap CDN)
- Plain ES modules — no bundler

## Run

```sh
open index.html            # quickest
python3 -m http.server 8000  # if you'd rather a local server
```

## Project layout

```
index.html        markup + import map + script entry
styles.css        all styling
js/
  data.js         constants and data tables (planets, warp, ref events, nav)
  state.js        shared mutable state object
  physics.js      Body, integrator, collisions, prediction, world build
  textures.js     procedural canvas-painted planet textures + sun glow
  scene.js        renderer, scene, camera, lights, starfield, label layer
  visuals.js      body meshes/trails/labels + per-frame visual sync
  camera.js       orbit-camera state, mouse + keyboard movement
  asteroid.js     aim mode, prediction line, launch, impact modal
  ui.js           DOM controls, nav dock, telemetry, keyboard shortcuts
  main.js         init + tick loop
```

## Controls

**Mouse**
- Drag — orbit the camera
- Scroll — zoom
- Click a body — focus and follow it
- `+ ASTEROID` — enter aim mode, then click+drag in the scene to set the launch vector and release to fire

**Keyboard — held**
- `W`/`A`/`S`/`D` or arrow keys — orbit
- `Q` / `E` — zoom out / in
- `[` / `]` — pan vertical
- `;` / `'` — pan horizontal
- `Shift` — 2.5× speed modifier

**Keyboard — one-shot**
- `Space` — pause / resume
- `,` / `.` — warp down / up
- `R` — reset world
- `X` — clear debris
- `N` — toggle aim mode (`+ ASTEROID`)
- `T` / `L` — toggle trails / labels
- `H` — hide / show HUD
- `1`–`9`, `0` — jump to Sun, Mercury, …, Neptune
- `O` — overview, `F` — free cam
- `?` — toggle keyboard help, `Esc` — close help / cancel aim

## Roadmap

The fun stuff — open to PRs and cherry-picking.

### Bodies & physics
- [ ] **Black holes** — Schwarzschild approximation, accretion disk, screen-space gravitational lensing post-process
- [ ] **Galactic scale** — switch the integrator to Barnes-Hut octree so we can handle ~10⁵ bodies; star cluster and galaxy presets
- [ ] **Procedural moons + asteroid belts** — main belt, Trojans, Kuiper belt sprinkles
- [ ] **Comet trails** — sublimation/ion tail when near the Sun, pointed away from it
- [ ] **Tidal locking** — slowly drag rotation toward orbital period when within Roche distance; visualize libration
- [ ] **Mass → rotation coupling** — collisions transfer angular momentum (impactor mass and impact-vector skew should change planet spin axis and rate). Ditto, dragging mass higher should affect orbits of bound moons.
- [ ] **N-body presets** — binary star, three-body chaos, figure-8 orbit, Lagrange points

### Spacecraft & impactors
- [ ] **Rocket launches** — low-thrust craft with delta-v budget, throttle, prograde/retrograde/normal burn directions, orbit insertion
- [ ] **Mission planner** — Hohmann transfer assistant, gravity assists, porkchop plot
- [ ] **Asteroid catalog** — Apophis, Bennu, Ceres with real orbital elements
- [ ] **Kinetic deflection** — DART-style impactor with delta-v change readout

### Visualization
- [ ] **Time-rewind / scrubbing** — keep a state ring buffer, allow scrubbing the timeline
- [ ] **Lagrange-point overlay** — L1–L5 markers updated each frame
- [ ] **Roche-limit and Hill-sphere overlays**
- [ ] **Camera presets** — chase cam on asteroid, top-down ecliptic, behind-planet, sun-relative
- [ ] **Atmospheric shells** — translucent halo around Earth/Venus/giant planets
- [ ] **Real planet textures** option behind a flag (NASA imagery)

### Engine
- [ ] **WebGPU renderer + GPU compute** for n-body forces — push body count up
- [ ] **Save / load scenarios via URL hash** so configurations are shareable
- [ ] **Replay export** — render to MP4/WebM
- [ ] **Mobile / touch controls** — pinch-zoom, two-finger orbit, tap-and-hold for aim

### UX
- [ ] **Body inspector** — click a body, see mass / radius / orbital elements / parent in a side panel; allow live editing
- [ ] **Tutorial mode** — guided tour: launch an asteroid at Earth, deflect it, set up a Hohmann transfer
- [ ] **Sound** — subtle ambient drone, impact thump, launch whoosh

## Status

v0.1 — n-body sandbox.
