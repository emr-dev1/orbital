// Three.js visual representation of bodies: meshes, axial-tilt pivots,
// trail lines, and DOM labels. Provides per-frame sync helpers used by main.

import * as THREE from 'three';
import { state } from './state.js';
import { scene, sunLight, labelLayer } from './scene.js';
import { makePlanetTexture, makeGlowSprite, loadPhotoTexture, makeRingTexture } from './textures.js';
import { RENDER_SCALE, WARP_LEVELS } from './data.js';

export const bodyMeshes   = new Map(); // body -> outer pivot (axis-tilt + position)
export const bodySpinners = new Map(); // body -> inner mesh that spins on local Y
export const trailLines   = new Map();
export const labelDivs    = new Map();

const R_EARTH = 6.37e6;
// Hard cap on per-frame spin in radians. At 60 fps, 0.35 rad/frame ≈ 60°/s ≈
// 6 RPM — fast enough to read as motion, slow enough that the texture stays
// recognisable. At π/frame planets just strobed at high warp.
const MAX_ROT_PER_FRAME = 0.35;
const VISUAL_SPIN_BOOST = 6;       // planets spin 6x real speed for visibility

// Atmospheric halo per body. `scale` is multiplier on the body's visual
// radius (1.0 = no halo, 1.05 = thin shell). `color` is the dominant
// atmospheric tint — Earth blue from Rayleigh scattering, Venus tan from
// sulfuric clouds, gas giants ~ planet body color, etc.
const ATMOSPHERES = {
  EARTH:   { color: 0x6699ff, opacity: 0.28, scale: 1.04 },
  VENUS:   { color: 0xe0bf6a, opacity: 0.35, scale: 1.05 },
  MARS:    { color: 0xc1542a, opacity: 0.10, scale: 1.03 },
  JUPITER: { color: 0xd8b48c, opacity: 0.18, scale: 1.03 },
  SATURN:  { color: 0xe6d4a0, opacity: 0.15, scale: 1.04 },
  URANUS:  { color: 0x8fd4d6, opacity: 0.30, scale: 1.05 },
  NEPTUNE: { color: 0x4988ff, opacity: 0.30, scale: 1.05 },
  // Titan's thick nitrogen haze — denser than Earth's atmosphere.
  TITAN:   { color: 0xd9954a, opacity: 0.35, scale: 1.10 },
};

export function visualRadius(b) {
  if (b.name === 'SUN') return 18;
  // Black holes: real Schwarzschild radii would be invisible at our scale
  // (a stellar BH is 30 km vs the Sun's 700,000). Log-scale the visible
  // event horizon so a stellar BH reads as a small dark dot and a
  // supermassive one looks Sun-sized.
  if (b.isBlackHole) return Math.max(0.6, 0.45 * Math.log10(Math.max(b.mass, 1e29) / 1e29) + 0.6);
  // Power-law compression: exponent 0.7 keeps Mercury / Mars / Earth / Jupiter
  // all legible while preserving truer size ratios — Moon now reads as ~40%
  // of Earth (was ~50%), Ganymede edges out Mercury, Titan towers over
  // Enceladus the way it actually does.
  const r = 2.0 * Math.pow(b.displayRadius / R_EARTH, 0.7);
  // Floors: asteroids 0.3 (so a 10⁶ kg pebble stays clickable while threats
  // read at the right size), small bodies 0.16 (Phobos/Deimos remain visible
  // little dots without ballooning to look planet-sized).
  if (b.isAsteroid) return Math.max(0.3, r);
  return Math.max(0.16, r);
}

