// Earth Mode — Earth-centric cinematic view with curated space events.
//
// Activated by clicking the EARTH MODE button (or the global toggle below).
// While active:
//   * Simulation auto-pauses; orbital motion freezes so events read clearly.
//   * Camera locks to Earth, framing Earth + Moon at a tight distance.
//   * Left panel stack is replaced with the event picker (CSS handled by
//     `body.earth-mode`).
//   * Right-side INSPECTOR is forced onto Earth so the user sees stat
//     changes from each event live.
//
// Events are driven off REAL time (not sim time) so animations play even
// while the orbital integrator is paused. They mutate Earth's evolution
// fields (surfaceTemp, iceCover, dustOptical, population, biosphereStage,
// events log, etc.) — the Inspector renders those at 10Hz, so stats tick
// in front of the user as the animation plays.

import * as THREE from 'three';
import { state } from './state.js';
import { scene } from './scene.js';
import { bodyMeshes, bodySpinners, visualRadius, renderPos } from './visuals.js';
import { camState } from './camera.js';
import { COMPOSITIONS, RENDER_SCALE, BIOSPHERE_STAGES, TNT_J } from './data.js';
import { fireAsteroid } from './asteroid.js';

// =====================================================================
// State
// =====================================================================

const earthState = {
  active: false,
  prevPaused: false,           // sim paused state at the moment of entry
  prevFocus: null,             // focused body before entering
  prevTargetDist: 400,
  prevYaw: 0,
  prevPitch: -0.4,
  selectedEvent: 'FLARE',      // 'FLARE' | 'ICE' | 'ASTEROID'
  flareClass: 'X',             // 'M' | 'X' | 'CARRINGTON' | 'SUPERFLARE'
  iceTempDrop: 12,             // K
  iceDurationYears: 2000,
  asteroidComposition: 'ROCKY',
  // Per-event animation slots — populated when an event is triggered,
  // ticked each frame, disposed when their lifetime expires.
  flare: null,
  ice:   null,
  asteroidPending: null,       // tracking handle for the in-flight asteroid
};

function getEarth() { return state.bodies.find(b => b.name === 'EARTH'); }
function getSun()   { return state.bodies.find(b => b.name === 'SUN');   }

// =====================================================================
// Enter / exit
// =====================================================================

export function enterEarthMode() {
  if (earthState.active) return;
  const earth = getEarth();
  if (!earth) return;

  earthState.active = true;
  earthState.prevPaused     = state.paused;
  earthState.prevFocus      = camState.focusBody;
  earthState.prevTargetDist = camState.targetDist;
  earthState.prevYaw        = camState.yaw;
  earthState.prevPitch      = camState.pitch;

  // Auto-pause so the cinematic events read at real-time pacing.
  state.paused = true;
  syncPauseButton();

  // Frame Earth + Moon. Moon orbits Earth at ~7.7 render units once the
  // displayOrbitScale=20 boost is applied; distance 35 with a slight tilt
  // catches both in the frame and gives surface detail on Earth.
  camState.focusBody  = earth;
  camState.targetDist = 35;
  camState.yaw        = 0.4;
  camState.pitch      = -0.25;

  document.body.classList.add('earth-mode');
  document.getElementById('earthModeBtn').classList.add('active');

  // Force the right-side inspector onto Earth — the Inspector renders
  // whatever camState.focusBody is, but make sure the event log is fresh.
  if (!earth.events) earth.events = [];
}

export function exitEarthMode() {
  if (!earthState.active) return;
  earthState.active = false;

  // Tear down any live animations cleanly.
  _disposeFlare();
  _disposeIce();

  // Restore prior camera + sim state.
  state.paused = earthState.prevPaused;
  syncPauseButton();
  camState.focusBody  = earthState.prevFocus;
  camState.targetDist = earthState.prevTargetDist;
  camState.yaw        = earthState.prevYaw;
  camState.pitch      = earthState.prevPitch;

  document.body.classList.remove('earth-mode');
  document.getElementById('earthModeBtn').classList.remove('active');
}

function syncPauseButton() {
  const btn = document.getElementById('pauseBtn');
  if (!btn) return;
  btn.classList.toggle('active', state.paused);
  btn.textContent = state.paused ? 'RESUME' : 'PAUSE';
}

// =====================================================================
// UI wiring
// =====================================================================

function selectEvent(evt) {
  earthState.selectedEvent = evt;
  for (const b of document.querySelectorAll('#eventRadio .event-btn')) {
    b.classList.toggle('active', b.dataset.evt === evt);
  }
  document.getElementById('tuneFlare').style.display    = evt === 'FLARE'    ? '' : 'none';
  document.getElementById('tuneIce').style.display      = evt === 'ICE'      ? '' : 'none';
  document.getElementById('tuneAsteroid').style.display = evt === 'ASTEROID' ? '' : 'none';
}

function setFlareClass(cls) {
  earthState.flareClass = cls;
  for (const b of document.querySelectorAll('#flareClass .tune-pill')) {
    b.classList.toggle('active', b.dataset.cls === cls);
  }
  const hint = {
    M:          'M-CLASS · MINOR · FAINT AURORAL DISPLAY',
    X:          'X-CLASS · GRID DAMAGE · MAJOR AURORA',
    CARRINGTON: 'CARRINGTON-LEVEL · GLOBAL GRID FAILURE',
    SUPERFLARE: 'SUPERFLARE · ATMOSPHERIC IONISATION · LIFE-THREATENING',
  };
  document.getElementById('flareHint').textContent = hint[cls];
}

