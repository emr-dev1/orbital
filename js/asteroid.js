// Asteroid launch flow: aim mode toggle, prediction line + impact-marker
// while aiming, body creation on release, and the impact analysis modal.

import * as THREE from 'three';
import { state } from './state.js';
import { scene, canvas, camera } from './scene.js';
import { Body, computeAccelerations, predictTrajectory } from './physics.js';
import { rebuildVisuals, renderPos, visualRadius } from './visuals.js';
import { RENDER_SCALE, TNT_J, REF_EVENTS, WARP_LEVELS } from './data.js';

// --- prediction visuals ---
const predGeo = new THREE.BufferGeometry();
predGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(800 * 3), 3));
const predMat = new THREE.LineDashedMaterial({
  color: 0xff5530, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.9,
});
export const predLine = new THREE.Line(predGeo, predMat);
predLine.frustumCulled = false;
predLine.visible = false;
scene.add(predLine);

export const impactMarker = new THREE.Mesh(
  new THREE.RingGeometry(2, 3, 32),
  new THREE.MeshBasicMaterial({ color: 0xff5530, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
);
impactMarker.visible = false;
scene.add(impactMarker);

// Launchpad indicator — green ring at the auto-computed spawn position.
// Visible whenever aim mode is active so the user can see "this is where
// the asteroid will fire from."
export const launchpadMarker = new THREE.Group();
{
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x6ee7a8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  const outer = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 32), ringMat);
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 24), ringMat);
  launchpadMarker.add(outer, inner);
}
launchpadMarker.visible = false;
scene.add(launchpadMarker);

// Compute where the asteroid will spawn when aim mode is active. With a
// focus body, place the pad just outside the body's visual sphere on the
// camera-facing side so the user sees both the pad and the target. Without
// a focus, drop the pad at the camera's projected ecliptic position so the
// asteroid launches "from where you're looking."
function computeLaunchpad(focusBody) {
  if (!focusBody) {
    return new THREE.Vector3(camera.position.x, 0, camera.position.z);
  }
  const [fbX, _fbY, fbZ] = renderPos(focusBody);
  const dx = camera.position.x - fbX;
  const dz = camera.position.z - fbZ;
  const len = Math.hypot(dx, dz);
  const offset = 1.5 * visualRadius(focusBody);
  if (len < 0.1) return new THREE.Vector3(fbX + offset, 0, fbZ);
  return new THREE.Vector3(fbX + dx/len * offset, 0, fbZ + dz/len * offset);
}

export function setAimMode(on, focusBody = null) {
  state.aimMode = on;
  if (on) {
    // Default the target to the focus body so the user gets an instant
    // preview line. They can move the mouse to retarget anywhere.
    if (focusBody) {
      const [tx, ty, tz] = renderPos(focusBody);
      state.aimEnd = new THREE.Vector3(tx, ty, tz);
    } else {
      state.aimEnd = null;
    }
  } else {
    state.aimEnd = null;
    state.aimStart = null;
    launchpadMarker.visible = false;
    predLine.visible = false;
    impactMarker.visible = false;
  }
  document.getElementById('aimBtn').classList.toggle('active', on);
  document.getElementById('aimPanel').classList.toggle('show', on);
  canvas.style.cursor = on ? 'crosshair' : 'grab';
}

