// Entry point: build the world, then run the main animation loop.
// Per frame: physics substeps (with collision check), trail bookkeeping,
// visual sync, aim-prediction, label projection, camera, render, telemetry.

import { state } from './state.js';
import { WARP_LEVELS, RENDER_SCALE, DT_MAX_SUBSTEP, MAX_SUBSTEPS_PER_FRAME } from './data.js';
import { renderer, scene, camera } from './scene.js';
import { buildSolarSystem, computeAccelerations, step, detectImpact, mergeImpact } from './physics.js';
import { rebuildVisuals, syncBodyVisuals, updateLabels, bodyMeshes, trailLines, labelDivs, visualRadius } from './visuals.js';
import { updateCamera, camState } from './camera.js';
import { updateAimVisual, spawnImpactDebris, updateImpactDebris } from './asteroid.js';
import { buildAsteroidBelt, updateAsteroidBelt } from './asteroid_belt.js';
import { markEvolvers, update as evolutionUpdate, reset as evolutionReset, applyImpactEffects } from './evolution.js';
import { populateNavDock, updateTelemetry, getLaunchTarget } from './ui.js';
import { initEarthModeUI, updateEarthMode } from './earth_mode.js';
import { initBlackHoleUI, updateBlackHoleVisual } from './blackhole_ui.js';
import { initSolarFlareUI, updateSolarFlares } from './solar_flare.js';
import { updateTidalStreams } from './tidal_stream.js';
import { initHabZoneUI, updateHabitableZones } from './habitable_zone.js';
import { initBodyEditor, updateBodyEditor } from './body_editor.js';
import { initMobileDock } from './mobile.js';

buildSolarSystem();
computeAccelerations(state.bodies);
rebuildVisuals();
buildAsteroidBelt();
markEvolvers();
evolutionReset();
populateNavDock();
initEarthModeUI();
initBlackHoleUI();
initSolarFlareUI();
initHabZoneUI();
initBodyEditor();
initMobileDock();

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
        const [imp, tgt, ii, jj, tImpact] = hit;
        // detectImpact already orders the pair so `tgt` is the survivor
        // (black hole > non-asteroid > more massive) and `imp` is the
        // body that gets consumed.
        // No modal popup — the inspector EVENTS log + on-screen animation
        // (debris, shock waves, camera snap, ticking population counter)
        // already tell the impact story without blocking the view.
        // Spawn a particle burst at the impact site BEFORE mergeImpact
        // dissolves the impactor. tImpact pinpoints the actual contact
        // location within the substep so the burst lands on the planet's
        // surface, not at its centre. Skip surface shock waves when the
        // survivor is a BH — there's no surface to ripple, just a void.
        if (!tgt.isBlackHole) spawnImpactDebris(imp, tgt, tImpact);
        mergeImpact(imp, tgt, tImpact); // conserve mass + momentum + (axial) angular momentum
        applyImpactEffects(imp, tgt);    // climate / biosphere / population update
        // Cinematic camera snap to the impact site: focus the target,
        // pull in to ~3.5 visual radii, and orient yaw/pitch so the
        // strike point sits in front of the camera at a 3/4 angle. The
        // existing targetGoal lerp glides the move; yaw/pitch snap.
        camState.focusBody = tgt;
        camState.targetDist = visualRadius(tgt) * 3.5;
        const idx = imp.px - tgt.px;
        const idy = imp.py - tgt.py;
        const idz = imp.pz - tgt.pz;
        const horiz = Math.hypot(idx, idz) || 1;
        camState.yaw = Math.atan2(idx, idz);
        camState.pitch = Math.max(-1.4, Math.min(1.4,
          Math.atan2(idy, horiz) + Math.PI / 8,
        ));
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

  syncBodyVisuals(realDt, camState.focusBody);
  updateTidalStreams(realDt);
  updateAsteroidBelt();
  updateImpactDebris(realDt);
  updateEarthMode(realDt);
  updateSolarFlares(realDt);
  updateHabitableZones();
  updateBodyEditor();
  updateAimVisual(getLaunchTarget());
  updateBlackHoleVisual();
  updateLabels(camera);
  updateCamera(realDt);
  renderer.render(scene, camera);
  updateTelemetry();
  requestAnimationFrame(tick);
}

tick();