function setAsteroidComposition(key) {
  earthState.asteroidComposition = key;
  for (const b of document.querySelectorAll('#emComposition .tune-pill')) {
    b.classList.toggle('active', b.dataset.key === key);
  }
}

function supscript(s) {
  const map = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','.':'·','-':'⁻'};
  return s.split('').map(c => map[c] || c).join('');
}

function updateAsteroidHint() {
  const massExp = parseFloat(document.getElementById('emMass').value);
  const speedKm = parseFloat(document.getElementById('emSpeed').value);
  const mass = Math.pow(10, massExp);
  const E = 0.5 * mass * (speedKm * 1000) ** 2;
  const Mt = E / TNT_J / 1e6;
  const verdict =
    Mt < 0.01 ? 'AIRBURST · MINIMAL DAMAGE' :
    Mt < 50   ? 'CITY-KILLER · REGIONAL DEVASTATION' :
    Mt < 1e5  ? 'CONTINENTAL CATASTROPHE' :
    Mt < 1e8  ? 'MASS EXTINCTION EVENT' :
                'PLANET-CRACKING IMPACT';
  document.getElementById('astHint').textContent = verdict;
}

function updateIceHint() {
  const drop = parseFloat(document.getElementById('iceTemp').value);
  const dur  = parseFloat(document.getElementById('iceDur').value);
  const verdict =
    drop < 5  ? 'MILD COOLING · MINOR ICE EXPANSION' :
    drop < 12 ? 'SIGNIFICANT GLACIATION · 20-30% ICE COVER' :
    drop < 22 ? 'MAJOR ICE AGE · 40-60% ICE COVER' :
                'SNOWBALL EARTH · >70% ICE COVER · BIOSPHERE THREAT';
  document.getElementById('iceHint').textContent = `${verdict} · ${dur} YR`;
}

export function initEarthModeUI() {
  // Toggle button
  document.getElementById('earthModeBtn').onclick = () => {
    if (earthState.active) exitEarthMode(); else enterEarthMode();
  };
  document.getElementById('earthExitBtn').onclick = exitEarthMode;

  // Event radio
  for (const b of document.querySelectorAll('#eventRadio .event-btn')) {
    b.onclick = () => selectEvent(b.dataset.evt);
  }

  // Flare class pills
  for (const b of document.querySelectorAll('#flareClass .tune-pill')) {
    b.onclick = () => setFlareClass(b.dataset.cls);
  }

  // Ice age sliders
  const iceTemp = document.getElementById('iceTemp');
  const iceDur  = document.getElementById('iceDur');
  iceTemp.addEventListener('input', () => {
    document.getElementById('iceTempLabel').textContent = `-${iceTemp.value} K`;
    earthState.iceTempDrop = parseFloat(iceTemp.value);
    updateIceHint();
  });
  iceDur.addEventListener('input', () => {
    document.getElementById('iceDurLabel').textContent = `${iceDur.value} yr`;
    earthState.iceDurationYears = parseFloat(iceDur.value);
    updateIceHint();
  });
  updateIceHint();

  // Asteroid sliders
  const emMass  = document.getElementById('emMass');
  const emSpeed = document.getElementById('emSpeed');
  emMass.addEventListener('input', () => {
    const v = parseFloat(emMass.value);
    const s = (v % 1 === 0) ? String(v) : v.toFixed(1);
    document.getElementById('emMassLabel').textContent = '10' + supscript(s) + ' kg';
  });
  emSpeed.addEventListener('input', () => {
    const v = parseFloat(emSpeed.value);
    document.getElementById('emSpeedLabel').textContent =
      (v < 10 ? v.toFixed(1) : v.toFixed(0)) + ' km/s';
    updateAsteroidHint();
  });

  // Composition pills (built from data.js so we get the same set as the
  // main LAUNCH panel).
  const compEl = document.getElementById('emComposition');
  compEl.innerHTML = '';
  for (const [key, info] of Object.entries(COMPOSITIONS)) {
    const btn = document.createElement('button');
    btn.className = 'tune-pill' + (key === earthState.asteroidComposition ? ' active' : '');
    btn.dataset.key = key;
    btn.textContent = info.label;
    btn.onclick = () => setAsteroidComposition(key);
    compEl.appendChild(btn);
  }
  updateAsteroidHint();

  // Trigger
  document.getElementById('triggerEventBtn').onclick = triggerSelectedEvent;

  // Esc exits Earth Mode (ahead of the help/aim handlers — ui.js' Esc
  // already runs but we add this to make sure we don't get stuck).
  window.addEventListener('keydown', e => {
    if (!earthState.active) return;
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape') exitEarthMode();
  });
}

function triggerSelectedEvent() {
  switch (earthState.selectedEvent) {
    case 'FLARE':    triggerSolarFlare(); break;
    case 'ICE':      triggerIceAge();     break;
    case 'ASTEROID': triggerAsteroid();   break;
  }
}

