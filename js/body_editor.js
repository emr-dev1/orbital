// Body editor — appears as the MODIFY panel on the right when a body is
// focused. Mass and size sliders edit the focused body LIVE, so the user
// sees the gravitational ripple immediately if the sim is running. The
// PREDICT button forks the world into a fast forward sim and draws
// dashed cyan lines showing where every other body will be over the next
// year under the modified gravity — that's the "show how it impacts the
// rest of the system" answer.
//
// Original mass + radius are stashed in a WeakMap on first focus so RESET
// always reverts to whatever the body started the session with, even if
// the user loaded into the panel mid-edit.

import * as THREE from 'three';
import { state } from './state.js';
import { scene } from './scene.js';
import { bodySpinners, visualRadius, renderPos } from './visuals.js';
import { camState } from './camera.js';
import { computeAccelerations, step } from './physics.js';
import { RENDER_SCALE } from './data.js';

// ── original-value cache ──────────────────────────────────────────────
const _originals = new WeakMap();
function _origOf(body) {
  if (!_originals.has(body)) {
    _originals.set(body, { mass: body.mass, displayRadius: body.displayRadius });
  }
  return _originals.get(body);
}

// ── DOM refs (resolved in init) ───────────────────────────────────────
let elPanel, elEmpty, elBody, elTarget, elMassSlider, elSizeSlider,
    elMassLabel, elSizeLabel, elMassAbs, elSizeAbs, elPredictBtn, elResetBtn;

// Suppress slider input handlers during programmatic value updates (when
// focus changes we sync the slider position from the body's current
// mass/size, which would otherwise re-trigger an apply).
let _suppressInput = false;

// Currently-focused body the panel is wired to. Re-syncs when this changes.
let _activeBody = null;

// ── prediction visuals ────────────────────────────────────────────────
//
// One BufferGeometry + LineSegments per simulated body. Stored sparsely
// (Map keyed by body) so when bodies die we can clean up.
const PRED_POINTS    = 60;       // sample count per trajectory
const PRED_HORIZON_S = 365 * 86400; // seconds of sim time to project (1 year)
const _predLines = new Map();    // body → THREE.Line
const PRED_MAT = new THREE.LineDashedMaterial({
  color: 0x6effe1, dashSize: 1.5, gapSize: 1.0,
  transparent: true, opacity: 0.85, depthWrite: false,
});

function _ensurePredLineFor(body) {
  let line = _predLines.get(body);
  if (line) return line;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRED_POINTS * 3), 3));
  geo.setDrawRange(0, 0);
  line = new THREE.Line(geo, PRED_MAT);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  _predLines.set(body, line);
  return line;
}

function _hideAllPredLines() {
  for (const line of _predLines.values()) line.visible = false;
}

function _disposePredLine(body) {
  const line = _predLines.get(body);
  if (!line) return;
  if (line.parent) line.parent.remove(line);
  line.geometry.dispose();
  _predLines.delete(body);
}

