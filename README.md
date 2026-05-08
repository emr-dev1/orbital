# ORBITAL

Browser-based n-body solar system sandbox. Single HTML file. Open `index.html` in any modern browser.

## What it does

- Simulates the Sun, eight planets, and the Moon with velocity Verlet integration in SI units.
- Procedural planet textures (Earth continents, Jupiter bands + Great Red Spot, Mars polar caps, Moon maria, etc.) with correct axial tilt and rotation direction (Venus and Uranus retrograde).
- Time warp from 1 minute/sec up to 20 years/sec.
- Launch asteroids: pick mass and velocity, drag in scene to aim, watch the predicted trajectory dashed line, and release to fire.
- Impact analysis: relative velocity, kinetic energy, TNT-equivalent yield, crater diameter, and a verdict (city-killer through planet-cracker).
- Camera dock to jump between bodies, plus orbit / scroll / click-to-focus.

## Stack

- Three.js (r128, via importmap CDN)
- Plain ES modules — no build step

## Run

```sh
open index.html
# or any static server, e.g.
python3 -m http.server 8000
```

## Status

v0.1 — n-body sandbox.