// =====================================================================
// SOLAR FLARE / CME — three phased effects:
//   1. PLASMA CLOUD: a large stretched ellipsoid of glowing gas erupts
//      from the Sun direction and travels toward Earth, growing as it
//      approaches. Custom shader: 5-octave fbm noise, white-hot core,
//      orange/red exterior, bright filament threads.
//   2. BOW SHOCK: a curved crescent on Earth's sun-facing hemisphere
//      pulses while the cloud envelops the magnetosphere — the visible
//      "compression" of Earth's magnetic shield.
//   3. AURORA CURTAINS: cone-frustum meshes hugging the magnetic poles,
//      with multi-color shaders that show real auroral physics:
//      green (oxygen ~558 nm) at low altitude, red (oxygen ~630 nm)
//      higher up, violet (nitrogen) at the top. Vertical "ray"
//      filaments wave across the curtain like real aurora oval rays.
//
// Class tier scales the lifetime, brightness, and stat impact.
// =====================================================================

// Plasma cloud — long, glowing, turbulent. The geometry is a unit sphere
// scaled into an ellipsoid by the parent group; the shader paints it as
// a glowing plasma with strong noise modulation and bright filaments.
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
  // The cloud's shape is asymmetric: stretched along +Z (the comet-tail
  // pointing back toward the Sun), more compact along -Z (the leading
  // edge pushing toward Earth). All scales below are in the cloud's
  // own unit-sphere local frame.
  vec3 lp = vLocal;
  float zScale = lp.z > 0.0 ? 1.7 : 1.0;
  float r = length(vec3(lp.x, lp.y, lp.z / zScale));
  if (r > 1.0) discard;

  // Plasma turbulence — the noise field flows along +Z (back along the
  // tail) so the cloud looks like it's streaming from the leading edge.
  vec3 p1 = lp * 1.4 + vec3(uTime * 0.45, uTime * 0.30, uTime * 1.40 - lp.z * 1.6);
  vec3 p2 = lp * 3.2 + vec3(0.0, uTime * 0.55, uTime * 0.85);
  vec3 p3 = lp * 6.0 - vec3(uTime * 0.35, 0.0, uTime * 1.10);
  float n  = fbm(p1);
  float n2 = fbm(p2);
  float n3 = fbm(p3);

  // Density: highest in core, falling off, with strong noise modulation
  // so the cloud has bright pockets and dim gaps instead of a uniform blob.
  float density = (1.0 - r * r);
  density *= (0.35 + n * 0.85 + n2 * 0.35);
  density = smoothstep(0.0, 0.55, density);

  // Color: white-hot core → bright yellow → orange → deep red at edges.
  float core = 1.0 - r * r;
  vec3 hot  = vec3(1.00, 0.97, 0.82);
  vec3 mid  = vec3(1.00, 0.55, 0.18);
  vec3 cool = vec3(0.85, 0.20, 0.08);
  vec3 col = mix(cool, mid, smoothstep(0.45, 0.95, core));
  col = mix(col, hot, smoothstep(0.7, 1.0, core) * (0.4 + n * 0.6));

  // Bright filaments — thin high-noise threads that read as plasma streams.
  float fil = pow(n3, 5.5) * 4.0;
  col += fil * vec3(1.0, 0.85, 0.55);

  // Slight color variation by noise gives bands of differing temperature.
  col *= (0.65 + 0.55 * n);

  gl_FragColor = vec4(col * (0.7 + 0.6 * uIntensity), density * uIntensity);
}`;

// Bow shock — sphere shell with a crescent on the sun-facing hemisphere.
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
  // Crescent band — bright at apex, fading toward the limb.
  float band = smoothstep(0.45, 0.62, c) * (1.0 - smoothstep(0.88, 0.99, c));
  // Pulse so the shock reads as energetic rather than a static decal.
  float pulse = 0.65 + 0.35 * sin(uTime * 7.0 + c * 12.0);
  // Thin bright rim along the leading edge of the shock.
  float rim = smoothstep(0.55, 0.62, c) * (1.0 - smoothstep(0.62, 0.70, c)) * 1.3;
  vec3 col = mix(vec3(1.0, 0.45, 0.30), vec3(1.0, 0.85, 0.55), c);
  float a = (band + rim) * pulse * uIntensity * 0.85;
  gl_FragColor = vec4(col, a);
}`;

// Aurora curtain — multi-color polar curtain with vertical filaments.
//   uv.x: angular position around the polar oval (0..1 == 0..2π)
//   uv.y: altitude from the planet's surface (0 = bottom, 1 = top)
// The shader composites vivid green at low altitude, red in the middle,
// and violet at the top, then modulates with a vertical-filament pattern
// that animates so the curtain "breathes" like a real auroral display.
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
uniform float uColorBoost;   // 0..1 — slides palette toward extreme/SUPERFLARE colours

