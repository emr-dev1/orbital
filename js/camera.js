// Orbit-style camera: yaw/pitch around a target point at a tweened distance.
// Mouse drag orbits, wheel zooms, click focuses a body. Held WASD/arrows
// orbit; Q/E zoom; Shift accelerates. Translation pans (Space-aware exclusion
// keeps WASD movement from triggering during input typing).

import * as THREE from 'three';
import { camera, canvas } from './scene.js';
import { state } from './state.js';
import { NAV_DIST } from './data.js';
import { bodySpinners, renderPos } from './visuals.js';

export const camState = {
  target: new THREE.Vector3(0, 0, 0),
  // The camera tweens its position and look-at toward "goal" values each
  // frame, so transitions (entering aim mode → overview, focusing a body,
  // launching → follow asteroid) feel smooth rather than snappy.
  targetGoal: new THREE.Vector3(0, 0, 0),
  dist: 400,
  targetDist: 400,
  yaw: 0,
  pitch: -0.4,
  focusBody: null,
  prevFocus: null, // remember focus across an aim-mode cancel
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
  if (pressedKeys.has('Semicolon')) camState.targetGoal.addScaledVector(right, -panAmt);
  if (pressedKeys.has('Quote'))     camState.targetGoal.addScaledVector(right,  panAmt);
  if (pressedKeys.has('BracketLeft'))  camState.targetGoal.addScaledVector(up, -panAmt);
  if (pressedKeys.has('BracketRight')) camState.targetGoal.addScaledVector(up,  panAmt);
  // any pan input releases the focus lock so we don't fight the focus-tracker
  if (pressedKeys.has('Semicolon') || pressedKeys.has('Quote') || pressedKeys.has('BracketLeft') || pressedKeys.has('BracketRight')) {
    camState.focusBody = null;
  }
}

export function updateCamera(realDt = 0.016) {
  applyKeyboardCamera(realDt);

  // Resolve where the camera *wants* to look at this frame. With a focus
  // body, that's the body's render position (snaps each frame so we track).
  // Otherwise it's targetGoal — set explicitly when entering overview, panning,
  // or following a launched asteroid.
  if (camState.focusBody) {
    const [rx, ry, rz] = renderPos(camState.focusBody);
    camState.targetGoal.set(rx, ry, rz);
  }
  // Smooth tween toward the goal. Same factor for position and zoom so
  // overview transitions and asteroid hand-offs feel coherent.
  const k = 0.12;
  camState.target.x += (camState.targetGoal.x - camState.target.x) * k;
  camState.target.y += (camState.targetGoal.y - camState.target.y) * k;
  camState.target.z += (camState.targetGoal.z - camState.target.z) * k;
  camState.dist += (camState.targetDist - camState.dist) * k;

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

// Camera input:
//   Left drag           → orbit (yaw/pitch around target).
//   Middle drag         → pan the look-at point (Shift = 2.5× speed).
//   Wheel               → zoom.
// Aim mode reuses the same controls so the user can reposition the view
// while setting up a launch.
let mouseDownX = 0, mouseDownY = 0;
let panning = false;

canvas.addEventListener('mousedown', e => {
  mouseDownX = e.clientX; mouseDownY = e.clientY;
  if (e.button === 1) {
    // Middle button → pan. preventDefault stops Windows' autoscroll cursor.
    e.preventDefault();
    panning = true;
    lastX = e.clientX; lastY = e.clientY;
    return;
  }
  if (e.button === 0) {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
  }
});
canvas.addEventListener('mousemove', e => {
  if (panning) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    // Pan speed scales with zoom level so the world moves the same screen
    // distance regardless of how zoomed in/out you are.
    const scale = camState.dist * 0.0018 * (e.shiftKey ? 2.5 : 1);
    const right = new THREE.Vector3(Math.cos(camState.yaw), 0, -Math.sin(camState.yaw));
    const up    = new THREE.Vector3(0, 1, 0);
    camState.targetGoal.addScaledVector(right, -dx * scale);
    camState.targetGoal.addScaledVector(up,     dy * scale);
    // Panning breaks the focus lock — otherwise the next frame would snap
    // the camera back onto the focused body.
    if (camState.focusBody) camState.focusBody = null;
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  camState.yaw   -= dx * 0.005;
  camState.pitch -= dy * 0.005;
  camState.pitch = Math.max(-1.4, Math.min(1.4, camState.pitch));
  lastX = e.clientX; lastY = e.clientY;
});
// Suppress browser middle-click defaults (autoscroll, paste-on-X11) on canvas.
canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
window.addEventListener('mouseup', e => {
  if (e.button === 1) panning = false;
  if (e.button === 0) dragging = false;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(e.deltaY * 0.001);
  camState.targetDist = Math.max(8, Math.min(8000, camState.targetDist * f));
  camState.dist       = Math.max(8, Math.min(8000, camState.dist * f));
}, { passive: false });

canvas.addEventListener('click', e => {
  // Suppress click after a drag so orbiting the camera doesn't accidentally
  // change focus / target.
  const dragDist = Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY);
  if (dragDist > 5) return;

  const ray = makeRay(e.clientX, e.clientY);
  let closest = null, cd = Infinity;
  for (const [b, spinner] of bodySpinners) {
    const hit = ray.intersectObject(spinner);
    if (hit.length && hit[0].distance < cd) { cd = hit[0].distance; closest = b; }
  }
  if (state.aimMode) {
    if (closest) {
      // Body click → set the launch TARGET.
      window.dispatchEvent(new CustomEvent('orbital:aim-target', { detail: { name: closest.name } }));
    } else {
      // Empty-space click → place / relocate the asteroid spawn point on
      // the ecliptic at the picked location.
      const p = pickWorldPoint(e.clientX, e.clientY);
      if (p) window.dispatchEvent(new CustomEvent('orbital:aim-spawn', { detail: { x: p.x, y: 0, z: p.z } }));
    }
    return;
  }

  if (closest) {
    camState.focusBody = closest;
    // Also auto-zoom to the body's preferred view distance — clicking a
    // body should "take you there" without requiring a manual zoom.
    const navDist = NAV_DIST[closest.name];
    if (navDist !== undefined) camState.targetDist = navDist;
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
