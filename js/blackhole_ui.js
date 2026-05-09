// Dedicated black-hole forge dock.
//
// Separate from the asteroid LAUNCH panel because a black hole isn't a
// scaled-up rock — it deserves its own ritual: violet-on-void aesthetic,
// real-time event-horizon / photon-sphere / ISCO readouts as the user
// tunes mass, recognisable real-world analogues for context, and a
// dramatic "RELEASE SINGULARITY" commit.
//
// While the panel is open, the user is in *placement mode*: scene clicks
// reposition the BH spawn (rendered as a ghost in the scene, far outside
// the planetary system by default) or change the target. A predicted
// trajectory line shows how the configured BH will cut through the system
// over the next ~120 years given its mass + Δv.

import * as THREE from 'three';
import { state } from './state.js';
import { G, AU, NAV_ORDER, RENDER_SCALE } from './data.js';
import { renderPos, visualRadius, rebuildVisuals } from './visuals.js';
import { camState } from './camera.js';
import { camera, scene } from './scene.js';
import { Body, computeAccelerations, predictTrajectory } from './physics.js';

const C_LIGHT = 299792458;
const SOLAR   = 1.989e30;

// Recognisable real-world black holes, sorted by mass. Panel finds the
// nearest by log-distance and surfaces it as a "real-world analogue".
const BH_EXAMPLES = [
  { mass: 1.2e31, name: 'M3 STELLAR BH (~6 M☉)' },
  { mass: 4e31,   name: 'CYGNUS X-1 (21 M☉)' },
  { mass: 1.4e32, name: 'GW150914 REMNANT (62 M☉)' },
  { mass: 2e34,   name: 'IMBH IN ω CENTAURI (~10⁴ M☉)' },
  { mass: 2e35,   name: 'IMBH IN NGC 4395 (~10⁵ M☉)' },
  { mass: 8e36,   name: 'SGR A* — GALACTIC CENTRE (4M M☉)' },
  { mass: 1.3e40, name: 'M87* — FIRST IMAGED BH (6.5B M☉)' },
  { mass: 1.3e41, name: 'TON 618 — KNOWN SUPERMASSIVE (66B M☉)' },
];
function nearestExample(mass) {
  let best = BH_EXAMPLES[0];
  let bestDiff = Infinity;
  for (const e of BH_EXAMPLES) {
    const diff = Math.abs(Math.log10(mass) - Math.log10(e.mass));
    if (diff < bestDiff) { best = e; bestDiff = diff; }
  }
  return best.name;
}

function classify(mass) {
  const m = mass / SOLAR;
  if (m < 100)  return 'STELLAR · X-RAY BINARY';
  if (m < 1e5)  return 'INTERMEDIATE · CLUSTER CORE';
  if (m < 1e8)  return 'SUPERMASSIVE · GALACTIC CENTRE';
  return 'ULTRAMASSIVE · QUASAR ENGINE';
}
function compareSize(rs) {
  if (rs < 1e3)   return 'SUB-KILOMETRE · BUILDING-SCALE';
  if (rs < 1e4)   return 'CITY-BLOCK SCALE';
  if (rs < 1e5)   return 'CITY-SIZED';
  if (rs < 1e6)   return 'SMALL ISLAND';
  if (rs < 6e6)   return 'EARTH-SIZED HORIZON';
  if (rs < 7e8)   return 'SUN-SIZED HORIZON';
  if (rs < 5e10)  return 'ORBIT OF MERCURY';
  if (rs < 5e11)  return 'INNER SOLAR SYSTEM';
  return 'WIDER THAN OUR PLANETARY SYSTEM';
}
function fmtSize(m) {
  if (m < 1e3)   return m.toFixed(0) + ' m';
  if (m < 1e6)   return (m/1e3).toFixed(1) + ' km';
  if (m < 1e9)   return (m/1e6).toFixed(1) + ' Mm';
  if (m < 1e12)  return (m/1e9).toFixed(2) + ' Gm';
  return (m / 1.496e11).toFixed(2) + ' AU';
}

// Class pill → mass-slider exponent. Click a pill, slider snaps there.
const BH_CLASS_PRESETS = {
  STELLAR:      31,    // 10 M☉
  INTERMEDIATE: 34,    // 10⁴ M☉
  SUPERMASSIVE: 37,    // 10⁶ M☉
  ULTRAMASSIVE: 40,    // 10¹⁰ M☉
};

// Default BH spawn distance in AU — outside Neptune (30 AU) so the user
// can watch it approach. 60 AU ≈ Kuiper-belt edge.
const SPAWN_AU = 60;
const SPAWN_RENDER = SPAWN_AU * AU / RENDER_SCALE;

