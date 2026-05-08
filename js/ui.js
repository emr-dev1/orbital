// DOM wiring for the HUD: sliders, buttons, telemetry, nav dock,
// help overlay, and global keyboard shortcuts (one-shot actions).

import { state } from './state.js';
import { WARP_LEVELS, NAV_ORDER, NAV_DIST, AU } from './data.js';
import { buildSolarSystem } from './physics.js';
import { rebuildVisuals, trailLines, labelDivs, renderPos } from './visuals.js';
import { camState } from './camera.js';
import { setAimMode } from './asteroid.js';

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
speedEl.addEventListener('input', () => { speedLabel.textContent = speedEl.value + ' km/s'; });

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
aimBtn.onclick = () => setAimMode(!state.aimMode);

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
  document.getElementById('focus').textContent = b.name;
  document.querySelectorAll('.nav-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.name === b.name);
  });
}

overviewBtn.onclick = () => {
  camState.focusBody = null;
  camState.target.set(0, 0, 0);
  camState.targetDist = 4500;
  document.getElementById('focus').textContent = 'OVERVIEW';
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
};
freeCamBtn.onclick = () => {
  if (camState.focusBody) {
    const [rx, ry, rz] = renderPos(camState.focusBody);
    camState.target.set(rx, ry, rz);
  }
  camState.focusBody = null;
  document.getElementById('focus').textContent = 'FREE';
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
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

// --- telemetry (called from main loop) ---
export function updateTelemetry() {
  document.getElementById('bodyCount').textContent = state.bodies.length;
  document.getElementById('astCount').textContent = state.bodies.filter(b => b.isAsteroid).length;
  // Show the actual dt the integrator just used (capped by the substep rule)
  // and how many substeps it took to cover the current warp.
  const dt = state.lastDt || (WARP_LEVELS[state.warpIdx].dt / 1);
  document.getElementById('dtval').textContent =
    dt.toExponential(1) + ' s · ' + (state.lastSubsteps || 1) + 'x';

  const epoch = new Date('2000-01-01T12:00:00Z').getTime();
  const cur = new Date(epoch + state.simTime * 1000);
  document.getElementById('simdate').textContent = cur.toISOString().slice(0,10);

  const f = camState.focusBody;
  if (f) {
    document.getElementById('focus').textContent = f.name;
    const d = Math.sqrt(f.px*f.px + f.py*f.py + f.pz*f.pz) / AU;
    document.getElementById('dist').textContent = d.toFixed(3) + ' AU';
    const v = Math.sqrt(f.vx*f.vx + f.vy*f.vy + f.vz*f.vz) / 1000;
    document.getElementById('speed_r').textContent = v.toFixed(2) + ' km/s';
  }
}