// Fill the live AIM panel readouts: nearest-body target, distance, ETA at
// current slider speed, kinetic energy at impact (rough estimate using slider
// speed as relative velocity), and a damage verdict. Called each frame from
// updateAimVisual when aim mode is active.
function fillAimPanel(focusBody, predImpactIdx, predLastPoint) {
  if (!state.aimMode || !state.aimStart || !state.aimEnd) return;

  // Nearest body to aim point — capture only when the cursor is reasonably
  // close so floating-around-empty-space reads as "FREE POINT".
  let nearest = null, nearestD = Infinity;
  for (const b of state.bodies) {
    const [bx, , bz] = renderPos(b);
    const dx = bx - state.aimEnd.x;
    const dz = bz - state.aimEnd.z;
    const d  = Math.hypot(dx, dz);
    const cap = Math.max(visualRadius(b) * 1.8, 1.0);
    if (d < cap && d < nearestD) { nearestD = d; nearest = b; }
  }
  document.getElementById('aimTargetV').textContent = nearest ? nearest.name : 'FREE POINT';

  // Render-space distance from launchpad to current target → physical units.
  const ddx = (state.aimEnd.x - state.aimStart.x) * RENDER_SCALE;
  const ddy = (state.aimEnd.y - state.aimStart.y) * RENDER_SCALE;
  const ddz = (state.aimEnd.z - state.aimStart.z) * RENDER_SCALE;
  const distM = Math.hypot(ddx, ddy, ddz);
  document.getElementById('aimDistV').textContent =
    distM < 1e9 ? (distM/1e6).toFixed(1) + ' Mm' : (distM/1e9).toFixed(2) + ' Gm';

  // Slider-derived numbers
  const speedKm = parseFloat(document.getElementById('speed').value);
  document.getElementById('aimVelV').textContent = speedKm.toFixed(0) + ' km/s';

  const v = speedKm * 1000;
  const etaSec = distM / v;
  document.getElementById('aimEtaV').textContent =
    etaSec < 7200       ? (etaSec/60).toFixed(0)   + ' min' :
    etaSec < 86400 * 2  ? (etaSec/3600).toFixed(1) + ' hr'  :
    etaSec < 86400 * 60 ? (etaSec/86400).toFixed(1)+ ' d'   :
                          (etaSec/86400/365).toFixed(2)+ ' yr';

  const massExp = parseFloat(document.getElementById('mass').value);
  const mass = Math.pow(10, massExp);
  const E = 0.5 * mass * v * v;
  const TNT_t  = E / TNT_J;
  const TNT_Mt = TNT_t / 1e6;
  document.getElementById('aimImpactV').textContent =
    TNT_Mt < 1e-3 ? TNT_t.toExponential(1) + ' t' : TNT_Mt.toExponential(1) + ' Mt';

  const verdictEl = document.getElementById('aimVerdictV');
  let verdict, hot;
  if (!nearest)               { verdict = 'NO TARGET'; hot = 'miss'; }
  else if (predImpactIdx < 0) { verdict = 'WILL MISS';  hot = 'miss'; }
  else if (TNT_Mt < 0.01)     { verdict = 'AIRBURST';   hot = '';     }
  else if (TNT_Mt < 50)       { verdict = 'CITY-KILLER';hot = 'warn'; }
  else if (TNT_Mt < 1e5)      { verdict = 'CONTINENTAL';hot = 'warn'; }
  else if (TNT_Mt < 1e8)      { verdict = 'EXTINCTION'; hot = 'target'; }
  else                        { verdict = 'PLANET-CRACKER'; hot = 'target'; }
  verdictEl.textContent = verdict;
  verdictEl.className = 'v ' + hot;

  // Disable FIRE button when there's no actual target to hit (no path or no
  // body in the prediction's collision check). The asteroid still fires —
  // we just visually flag it as a miss so the user knows.
  const fireBtn = document.getElementById('fireBtn');
  if (predImpactIdx < 0 && !nearest) fireBtn.classList.add('miss');
  else fireBtn.classList.remove('miss');
}

// When focusBody is provided, slider speed is interpreted as Δv RELATIVE TO
// THAT BODY and the body's own velocity is baked into the asteroid. Without
// this, an asteroid spawned near Earth has no orbital velocity around the
// Sun (Earth needs ~30 km/s tangential to stay at 1 AU), so it falls into
// the Sun every launch. With the body's velocity included, the asteroid
// co-orbits the Sun the same way Earth does and the slider becomes a proper
// Earth-frame Δv — small values keep it loitering near Earth, big values
// give it a real impact velocity.
export function fireAsteroid(start, end, focusBody = null) {
  if (!start || !end) return;
  const dir = new THREE.Vector3().subVectors(end, start);
  if (dir.length() < 0.5) return;
  dir.normalize();

  const speedKm = parseFloat(document.getElementById('speed').value);
  const v = speedKm * 1000;
  const massExp = parseFloat(document.getElementById('mass').value);
  const mass = Math.pow(10, massExp);

  // physical radius assuming density 3000 kg/m^3
  const density = 3000;
  const radius = Math.cbrt((3 * mass) / (4 * Math.PI * density));

  const baseVx = focusBody ? focusBody.vx : 0;
  const baseVy = focusBody ? focusBody.vy : 0;
  const baseVz = focusBody ? focusBody.vz : 0;

  const ast = new Body({
    name: 'ASTEROID-' + (state.bodies.filter(b => b.isAsteroid).length + 1).toString().padStart(2, '0'),
    mass, displayRadius: radius, color: 0xff5530, isAsteroid: true,
    px: start.x * RENDER_SCALE, py: start.y * RENDER_SCALE, pz: start.z * RENDER_SCALE,
    vx: dir.x * v + baseVx, vy: dir.y * v + baseVy, vz: dir.z * v + baseVz,
  });
  state.bodies.push(ast);
  computeAccelerations(state.bodies);
  rebuildVisuals();
}

