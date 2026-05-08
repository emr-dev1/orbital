// Three.js visual representation of bodies: meshes, axial-tilt pivots,
// trail lines, and DOM labels. Provides per-frame sync helpers used by main.

import * as THREE from 'three';
import { state } from './state.js';
import { scene, sunLight, labelLayer } from './scene.js';
import { makePlanetTexture, makeGlowSprite } from './textures.js';
import { RENDER_SCALE, WARP_LEVELS } from './data.js';

export const bodyMeshes   = new Map(); // body -> outer pivot (axis-tilt + position)
export const bodySpinners = new Map(); // body -> inner mesh that spins on local Y
export const trailLines   = new Map();
export const labelDivs    = new Map();

const R_EARTH = 6.37e6;
const MAX_ROT_PER_FRAME = Math.PI; // cap any spin so it stays legible at extreme warp
const VISUAL_SPIN_BOOST = 6;       // planets spin 6x real speed for visibility

function visualRadius(b) {
  if (b.isAsteroid) return 0.6;
  if (b.name === 'SUN') return 18;
  // Power-law compression so Moon, Mars, Earth, Jupiter all stay legible.
  return 2.0 * Math.pow(b.displayRadius / R_EARTH, 0.5);
}

// Render position (in render units). For bodies with a parent (moons),
// expand the offset from the parent so the orbit is actually visible —
// real Moon orbit at 0.384 Gm sits inside Earth's visual sphere otherwise.
// Physics is untouched; this only affects rendering.
export function renderPos(b) {
  if (b.parent) {
    const parent = state.bodies.find(x => x.name === b.parent);
    if (parent) {
      const s = b.displayOrbitScale || 1;
      return [
        (parent.px + (b.px - parent.px) * s) / RENDER_SCALE,
        (parent.py + (b.py - parent.py) * s) / RENDER_SCALE,
        (parent.pz + (b.pz - parent.pz) * s) / RENDER_SCALE,
      ];
    }
  }
  return [b.px / RENDER_SCALE, b.py / RENDER_SCALE, b.pz / RENDER_SCALE];
}

export function rebuildVisuals() {
  for (const m of bodyMeshes.values()) scene.remove(m);
  for (const l of trailLines.values()) scene.remove(l);
  for (const d of labelDivs.values()) d.remove();
  bodyMeshes.clear(); bodySpinners.clear(); trailLines.clear(); labelDivs.clear();

  for (const b of state.bodies) {
    const rVis = visualRadius(b);
    const geo = new THREE.SphereGeometry(rVis, 48, 32);

    let mat;
    if (b.isAsteroid) {
      mat = new THREE.MeshStandardMaterial({
        color: b.color, roughness: 0.95, metalness: 0.1, emissive: 0x442200,
      });
    } else if (b.glow) {
      mat = new THREE.MeshBasicMaterial({
        map: makePlanetTexture(b.name, b.color), color: 0xffffff,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        map: makePlanetTexture(b.name, b.color),
        roughness: 0.85, metalness: 0.05,
      });
    }

    const spinner = new THREE.Mesh(geo, mat);

    if (b.ring) {
      const ringGeo = new THREE.RingGeometry(rVis*1.4, rVis*2.2, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xd4c08c, side: THREE.DoubleSide, transparent: true, opacity: 0.55,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      spinner.add(ring);
    }
    if (b.glow) {
      spinner.add(makeGlowSprite(0xffaa55, 60));
    }

    // Axis-tilt pivot. Spinner spins around its own local Y. Orbit plane is
    // XZ, so the orbit normal is +Y. Axial tilt is the angle between spin
    // axis and orbit normal — rotate around X (or any axis in the XZ plane)
    // to tip Y-axis off vertical by `tilt` degrees. Venus 177° and Uranus 98°
    // come out flipped/sideways automatically.
    const pivot = new THREE.Group();
    if (b.tilt !== undefined) {
      pivot.rotation.x = (b.tilt || 0) * Math.PI / 180;
    }
    pivot.add(spinner);
    scene.add(pivot);

    bodyMeshes.set(b, pivot);
    bodySpinners.set(b, spinner);

    // Trail line
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.trailMax * 3), 3));
    const tm = new THREE.LineBasicMaterial({
      color: b.isAsteroid ? 0xff5530 : b.color,
      transparent: true, opacity: b.isAsteroid ? 0.8 : 0.35,
    });
    const line = new THREE.Line(tg, tm);
    line.frustumCulled = false;
    if (!state.showTrails) line.visible = false;
    scene.add(line);
    trailLines.set(b, line);

    // Label
    const div = document.createElement('div');
    div.textContent = b.name;
    Object.assign(div.style, {
      position: 'absolute',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '9px',
      letterSpacing: '0.18em',
      color: b.isAsteroid ? '#ff5530' : '#a5b4c8',
      transform: 'translate(8px, -50%)',
      whiteSpace: 'nowrap',
      textShadow: '0 0 6px #000',
    });
    if (!state.showLabels) div.style.display = 'none';
    labelLayer.appendChild(div);
    labelDivs.set(b, div);
  }
}