void main() {
  vec2 uv = vUv;

  // Vertical filament rays — narrow bright bands evenly spaced around the
  // pole. Two layers at slightly different frequencies + drift speeds so
  // the pattern is rich rather than periodic-looking.
  float r1 = 0.5 + 0.5 * sin(uv.x * 90.0 + uTime * 1.10);
  r1 = smoothstep(0.55, 1.0, r1);
  float r2 = 0.5 + 0.5 * sin(uv.x * 47.0 - uTime * 0.65 + 1.7);
  r2 = smoothstep(0.65, 1.0, r2);
  float rays = max(r1, r2 * 0.85);

  // Slow curtain wave — large brightness undulations that make the whole
  // curtain shimmer.
  float w1 = 0.5 + 0.5 * sin(uv.x * 9.0 + uTime * 1.25);
  float w2 = 0.5 + 0.5 * sin(uv.x * 13.0 - uTime * 1.85);
  float curtainGlow = mix(w1, w2, 0.5);

  // Multi-color altitude bands. Real auroras emit:
  //   <100 km    bright green (atomic oxygen 558 nm)
  //   200-300 km red (atomic oxygen 630 nm, deeper red)
  //   ~500 km    blue / violet (molecular nitrogen)
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
  // SUPERFLARE: shove the whole palette toward magenta to read as "the
  // atmosphere's actually being ionised, not a pretty light show."
  col = mix(col, mix(red, violet, 0.6 + 0.4 * uv.y), uColorBoost * 0.6);

  // Edge fades so the curtain doesn't end on a hard line.
  float topFade = 1.0 - smoothstep(0.88, 1.0, uv.y);
  float botFade = smoothstep(0.0, 0.04, uv.y);
  float edge = topFade * botFade;

  // Final compositing — base curtain + filament highlights.
  float baseA = (0.30 + 0.50 * curtainGlow) * edge;
  float rayA  = rays * (0.55 + 0.45 * curtainGlow) * edge;
  // Highlight rays brighter and slightly whiter than base.
  vec3 finalCol = col * (0.6 + 0.6 * curtainGlow) + rays * vec3(0.6, 0.85, 0.7) * 0.7;
  float a = clamp(baseA + rayA, 0.0, 1.0) * uIntensity * 1.05;
  gl_FragColor = vec4(finalCol, a);
}`;

const FLARE_CLASS_INFO = {
  M:          { intensity: 0.45, lifeMax:  8.0, popKill: 0.0,    biosphereDrop: 0, dustAdd: 0.00, tempBump: 0.5,  cmeScale: 0.55, colorBoost: 0.0 },
  X:          { intensity: 0.75, lifeMax: 11.0, popKill: 0.005,  biosphereDrop: 0, dustAdd: 0.01, tempBump: 1.5,  cmeScale: 0.85, colorBoost: 0.0 },
  CARRINGTON: { intensity: 0.95, lifeMax: 13.0, popKill: 0.04,   biosphereDrop: 0, dustAdd: 0.02, tempBump: 3.0,  cmeScale: 1.10, colorBoost: 0.3 },
  SUPERFLARE: { intensity: 1.20, lifeMax: 16.0, popKill: 0.30,   biosphereDrop: 1, dustAdd: 0.05, tempBump: 6.0,  cmeScale: 1.45, colorBoost: 1.0 },
};

function _disposeFlare() {
  const f = earthState.flare;
  if (!f) return;
  for (const m of [f.cloudMesh, f.bowShock, f.auroraN, f.auroraS]) {
    if (m && m.parent) m.parent.remove(m);
    if (m && m.geometry) m.geometry.dispose();
    if (m && m.material) m.material.dispose();
  }
  if (f.cloudGroup && f.cloudGroup.parent) f.cloudGroup.parent.remove(f.cloudGroup);
  earthState.flare = null;
}

// Build a multi-color aurora curtain at one pole. `northSide=true` puts
// the curtain above the north pole flaring upward; `false` puts it below
// the south pole flaring downward — both tracking the magnetic field
// lines as they spread from the surface into space.
function _makeAuroraCurtain(spinner, vR, northSide, info) {
  // Geometry: cone-frustum hugging the polar cap. Bottom ring sits at
  // ~62° latitude on the surface, top ring flares outward (the field
  // lines spread as they rise). 96 radial segments for smooth filaments.
  // Sized large enough to read clearly at Earth Mode camera distance —
  // a small ring at exactly 70° latitude is invisible in practice.
  const baseRingR  = vR * 0.50;       // ring radius at the surface
  const flareRingR = vR * 0.95;       // ring radius at top of curtain
  const height     = vR * 0.95;       // vertical extent — tall, dramatic
  const yBase      = vR * 0.89;       // height of bottom ring above Earth centre
  const sign = northSide ? 1 : -1;

  // CylinderGeometry(radiusTop, radiusBottom, height, …). For the north
  // pole the wide flare is at the top (radiusTop > radiusBottom). For
  // the south pole we mirror by swapping which end is wide and shifting
  // the geometry to the lower hemisphere.
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

export function triggerSolarFlare() {
  const earth = getEarth(), sun = getSun();
  if (!earth || !sun) return;
  const spinner = bodySpinners.get(earth);
  if (!spinner) return;

  _disposeFlare();
  const info = FLARE_CLASS_INFO[earthState.flareClass];
  const vR = visualRadius(earth);

  // ── auto-orient camera so the CME path crosses the screen ────────────
  // Without this, the Sun could be directly behind the camera and the
  // entire arrival happens off-screen until impact. We rotate yaw to
  // place the Sun at ~90° from the camera-forward axis. The existing
  // camera lerp glides the rotation rather than snapping.
  const sunFromEarth = new THREE.Vector3(
    sun.px - earth.px, sun.py - earth.py, sun.pz - earth.pz,
  ).normalize();
  const sunYaw = Math.atan2(sunFromEarth.x, sunFromEarth.z);
  camState.yaw   = sunYaw + Math.PI / 2;
  camState.pitch = -0.20;

  // ── plasma cloud (CME) ───────────────────────────────────────────────
  // Unit sphere geometry, scaled by the parent group each frame to
  // grow as it travels and stretched by the shader into an ellipsoid.
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
  const cloudGroup = new THREE.Group();
  cloudGroup.add(cloudMesh);
  scene.add(cloudGroup);

  // ── bow shock crescent ───────────────────────────────────────────────
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

  // ── multi-color aurora curtains at the magnetic poles ───────────────
  const auroraN = _makeAuroraCurtain(spinner, vR, true,  info);
  const auroraS = _makeAuroraCurtain(spinner, vR, false, info);

  earthState.flare = {
    earth, sun, spinner,
    cloudMesh, cloudMat, cloudGroup,
    bowShock, bowMat,
    auroraN, auroraS,
    info,
    classTier: earthState.flareClass,
    life: info.lifeMax, lifeMax: info.lifeMax,
  };

  // Stat impact, applied immediately. Inspector picks it up next refresh.
  earth.events = earth.events || [];
  earth.events.unshift({
    time: state.simTime, type: 'IMPACT',
    description: `${earthState.flareClass} SOLAR FLARE`,
  });
  if (earth.events.length > 10) earth.events.length = 10;

  earth.surfaceTemp = (earth.surfaceTemp ?? 288) + info.tempBump;
  if (earth.dustOptical !== undefined && info.dustAdd > 0) {
    earth.dustOptical = Math.min(1, (earth.dustOptical || 0) + info.dustAdd);
  }
  if (earth.population && info.popKill > 0) {
    const lost = earth.population * info.popKill;
    const prior = earth.populationDeathRoll;
    const remaining = (prior ? prior.remaining : 0) + lost;
    earth.populationDeathRoll = { remaining, ratePerRealSec: remaining / Math.max(2.0, info.lifeMax * 0.6) };
    earth.events.unshift({
      time: state.simTime, type: 'CASUALTIES',
      description: `${(info.popKill*100).toFixed(0)}% LOST · GRID/RADIATION`,
    });
  }
  if (info.biosphereDrop > 0 && earth.biosphereStage > 0) {
    earth.biosphereStage = Math.max(0, earth.biosphereStage - info.biosphereDrop);
    earth.biosphere = BIOSPHERE_STAGES[earth.biosphereStage];
    earth.habitableYears = -100;
    earth.events.unshift({
      time: state.simTime, type: 'EXTINCTION',
      description: `IONISATION COLLAPSE · -${info.biosphereDrop} STAGE`,
    });
  }
}

// Triangular envelope: 0 outside [a,c], peaks 1 at b, linear ramps in/out.
function _band(t, a, b, c) {
  if (t < a || t > c) return 0;
  return t < b ? (t - a) / (b - a) : (c - t) / (c - b);
}

function _updateFlare(realDt) {
  const f = earthState.flare;
  if (!f) return;
  f.life -= realDt;
  if (f.life <= 0) { _disposeFlare(); return; }

  const t = 1 - (f.life / f.lifeMax);   // 0 → 1 over lifetime
  const I = f.info.intensity;

  // Sun direction in WORLD coords (cloud lives in scene root) — and the
  // same in spinner-local coords for the bow-shock shader.
  const ex = f.earth.px, ey = f.earth.py, ez = f.earth.pz;
  const sx = f.sun.px,  sy = f.sun.py,  sz = f.sun.pz;
  const dx = sx - ex, dy = sy - ey, dz = sz - ez;
  const dM = Math.hypot(dx, dy, dz) || 1;
  const sunWorld = new THREE.Vector3(dx / dM, dy / dM, dz / dM);
  const invQ = new THREE.Quaternion();
  f.spinner.getWorldQuaternion(invQ).invert();
  const sunLocal = sunWorld.clone().applyQuaternion(invQ);

  const [erx, ery, erz] = renderPos(f.earth);
  const vR = visualRadius(f.earth);

  // ── PHASE 1: plasma cloud travels from Sun direction toward Earth ───
  // Travel runs from t=0 to t=0.45 of life; after that the cloud envelopes
  // Earth and slowly fades (replaced visually by the aurora response).
  // Distances are tuned so the cloud is partially in-frame at t=0 with the
  // default Earth-Mode camera (dist 35, FOV 55° → half-width ≈ 18 units at
  // Earth's depth). Starting at 28 with radius 6 puts the cloud's leading
  // edge right around the frame boundary at the start.
  const travelT = Math.min(1, t / 0.45);
  const ease = travelT * travelT * (3 - 2 * travelT);   // smoothstep accel
  const startDist = 28;
  const endDist   = vR * 2.0;
  const cloudDist = startDist - (startDist - endDist) * ease;
  // Cloud size: starts substantial, blooms further as it crashes into the
  // bow shock — at impact the cloud is large enough to envelop Earth.
  const cloudR = (6.0 + 12.0 * ease) * f.info.cmeScale;

  // Position the cloud group on the Sun-side of Earth at cloudDist.
  f.cloudGroup.position.set(
    erx + sunWorld.x * cloudDist,
    ery + sunWorld.y * cloudDist,
    erz + sunWorld.z * cloudDist,
  );
  // Orient the cloud's local +Z back toward the Sun, so the elongated
  // tail points home and the leading edge faces Earth. lookAt makes -Z
  // point at the target, hence target = position - sunWorld.
  f.cloudGroup.lookAt(
    f.cloudGroup.position.x - sunWorld.x,
    f.cloudGroup.position.y - sunWorld.y,
    f.cloudGroup.position.z - sunWorld.z,
  );
  f.cloudGroup.scale.set(cloudR, cloudR, cloudR);

  const cloudIntensity = _band(t, 0, 0.32, 0.62) * I * 1.4;
  const u = f.cloudMat.uniforms;
  u.uTime.value += realDt;
  u.uIntensity.value = cloudIntensity;

  // ── PHASE 2: bow shock pulses while the cloud envelopes Earth ───────
  const bowU = f.bowMat.uniforms;
  bowU.uSunDirLocal.value.copy(sunLocal);
  bowU.uTime.value += realDt;
  bowU.uIntensity.value = _band(t, 0.26, 0.45, 0.65) * I * 1.1;

  // ── PHASE 3: aurora curtains pulse at the poles ─────────────────────
  // Aurora ramps in once the cloud reaches Earth and persists through the
  // back half of the lifetime, gradually fading. A slow pulsation is
  // baked into the band envelope to make the lights "breathe".
  const auroraEnv = _band(t, 0.30, 0.62, 1.0);
  const breathing = 0.85 + 0.15 * Math.sin(t * Math.PI * 4.0);
  const auroraI = auroraEnv * breathing * I * 1.6;
  for (const a of [f.auroraN, f.auroraS]) {
    a.material.uniforms.uTime.value += realDt;
    a.material.uniforms.uIntensity.value = auroraI;
  }
}

// =====================================================================
// ICE AGE — two layered shells over Earth:
//   1. ICE SHELL: bright snow-and-glacier coverage with continental noise
//      (so ice has fingers extending toward the equator, not a clean band).
//      Sun-direction shading: brilliant white on the day side, deep blue
//      moonlight on the night side. Sparkle highlights via pow-noise so
//      the glaciers actually glint.
//   2. STORM SHELL: a slightly larger sphere with animated fbm cloud
//      pattern, latitude-biased toward higher altitudes (polar storm
//      bands). Ramps in with coverage to give the planet that thick,
//      grey, cloud-shrouded glacial-maximum look.
// Stats ramp over the same window.
// =====================================================================

const ICE_VERT = `
varying vec3 vLocal;
void main() {
  vLocal = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ICE_FRAG = `
precision highp float;
varying vec3 vLocal;
uniform float uTime;
uniform float uCoverage;     // 0..1 fraction of surface frozen
uniform float uOpacity;
uniform vec3  uSunDirLocal;

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
  // Latitude as a base, but shifted by continental-scale noise so the ice
  // line has long "fingers" pushing toward the equator along imaginary
  // land masses — much more like real glacial coverage than a clean band.
  float lat = abs(vLocal.y);
  float continental = (fbm(vLocal * 2.4) - 0.5) * 0.55;
  float jagged      = (fbm(vLocal * 7.5 + vec3(uTime * 0.025)) - 0.5) * 0.22;
  float effectiveLat = lat + continental + jagged;

  // Coverage drives the ice line; multiplier > 1 lets a uCoverage of ~0.7
  // reach the equator (snowball-Earth lockout).
  float iceLine = 1.0 - uCoverage * 1.4;
  float frozen = smoothstep(iceLine - 0.08, iceLine + 0.05, effectiveLat);
  if (frozen < 0.015) discard;

  // Crystalline ice texture (slow drift) and finer-grained surface detail.
  float crystals     = fbm(vLocal * 16.0 + vec3(uTime * 0.012));
  float fineCrystals = fbm(vLocal * 38.0);

  // Sun-direction shading. uSunDirLocal is in spinner-local space — the
  // ice tracks Earth's day/night cycle and lights up brilliantly on the
  // sunlit hemisphere while the night-side caps glow deep blue.
  float sunDot = dot(vLocal, normalize(uSunDirLocal));
  float lighting = mix(0.20, 1.15, smoothstep(-0.25, 0.55, sunDot));

  // Color palette: brilliant white on day, deep blue on night.
  vec3 daySnow = vec3(0.99, 1.00, 1.00);
  vec3 dimIce  = vec3(0.40, 0.58, 0.92);
  vec3 col = mix(dimIce, daySnow, smoothstep(-0.05, 0.45, sunDot));

  // Cyan crystal undertones — ice has subtle blue depths.
  col += crystals * vec3(0.04, 0.09, 0.15);

  // Bright glints — pow(noise, large) gives sparse sparkles on the lit side.
  float glint = pow(fineCrystals, 16.0) * 6.0 * smoothstep(0.0, 0.4, sunDot);
  col += glint * vec3(0.95, 0.98, 1.00);

  // Apply lighting (with healthy ambient so the night side stays readable).
  col *= (0.45 + lighting * 0.65);

  // Edge softening — the very fringe of the ice line is partially open
  // water, which we model by softening alpha at low frozen values.
  float a = frozen * uOpacity;
  gl_FragColor = vec4(col, a);
}`;

const STORM_FRAG = `
precision highp float;
varying vec3 vLocal;
uniform float uTime;
uniform float uCoverage;
uniform float uOpacity;
uniform vec3  uSunDirLocal;

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
  // Drifting cloud field; a slow vertical bias so the storm bands look
  // like they're streaming around the planet at high latitudes.
  vec3 q = vLocal * 2.2 + vec3(uTime * 0.04, uTime * 0.012, uTime * 0.025);
  float clouds = fbm(q);
  float lat = abs(vLocal.y);
  // Latitude bias: more cloud at the poles than the equator.
  clouds += lat * 0.30;
  // Threshold so we get individual cloud structures rather than a uniform haze.
  float cloudMask = smoothstep(0.42, 0.78, clouds);

  // Sun-direction shading.
  float sunDot = dot(vLocal, normalize(uSunDirLocal));
  float lighting = mix(0.30, 1.05, smoothstep(-0.25, 0.55, sunDot));

  // Storm-cloud color: warm grey-white on day, deep slate on night.
  vec3 dayCloud   = vec3(0.92, 0.94, 0.97);
  vec3 nightCloud = vec3(0.28, 0.36, 0.50);
  vec3 col = mix(nightCloud, dayCloud, smoothstep(-0.10, 0.40, sunDot));
  col *= (0.55 + lighting * 0.55);

  // Opacity ramps with both global coverage and the local cloud field.
  float a = cloudMask * uCoverage * uOpacity * 1.25;
  gl_FragColor = vec4(col, a);
}`;

function _disposeIce() {
  const i = earthState.ice;
  if (!i) return;
  for (const m of [i.shell, i.stormShell]) {
    if (m && m.parent) m.parent.remove(m);
    if (m && m.geometry) m.geometry.dispose();
    if (m && m.material) m.material.dispose();
  }
  earthState.ice = null;
}

export function triggerIceAge() {
  const earth = getEarth();
  if (!earth) return;
  const spinner = bodySpinners.get(earth);
  if (!spinner) return;

  _disposeIce();

  const tempDrop = earthState.iceTempDrop;
  const durYears = earthState.iceDurationYears;
  // Map K-drop → final iceCover. -2 K → 0.15, -12 K → 0.45, -22 K → 0.75, -30 K → 0.95.
  const targetCover = Math.min(0.95, Math.max(0.05, 0.05 + tempDrop * 0.030));
  // Visual animation runs over ~7 real seconds regardless of duration —
  // long enough to watch the ice creep in but not so long the user waits.
  const lifeMax = 7.0;

  const vR = visualRadius(earth);

  // Ice shell — sits well clear of the surface so it doesn't z-fight,
  // and just inside the existing atmosphere shell at vR*1.04.
  const iceGeo = new THREE.SphereGeometry(vR * 1.022, 128, 80);
  const iceMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: Math.random() * 10 },
      uCoverage:    { value: earth.iceCover || 0 },
      uOpacity:     { value: 0 },
      uSunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: ICE_VERT,
    fragmentShader: ICE_FRAG,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  const shell = new THREE.Mesh(iceGeo, iceMat);
  spinner.add(shell);

  // Storm shell — slightly outside the ice, just inside the atmosphere.
  const stormGeo = new THREE.SphereGeometry(vR * 1.034, 96, 64);
  const stormMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: Math.random() * 10 },
      uCoverage:    { value: 0 },
      uOpacity:     { value: 0 },
      uSunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: ICE_VERT,
    fragmentShader: STORM_FRAG,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  const stormShell = new THREE.Mesh(stormGeo, stormMat);
  spinner.add(stormShell);

  earthState.ice = {
    earth, spinner,
    shell, mat: iceMat,
    stormShell, stormMat,
    startCover: earth.iceCover || 0,
    targetCover,
    tempDrop,
    durYears,
    life: lifeMax, lifeMax,
    statsApplied: false,
  };

  earth.events = earth.events || [];
  earth.events.unshift({
    time: state.simTime, type: 'EXTINCTION',
    description: `ICE AGE · -${tempDrop}K · ${durYears} YR`,
  });
  if (earth.events.length > 10) earth.events.length = 10;
}