// Per-frame: maintain the launchpad position, the dashed prediction, and
// the impact marker while aim mode is on. Called from the main tick loop.
// focusBody is forwarded so the prediction uses the same body-relative
// velocity convention as the real launch will.
export function updateAimVisual(focusBody = null) {
  if (!state.aimMode) {
    predLine.visible = false;
    impactMarker.visible = false;
    launchpadMarker.visible = false;
    return;
  }
  // Always show the launchpad while aim mode is on.
  state.aimStart = computeLaunchpad(focusBody);
  launchpadMarker.position.copy(state.aimStart);
  launchpadMarker.lookAt(camera.position);
  launchpadMarker.visible = true;

  if (!state.aimEnd) {
    predLine.visible = false;
    impactMarker.visible = false;
    return;
  }
  const dir = new THREE.Vector3().subVectors(state.aimEnd, state.aimStart);
  if (dir.length() <= 0.5) {
    predLine.visible = false;
    impactMarker.visible = false;
    return;
  }
  dir.normalize();

  const speedKm = parseFloat(document.getElementById('speed').value);
  const v = speedKm * 1000;
  const massExp = parseFloat(document.getElementById('mass').value);
  const mass = Math.pow(10, massExp);
  const baseVx = focusBody ? focusBody.vx : 0;
  const baseVy = focusBody ? focusBody.vy : 0;
  const baseVz = focusBody ? focusBody.vz : 0;
  const proto = {
    px: state.aimStart.x * RENDER_SCALE, py: state.aimStart.y * RENDER_SCALE, pz: state.aimStart.z * RENDER_SCALE,
    vx: dir.x * v + baseVx, vy: dir.y * v + baseVy, vz: dir.z * v + baseVz, mass,
  };
  // Prediction step adapts to warp so the line looks reasonable far ahead.
  const predDt = Math.max(3600, WARP_LEVELS[state.warpIdx].dt / 2);
  const pred = predictTrajectory(proto, 600, predDt);

  const arr = predLine.geometry.attributes.position.array;
  for (let i = 0; i < pred.path.length; i++) {
    arr[i*3]   = pred.path[i][0];
    arr[i*3+1] = pred.path[i][1];
    arr[i*3+2] = pred.path[i][2];
  }
  predLine.geometry.setDrawRange(0, pred.path.length);
  predLine.geometry.attributes.position.needsUpdate = true;
  predLine.computeLineDistances();
  predLine.visible = pred.path.length > 1;

  if (pred.impactIdx >= 0 && pred.path.length) {
    const last = pred.path[pred.path.length - 1];
    impactMarker.position.set(last[0], last[1], last[2]);
    impactMarker.lookAt(camera.position);
    impactMarker.visible = true;
  } else {
    impactMarker.visible = false;
  }

  fillAimPanel(focusBody, pred.impactIdx, pred.path[pred.path.length - 1]);
}

// --- impact analysis ---
function refEventFor(megatons) {
  let best = REF_EVENTS[0];
  for (const e of REF_EVENTS) if (megatons >= e.t) best = e;
  return best.label;
}
function verdictFor(target, megatons) {
  if (target.name === 'SUN') return 'ABSORBED. NEGLIGIBLE.';
  if (target.name === 'JUPITER' || target.name === 'SATURN') return 'GAS GIANT ATE IT. SHOEMAKER-LEVY VIBES.';
  if (megatons < 0.01) return 'AIRBURST. MINIMAL DAMAGE.';
  if (megatons < 50)   return 'REGIONAL DEVASTATION. CITY-KILLER.';
  if (megatons < 1e5)  return 'CONTINENTAL CATASTROPHE.';
  if (megatons < 1e8)  return 'GLOBAL MASS EXTINCTION EVENT.';
  return 'PLANET-CRACKING IMPACT. SURFACE STERILIZED.';
}

export function showImpact(impactor, target) {
  const dvx = impactor.vx - target.vx, dvy = impactor.vy - target.vy, dvz = impactor.vz - target.vz;
  const vRel = Math.sqrt(dvx*dvx + dvy*dvy + dvz*dvz);
  const E = 0.5 * impactor.mass * vRel * vRel;
  const TNT_t = E / TNT_J;
  const TNT_Mt = TNT_t / 1e6;
  // ballpark crater scaling: D ~ 1.8 * (E)^(1/3.4) km, E in MT
  const D = 1.8 * Math.pow(Math.max(TNT_Mt, 1e-9), 1/3.4);

  document.getElementById('impactTarget').textContent = '— ' + target.name + ' —';
  document.getElementById('iVel').textContent = (vRel/1000).toFixed(2) + ' km/s';
  document.getElementById('iE').textContent = E.toExponential(2) + ' J';
  document.getElementById('iTNT').textContent = TNT_Mt < 0.001
    ? (TNT_t).toExponential(2) + ' t'
    : TNT_Mt.toExponential(2) + ' Mt';
  document.getElementById('iCrater').textContent = D < 0.1 ? (D*1000).toFixed(0) + ' m' : D.toFixed(1) + ' km';
  document.getElementById('iRef').textContent = refEventFor(TNT_Mt);
  document.getElementById('iVerdict').textContent = verdictFor(target, TNT_Mt);
  document.getElementById('impactModal').classList.add('show');

  state.paused = true;
  const pauseBtn = document.getElementById('pauseBtn');
  pauseBtn.classList.add('active');
  pauseBtn.textContent = 'RESUME';
}
