// Habitable zone (Goldilocks zone) overlay — toggled by the HAB ZONE
// button on the left HUD. For each star in the sandbox we draw a
// translucent ring around it in the ecliptic plane:
//
//   • bright green annulus  — conservative HZ (Kasting et al.)
//   • dim green outer ring  — optimistic outer edge (early-Mars limit)
//   • dim amber inner ring  — optimistic inner edge (recent-Venus limit)
//   • thin neon edge loops  — clear demarcation of the conservative band
//
// Inner / outer radii scale with √(L / L_sun) so brighter stars push their
// zones outward correctly. Stars are detected via `b.glow && b.luminosity`
// so any new luminous body added at runtime is picked up automatically.

import * as THREE from 'three';
import { state } from './state.js';
import { scene } from './scene.js';
import { renderPos } from './visuals.js';
import { RENDER_SCALE, AU } from './data.js';

// Standard solar luminosity (W). Used as the reference for HZ scaling.
const L_SUN = 3.828e26;

// AU expressed in render units — RENDER_SCALE = 1 m per render unit, so
// 1 AU is `AU / RENDER_SCALE` render units (≈ 149.6 with the default).
const AU_RENDER = AU / RENDER_SCALE;

// Habitable-zone bounds, fractions of AU at L = L_sun.
const HZ_INNER_FRAC = 0.95;     // conservative inner — runaway greenhouse
const HZ_OUTER_FRAC = 1.37;     // conservative outer — maximum greenhouse
const OPT_INNER_FRAC = 0.75;    // optimistic inner — recent Venus
const OPT_OUTER_FRAC = 1.77;    // optimistic outer — early Mars

let _enabled = false;
const _zones = new Map();       // sun body → THREE.Group

function _isSun(b) {
  return b && b.glow === true && typeof b.luminosity === 'number' && b.luminosity > 0;
}

function _ringLoop(radius, segments, color, opacity) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
  });
  return new THREE.LineLoop(geo, mat);
}

function _annulus(innerR, outerR, color, opacity) {
  const geo = new THREE.RingGeometry(innerR, outerR, 192, 1);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // RingGeometry sits in the XY plane by default; rotate to lay it flat
  // in the ecliptic (XZ plane in our world).
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function _buildZoneFor(sun) {
  const L = sun.luminosity || L_SUN;
  const scale = Math.sqrt(L / L_SUN);

  const optIn  = OPT_INNER_FRAC * scale * AU_RENDER;
  const inner  = HZ_INNER_FRAC  * scale * AU_RENDER;
  const outer  = HZ_OUTER_FRAC  * scale * AU_RENDER;
  const optOut = OPT_OUTER_FRAC * scale * AU_RENDER;

  const group = new THREE.Group();
  group.name = `habZone-${sun.name}`;

  // Optimistic inner band (warmer, amber)
  group.add(_annulus(optIn, inner, 0xddbb55, 0.07));
  // Conservative HZ (vivid green)
  group.add(_annulus(inner, outer, 0x44dd66, 0.20));
  // Optimistic outer band (cooler, blue-green)
  group.add(_annulus(outer, optOut, 0x88dd99, 0.07));

  // Crisp edge loops on the conservative band so the boundary reads
  // clearly even at OVERVIEW where the fill alpha smears together.
  group.add(_ringLoop(inner, 192, 0x6effa8, 0.65));
  group.add(_ringLoop(outer, 192, 0x6effa8, 0.65));
  // Faint optimistic-edge loops for completeness.
  group.add(_ringLoop(optIn,  192, 0xddbb55, 0.30));
  group.add(_ringLoop(optOut, 192, 0x88dd99, 0.30));

  group.visible = _enabled;
  scene.add(group);
  return group;
}

function _disposeZone(group) {
  if (group.parent) group.parent.remove(group);
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
}

function _ensureZonesBuilt() {
  for (const b of state.bodies) {
    if (_isSun(b) && !_zones.has(b)) {
      _zones.set(b, _buildZoneFor(b));
    }
  }
}

export function setHabZoneVisible(visible) {
  _enabled = visible;
  if (visible) _ensureZonesBuilt();
  for (const g of _zones.values()) g.visible = visible;
  const btn = document.getElementById('habZoneBtn');
  if (btn) btn.classList.toggle('active', _enabled);
}

export function isHabZoneVisible() { return _enabled; }

// Per-frame: keep each zone glued to its sun (the Sun wobbles slightly
// from Jupiter's pull, and any future added star may move). Also lazily
// pick up new suns and prune dead ones.
export function updateHabitableZones() {
  if (_enabled) _ensureZonesBuilt();
  for (const [sun, group] of _zones) {
    if (!sun.alive || !state.bodies.includes(sun)) {
      _disposeZone(group);
      _zones.delete(sun);
      continue;
    }
    if (!_enabled) { group.visible = false; continue; }
    group.visible = true;
    const [rx, ry, rz] = renderPos(sun);
    group.position.set(rx, ry, rz);
  }
}

export function initHabZoneUI() {
  const btn = document.getElementById('habZoneBtn');
  if (!btn) return;
  btn.classList.toggle('active', _enabled);
  btn.onclick = () => setHabZoneVisible(!_enabled);
}
