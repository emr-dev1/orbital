// Orbit-style camera: yaw/pitch around a target point at a tweened distance.
// Mouse drag orbits, wheel zooms, click focuses a body. Held WASD/arrows
// orbit; Q/E zoom; Shift accelerates. Translation pans (Space-aware exclusion
// keeps WASD movement from triggering during input typing).

import * as THREE from 'three';
import { camera, canvas } from './scene.js';
import { state } from './state.js';
import { bodySpinners, renderPos } from './visuals.js';
import { setAimMode, fireAsteroid } from './asteroid.js';

export const camState = {
  target: new THREE.Vector3(0, 0, 0),
  dist: 400,
  targetDist: 400,
  yaw: 0,
  pitch: -0.4,
  focusBody: null,
};

const KEY_ROT_SPEED  = 1.6; // rad/s
const KEY_ZOOM_SPEED = 1.6; // multiplicative per second
const KEY_PAN_SPEED  = 0.6; // fraction of camera distance per second
const SHIFT_BOOST    = 2.5;

const pressedKeys = new Set();

function applyKeyboardCamera(realDt) {
  if (pressedKeys.size === 0) return;
  const boost = pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight') ? SHIFT_BOOST : 1;
  const rot = KEY_ROT_SPEED * realDt * boost;
  const zoomFactor = Math.pow(KEY_ZOOM_SPEED, realDt * boost);

  // Orbit: arrows / WASD
  if (pressedKeys.has('ArrowLeft')  || pressedKeys.has('KeyA')) camState.yaw   -= rot;
  if (pressedKeys.has('ArrowRight') || pressedKeys.has('KeyD')) camState.yaw   += rot;
  if (pressedKeys.has('ArrowUp')    || pressedKeys.has('KeyW')) camState.pitch += rot;
  if (pressedKeys.has('ArrowDown')  || pressedKeys.has('KeyS')) camState.pitch -= rot;
  camState.pitch = Math.max(-1.4, Math.min(1.4, camState.pitch));

  // Zoom: Q (out) / E (in), and -/+ as alternatives
  if (pressedKeys.has('KeyE') || pressedKeys.has('Equal') || pressedKeys.has('NumpadAdd')) {
    camState.targetDist = Math.max(8, camState.targetDist / zoomFactor);
  }
  if (pressedKeys.has('KeyQ') || pressedKeys.has('Minus') || pressedKeys.has('NumpadSubtract')) {
    camState.targetDist = Math.min(8000, camState.targetDist * zoomFactor);
  }

  // Pan target with [ ] for vertical and ; ' for horizontal —
  // keeps panning off the WASD/arrow orbit keys.
  const panAmt = camState.dist * KEY_PAN_SPEED * realDt * boost;
  const right = new THREE.Vector3(Math.cos(camState.yaw), 0, -Math.sin(camState.yaw));
  const up    = new THREE.Vector3(0, 1, 0);
  if (pressedKeys.has('Semicolon')) camState.target.addScaledVector(right, -panAmt);
  if (pressedKeys.has('Quote'))     camState.target.addScaledVector(right,  panAmt);
  if (pressedKeys.has('BracketLeft'))  camState.target.addScaledVector(up, -panAmt);
  if (pressedKeys.has('BracketRight')) camState.target.addScaledVector(up,  panAmt);
  // any pan input releases the focus lock so we don't fight the focus-tracker
  if (pressedKeys.has('Semicolon') || pressedKeys.has('Quote') || pressedKeys.has('BracketLeft') || pressedKeys.has('BracketRight')) {
    camState.focusBody = null;
    document.getElementById('focus').textContent = 'FREE';
  }
}

export function updateCamera(realDt = 0.016) {
  applyKeyboardCamera(realDt);

  if (camState.focusBody) {
    const [rx, ry, rz] = renderPos(camState.focusBody);
    camState.target.set(rx, ry, rz);
  }
  camState.dist += (camState.targetDist - camState.dist) * 0.12;

  const cy = Math.cos(camState.yaw), sy = Math.sin(camState.yaw);
  const cp = Math.cos(camState.pitch), sp = Math.sin(camState.pitch);
  camera.position.set(
    camState.target.x + camState.dist * cp * sy,
    camState.target.y + camState.dist * sp,
    camState.target.z + camState.dist * cp * cy,
  );
  camera.lookAt(camState.target);
}

export function makeRay(cx, cy) {
  const ndc = new THREE.Vector2(
    (cx / innerWidth) * 2 - 1,
    -(cy / innerHeight) * 2 + 1,
  );
  const r = new THREE.Raycaster();
  r.setFromCamera(ndc, camera);
  return r;
}

export function pickWorldPoint(cx, cy) {
  const ray = makeRay(cx, cy);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const out = new THREE.Vector3();
  ray.ray.intersectPlane(plane, out);
  return out;
}

// --- mouse / wheel ---
let dragging = false, lastX = 0, lastY = 0;

canvas.addEventListener('mousedown', e => {
  if (state.aimMode) {
    // Aim mode is now click-to-fire. The launchpad position is auto-computed
    // and updated in updateAimVisual; the mouse position drives the target.
    if (state.aimStart && state.aimEnd) {
      fireAsteroid(state.aimStart, state.aimEnd, camState.focusBody);
      setAimMode(false);
    }
    return;
  }
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('mousemove', e => {
  if (state.aimMode) {
    // While aim mode is on, mouse hover sets the aim target — no drag needed.
    state.aimEnd = pickWorldPoint(e.clientX, e.clientY);
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  camState.yaw   -= dx * 0.005;
  camState.pitch -= dy * 0.005;
  camState.pitch = Math.max(-1.4, Math.min(1.4, camState.pitch));
  lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('mouseup', () => {
  dragging = false;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(e.deltaY * 0.001);
  camState.targetDist = Math.max(8, Math.min(8000, camState.targetDist * f));
  camState.dist       = Math.max(8, Math.min(8000, camState.dist * f));
}, { passive: false });

canvas.addEventListener('click', e => {
  if (state.aimMode) return;
  const ray = makeRay(e.clientX, e.clientY);
  let closest = null, cd = Infinity;
  for (const [b, spinner] of bodySpinners) {
    const hit = ray.intersectObject(spinner);
    if (hit.length && hit[0].distance < cd) { cd = hit[0].distance; closest = b; }
  }
  if (closest) {
    camState.focusBody = closest;
    document.getElementById('focus').textContent = closest.name;
  }
});

// --- keyboard tracking (movement keys are applied each frame) ---
function shouldIgnoreKey(e) {
  // don't intercept typing in form fields
  const tag = e.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
}

window.addEventListener('keydown', e => {
  if (shouldIgnoreKey(e)) return;
  pressedKeys.add(e.code);
});
window.addEventListener('keyup', e => {
  pressedKeys.delete(e.code);
});
window.addEventListener('blur', () => pressedKeys.clear());