function _updateIce(realDt) {
  const i = earthState.ice;
  if (!i) return;
  i.life -= realDt;
  if (i.life <= 0) {
    _applyIceFinalStats();
    _disposeIce();
    return;
  }

  const t = 1 - i.life / i.lifeMax;       // 0 → 1
  const ease = t * t * (3 - 2 * t);       // smoothstep
  const cover = i.startCover + (i.targetCover - i.startCover) * ease;

  // Sun direction in spinner-local frame so the ice/storm shaders track
  // Earth's day side as the camera or planet rotates.
  const sun = getSun();
  if (sun) {
    const dx = sun.px - i.earth.px;
    const dy = sun.py - i.earth.py;
    const dz = sun.pz - i.earth.pz;
    const dM = Math.hypot(dx, dy, dz) || 1;
    const sunWorld = new THREE.Vector3(dx / dM, dy / dM, dz / dM);
    const invQ = new THREE.Quaternion();
    i.spinner.getWorldQuaternion(invQ).invert();
    const sunLocal = sunWorld.clone().applyQuaternion(invQ);
    i.mat.uniforms.uSunDirLocal.value.copy(sunLocal);
    i.stormMat.uniforms.uSunDirLocal.value.copy(sunLocal);
  }

  // Drive both shaders.
  const rampIn  = Math.min(1, t / 0.10);
  const fadeOut = 1 - Math.max(0, (t - 0.95) / 0.05);
  const env = rampIn * fadeOut;

  const u = i.mat.uniforms;
  u.uTime.value += realDt;
  u.uCoverage.value = cover;
  u.uOpacity.value = 0.95 * env;

  // Storm clouds ramp in slightly behind the ice (50ms-equivalent lag) and
  // intensify with deeper temperature drops; opacity peaks ~0.7 of cover.
  const stormCoverage = Math.min(1, cover * 0.9);
  const sm = i.stormMat.uniforms;
  sm.uTime.value += realDt;
  sm.uCoverage.value = stormCoverage;
  sm.uOpacity.value = 0.85 * env;

  // Continuously update Earth's iceCover and temp so the inspector ticks.
  i.earth.iceCover = cover;
  // Temperature drops linearly with the visual progression.
  i.earth.surfaceTemp = (i.earth.surfaceTemp ?? 288);
  if (!i.statsApplied) {
    // First-frame snapshot of the starting temp so we can interpolate cleanly.
    i._startTemp = i.earth.surfaceTemp;
    i.statsApplied = 'in-flight';
  }
  i.earth.surfaceTemp = i._startTemp - i.tempDrop * ease;
  // Habitability falls; biosphere may regress at deep drops.
  if (i.earth.habitability !== undefined) {
    i.earth.habitability = Math.max(0, i.earth.habitability - 0.6 * ease);
  }
  // Population: logistic-ish decay toward (1 - cover) of carrying capacity.
  if (i.earth.population !== undefined && i.earth.population > 0) {
    const survival = Math.max(0, 1 - cover * 1.1);
    const target = i.earth.population * survival;
    // Smooth toward target over the animation.
    i.earth.population += (target - i.earth.population) * (0.15 * realDt);
  }
}

