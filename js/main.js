// Entry point: build the world, then run the main animation loop.
// Per frame: physics substeps (with collision check), trail bookkeeping,
// visual sync, aim-prediction, label projection, camera, render, telemetry.

import { state } from './state.js';
import { WARP_LEVELS, RENDER_SCALE, DT_MAX_SUBSTEP, MAX_SUBSTEPS_PER_FRAME } from './data.js';
import { renderer, scene, camera } from './scene.js';
import { buildSolarSystem, computeAccelerations, step, detectImpact, mergeImpact } from './physics.js';
import { rebuildVisuals, syncBodyVisuals, updateLabels, bodyMeshes, trailLines, labelDivs } from './visuals.js';
import { updateCamera, camState } from './camera.js';
import { showImpact, updateAimVisual, spawnImpactDebris, updateImpactDebris } from './asteroid.js';
import { buildAsteroidBelt, updateAsteroidBelt } from './asteroid_belt.js';
import { markEvolvers, update as evolutionUpdate, reset as evolutionReset, applyImpactEffects } from './evolution.js';
import { populateNavDock, updateTelemetry, getLaunchTarget } from './ui.js';

buildSolarSystem();
computeAccelerations(state.bodies);
rebuildVisuals();
buildAsteroidBelt();
markEvolvers();
evolutionReset();
populateNavDock();

let lastFrameTime = performance.now();

function tick() {
  const now = performance.now();
  const realDt = Math.min((now - lastFrameTime) / 1000, 0.1); // clamp huge gaps (tab unfocus)
  lastFrameTime = now;

  if (!state.paused) {
    // Adaptive substeps: keep dt_substep below DT_MAX_SUBSTEP so even the
    // Moon's tight orbit stays bound at extreme warps. Capped at
    // MAX_SUBSTEPS_PER_FRAME so a single frame can't lock up the page.
    const totalDt   = WARP_LEVELS[state.warpIdx].dt * realDt;
    const requested = Math.ceil(Math.abs(totalDt) / DT_MAX_SUBSTEP);
    const nSubsteps = Math.max(1, Math.min(MAX_SUBSTEPS_PER_FRAME, requested));
    const dt        = totalDt / nSubsteps;
    state.lastDt = dt;
    state.lastSubsteps = nSubsteps;

    for (let s = 0; s < nSubsteps; s++) {
      step(state.bodies, dt);
      state.simTime += dt;
      const hit = detectImpact();
      if (hit) {
        const [imp, tgt, ii, _jj, tImpact] = hit;
        showImpact(imp, tgt);
        // Spawn a particle burst at the impact site BEFORE mergeImpact
        // dissolves the impactor — uses the impactor's velocity to scatter.
        spawnImpactDebris(imp, tgt);
        mergeImpact(imp, tgt, tImpact); // conserve mass + momentum + (axial) angular momentum
        applyImpactEffects(imp, tgt);    // climate / biosphere / population update
        if (camState.focusBody === imp) {
          camState.focusBody = tgt;
        }
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

  // Climate / biosphere / population — only when sim is running.
  if (!state.paused) evolutionUpdate();

  syncBodyVisuals(realDt);
  updateAsteroidBelt();
  updateImpactDebris(realDt);
  updateAimVisual(getLaunchTarget());
  updateLabels(camera);
  updateCamera(realDt);
  renderer.render(scene, camera);
  updateTelemetry();
  requestAnimationFrame(tick);
}

tick();
