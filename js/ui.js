// DOM wiring for the HUD: sliders, buttons, telemetry, nav dock,
// help overlay, and global keyboard shortcuts (one-shot actions).

import * as THREE from 'three';
import { state } from './state.js';
import { WARP_LEVELS, NAV_ORDER, NAV_DIST, AU, RENDER_SCALE } from './data.js';
import { buildSolarSystem } from './physics.js';
import { rebuildVisuals, trailLines, labelDivs, renderPos, visualRadius } from './visuals.js';
import { camState } from './camera.js';
import { setAimMode, fireAsteroid } from './asteroid.js';

const warpEl     = document.getElementById('warp');
const warpLabel  = document.getElementById('warpLabel');
const warpVal    = document.getElementById('warpval');
const massEl     = document.getElementById('mass');
const massLabel  = document.getElementById('massLabel');
const speedEl    = document.getElementById('speed');
const speedLabel = document.getElementById('speedLabel');
const pauseBtn   = document.getElementById('pauseBtn');
const resetBtn   = document.getElementById('resetBtn');
const clearBtn   = document.getElementById('clearBtn');
const trailsBtn  = document.getElementById('trailsBtn');
const labelsBtn  = document.getElementById('labelsBtn');
const aimBtn     = document.getElementById('aimBtn');
const helpBtn    = document.getElementById('helpBtn');
const helpOverlay = document.getElementById('helpOverlay');
const overviewBtn = document.getElementById('overviewBtn');
const freeCamBtn  = document.getElementById('freeCamBtn');
const closeImpactBtn = document.getElementById('closeImpact');

function supscript(s) {
  const map = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','.':'·','-':'⁻'};
  return s.split('').map(c => map[c] || c).join('');
}
function colorHex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function formatMassExp(e) {
  const s = (e % 1 === 0) ? String(e) : e.toFixed(1);
  return '10' + supscript(s) + ' kg';
}

function updateWarpLabel() {
  warpLabel.textContent = WARP_LEVELS[state.warpIdx].label;
  warpVal.textContent = WARP_LEVELS[state.warpIdx].label.replace('/s','');
}

function syncPauseButton() {
  pauseBtn.classList.toggle('active', state.paused);
  pauseBtn.textContent = state.paused ? 'RESUME' : 'PAUSE';
}

// --- sliders ---
warpEl.addEventListener('input', () => { state.warpIdx = parseInt(warpEl.value); updateWarpLabel(); });
massEl.addEventListener('input', () => {
  massLabel.textContent = formatMassExp(parseFloat(massEl.value));
});
speedEl.addEventListener('input', () => {
  const v = parseFloat(speedEl.value);
  // Tighter formatting at low speeds where the small-Δv transfer regime lives.
  speedLabel.textContent = (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : v.toFixed(0)) + ' km/s';
});

// --- buttons ---
pauseBtn.onclick = () => { state.paused = !state.paused; syncPauseButton(); };
resetBtn.onclick = () => {
  buildSolarSystem();
  rebuildVisuals();
  populateNavDock();
  state.paused = true; syncPauseButton();
};
clearBtn.onclick = () => {
  state.bodies = state.bodies.filter(b => !b.isAsteroid);
  rebuildVisuals();
};
trailsBtn.onclick = () => {
  state.showTrails = !state.showTrails;
  trailsBtn.classList.toggle('active', state.showTrails);
  for (const l of trailLines.values()) l.visible = state.showTrails;
};
labelsBtn.onclick = () => {
  state.showLabels = !state.showLabels;
  labelsBtn.classList.toggle('active', state.showLabels);
  for (const d of labelDivs.values()) d.style.display = state.showLabels ? '' : 'none';
};
// Launch state: spawn point in render units (set by clicking empty space)
// and target body name (set by clicking a body, or via a TARGET pill).
const launchState = { targetName: 'EARTH' };
const launchTargetEl = document.getElementById('launchTarget');

function populateLaunchTargets() {
  launchTargetEl.innerHTML = '';
  for (const name of NAV_ORDER) {
    const b = state.bodies.find(x => x.name === name);
    if (!b) continue;
    const btn = document.createElement('button');
    btn.className = 'launch-pill' + (launchState.targetName === name ? ' active' : '');
    btn.dataset.name = name;
    btn.innerHTML = `<span class="swatch" style="background:${colorHex(b.color)};color:${colorHex(b.color)}"></span>${name}`;
    btn.onclick = () => {
      launchState.targetName = name;
      for (const p of launchTargetEl.children) p.classList.toggle('active', p.dataset.name === name);
    };
    launchTargetEl.appendChild(btn);
  }
}
export function getLaunchTarget() { return state.bodies.find(b => b.name === launchState.targetName); }