// Per-frame: position pivots, spin meshes, push trail vertices.
export function syncBodyVisuals(realDt) {
  // When paused, idle-spin at ~1 day per real second so planets still feel alive.
  const rotDt = state.paused ? (3600 * realDt * 24) : (WARP_LEVELS[state.warpIdx].dt * realDt);

  for (const b of state.bodies) {
    const pivot = bodyMeshes.get(b); if (!pivot) continue;
    const [rx, ry, rz] = renderPos(b);
    pivot.position.set(rx, ry, rz);
    if (b.name === 'SUN') sunLight.position.copy(pivot.position);

    const spinner = bodySpinners.get(b);
    if (spinner && b.rotPeriod) {
      // Sun is a featureless glow — don't boost its already-slow spin.
      // Everything else gets the visual boost so axial rotation is legible.
      // Negative rotPeriod (Venus, Uranus) → dRot is negative → retrograde,
      // which is the physics we want.
      // (True synchronous tidal-lock visualization is on the roadmap.)
      const visualPeriod = b.name === 'SUN' ? b.rotPeriod * 8 : b.rotPeriod / VISUAL_SPIN_BOOST;
      let dRot = (2 * Math.PI * rotDt) / visualPeriod;
      if (dRot >  MAX_ROT_PER_FRAME) dRot =  MAX_ROT_PER_FRAME;
      else if (dRot < -MAX_ROT_PER_FRAME) dRot = -MAX_ROT_PER_FRAME;
      spinner.rotation.y += dRot;
    } else if (spinner && b.isAsteroid) {
      spinner.rotation.y += 0.02;
      spinner.rotation.x += 0.011;
    }

    // Trail vertices. For parented bodies we stored offsets from the parent;
    // re-anchor against the parent's CURRENT render position each frame so the
    // orbit ellipse follows the parent instead of smearing through space.
    const line = trailLines.get(b);
    if (line && b.trail.length > 1) {
      const arr = line.geometry.attributes.position.array;
      const parent = b.parent ? state.bodies.find(x => x.name === b.parent) : null;
      const px = parent ? parent.px / RENDER_SCALE : 0;
      const py = parent ? parent.py / RENDER_SCALE : 0;
      const pz = parent ? parent.pz / RENDER_SCALE : 0;
      for (let i = 0; i < b.trail.length; i++) {
        arr[i*3]   = b.trail[i][0] + px;
        arr[i*3+1] = b.trail[i][1] + py;
        arr[i*3+2] = b.trail[i][2] + pz;
      }
      line.geometry.setDrawRange(0, b.trail.length);
      line.geometry.attributes.position.needsUpdate = true;
    }
  }
}

export function updateLabels(camera) {
  if (!state.showLabels) return;
  const v = new THREE.Vector3();
  for (const [b, div] of labelDivs) {
    const [rx, ry, rz] = renderPos(b);
    v.set(rx, ry, rz);
    v.project(camera);
    if (v.z > 1 || v.z < -1) { div.style.display = 'none'; continue; }
    div.style.display = '';
    div.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
    div.style.top  = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  }
}
