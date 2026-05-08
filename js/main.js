// Entry point: build the world, then run the main animation loop.
// Per frame: physics substeps (with collision check), trail bookkeeping,
// visual sync, aim-prediction, label projection, camera, render, telemetry.

import { state } from './state.js';
import { WARP_LEVELS, RENDER_SCALE, STEPS_PER_FRAME } from './data.js';
import { renderer, scene, camera } from './scene.js';
import { buildSolarSystem, computeAccelerations, step, detectImpact } from './physics.js';
import { rebuildVisuals, syncBodyVisuals, updateLabels, bodyMeshes, trailLines, labelDivs } from './visuals.js';
import { updateCamera } from './camera.js';
import { showImpact, updateAimVisual } from './asteroid.js';
import { populateNavDock, updateTelemetry } from './ui.js';

buildSolarSystem();
computeAccelerations(state.bodies);
rebuildVisuals();
populateNavDock();

let lastFrameTime = performance.now();

function tick() {
  const now = performance.now();
  const realDt = Math.min((now - lastFrameTime) / 1000, 0.1); // clamp huge gaps (tab unfocus)
  lastFrameTime = now;

  if (!state.paused) {
    const totalDt = WARP_LEVELS[state.warpIdx].dt * realDt;
    const dt = totalDt / STEPS_PER_FRAME;
    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      step(state.bodies, dt);
      state.simTime += dt;
      const hit = detectImpact();
      if (hit) {
        const [imp, tgt, ii] = hit;
        showImpact(imp, tgt);
        state.bodies[ii].alive = false;
        const m = bodyMeshes.get(state.bodies[ii]); if (m) scene.remove(m);
        const l = trailLines.get(state.bodies[ii]); if (l) scene.remove(l);
        const d = labelDivs.get(state.bodies[ii]);  if (d) d.remove();
        state.bodies = state.bodies.filter(b => b.alive);
        rebuildVisuals();
        break;
      }
    }
    // Trail bookkeeping. For parented bodies (the Moon) store the parent-
    // relative offset in render units so the orbit follows its parent and
    // gets the visual scale-up. visuals.js re-anchors at render time.
    for (const b of state.bodies) {
      if (b.parent) {
        const parent = state.bodies.find(x => x.name === b.parent);
        if (parent) {
          const s = b.displayOrbitScale || 1;
          b.trail.push([
            (b.px - parent.px) * s / RENDER_SCALE,
            (b.py - parent.py) * s / RENDER_SCALE,
            (b.pz - parent.pz) * s / RENDER_SCALE,
          ]);
        } else {
          b.trail.push([b.px / RENDER_SCALE, b.py / RENDER_SCALE, b.pz / RENDER_SCALE]);
        }
      } else {
        b.trail.push([b.px / RENDER_SCALE, b.py / RENDER_SCALE, b.pz / RENDER_SCALE]);
      }
      if (b.trail.length > b.trailMax) b.trail.shift();
    }
  }

  syncBodyVisuals(realDt);
  updateAimVisual();
  updateLabels(camera);
  updateCamera(realDt);
  renderer.render(scene, camera);
  updateTelemetry();
  requestAnimationFrame(tick);
}

tick();