// Sync target pill active class with current selection. Called from the
// scene-click event listener below.
function setLaunchTargetByName(name) {
  if (!NAV_ORDER.includes(name)) return;
  launchState.targetName = name;
  for (const p of launchTargetEl.children) p.classList.toggle('active', p.dataset.name === name);
}
window.addEventListener('orbital:aim-target', e => setLaunchTargetByName(e.detail.name));

// Empty-space click during aim mode → relocate spawn point.
window.addEventListener('orbital:aim-spawn', e => {
  state.launchSpawn = new THREE.Vector3(e.detail.x, e.detail.y, e.detail.z);
});

aimBtn.onclick = () => {
  const turningOn = !state.aimMode;
  if (turningOn) {
    // Default the target to a body that's NOT the current focus, so the
    // preview line draws something obviously interesting.
    if (camState.focusBody && NAV_ORDER.includes(camState.focusBody.name)
        && camState.focusBody.name === launchState.targetName) {
      const i = NAV_ORDER.indexOf(launchState.targetName);
      launchState.targetName = NAV_ORDER[(i + 1) % NAV_ORDER.length];
    }
    // Default spawn — a position offset from the previous focus body so
    // the user sees the placeholder asteroid right away. They can click
    // anywhere on empty space to move it.
    const seed = camState.focusBody || state.bodies.find(b => b.name === 'EARTH');
    if (seed) {
      const [rx, , rz] = renderPos(seed);
      // Offset along +X by ~3 visual radii so it sits next to the body.
      state.launchSpawn = new THREE.Vector3(rx + visualRadius(seed) * 3, 0, rz);
    } else {
      state.launchSpawn = new THREE.Vector3(150, 0, 0);
    }
    populateLaunchTargets();
  } else {
    state.launchSpawn = null;
  }
  setAimMode(turningOn);
};

const fireBtn = document.getElementById('fireBtn');
const cancelAimBtn = document.getElementById('cancelAimBtn');
fireBtn.onclick = () => {
  if (!state.aimMode || !state.launchSpawn) return;
  const tgt = getLaunchTarget();
  if (!tgt) return;
  const ast = fireAsteroid(state.launchSpawn, tgt);
  if (ast) {
    // Track the asteroid into its target. Initial camera distance scales to
    // the spawn→target distance so the user sees both endpoints initially.
    const dx = (tgt.px - state.launchSpawn.x * RENDER_SCALE) / RENDER_SCALE;
    const dy = (tgt.py - state.launchSpawn.y * RENDER_SCALE) / RENDER_SCALE;
    const dz = (tgt.pz - state.launchSpawn.z * RENDER_SCALE) / RENDER_SCALE;
    const stDist = Math.hypot(dx, dy, dz);
    camState.focusBody = ast;
    camState.targetDist = Math.max(15, Math.min(stDist * 0.35, 400));
  }
  setAimMode(false);
};
cancelAimBtn.onclick = () => setAimMode(false);

closeImpactBtn.onclick = () => {
  document.getElementById('impactModal').classList.remove('show');
};

// --- nav dock ---
export function populateNavDock() {
  const grid = document.getElementById('navGrid');
  grid.innerHTML = '';
  for (const name of NAV_ORDER) {
    const b = state.bodies.find(x => x.name === name);
    if (!b) continue;
    const btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.dataset.name = name;
    btn.innerHTML = `<span class="swatch" style="background:${colorHex(b.color)};color:${colorHex(b.color)}"></span>${name}`;
    btn.onclick = () => goToBody(b);
    grid.appendChild(btn);
  }
}
function goToBody(b) {
  camState.focusBody = b;
  camState.targetDist = NAV_DIST[b.name] || 30;
  document.querySelectorAll('.nav-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.name === b.name);
  });
}

overviewBtn.onclick = () => {
  camState.focusBody = null;
  camState.targetGoal.set(0, 0, 0);
  camState.targetDist = 4500;
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
};
freeCamBtn.onclick = () => {
  if (camState.focusBody) {
    const [rx, ry, rz] = renderPos(camState.focusBody);
    camState.targetGoal.set(rx, ry, rz);
  }
  camState.focusBody = null;
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
};

