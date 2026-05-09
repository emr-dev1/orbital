# ORBITAL

Browser-based n-body solar system sandbox. No build step. Open `index.html` in any modern browser, or serve the directory.

## What it does

- Simulates the Sun, eight planets, the Moon, and 10+ major moons (Phobos/Deimos, the Galileans, Titan, Enceladus, Titania, Triton…) with **Yoshida 4th-order symplectic** integration in SI units.
- **First post-Newtonian (1PN) correction** in the Sun's field — Mercury's perihelion advance falls out for free.
- **Continuous collision detection** so a fast asteroid can't tunnel through a planet between substeps.
- Procedural planet textures *and* async upgrade to NASA-style photo textures once they load (Earth, Jupiter, Mars, Saturn rings, etc.) with correct axial tilt and rotation direction (Venus and Uranus retrograde).
- Atmospheric halos on Earth/Venus/Mars/giants and Titan, layered solar corona, real-time tidal locking on the Moon and major moons.
- Time warp from 1 minute/sec up to 20 years/sec.
- **Climate / biosphere / population evolution** — energy balance with ice-albedo feedback, dust-driven nuclear winter, CO₂ greenhouse, biosphere stages from STERILE → INTELLIGENT, logistic population growth.
- **Asteroid launches** with mass + Δv sliders, composition pills (rocky / icy / iron / carbonaceous), famous-body catalog (Tunguska, Apophis, Bennu, Chicxulub, Ceres, Theia), dashed prediction line, and impact analysis (yield, crater diameter, reference event, verdict).
- **Surface impact effects** — debris bursts, multi-stage shockwaves, surface flash, all anchored to the impact point in the spinner's local frame so they ride the planet's rotation correctly. Climate / biosphere / population react to the strike.
- **Black holes** — dedicated forge with event-horizon / photon-sphere / ISCO readouts, tidal-disruption stream particles flowing from a doomed planet into the BH, mass transfer until consumption.
- **Earth Mode** — Sun-paused cinematic Earth-centric view; pick from SOLAR FLARE / ICE AGE / ASTEROID with per-event tuning, watch a hyper-realistic animation play out while the right-side INSPECTOR tracks live stat changes.
- **Random solar flare** button — fires a CME of random class at a randomly-picked target body with the full sequence: plasma cloud erupts from the Sun → bow shock at the magnetosphere → multi-color aurora curtains at the magnetic poles (green oxygen → red oxygen → violet nitrogen).
- **Habitable zone overlay** — Goldilocks-zone rings around every star, scaled by √(L / L_sun), with conservative + optimistic edges.
- **Body editor (MODIFY panel)** — focus a body, drag MASS and SIZE sliders, hit PREDICT to see dashed cyan trajectories showing how every other body's orbit reshapes over the next year under the new gravity.
- Camera dock + keyboard nav, view presets (TOP / 3D / SIDE × INNER / BELT / OUTER × scene presets), live inspector with telemetry / classification / atmosphere / habitability / civilization / events log.

## Stack

- Three.js (r128, via importmap CDN)
- Plain ES modules — no bundler, no TypeScript, no framework

## Run

```sh
open index.html              # quickest
python3 -m http.server 8000  # local server, browse to localhost:8000
```

## Project layout

```
index.html              markup + import map + script entry
styles.css              all styling (panels, HUD, modals, sliders)
js/
  data.js               constants, planet/moon catalogs, compositions, body info
  state.js              shared mutable state object
  physics.js            Body, Yoshida-4 + 1PN integrator, CCD collisions, Kepler init
  scene.js              renderer, scene, camera, lights, starfield, label layer
  textures.js           procedural canvas planet textures + Sun glow + photo loader
  visuals.js            body meshes / pivots / spinners / atmospheres / trails / labels
  camera.js             orbit-camera state, mouse + keyboard, view presets
  asteroid.js           aim mode, prediction line, launch, debris + shockwave + flash
  asteroid_belt.js      main-belt sprinkle of background asteroids
  evolution.js          climate / biosphere / population tick, impact effects
  earth_mode.js         Earth-centric event mode (flare / ice age / asteroid)
  solar_flare.js        global "fire a random CME" button + animations
  habitable_zone.js     Goldilocks-zone overlay rings
  body_editor.js        MODIFY panel — mass / size sliders + prediction lines
  blackhole_ui.js       black hole forge panel
  tidal_stream.js       tidal-disruption particle stream into a black hole
  ui.js                 DOM controls, nav dock, telemetry, inspector, keyboard
  main.js               init + tick loop
```