// Camera pull-back when the panel opens — wide enough to fit the BH
// spawn (≈ 60 AU = 9000 render units) plus the planetary system.
const PLACEMENT_CAMERA_DIST = 14000;

// =====================================================================
// Ghost BH visual — a small black sphere wrapped in a violet ring sits at
// state.bhSpawn while bhMode is on. Built once, shown/hidden + repositioned
// each frame from updateBlackHoleVisual.
// =====================================================================
const ghostGroup = new THREE.Group();
{
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  const ringInner = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.10, 14, 64),
    new THREE.MeshBasicMaterial({
      color: 0xc084ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  ringInner.rotation.x = Math.PI / 2;
  const ringOuter = new THREE.Mesh(
    new THREE.TorusGeometry(2.1, 0.06, 12, 64),
    new THREE.MeshBasicMaterial({
      color: 0xa066ff, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  ringOuter.rotation.x = Math.PI / 2;
  ghostGroup.add(sphere, ringInner, ringOuter);
}
ghostGroup.visible = false;
scene.add(ghostGroup);

// =====================================================================
// BH prediction line — long-range trajectory through the system at the
// configured mass + Δv. Built from predictTrajectory; predDt is bigger
// than the asteroid's because BHs come from much farther away.
// =====================================================================
const BH_PRED_CAPACITY = 1500;
const bhPredGeo = new THREE.BufferGeometry();
bhPredGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BH_PRED_CAPACITY * 3), 3));
const bhPredMat = new THREE.LineDashedMaterial({
  color: 0xc084ff, dashSize: 4, gapSize: 2.5, transparent: true, opacity: 0.85,
});
const bhPredLine = new THREE.Line(bhPredGeo, bhPredMat);
bhPredLine.frustumCulled = false;
bhPredLine.visible = false;
scene.add(bhPredLine);

// =====================================================================
// Panel state + DOM refs
// =====================================================================
const bhState = { targetName: 'SUN' };
let panelEl, openBtn, closeBtn, cancelBtn, fireBtn,
    massEl, dvEl, targetEl, classPillsEl;
// Saved so we can restore the user's pre-placement camera if they CANCEL.
let savedFocus = null, savedTargetDist = null;

function colorHex(n) { return '#' + n.toString(16).padStart(6, '0'); }

function populateTargetPills() {
  targetEl.innerHTML = '';
  for (const name of NAV_ORDER) {
    const b = state.bodies.find(x => x.name === name);
    if (!b) continue;
    const btn = document.createElement('button');
    btn.className = 'bh-target-pill' + (bhState.targetName === name ? ' active' : '');
    btn.dataset.name = name;
    btn.innerHTML = `<span class="swatch" style="background:${colorHex(b.color)};color:${colorHex(b.color)}"></span>${name}`;
    btn.onclick = () => setTargetByName(name);
    targetEl.appendChild(btn);
  }
}
function setTargetByName(name) {
  if (!NAV_ORDER.includes(name)) return;
  bhState.targetName = name;
  for (const p of targetEl.children) p.classList.toggle('active', p.dataset.name === name);
}

function refreshReadouts() {
  const massExp = parseFloat(massEl.value);
  const mass = Math.pow(10, massExp);
  const rs = (2 * G * mass) / (C_LIGHT * C_LIGHT);
  document.getElementById('bhMassKg').textContent    = mass.toExponential(2);
  document.getElementById('bhMassSolar').textContent = (mass / SOLAR).toExponential(2);
  document.getElementById('bhClassLabel').textContent = classify(mass);
  document.getElementById('bhRs').textContent        = fmtSize(rs);
  document.getElementById('bhPs').textContent        = fmtSize(1.5 * rs);
  document.getElementById('bhIsco').textContent      = fmtSize(3.0 * rs);
  document.getElementById('bhCompare').textContent   = compareSize(rs);
  document.getElementById('bhExample').textContent   = nearestExample(mass);
  document.getElementById('bhDvVal').textContent     = parseFloat(dvEl.value).toFixed(1);
  for (const p of classPillsEl.children) {
    const v = BH_CLASS_PRESETS[p.dataset.class];
    p.classList.toggle('active', Math.abs(massExp - v) < 1.5);
  }
}

// Place the spawn ghost at a sensible default — outside the system on the
// camera-facing side so the user sees the BH in the same direction they're
// already looking from.
function defaultBhSpawn() {
  const cx = camera.position.x, cz = camera.position.z;
  const len = Math.hypot(cx, cz);
  const dx = len > 1e-3 ? cx / len : 1;
  const dz = len > 1e-3 ? cz / len : 0;
  return new THREE.Vector3(dx * SPAWN_RENDER, 0, dz * SPAWN_RENDER);
}

function openPanel() {
  // Save current camera so CANCEL can restore it.
  savedFocus = camState.focusBody;
  savedTargetDist = camState.targetDist;

  state.bhMode = true;
  // Default target = a body that isn't the focus (more dramatic launch).
  if (camState.focusBody && NAV_ORDER.includes(camState.focusBody.name)
      && camState.focusBody.name === bhState.targetName) {
    const i = NAV_ORDER.indexOf(bhState.targetName);
    bhState.targetName = NAV_ORDER[(i + 1) % NAV_ORDER.length];
  }
  state.bhSpawn = defaultBhSpawn();

  // Camera tweens to a wide overview that fits both the BH spawn (~60 AU
  // out) and the planetary system. focusBody = null so the tween isn't
  // overridden each frame.
  camState.focusBody = null;
  camState.targetGoal.set(0, 0, 0);
  camState.targetDist = PLACEMENT_CAMERA_DIST;

  populateTargetPills();
  refreshReadouts();
  panelEl.classList.add('show');
  ghostGroup.visible = true;
}

function closePanel(restoreCamera = true) {
  state.bhMode = false;
  state.bhSpawn = null;
  ghostGroup.visible = false;
  bhPredLine.visible = false;
  panelEl.classList.remove('show');
  if (restoreCamera) {
    camState.focusBody = savedFocus;
    if (savedTargetDist !== null) camState.targetDist = savedTargetDist;
  }
  savedFocus = null;
  savedTargetDist = null;
}

function launchBlackHole() {
  const target = state.bodies.find(b => b.name === bhState.targetName);
  if (!target || !state.bhSpawn) { closePanel(); return; }

  const massExp = parseFloat(massEl.value);
  const mass = Math.pow(10, massExp);
  const dvMs = parseFloat(dvEl.value) * 1000;

  // Spawn position from the ghost (in physical metres).
  const spawnPx = state.bhSpawn.x * RENDER_SCALE;
  const spawnPy = state.bhSpawn.y * RENDER_SCALE;
  const spawnPz = state.bhSpawn.z * RENDER_SCALE;

  // Direction toward target.
  const ddx = target.px - spawnPx;
  const ddy = target.py - spawnPy;
  const ddz = target.pz - spawnPz;
  const dD = Math.hypot(ddx, ddy, ddz) || 1;
  const ux = ddx / dD, uy = ddy / dD, uz = ddz / dD;

  // Local circular Sun-orbit baseline. From 60 AU this is small (~3.8 km/s)
  // but it keeps the BH on a vaguely sensible Kepler-like path until it
  // gets close enough that its own gravity dominates.
  const sun = state.bodies.find(b => b.name === 'SUN');
  let baseVx = 0, baseVy = 0, baseVz = 0;
  if (sun) {
    const sxRel = spawnPx - sun.px, szRel = spawnPz - sun.pz;
    const r = Math.hypot(sxRel, szRel) || 1;
    const vCirc = Math.sqrt(G * sun.mass / r);
    baseVx =  vCirc * szRel / r + sun.vx;
    baseVz = -vCirc * sxRel / r + sun.vz;
    baseVy = sun.vy;
  }

  const rs = (2 * G * mass) / (C_LIGHT * C_LIGHT);
  const bh = new Body({
    name: 'BH-' + (state.bodies.filter(x => x.isBlackHole).length + 1).toString().padStart(2, '0'),
    mass, displayRadius: rs, color: 0x000000,
    isAsteroid: true, isBlackHole: true,
    composition: 'BLACKHOLE',
    rotPeriod: 60,                                // accretion disk spin
    px: spawnPx, py: spawnPy, pz: spawnPz,
    vx: baseVx + ux * dvMs,
    vy: baseVy + uy * dvMs,
    vz: baseVz + uz * dvMs,
  });
  state.bodies.push(bh);
  computeAccelerations(state.bodies);
  rebuildVisuals();

  // Camera follows the BH so the user can watch it approach the target.
  camState.focusBody = bh;
  camState.targetDist = Math.max(PLACEMENT_CAMERA_DIST * 0.4, visualRadius(bh) * 8);

  // Don't restore the original camera — user is now watching the BH.
  closePanel(false);
}

// =====================================================================
// Per-frame: while bhMode is on, place the ghost at state.bhSpawn and
// recompute the predicted trajectory line (BH path through the system at
// configured mass + Δv). Called from main.js's tick.
// =====================================================================
export function updateBlackHoleVisual() {
  if (!state.bhMode || !state.bhSpawn) {
    ghostGroup.visible = false;
    bhPredLine.visible = false;
    return;
  }
  ghostGroup.visible = true;
  ghostGroup.position.copy(state.bhSpawn);
  // Slow continuous rotation so the rings catch the eye.
  ghostGroup.rotation.y += 0.015;

  // Build the proto and forward-simulate the BH's path. predictTrajectory
  // already supports BH-mass probes (its accel function is full N-body).
  const target = state.bodies.find(b => b.name === bhState.targetName);
  if (!target) { bhPredLine.visible = false; return; }
  const massExp = parseFloat(massEl.value);
  const mass = Math.pow(10, massExp);
  const dvMs = parseFloat(dvEl.value) * 1000;
  const spawnPx = state.bhSpawn.x * RENDER_SCALE;
  const spawnPy = state.bhSpawn.y * RENDER_SCALE;
  const spawnPz = state.bhSpawn.z * RENDER_SCALE;
  const ddx = target.px - spawnPx;
  const ddy = target.py - spawnPy;
  const ddz = target.pz - spawnPz;
  const dD = Math.hypot(ddx, ddy, ddz) || 1;
  const ux = ddx / dD, uy = ddy / dD, uz = ddz / dD;

  // Local circular baseline so the prediction matches the actual launch.
  const sun = state.bodies.find(b => b.name === 'SUN');
  let baseVx = 0, baseVy = 0, baseVz = 0;
  if (sun) {
    const sxRel = spawnPx - sun.px, szRel = spawnPz - sun.pz;
    const r = Math.hypot(sxRel, szRel) || 1;
    const vCirc = Math.sqrt(G * sun.mass / r);
    baseVx =  vCirc * szRel / r + sun.vx;
    baseVz = -vCirc * sxRel / r + sun.vz;
    baseVy = sun.vy;
  }

  const proto = {
    px: spawnPx, py: spawnPy, pz: spawnPz,
    vx: baseVx + ux * dvMs, vy: baseVy + uy * dvMs, vz: baseVz + uz * dvMs,
    mass,
  };
  // 30 days/step × 1500 = 123 sim-years of preview — long enough to see a
  // full encounter from far outside the system. (Asteroid prediction caps
  // at 5 days/step but BHs come from much farther, so a coarser step is
  // appropriate; the integrator handles the larger dt fine for a body
  // moving through mostly-empty space.)
  const predDt = 86400 * 30;
  const pred = predictTrajectory(proto, BH_PRED_CAPACITY, predDt);

  const arr = bhPredGeo.attributes.position.array;
  for (let i = 0; i < pred.path.length; i++) {
    arr[i*3]   = pred.path[i][0];
    arr[i*3+1] = pred.path[i][1];
    arr[i*3+2] = pred.path[i][2];
  }
  bhPredGeo.setDrawRange(0, pred.path.length);
  bhPredGeo.attributes.position.needsUpdate = true;
  bhPredLine.computeLineDistances();
  bhPredLine.visible = pred.path.length > 1;
}

// =====================================================================
// Init + event wiring
// =====================================================================
export function initBlackHoleUI() {
  panelEl       = document.getElementById('bhPanel');
  openBtn       = document.getElementById('bhOpenBtn');
  closeBtn      = document.getElementById('bhCloseBtn');
  cancelBtn     = document.getElementById('bhCancelBtn');
  fireBtn       = document.getElementById('bhFireBtn');
  massEl        = document.getElementById('bhMass');
  dvEl          = document.getElementById('bhDv');
  targetEl      = document.getElementById('bhTarget');
  classPillsEl  = document.getElementById('bhClassPills');
  if (!panelEl) return;

  openBtn.onclick   = openPanel;
  closeBtn.onclick  = () => closePanel(true);
  cancelBtn.onclick = () => closePanel(true);
  fireBtn.onclick   = launchBlackHole;
  massEl.addEventListener('input', refreshReadouts);
  dvEl.addEventListener('input', refreshReadouts);
  for (const p of classPillsEl.children) {
    p.onclick = () => {
      massEl.value = BH_CLASS_PRESETS[p.dataset.class];
      refreshReadouts();
    };
  }

  // Scene click events from camera.js.
  window.addEventListener('orbital:bh-spawn', (e) => {
    state.bhSpawn = new THREE.Vector3(e.detail.x, 0, e.detail.z);
  });
  window.addEventListener('orbital:bh-target', (e) => {
    setTargetByName(e.detail.name);
  });
}