// =====================================================================
// VIEW PRESETS — angle / zoom / scene
// =====================================================================
// Angle buttons modify pitch only — keeps current focus & zoom so users
// can flip "TOP" then "3D" without losing their place.
function setAngle(pitchRad) {
  camState.pitch = pitchRad;
  // Pitch is read directly each frame, no goal tween. Snap is intentional
  // — feels like an editor camera switch.
}
document.getElementById('angleTopBtn').onclick  = () => setAngle(-1.45);   // ~83° down
document.getElementById('angle3dBtn').onclick   = () => setAngle(-0.40);   // default tilt
document.getElementById('angleSideBtn').onclick = () => setAngle(-0.05);   // edge-on, slight tilt

// Zoom buttons modify targetDist only — keeps focus and angle untouched
// so a user can dial in a body, then toggle the surrounding context.
function setZoom(dist) { camState.targetDist = dist; }
document.getElementById('zoomInnerBtn').onclick = () => setZoom(280);   // Mercury–Mars
document.getElementById('zoomBeltBtn').onclick  = () => setZoom(750);   // out to belt
document.getElementById('zoomOuterBtn').onclick = () => setZoom(2800);  // out to Saturn/Uranus

// Scene presets bundle focus + target + zoom + angle into one click.
document.getElementById('sceneTopAllBtn').onclick = () => {
  camState.focusBody = null;
  camState.targetGoal.set(0, 0, 0);
  camState.targetDist = 4500;
  camState.pitch = -1.45;
  camState.yaw = 0;
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
};
document.getElementById('sceneEclipticBtn').onclick = () => {
  // Edge-on view of the ecliptic — planets line up as a thin band.
  camState.focusBody = null;
  camState.targetGoal.set(0, 0, 0);
  camState.targetDist = 600;
  camState.pitch = 0;
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
};
document.getElementById('sceneSunRelBtn').onclick = () => {
  // Sun centered, default 3D angle, framing through Jupiter — good for
  // watching inner-system orbits while the outer planets sweep around.
  const sun = state.bodies.find(b => b.name === 'SUN');
  camState.focusBody = sun || null;
  camState.targetDist = 800;
  camState.pitch = -0.4;
  document.querySelectorAll('.nav-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.name === 'SUN');
  });
};

// --- help overlay ---
function toggleHelp(show) {
  if (show === undefined) show = !helpOverlay.classList.contains('show');
  helpOverlay.classList.toggle('show', show);
}
helpBtn.onclick = () => toggleHelp();
helpOverlay.addEventListener('click', e => {
  if (e.target === helpOverlay) toggleHelp(false);
});

function toggleHud() {
  document.body.classList.toggle('hud-hidden');
}

// --- global keyboard (one-shot actions) ---
function shouldIgnoreKey(e) {
  const tag = e.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
}

window.addEventListener('keydown', e => {
  if (shouldIgnoreKey(e)) return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      pauseBtn.click(); break;
    case 'KeyR': resetBtn.click(); break;
    case 'KeyT': trailsBtn.click(); break;
    case 'KeyL': labelsBtn.click(); break;
    case 'KeyN': aimBtn.click(); break;
    case 'KeyO': overviewBtn.click(); break;
    case 'KeyF': freeCamBtn.click(); break;
    case 'KeyH': toggleHud(); break;
    case 'KeyX': clearBtn.click(); break;
    case 'Slash': if (e.shiftKey) toggleHelp(); break; // ?
    case 'Escape':
      if (helpOverlay.classList.contains('show')) toggleHelp(false);
      else if (state.aimMode) setAimMode(false);
      else document.getElementById('impactModal').classList.remove('show');
      break;
    case 'Enter':
      if (state.aimMode) { e.preventDefault(); fireBtn.click(); }
      break;
    case 'Comma':
      // step warp down
      if (state.warpIdx > 0) { state.warpIdx--; warpEl.value = state.warpIdx; updateWarpLabel(); }
      break;
    case 'Period':
      if (state.warpIdx < WARP_LEVELS.length - 1) { state.warpIdx++; warpEl.value = state.warpIdx; updateWarpLabel(); }
      break;
    default: {
      // Digit1..Digit9, Digit0 -> jump to bodies in NAV_ORDER
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(-1));
        const idx = (n === 0) ? 9 : (n - 1);
        const name = NAV_ORDER[idx];
        const b = state.bodies.find(x => x.name === name);
        if (b) goToBody(b);
      }
    }
  }
});