// Jagged "potato" geometry for asteroids. Built from a low-detail icosahedron
// so each triangular face stays large enough to read as a distinct flat panel
// under flatShading — gives the craggy crystalline look real asteroids have
// (Itokawa, Bennu, Eros) instead of a smooth marble.
//
// Vertices are displaced along their radial direction by a deterministic
// per-position hash so two siblings differ but a single asteroid keeps its
// shape across rebuilds. Hashing by world-position (not vertex index) means
// duplicate vertices that polyhedron geometries emit at face boundaries get
// the same displacement, preventing cracks in the silhouette.
function makeAsteroidGeometry(rVis, seed = 0) {
  const geo = new THREE.IcosahedronGeometry(rVis, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    // Two-frequency hash on the unit direction: the low frequency gives the
    // overall lumpy outline, the high frequency adds small-scale facet break-up.
    const dx = v.x / rVis, dy = v.y / rVis, dz = v.z / rVis;
    const h1 = Math.sin((dx * 12.989 + dy * 78.233 + dz * 37.719) * (1 + seed * 0.013) + seed * 0.7) * 43758.5453;
    const h2 = Math.sin((dx * 41.317 + dy * 23.149 + dz * 91.412) * (1 + seed * 0.029) + seed * 1.3) * 12345.6789;
    const r1 = (h1 - Math.floor(h1)) * 2 - 1;
    const r2 = (h2 - Math.floor(h2)) * 2 - 1;
    const factor = 1 + r1 * 0.30 + r2 * 0.10;     // ±~40% radius variation
    v.normalize().multiplyScalar(rVis * Math.max(0.55, factor));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();   // needed so lighting reflects the new shape
  return geo;
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

    // ── Black hole: pure-black event horizon + glowing accretion disks ──
    // Built as a small scene graph (pivot ▸ diskGroup ▸ {sphere, inner ring,
    // outer ring}) so the disks rotate via the existing spinner machinery
    // while the sphere stays still. Bodies don't get tilt or atmospheres.
    if (b.isBlackHole) {
      // Pure-black event horizon. Higher tessellation than planets so the
      // silhouette stays smooth against bright disks behind it.
      const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(rVis, 64, 48),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
      );

      // Accretion disk: three flat ring layers, hottest in (yellow-white)
      // → orange → red. Flat rings (not tori) so they read as a thin disk
      // when viewed at glancing angles.
      const diskGroup = new THREE.Group();   // rotates around its local Y
      diskGroup.rotation.z = 0.20;            // slight tilt — disks are never perfectly aligned
      const innerDisk = new THREE.Mesh(
        new THREE.RingGeometry(rVis * 1.7, rVis * 2.4, 96),
        new THREE.MeshBasicMaterial({
          color: 0xffe080, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      innerDisk.rotation.x = Math.PI / 2;
      const midDisk = new THREE.Mesh(
        new THREE.RingGeometry(rVis * 2.4, rVis * 3.4, 96),
        new THREE.MeshBasicMaterial({
          color: 0xff9038, transparent: true, opacity: 0.70,
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      midDisk.rotation.x = Math.PI / 2;
      const outerDisk = new THREE.Mesh(
        new THREE.RingGeometry(rVis * 3.4, rVis * 5.2, 96),
        new THREE.MeshBasicMaterial({
          color: 0xff4020, transparent: true, opacity: 0.40,
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      outerDisk.rotation.x = Math.PI / 2;
      diskGroup.add(innerDisk, midDisk, outerDisk);

      // Polar relativistic jets along the disk's spin axis (local +Y).
      // Open-cone hollow geometry with additive blending reads as wispy
      // violet plasma rather than solid metal.
      const jetMat = new THREE.MeshBasicMaterial({
        color: 0xc084ff, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
      });
      const jetGeo = new THREE.ConeGeometry(rVis * 0.40, rVis * 6.5, 18, 1, true);
      const jetUp = new THREE.Mesh(jetGeo, jetMat);
      jetUp.position.y = rVis * 3.25;          // base at origin, tip up
      const jetDown = new THREE.Mesh(jetGeo.clone(), jetMat);
      jetDown.position.y = -rVis * 3.25;       // base at origin, tip down
      jetDown.rotation.x = Math.PI;
      diskGroup.add(jetUp, jetDown);

      // Photon ring — sprite that always faces the camera. This is the
      // bright halo Einstein-ring observers see; using a Sprite means it
      // tracks the viewer correctly without any special update code.
      const photonRingSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeRingTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: 0xffe0a0,
      }));
      photonRingSprite.scale.set(rVis * 3.6, rVis * 3.6, 1);

      // Soft outer glow so the BH bleeds light into nearby space — sells
      // the gravitational presence even when the disk is edge-on.
      const halo = makeGlowSprite(0xc070ff, rVis * 14, 0.30);

      const pivot = new THREE.Group();
      pivot.add(horizon, diskGroup, photonRingSprite, halo);
      scene.add(pivot);

      bodyMeshes.set(b, pivot);
      bodySpinners.set(b, diskGroup);   // syncBodyVisuals spins this group

      // Trail line — same as other bodies so the BH path is visible.
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.trailMax * 3), 3));
      const tm = new THREE.LineBasicMaterial({
        color: 0xff6030, transparent: true, opacity: 0.85,
      });
      const line = new THREE.Line(tg, tm);
      line.frustumCulled = false;
      if (!state.showTrails) line.visible = false;
      scene.add(line);
      trailLines.set(b, line);

      // Label.
      const div = document.createElement('div');
      div.textContent = b.name;
      Object.assign(div.style, {
        position: 'absolute',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '9px', letterSpacing: '0.18em',
        color: '#ff5530',
        transform: 'translate(8px, -50%)',
        whiteSpace: 'nowrap', textShadow: '0 0 6px #000',
      });
      if (!state.showLabels) div.style.display = 'none';
      labelLayer.appendChild(div);
      labelDivs.set(b, div);
      continue;
    }

    let geo, mat;
    if (b.isAsteroid) {
      // Seed jaggedness from mass + a stable per-body name-hash so each
      // asteroid keeps a unique silhouette across rebuilds without globally
      // re-randomising on every impact.
      const nameHash = b.name ? Array.from(b.name).reduce((h, c) => h * 31 + c.charCodeAt(0), 7) : 0;
      const seed = (Math.log10(Math.max(b.mass, 1)) * 11 + nameHash * 0.13) % 100;
      geo = makeAsteroidGeometry(rVis, seed);
      mat = new THREE.MeshStandardMaterial({
        color: b.color, roughness: 0.95, metalness: 0.1, emissive: 0x442200,
        flatShading: true,        // each face shaded as a hard plane → craggy
      });
    } else if (b.glow) {
      geo = new THREE.SphereGeometry(rVis, 48, 32);
      // Sun: BasicMaterial so the texture stays bright regardless of lighting.
      const proc = makePlanetTexture(b.name, b.color);
      mat = new THREE.MeshBasicMaterial({ map: proc, color: 0xffffff });
      // Async-upgrade to NASA-style photo once it loads.
      loadPhotoTexture(b.name, (tex) => { mat.map = tex; mat.needsUpdate = true; });
    } else {
      geo = new THREE.SphereGeometry(rVis, 48, 32);
      const proc = makePlanetTexture(b.name, b.color);
      mat = new THREE.MeshStandardMaterial({
        map: proc, roughness: 0.85, metalness: 0.05,
      });
      loadPhotoTexture(b.name, (tex) => { mat.map = tex; mat.needsUpdate = true; });
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
      // Layered corona — three additive sprites at increasing radii give a
      // soft halo without a post-process bloom pass.
      spinner.add(makeGlowSprite(0xffe9aa, 50, 0.85));
      spinner.add(makeGlowSprite(0xff9d44, 90, 0.45));
      spinner.add(makeGlowSprite(0xff5520, 160, 0.20));
    }
    // Atmospheric shell — slightly larger sphere with backside additive
    // blending. Reads as a soft halo when viewed from outside the planet.
    const atmo = ATMOSPHERES[b.name];
    if (atmo) {
      const aGeo = new THREE.SphereGeometry(rVis * atmo.scale, 32, 24);
      const aMat = new THREE.MeshBasicMaterial({
        color: atmo.color, transparent: true, opacity: atmo.opacity,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      });
      spinner.add(new THREE.Mesh(aGeo, aMat));
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

// Per-frame: position pivots, spin meshes, push trail vertices. focusBody
// — when provided — gets a tighter spin clamp so the user can actually
// watch animations on the body they're staring at, regardless of warp.
export function syncBodyVisuals(realDt, focusBody = null) {
  // Pause means pause: no orbital advance, no axial spin, no asteroid tumble.
  const rotDt = state.paused ? 0 : (WARP_LEVELS[state.warpIdx].dt * realDt);
  // Cap spin per-frame: the focused body slows to a readable ~1 RPM, others
  // can run faster up to MAX_ROT_PER_FRAME.
  const FOCUS_CAP = 0.02;

  for (const b of state.bodies) {
    const pivot = bodyMeshes.get(b); if (!pivot) continue;
    const [rx, ry, rz] = renderPos(b);
    pivot.position.set(rx, ry, rz);
    if (b.name === 'SUN') sunLight.position.copy(pivot.position);

    // Tidally drained body: shrink the pivot to telegraph mass loss as it
    // gets shredded by a nearby black hole. originalMass is only seeded by
    // the tidal-stream module when a body enters a BH's tidal zone, so
    // unaffected bodies stay at scale 1.
    if (b.originalMass && b.mass < b.originalMass && !b.isBlackHole) {
      const ratio = Math.max(0.05, b.mass / b.originalMass);
      pivot.scale.setScalar(Math.cbrt(ratio));
    }

    const spinner = bodySpinners.get(b);
    if (spinner && b.tidallyLocked && b.parent) {
      // True tidal lock: same face always points at the parent. We don't
      // accumulate a rate; we set the orientation directly each frame from
      // the geometric Moon→Earth direction in the ecliptic (XZ) plane.
      // Axial-rotation period (and the visual spin boost) are not applied —
      // the lock geometry already defines orientation.
      const parent = state.bodies.find(x => x.name === b.parent);
      if (parent) {
        const dx = b.px - parent.px;
        const dz = b.pz - parent.pz;
        // angle θ for which spinner-local +X (where the prime meridian sits)
        // points from the body toward the parent. Solving the body→parent
        // direction in the ecliptic gives θ = atan2(dz, −dx).
        spinner.rotation.y = Math.atan2(dz, -dx);
      }
    } else if (state.paused) {
      // freeze everything — pivot positions still get refreshed above so
      // re-parenting this frame doesn't leave stale meshes.
    } else if (spinner && b.rotPeriod) {
      // Sun is a featureless glow — don't boost its already-slow spin.
      // Everything else gets the visual boost so axial rotation is legible.
      const visualPeriod = b.name === 'SUN' ? b.rotPeriod * 8 : b.rotPeriod / VISUAL_SPIN_BOOST;
      const cap = (b === focusBody) ? FOCUS_CAP : MAX_ROT_PER_FRAME;
      let dRot = (2 * Math.PI * rotDt) / visualPeriod;
      if (dRot >  cap) dRot =  cap;
      else if (dRot < -cap) dRot = -cap;
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