## Controls

**Mouse**
- Drag — orbit the camera
- Middle drag — pan the look-at point (Shift = 2.5× speed)
- Scroll — zoom
- Click a body — focus and follow it
- `+ ASTEROID` — enter aim mode, click empty space to place the launchpad, click a body to retarget, hit FIRE
- `+ BLACK HOLE` — open the BH forge; tune mass / Δv, click in the scene to position, RELEASE SINGULARITY

**Toggles** (left HUD)
- `TRAILS` / `LABELS` — show body orbits / name labels
- `HAB ZONE` — show the Goldilocks-zone rings around each star
- `EARTH MODE` — enter the cinematic Earth-centric event view
- `☀ SOLAR FLARE` — fire a random-class CME at a random target body

**View presets** (left HUD)
- `ANGLE`: TOP / 3D / SIDE
- `ZOOM`: INNER / BELT / OUTER
- `SCENE`: TOP·ALL / ECLIPTIC / SUN-REL

**Inspector & MODIFY panel** (right HUD)
- Click a body to populate the inspector with classification / orbital / atmosphere / habitability / civilization / events
- The MODIFY panel below shows MASS and SIZE sliders for the focused body; PREDICT draws dashed prediction lines showing how every other body's orbit changes under the new gravity

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
- `?` — toggle keyboard help, `Esc` — close help / cancel aim / exit Earth Mode

## Roadmap

Built since v0.1 and still on the wishlist.

### Bodies & physics
- [x] **Black holes** — Schwarzschild approximation, tidal stream, event-horizon / photon-sphere / ISCO readouts
- [ ] **Galactic scale** — switch to Barnes-Hut octree so we can handle ~10⁵ bodies; star cluster and galaxy presets
- [x] **Procedural moons + asteroid belts** — main belt sprinkle, 10+ named moons
- [ ] **Comet trails** — sublimation/ion tail when near the Sun, pointed away from it
- [x] **Tidal locking** — major moons present same face to their parent
- [x] **Mass → rotation coupling** — collisions transfer angular momentum into target spin
- [ ] **N-body presets** — binary star, three-body chaos, figure-8, Lagrange points
- [x] **First post-Newtonian correction** — Mercury's perihelion advance

### Spacecraft & impactors
- [ ] **Rocket launches** — low-thrust craft with delta-v budget, throttle, prograde/retrograde/normal burn directions
- [ ] **Mission planner** — Hohmann transfer assistant, gravity assists, porkchop plot
- [x] **Asteroid catalog** — Tunguska, Apophis, Bennu, Chicxulub, Ceres, Theia
- [ ] **Kinetic deflection** — DART-style impactor with delta-v change readout

### Visualization
- [ ] **Time-rewind / scrubbing** — keep a state ring buffer, allow scrubbing the timeline
- [x] **Habitable-zone overlay**
- [ ] **Lagrange-point overlay** — L1–L5 markers updated each frame
- [ ] **Roche-limit and Hill-sphere overlays**
- [x] **Camera presets** — angle / zoom / scene
- [x] **Atmospheric shells** — translucent halo around Earth/Venus/giant planets, Titan haze
- [x] **Real planet textures** — async-loaded NASA-style photos with procedural fallback

### Engine
- [ ] **WebGPU renderer + GPU compute** for n-body forces — push body count up
- [ ] **Save / load scenarios via URL hash** so configurations are shareable
- [ ] **Replay export** — render to MP4/WebM
- [ ] **Mobile / touch controls** — pinch-zoom, two-finger orbit, tap-and-hold for aim

### UX
- [x] **Body inspector** — click a body, see mass / radius / orbital elements / atmosphere / habitability / events
- [x] **Live editing** — MODIFY panel with mass / size sliders + dashed prediction lines for every other body
- [x] **Climate / biosphere / population evolution** — toy energy-balance + ice-albedo + dust + greenhouse + biosphere stages + logistic pop
- [x] **Earth Mode** — cinematic Earth-centric event view with solar flare / ice age / asteroid
- [x] **Hyper-realistic event animations** — CME plasma + bow shock + multi-color aurora curtains; ice-creep + storm-cloud shells; surface impact debris + shockwaves + flash
- [ ] **Tutorial mode** — guided tour: launch an asteroid at Earth, deflect it, set up a Hohmann transfer
- [ ] **Sound** — subtle ambient drone, impact thump, launch whoosh

## Status

v0.2 — Earth Mode, black holes, body editor, full event animations.