// --- initial UI sync ---
massLabel.textContent = formatMassExp(parseFloat(massEl.value));
updateWarpLabel();
syncPauseButton();
trailsBtn.classList.add('active');
labelsBtn.classList.add('active');

// =====================================================================
// BODY INSPECTOR
// =====================================================================

const insTitleEl = document.getElementById('insTitle');
const insBodyEl  = document.getElementById('insBody');

function fmtTime(s) {
  if (s < 60) return s.toFixed(0) + ' s';
  if (s < 3600) return (s / 60).toFixed(1) + ' min';
  if (s < 86400) return (s / 3600).toFixed(1) + ' hr';
  if (s < 86400 * 365) return (s / 86400).toFixed(1) + ' d';
  return (s / 86400 / 365).toFixed(1) + ' yr';
}
function fmtPressure(bar) {
  if (bar === 0) return '0';
  if (bar < 1e-6) return bar.toExponential(1) + ' bar';
  if (bar < 1)    return (bar * 1000).toFixed(2) + ' mbar';
  return bar.toFixed(2) + ' bar';
}
function fmtPopulation(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1) + ' BILLION';
  if (n >= 1e6) return (n/1e6).toFixed(1) + ' MILLION';
  return n.toFixed(0);
}
function row(k, v, cls = '') {
  return `<div class="ins-row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
}
function rowBar(k, v, fraction, cls = '') {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return `<div class="ins-row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>` +
         `<div class="ins-bar ${cls}"><span style="width:${pct.toFixed(1)}%"></span></div>`;
}

let _lastInspectedBody = null;