// Forward-simulate the system and write each body's projected positions
// into its prediction line geometry. Works on a deep clone of the bodies
// array so the live sim is untouched.
function _runPrediction() {
  const live = state.bodies.filter(b => b.alive);
  if (live.length === 0) return;

  const clones = live.map(b => ({
    src: b,
    px: b.px, py: b.py, pz: b.pz,
    prevPx: b.px, prevPy: b.py, prevPz: b.pz,
    vx: b.vx, vy: b.vy, vz: b.vz,
    ax: 0, ay: 0, az: 0,
    mass: b.mass, alive: true,
    name: b.name, isAsteroid: b.isAsteroid,
  }));

  // Yoshida is stable for moderate dt on planet-scale orbits; with 60
  // points across one year, dt ≈ 6 days/step. The Moon (27d period)
  // loses some accuracy at this dt but the shape stays recognisable.
  const dt = PRED_HORIZON_S / PRED_POINTS;
  computeAccelerations(clones);

  for (const c of clones) {
    const line = _ensurePredLineFor(c.src);
    line._writeIdx = 0;
    line._arr = line.geometry.attributes.position.array;
  }

  for (let s = 0; s < PRED_POINTS; s++) {
    step(clones, dt);
    for (const c of clones) {
      const line = _predLines.get(c.src);
      if (!line) continue;
      const i = line._writeIdx++;
      line._arr[i*3]   = c.px / RENDER_SCALE;
      line._arr[i*3+1] = c.py / RENDER_SCALE;
      line._arr[i*3+2] = c.pz / RENDER_SCALE;
    }
  }

  // Commit and reveal each line.
  for (const [body, line] of _predLines) {
    if (!body.alive || !state.bodies.includes(body)) {
      _disposePredLine(body);
      continue;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.setDrawRange(0, line._writeIdx || 0);
    line.computeLineDistances();           // dashed line needs this
    line.visible = (line._writeIdx || 0) > 1;
  }
}

// ── live apply (mass + size sliders) ──────────────────────────────────
function _applyLive() {
  if (!_activeBody) return;
  const orig = _origOf(_activeBody);
  const massMul = Math.pow(10, parseFloat(elMassSlider.value));
  const sizeMul = Math.pow(10, parseFloat(elSizeSlider.value));

  _activeBody.mass = orig.mass * massMul;
  // displayRadius drives both visualRadius (sqrt scaling) and
  // bodyCollisionRadius. We scale displayRadius so the visible body
  // matches `sizeMul`: visualRadius = origVR * sqrt(sizeMul^2) = origVR * sizeMul.
  _activeBody.displayRadius = orig.displayRadius * (sizeMul * sizeMul);

  // Resize the rendered mesh by scaling its spinner — much cheaper than
  // a full rebuildVisuals(). Atmosphere shells, rings, glow sprites are
  // all spinner children so they scale with it.
  const spinner = bodySpinners.get(_activeBody);
  if (spinner) spinner.scale.setScalar(sizeMul);

  // New mass takes effect on the next physics substep automatically;
  // a one-shot recompute makes paused-sim feedback snappier.
  computeAccelerations(state.bodies);

  _refreshLabels(massMul, sizeMul);
}

function _refreshLabels(massMul, sizeMul) {
  if (!_activeBody) return;
  const orig = _origOf(_activeBody);
  const fmtMul = (v) =>
    v >= 100 ? v.toFixed(0) + '×' :
    v >= 10  ? v.toFixed(1) + '×' :
    v >= 1   ? v.toFixed(2) + '×' :
               v.toFixed(3) + '×';
  elMassLabel.textContent = fmtMul(massMul) + ' ORIG';
  elSizeLabel.textContent = fmtMul(sizeMul) + ' ORIG';
  elMassAbs.textContent = (orig.mass * massMul).toExponential(2) + ' kg';
  const newR = orig.displayRadius * sizeMul * sizeMul;
  elSizeAbs.textContent = (newR / 1e3).toFixed(0) + ' km';
}

function _resetActive() {
  if (!_activeBody) return;
  const orig = _origOf(_activeBody);
  _activeBody.mass = orig.mass;
  _activeBody.displayRadius = orig.displayRadius;
  const spinner = bodySpinners.get(_activeBody);
  if (spinner) spinner.scale.setScalar(1);
  computeAccelerations(state.bodies);

  _suppressInput = true;
  elMassSlider.value = '0';
  elSizeSlider.value = '0';
  _suppressInput = false;
  _refreshLabels(1, 1);
}

// ── focus tracking ────────────────────────────────────────────────────
//
// When camera focus changes, sync the panel: empty if no focus, else
// load the focused body's current mass/size into the sliders.
function _syncToFocus() {
  const f = camState.focusBody || null;
  if (f === _activeBody) return;
  _activeBody = f;

  if (!f) {
    elBody.style.display = 'none';
    elEmpty.style.display = '';
    _hideAllPredLines();
    return;
  }
  elEmpty.style.display = 'none';
  elBody.style.display = '';
  elTarget.textContent = '— ' + f.name + ' —';

  const orig = _origOf(f);
  const massMul = f.mass / orig.mass;
  const sizeMul = Math.sqrt(f.displayRadius / orig.displayRadius);
  _suppressInput = true;
  elMassSlider.value = String(Math.log10(Math.max(1e-3, massMul)));
  elSizeSlider.value = String(Math.log10(Math.max(0.1,  sizeMul)));
  _suppressInput = false;
  _refreshLabels(massMul, sizeMul);
  _hideAllPredLines();        // stale predictions for the previous focus
}

// ── public API ────────────────────────────────────────────────────────
export function initBodyEditor() {
  elPanel       = document.getElementById('modifyPanel');
  elEmpty       = document.getElementById('modifyEmpty');
  elBody        = document.getElementById('modifyBody');
  elTarget      = document.getElementById('modifyTarget');
  elMassSlider  = document.getElementById('modMassSlider');
  elSizeSlider  = document.getElementById('modSizeSlider');
  elMassLabel   = document.getElementById('modMassLabel');
  elSizeLabel   = document.getElementById('modSizeLabel');
  elMassAbs     = document.getElementById('modMassAbs');
  elSizeAbs     = document.getElementById('modSizeAbs');
  elPredictBtn  = document.getElementById('modPredictBtn');
  elResetBtn    = document.getElementById('modResetBtn');

  if (!elPanel) return;

  for (const slider of [elMassSlider, elSizeSlider]) {
    slider.addEventListener('input', () => {
      if (_suppressInput) return;
      _applyLive();
      // Auto-refresh prediction lines if any are visible.
      if (_anyPredictionVisible()) _runPrediction();
    });
  }

  elPredictBtn.onclick = () => {
    if (!_activeBody) return;
    _runPrediction();
  };
  elResetBtn.onclick = _resetActive;
}

function _anyPredictionVisible() {
  for (const line of _predLines.values()) if (line.visible) return true;
  return false;
}

// Per-frame: keep panel state in sync with the current focus body.
export function updateBodyEditor() {
  _syncToFocus();
}