function _applyIceFinalStats() {
  const i = earthState.ice;
  if (!i) return;
  // Ensure we land exactly at the target so the inspector reads cleanly.
  i.earth.iceCover = i.targetCover;
  i.earth.surfaceTemp = i._startTemp - i.tempDrop;
  if (i.targetCover > 0.7 && i.earth.biosphereStage > 0) {
    i.earth.biosphereStage = Math.max(0, i.earth.biosphereStage - 1);
    i.earth.biosphere = BIOSPHERE_STAGES[i.earth.biosphereStage];
    i.earth.habitableYears = -200;
    i.earth.events.unshift({
      time: state.simTime, type: 'EXTINCTION',
      description: 'GLACIATION COLLAPSE · BIOSPHERE -1',
    });
  }
}

// =====================================================================
// ASTEROID — auto-spawn at a cinematic distance from Earth, fire toward
// Earth via the existing fireAsteroid pipeline. Briefly unpause sim so
// the integrator carries the asteroid in; re-pause once it's resolved.
// =====================================================================

export function triggerAsteroid() {
  const earth = getEarth();
  if (!earth) return;

  // Already-pending? Ignore so the user doesn't stack ten asteroids.
  if (earthState.asteroidPending) return;

  const massExp = parseFloat(document.getElementById('emMass').value);
  const speedKm = parseFloat(document.getElementById('emSpeed').value);
  // Spawn ~50 render units from Earth, slightly off-axis for a streaking
  // approach instead of a head-on shot. Spawn position is in render units
  // (fireAsteroid converts internally).
  const [erx, ery, erz] = renderPos(earth);
  const spawn = new THREE.Vector3(
    erx + 50,
    ery + 18,        // a bit above the ecliptic so it streaks down
    erz + 14,
  );

  // Push the chosen mass / speed onto the global sliders so fireAsteroid
  // (which reads them) launches with our values. Restore after.
  const massEl  = document.getElementById('mass');
  const speedEl = document.getElementById('speed');
  const prevMass  = massEl.value;
  const prevSpeed = speedEl.value;
  massEl.value  = String(massExp);
  speedEl.value = String(speedKm);

  const ast = fireAsteroid(spawn, earth, earthState.asteroidComposition);

  massEl.value  = prevMass;
  speedEl.value = prevSpeed;

  if (!ast) return;

  // Briefly unpause the sim so the asteroid actually travels and the
  // existing impact pipeline (debris, shockwaves, surface flash) runs.
  // Reset prevPaused to true so we go back to paused on event end.
  state.paused = false;
  syncPauseButton();
  earthState.prevPaused = true;
  earthState.asteroidPending = { ast };
}

function _updateAsteroidPending() {
  const p = earthState.asteroidPending;
  if (!p) return;
  // Once the asteroid is dead (impact resolved by main.js's collision path),
  // freeze the world again so the user can read the result.
  if (!p.ast.alive || !state.bodies.includes(p.ast)) {
    state.paused = true;
    syncPauseButton();
    earthState.asteroidPending = null;
  }
}

// =====================================================================
// Per-frame entrypoint
// =====================================================================

export function updateEarthMode(realDt) {
  if (!earthState.active) return;
  _updateFlare(realDt);
  _updateIce(realDt);
  _updateAsteroidPending();
}

export function isEarthModeActive() { return earthState.active; }