// Build the inspector panel for `body` once. Static fields go in the HTML;
// dynamic fields (current distance, velocity) get their own IDs and are
// updated each frame in updateInspectorDynamic.
function renderInspector(body) {
  if (!body) {
    insTitleEl.textContent = 'INSPECTOR';
    insBodyEl.className = 'ins-empty';
    insBodyEl.textContent = 'CLICK A BODY TO INSPECT';
    return;
  }
  insBodyEl.className = '';

  const swatch = body.color !== undefined
    ? `<span class="swatch" style="background:${colorHex(body.color)};color:${colorHex(body.color)};display:inline-block;width:8px;height:8px;border-radius:50%;box-shadow:0 0 6px currentColor;margin-right:8px;vertical-align:middle;"></span>`
    : '';
  insTitleEl.innerHTML = swatch + '<span class="body-name">' + body.name + '</span>';

  const sections = [];

  if (body.type) {
    sections.push(`<div class="ins-section">
      <div class="ins-section-title">CLASSIFICATION</div>
      ${row('TYPE', body.type)}
      ${body.class ? row('CLASS', body.class) : ''}
      ${body.parent ? row('PARENT', body.parent) : ''}
    </div>`);
  }

  sections.push(`<div class="ins-section">
    <div class="ins-section-title">PHYSICAL</div>
    ${row('MASS', body.mass.toExponential(2) + ' kg')}
    ${row('RADIUS', (body.displayRadius / 1e3).toFixed(0) + ' km')}
    ${body.surfaceGravity !== undefined ? row('SURFACE g', body.surfaceGravity.toFixed(2) + ' m/s²') : ''}
    ${body.composition ? row('COMPOSITION', body.composition) : ''}
  </div>`);

  sections.push(`<div class="ins-section">
    <div class="ins-section-title">ORBITAL</div>
    <div class="ins-row" id="ins-dist"><span class="k">DIST FROM SUN</span><span class="v">— AU</span></div>
    <div class="ins-row" id="ins-speed"><span class="k">VELOCITY</span><span class="v">— km/s</span></div>
    ${body.tilt !== undefined ? row('AXIAL TILT', body.tilt.toFixed(2) + '°') : ''}
    ${body.rotPeriod ? row('SIDEREAL DAY', fmtTime(Math.abs(body.rotPeriod)) + (body.rotPeriod < 0 ? ' RETROGRADE' : '')) : ''}
  </div>`);

  if (body.atmosphere) {
    sections.push(`<div class="ins-section">
      <div class="ins-section-title">ATMOSPHERE</div>
      ${row('COMPOSITION', body.atmosphere)}
      ${body.pressure !== undefined ? row('PRESSURE', fmtPressure(body.pressure)) : ''}
      ${body.surfaceTemp !== undefined ? row('SURFACE TEMP', body.surfaceTemp + ' K · ' + (body.surfaceTemp - 273).toFixed(0) + '°C') : ''}
      ${body.cloudTopTemp !== undefined ? row('CLOUD-TOP TEMP', body.cloudTopTemp + ' K') : ''}
    </div>`);
  }

  if (body.water !== undefined || body.biosphere) {
    const habCls = body.habitability > 0.5 ? 'good' : body.habitability > 0.1 ? 'warn' : 'hot';
    sections.push(`<div class="ins-section">
      <div class="ins-section-title">HABITABILITY</div>
      ${body.water !== undefined ? rowBar('WATER COVER', (body.water * 100).toFixed(1) + '%', body.water, 'good') : ''}
      ${body.iceCover !== undefined ? rowBar('ICE COVER', (body.iceCover * 100).toFixed(1) + '%', body.iceCover) : ''}
      ${body.co2 !== undefined ? row('CO₂', body.co2 + ' ppm') : ''}
      ${body.biosphere ? row('BIOSPHERE', body.biosphere, body.habitability > 0.5 ? 'good' : '') : ''}
      ${body.habitability !== undefined ? rowBar('HABITABILITY', (body.habitability * 100).toFixed(0) + '%', body.habitability, habCls) : ''}
    </div>`);
  }

  if (body.population !== undefined) {
    sections.push(`<div class="ins-section">
      <div class="ins-section-title">CIVILIZATION</div>
      ${row('POPULATION', fmtPopulation(body.population), 'good')}
    </div>`);
  }

  if (body.luminosity) {
    sections.push(`<div class="ins-section">
      <div class="ins-section-title">STELLAR</div>
      ${row('LUMINOSITY', body.luminosity.toExponential(2) + ' W')}
      ${body.coreTemp ? row('CORE TEMP', body.coreTemp.toExponential(1) + ' K') : ''}
      ${body.fusion ? row('FUSION', body.fusion) : ''}
      ${body.age ? row('AGE', (body.age / 1e9).toFixed(1) + ' Gyr') : ''}
    </div>`);
  }

  if (body.moons !== undefined) {
    sections.push(`<div class="ins-section">
      <div class="ins-section-title">SYSTEM</div>
      ${row('MOONS', body.moons)}
    </div>`);
  }

  if (body.notes) {
    sections.push(`<div class="ins-notes">${body.notes}</div>`);
  }

  insBodyEl.innerHTML = sections.join('');
}

function updateInspectorDynamic(body) {
  if (!body) return;
  const sun = state.bodies.find(b => b.name === 'SUN');
  const distEl = document.getElementById('ins-dist');
  const speedEl = document.getElementById('ins-speed');
  if (distEl && sun) {
    const dx = body.px - sun.px, dy = body.py - sun.py, dz = body.pz - sun.pz;
    const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
    distEl.querySelector('.v').textContent = (d / AU).toFixed(3) + ' AU';
  }
  if (speedEl) {
    const v = Math.sqrt(body.vx*body.vx + body.vy*body.vy + body.vz*body.vz);
    speedEl.querySelector('.v').textContent = (v / 1000).toFixed(2) + ' km/s';
  }
}

// --- telemetry (called from main loop) ---
export function updateTelemetry() {
  document.getElementById('bodyCount').textContent = state.bodies.length;
  document.getElementById('astCount').textContent = state.bodies.filter(b => b.isAsteroid).length;
  const dt = state.lastDt || (WARP_LEVELS[state.warpIdx].dt / 1);
  document.getElementById('dtval').textContent =
    dt.toExponential(1) + ' s · ' + (state.lastSubsteps || 1) + 'x';

  const epoch = new Date('2000-01-01T12:00:00Z').getTime();
  const cur = new Date(epoch + state.simTime * 1000);
  document.getElementById('simdate').textContent = cur.toISOString().slice(0,10);

  // Re-render inspector when focus changes; update dynamic readouts every frame.
  if (camState.focusBody !== _lastInspectedBody) {
    renderInspector(camState.focusBody);
    _lastInspectedBody = camState.focusBody;
  }
  updateInspectorDynamic(camState.focusBody);
}
