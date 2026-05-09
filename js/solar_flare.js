// Random solar flare — fired by the SOLAR FLARE button. Picks a random
// target body (planet or moon) and runs the full three-phase CME sequence
// against it: plasma cloud erupts from the Sun, travels along Sun → target,
// pulses a bow shock on the target's sun-facing hemisphere, and lights up
// multi-color aurora curtains at the target's magnetic poles.
//
// Each click stacks a new flare against an independently-chosen body, so
// rapid-fire clicks can have several CMEs in flight to different planets
// at once. Animation is real-time so flares keep playing through pause /
// warp changes.

import * as THREE from 'three';
import { state } from './state.js';
import { scene } from './scene.js';
import { bodySpinners, visualRadius, renderPos } from './visuals.js';
import { RENDER_SCALE } from './data.js';

// =====================================================================
// Shaders — same family as the Earth Mode flare so the look is coherent.
// CME plasma cloud, bow shock crescent, aurora curtain.
// =====================================================================

const CME_VERT = `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const CME_FRAG = `
precision highp float;
varying vec3 vLocal;
uniform float uTime;
uniform float uIntensity;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x),
                 mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                 mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise3(p); p *= 2.13; a *= 0.5; }
  return v;
}

void main() {
  vec3 lp = vLocal;
  float zScale = lp.z > 0.0 ? 1.7 : 1.0;
  float r = length(vec3(lp.x, lp.y, lp.z / zScale));
  if (r > 1.0) discard;

  vec3 p1 = lp * 1.4 + vec3(uTime * 0.45, uTime * 0.30, uTime * 1.40 - lp.z * 1.6);
  vec3 p2 = lp * 3.2 + vec3(0.0, uTime * 0.55, uTime * 0.85);
  vec3 p3 = lp * 6.0 - vec3(uTime * 0.35, 0.0, uTime * 1.10);
  float n  = fbm(p1);
  float n2 = fbm(p2);
  float n3 = fbm(p3);

  float density = (1.0 - r * r);
  density *= (0.35 + n * 0.85 + n2 * 0.35);
  density = smoothstep(0.0, 0.55, density);

  float core = 1.0 - r * r;
  vec3 hot  = vec3(1.00, 0.97, 0.82);
  vec3 mid  = vec3(1.00, 0.55, 0.18);
  vec3 cool = vec3(0.85, 0.20, 0.08);
  vec3 col = mix(cool, mid, smoothstep(0.45, 0.95, core));
  col = mix(col, hot, smoothstep(0.7, 1.0, core) * (0.4 + n * 0.6));

  float fil = pow(n3, 5.5) * 4.0;
  col += fil * vec3(1.0, 0.85, 0.55);

  col *= (0.65 + 0.55 * n);

  gl_FragColor = vec4(col * (0.7 + 0.6 * uIntensity), density * uIntensity);
}`;

const BOW_VERT = `
varying vec3 vLocal;
void main() {
  vLocal = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BOW_FRAG = `
precision highp float;
varying vec3 vLocal;
uniform vec3  uSunDirLocal;
uniform float uTime;
uniform float uIntensity;
void main() {
  float c = dot(vLocal, normalize(uSunDirLocal));
  if (c < 0.45) discard;
  float band = smoothstep(0.45, 0.62, c) * (1.0 - smoothstep(0.88, 0.99, c));
  float pulse = 0.65 + 0.35 * sin(uTime * 7.0 + c * 12.0);
  float rim = smoothstep(0.55, 0.62, c) * (1.0 - smoothstep(0.62, 0.70, c)) * 1.3;
  vec3 col = mix(vec3(1.0, 0.45, 0.30), vec3(1.0, 0.85, 0.55), c);
  float a = (band + rim) * pulse * uIntensity * 0.85;
  gl_FragColor = vec4(col, a);
}`;

const AURORA_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const AURORA_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;
uniform float uColorBoost;

void main() {
  vec2 uv = vUv;
  float r1 = 0.5 + 0.5 * sin(uv.x * 90.0 + uTime * 1.10);
  r1 = smoothstep(0.55, 1.0, r1);
  float r2 = 0.5 + 0.5 * sin(uv.x * 47.0 - uTime * 0.65 + 1.7);
  r2 = smoothstep(0.65, 1.0, r2);
  float rays = max(r1, r2 * 0.85);

  float w1 = 0.5 + 0.5 * sin(uv.x * 9.0 + uTime * 1.25);
  float w2 = 0.5 + 0.5 * sin(uv.x * 13.0 - uTime * 1.85);
  float curtainGlow = mix(w1, w2, 0.5);

  vec3 green  = vec3(0.10, 1.00, 0.40);
  vec3 cyan   = vec3(0.30, 0.95, 0.85);
  vec3 red    = vec3(1.00, 0.25, 0.40);
  vec3 violet = vec3(0.70, 0.35, 1.00);

  vec3 col;
  if (uv.y < 0.30) {
    col = mix(green, cyan, uv.y / 0.30);
  } else if (uv.y < 0.60) {
    col = mix(cyan, red, (uv.y - 0.30) / 0.30);
  } else {
    col = mix(red, violet, (uv.y - 0.60) / 0.40);
  }
  col = mix(col, mix(red, violet, 0.6 + 0.4 * uv.y), uColorBoost * 0.6);

  float topFade = 1.0 - smoothstep(0.88, 1.0, uv.y);
  float botFade = smoothstep(0.0, 0.04, uv.y);
  float edge = topFade * botFade;

  float baseA = (0.30 + 0.50 * curtainGlow) * edge;
  float rayA  = rays * (0.55 + 0.45 * curtainGlow) * edge;
  vec3 finalCol = col * (0.6 + 0.6 * curtainGlow) + rays * vec3(0.6, 0.85, 0.7) * 0.7;
  float a = clamp(baseA + rayA, 0.0, 1.0) * uIntensity * 1.05;
  gl_FragColor = vec4(finalCol, a);
}`;

// =====================================================================
// Class table — lifetime, cmeScale (multiplies cloud size), peak intensity,
// aurora colour boost. Probabilities favour smaller flares.
// =====================================================================
const CLASS_INFO = {
  M:          { lifeMax:  8.0, cmeScale: 0.55, intensity: 0.65, colorBoost: 0.0, label: 'M-CLASS'    },
  X:          { lifeMax: 11.0, cmeScale: 0.85, intensity: 0.85, colorBoost: 0.0, label: 'X-CLASS'    },
  CARRINGTON: { lifeMax: 14.0, cmeScale: 1.15, intensity: 1.05, colorBoost: 0.3, label: 'CARRINGTON' },
  SUPERFLARE: { lifeMax: 18.0, cmeScale: 1.50, intensity: 1.30, colorBoost: 1.0, label: 'SUPERFLARE' },
};

function _randomClass() {
  const r = Math.random();
  if (r < 0.50) return 'M';
  if (r < 0.80) return 'X';
  if (r < 0.95) return 'CARRINGTON';
  return 'SUPERFLARE';
}

// Pick a random target body — any planet or moon (no Sun, no asteroids,
// no black holes) that has a spinner so we can attach effects.
function _randomTarget() {
  const candidates = state.bodies.filter(b =>
    b.name !== 'SUN' && !b.isAsteroid && !b.isBlackHole && bodySpinners.get(b)
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Triangular envelope — same helper the Earth Mode flare uses.
function _band(t, a, b, c) {
  if (t < a || t > c) return 0;
  return t < b ? (t - a) / (b - a) : (c - t) / (c - b);
}

// Build a multi-color aurora curtain at one pole — same as Earth Mode.
function _makeAuroraCurtain(spinner, vR, northSide, info) {
  const baseRingR  = vR * 0.50;
  const flareRingR = vR * 0.95;
  const height     = vR * 0.95;
  const yBase      = vR * 0.89;
  const sign = northSide ? 1 : -1;

  const geo = northSide
    ? new THREE.CylinderGeometry(flareRingR, baseRingR, height, 96, 4, true)
    : new THREE.CylinderGeometry(baseRingR, flareRingR, height, 96, 4, true);
  geo.translate(0, sign * (yBase + height / 2), 0);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: Math.random() * 10 },
      uIntensity:  { value: 0 },
      uColorBoost: { value: info.colorBoost },
    },
    vertexShader: AURORA_VERT,
    fragmentShader: AURORA_FRAG,
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  spinner.add(m);
  return m;
}

const _flares = [];

function _disposeFlare(f) {
  for (const m of [f.cloudMesh, f.bowShock, f.auroraN, f.auroraS]) {
    if (m && m.parent) m.parent.remove(m);
    if (m && m.geometry) m.geometry.dispose();
    if (m && m.material) m.material.dispose();
  }
  if (f.cloudGroup && f.cloudGroup.parent) f.cloudGroup.parent.remove(f.cloudGroup);
}

export function triggerRandomSolarFlare() {
  const sun = state.bodies.find(b => b.name === 'SUN');
  if (!sun) return;
  const target = _randomTarget();
  if (!target) return;
  const spinner = bodySpinners.get(target);
  if (!spinner) return;

  const cls  = _randomClass();
  const info = CLASS_INFO[cls];
  const vR   = visualRadius(target);

  // ── plasma cloud (CME) — lives in scene root, animated each frame ────
  const cloudGeo = new THREE.SphereGeometry(1.0, 64, 48);
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: Math.random() * 10 },
      uIntensity: { value: 0 },
    },
    vertexShader: CME_VERT,
    fragmentShader: CME_FRAG,
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  // Random roll around travel axis so simultaneous flares don't look identical.
  cloudMesh.rotation.z = Math.random() * Math.PI * 2;
  const cloudGroup = new THREE.Group();
  cloudGroup.add(cloudMesh);
  scene.add(cloudGroup);

  // ── bow shock crescent on the target's sun-facing hemisphere ──────────
  const bowGeo = new THREE.SphereGeometry(vR * 3.2, 64, 48);
  const bowMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
      uTime:        { value: 0 },
      uIntensity:   { value: 0 },
    },
    vertexShader: BOW_VERT,
    fragmentShader: BOW_FRAG,
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.FrontSide,
  });
  const bowShock = new THREE.Mesh(bowGeo, bowMat);
  spinner.add(bowShock);

  // ── aurora curtains at both magnetic poles ────────────────────────────
  const auroraN = _makeAuroraCurtain(spinner, vR, true,  info);
  const auroraS = _makeAuroraCurtain(spinner, vR, false, info);

  _flares.push({
    sun, target, spinner,
    cloudMesh, cloudMat, cloudGroup,
    bowShock, bowMat,
    auroraN, auroraS,
    info, cls,
    life: info.lifeMax, lifeMax: info.lifeMax,
  });

  // Event log on both Sun (the source) and the target body so the
  // Inspector's EVENTS section reads correctly from either focus.
  sun.events = sun.events || [];
  sun.events.unshift({
    time: state.simTime, type: 'IMPACT',
    description: `${info.label} CME → ${target.name}`,
  });
  if (sun.events.length > 10) sun.events.length = 10;
  target.events = target.events || [];
  target.events.unshift({
    time: state.simTime, type: 'IMPACT',
    description: `${info.label} CME ARRIVING`,
  });
  if (target.events.length > 10) target.events.length = 10;
}

export function updateSolarFlares(realDt) {
  for (let i = _flares.length - 1; i >= 0; i--) {
    const f = _flares[i];
    f.life -= realDt;
    if (f.life <= 0) {
      _disposeFlare(f);
      _flares.splice(i, 1);
      continue;
    }

    const t = 1 - f.life / f.lifeMax;
    const I = f.info.intensity;

    // Sun → target direction in world coordinates (real-meters in physics
    // space, but unit-direction is the same in render space).
    const dx = f.target.px - f.sun.px;
    const dy = f.target.py - f.sun.py;
    const dz = f.target.pz - f.sun.pz;
    const dM = Math.hypot(dx, dy, dz) || 1;
    const flightDir = new THREE.Vector3(dx / dM, dy / dM, dz / dM);

    // Sun direction FROM the target (used by the bow-shock shader to find
    // the sunlit hemisphere). Rotate into spinner-local frame so the
    // crescent stays on the day side as the planet spins.
    const sunFromTarget = flightDir.clone().negate();
    const invQ = new THREE.Quaternion();
    f.spinner.getWorldQuaternion(invQ).invert();
    const sunDirLocal = sunFromTarget.clone().applyQuaternion(invQ);

    // Render positions of Sun and target.
    const sunRender    = renderPos(f.sun);
    const targetRender = renderPos(f.target);
    const totalRenderDist = Math.hypot(
      targetRender[0] - sunRender[0],
      targetRender[1] - sunRender[1],
      targetRender[2] - sunRender[2],
    );

    // ── PHASE 1: cloud travels Sun → target over the first 45% of life ──
    const travelT = Math.min(1, t / 0.45);
    const ease = travelT * travelT * (3 - 2 * travelT);
    const sunR = visualRadius(f.sun);
    const vR   = visualRadius(f.target);
    // Travel from just outside the Sun to just outside the target's
    // bow-shock distance (~3.2 vR away from the planet centre).
    const start = sunR * 1.05;
    const end   = totalRenderDist - vR * 3.2;
    const cloudDistFromSun = start + Math.max(0, (end - start)) * ease;

    // Cloud size scales with both class (cmeScale) and the target body's
    // visual radius (so a Jupiter-bound flare reads as much bigger than
    // a Mercury-bound one). sqrt-scaling keeps Jupiter's flare from
    // dwarfing the entire screen at OVERVIEW.
    const sizeMul = Math.sqrt(Math.max(0.5, vR / 2));
    const cloudR  = (8.0 + 16.0 * ease) * f.info.cmeScale * sizeMul;

    // Position cloud on the Sun→target line at cloudDistFromSun.
    f.cloudGroup.position.set(
      sunRender[0] + flightDir.x * cloudDistFromSun,
      sunRender[1] + flightDir.y * cloudDistFromSun,
      sunRender[2] + flightDir.z * cloudDistFromSun,
    );
    // Orient so local -Z points toward the target (leading edge), tail
    // extends back toward the Sun.
    f.cloudGroup.lookAt(
      f.cloudGroup.position.x + flightDir.x,
      f.cloudGroup.position.y + flightDir.y,
      f.cloudGroup.position.z + flightDir.z,
    );
    f.cloudGroup.scale.set(cloudR, cloudR, cloudR);

    const cu = f.cloudMat.uniforms;
    cu.uTime.value += realDt;
    cu.uIntensity.value = _band(t, 0, 0.32, 0.62) * I * 1.4;

    // ── PHASE 2: bow shock pulses while the cloud envelopes the target ──
    const bu = f.bowMat.uniforms;
    bu.uSunDirLocal.value.copy(sunDirLocal);
    bu.uTime.value += realDt;
    bu.uIntensity.value = _band(t, 0.26, 0.45, 0.65) * I * 1.1;

    // ── PHASE 3: aurora curtains at the magnetic poles ─────────────────
    const auroraEnv = _band(t, 0.30, 0.62, 1.0);
    const breathing = 0.85 + 0.15 * Math.sin(t * Math.PI * 4.0);
    const auroraI = auroraEnv * breathing * I * 1.6;
    for (const a of [f.auroraN, f.auroraS]) {
      a.material.uniforms.uTime.value += realDt;
      a.material.uniforms.uIntensity.value = auroraI;
    }
  }
}

export function initSolarFlareUI() {
  const btn = document.getElementById('solarFlareBtn');
  if (btn) btn.onclick = triggerRandomSolarFlare;
}
