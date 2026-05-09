// Climate, biosphere, and population dynamics. Runs once per simulated year
// (driven from main.js's tick) on every body marked `evolves = true`.
// Deliberately a toy model — not a GCM — but rich enough to show the
// dynamics the user wanted to play with:
//
//   * Energy balance: insolation × (1 − albedo) × dust transmission with a
//     greenhouse multiplier from atmospheric pressure + CO₂.
//   * Ice-albedo feedback: cold → ice grows → albedo up → colder; warm →
//     ice melts → albedo down → warmer. Snowball Earth and runaway
//     greenhouse states are reachable.
//   * Atmospheric dust decays exponentially after impacts (~50-yr half life).
//   * Biosphere progression: STERILE → PREBIOTIC → MICROBIAL → COMPLEX →
//     INTELLIGENT, gated on continuous habitability time. Major impacts
//     regress stages; sustained inhospitable conditions decay them.
//   * Population: logistic growth toward a habitability-scaled carrying
//     capacity. Tracked only on bodies that start with one (Earth).
//
// All thresholds are sandbox-tuned — fast enough to watch evolution unfold
// at warp 7-9, slow enough that small impacts don't crash everything.

import { state } from './state.js';
import { TNT_J, BIOSPHERE_STAGES, STAGE_DURATION_YEARS } from './data.js';

const SECONDS_PER_YEAR = 86400 * 365.25;
const L_SUN  = 3.828e26;       // solar luminosity (W)
const SIGMA  = 5.670374e-8;    // Stefan-Boltzmann constant (W m⁻² K⁻⁴)

let _lastEvolveSec = 0;

// Determine which bodies should run the evolution model. Anything with a
// surfaceTemp seeded from BODY_INFO qualifies — terrestrial planets, the
// Moon, the major moons we tagged with conditions (Europa, Titan,
// Enceladus). Asteroids are excluded; gas giants would need a different
// model so they're skipped too.
export function markEvolvers() {
  for (const b of state.bodies) {
    b.evolves = (
      !b.isAsteroid &&
      b.surfaceTemp !== undefined &&
      b.type !== 'GAS GIANT' &&
      b.type !== 'ICE GIANT' &&
      b.type !== 'STAR'
    );
    if (b.evolves) {
      // Initialise dynamic fields so the first evolveBody call has sane data.
      if (b.iceCover === undefined)       b.iceCover = 0;
      if (b.dustOptical === undefined)    b.dustOptical = 0;
      if (b.co2 === undefined)            b.co2 = 0;
      if (b.water === undefined)          b.water = 0;
      if (b.pressure === undefined)       b.pressure = 0;
      if (b.events === undefined)         b.events = [];
      if (b.biosphereStage === undefined) {
        // Lenient match — "COMPLEX MULTICELLULAR" → COMPLEX, "PREBIOTIC?" → PREBIOTIC.
        const desc = (b.biosphere || 'STERILE').toUpperCase();
        let idx = 0;
        for (let i = BIOSPHERE_STAGES.length - 1; i >= 0; i--) {
          if (desc.includes(BIOSPHERE_STAGES[i])) { idx = i; break; }
        }
        b.biosphereStage = idx;
        b.biosphere = BIOSPHERE_STAGES[idx]; // canonicalise the display string
      }
      if (b.habitableYears === undefined) b.habitableYears = 0;
      if (b.population !== undefined && b.populationCarryingCapacity === undefined) {
        b.populationCarryingCapacity = Math.max(b.population * 1.5, 1.5e10);
      }
    }
  }
  _lastEvolveSec = state.simTime;
}

function evolveBody(b, dyears) {
  if (!b.evolves) return;
  if (dyears <= 0) return;

  // Locate the parent star and the body's orbital "host" (so moons inherit
  // their planet's distance for insolation).
  const sun = state.bodies.find(x => x.name === 'SUN');
  if (!sun) return;
  const host = b.parent ? state.bodies.find(x => x.name === b.parent) || b : b;
  const dx = host.px - sun.px, dy = host.py - sun.py, dz = host.pz - sun.pz;
  const r  = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;

  // Energy in
  const insol = L_SUN / (4 * Math.PI * r * r);
  const albedo       = 0.06 + 0.55 * b.iceCover;       // ocean→ice ramp
  const transmission = Math.max(0.05, 1 - b.dustOptical);
  const Fabs         = insol * (1 - albedo) * transmission;

  // Greenhouse: pressure-driven, CO₂ as log multiplier. Earth at 1 bar +
  // ~400 ppm gives a multiplier near 1.13, which lifts 255 K → ~288 K.
  // CO₂ exponent tuned to make Mars genuinely warmable with thicker atmo.
  const co2Boost   = 1 + Math.log10(Math.max(b.co2, 1)) / 3.5;
  const greenhouse = 1 + Math.min(0.7, b.pressure * 0.13 * co2Boost);

  const Teq = Math.pow(Fabs / (4 * SIGMA), 0.25) * greenhouse;

  // Surface temp drifts toward Teq with thermal inertia. 1 − 0.94^dyears
  // gives ~6%/yr at small steps and the right asymptote at large dt.
  const inertia = 1 - Math.pow(0.94, dyears);
  b.surfaceTemp += (Teq - b.surfaceTemp) * inertia;

  // Ice cover follows temperature with hysteresis (deadband 270-280 K).
  if (b.surfaceTemp < 270) {
    b.iceCover = Math.min(1, b.iceCover + (270 - b.surfaceTemp) * 0.0006 * dyears);
  } else if (b.surfaceTemp > 280) {
    b.iceCover = Math.max(0, b.iceCover - (b.surfaceTemp - 280) * 0.0006 * dyears);
  }

  // Atmospheric dust decays geometrically — rough 50-year half-life.
  b.dustOptical *= Math.pow(0.985, dyears);
  if (b.dustOptical < 1e-4) b.dustOptical = 0;

  // CO₂ slowly weathers back to baseline (very slow on real Earth; sped up
  // here so the user sees recovery within a sandbox session).
  if (b.co2 > 280) b.co2 = Math.max(280, b.co2 - 0.5 * dyears);

  // Habitability: composite score driven by liquid water, temperature
  // window, atmospheric pressure window. 0 → 1.
  const liquid     = b.water * (1 - b.iceCover);
  const tempScore  = Math.max(0, 1 - Math.abs(b.surfaceTemp - 290) / 50);
  const waterScore = Math.min(1, liquid / 0.4);
  const pressScore = (b.pressure > 0.1 && b.pressure < 10) ? 1 : 0.2;
  const isHabitable = liquid > 0.02 && b.surfaceTemp > 250 && b.surfaceTemp < 340 &&
                      b.pressure > 0.05 && b.pressure < 100;
  b.habitability = isHabitable ? Math.max(0, Math.min(1, 0.4*tempScore + 0.4*waterScore + 0.2*pressScore)) : 0;

  // Biosphere progression / decay.
  if (isHabitable) {
    b.habitableYears += dyears;
    // Loop in case dyears was big enough to span multiple stages — keeps
    // long-warp jumps consistent with many small ticks.
    while (
      b.biosphereStage < BIOSPHERE_STAGES.length - 1 &&
      STAGE_DURATION_YEARS[b.biosphereStage] &&
      b.habitableYears > STAGE_DURATION_YEARS[b.biosphereStage]
    ) {
      b.habitableYears -= STAGE_DURATION_YEARS[b.biosphereStage];
      b.biosphereStage += 1;
      b.events.unshift({
        time: state.simTime, type: 'EVOLUTION',
        description: `BIOSPHERE → ${BIOSPHERE_STAGES[b.biosphereStage]}`,
      });
      if (b.events.length > 10) b.events.length = 10;
    }
  } else {
    // Conditions broken: erode the habitable-time counter. If it stays
    // broken long enough, drop a stage.
    b.habitableYears -= dyears * 3;
    if (b.habitableYears < -200 && b.biosphereStage > 0) {
      b.biosphereStage -= 1;
      b.habitableYears = 0;
      b.events.unshift({
        time: state.simTime, type: 'EXTINCTION',
        description: `BIOSPHERE COLLAPSED → ${BIOSPHERE_STAGES[b.biosphereStage]}`,
      });
      if (b.events.length > 10) b.events.length = 10;
    }
    if (b.habitableYears < 0) b.habitableYears = Math.max(b.habitableYears, -500);
  }
  b.biosphere = BIOSPHERE_STAGES[b.biosphereStage];

  // Population dynamics (only on bodies that start with one). Closed-form
  // logistic so even multi-year ticks don't overshoot — Euler with large
  // dyears would shoot p past k and oscillate.
  if (b.population !== undefined && b.population > 0) {
    const k  = Math.max(1, b.populationCarryingCapacity * b.habitability);
    const r0 = 0.012;
    const p0 = b.population;
    if (k < 1.5) {
      // No habitable conditions → exponential decline at growth-rate scale.
      b.population = p0 * Math.exp(-r0 * 2 * dyears);
    } else {
      const factor = (k / p0) - 1;
      b.population = k / (1 + factor * Math.exp(-r0 * dyears));
    }
    if (b.population < 1) b.population = 0;
  }
}

// Per-frame: advance simulation time by however many sim-years have passed
// since the last evolution tick. Sub-year deltas are accumulated; a single
// tick covers many years at high warp.
export function update() {
  const dsec = state.simTime - _lastEvolveSec;
  if (dsec <= 0) return;
  const dyears = dsec / SECONDS_PER_YEAR;
  _lastEvolveSec = state.simTime;
  // Skip very small deltas so cheap warps don't churn through Newton
  // iterations on Math operations every frame.
  if (dyears < 0.001) return;
  for (const b of state.bodies) evolveBody(b, dyears);
}

export function reset() {
  _lastEvolveSec = state.simTime;
}

// =====================================================================
// Impact effects
// =====================================================================
// Called from main.js right after mergeImpact applies physics. Mutates the
// target's habitability state based on the impactor's mass, velocity, and
// composition. Yield is in megatons TNT.
export function applyImpactEffects(impactor, target) {
  if (!target.evolves && target.surfaceTemp === undefined) return;
  const dvx = impactor.vx - target.vx;
  const dvy = impactor.vy - target.vy;
  const dvz = impactor.vz - target.vz;
  const v = Math.sqrt(dvx*dvx + dvy*dvy + dvz*dvz);
  const E = 0.5 * impactor.mass * v * v;
  const Mt = E / TNT_J / 1e6;

  // Ensure the target has the dynamic fields evolveBody would seed.
  if (target.iceCover    === undefined) target.iceCover = 0;
  if (target.dustOptical === undefined) target.dustOptical = 0;
  if (target.water       === undefined) target.water = 0;
  if (target.events      === undefined) target.events = [];

  // Water deposit (icy / carbonaceous bodies). Crude scaling: an icy body
  // with mass = 0.001 × Earth's ocean (~1.4e21 kg) deposits ~10% of the
  // surface coverage gap. So a Ceres-class icy strike on a dry world
  // measurably wets it.
  const waterFrac = impactor.waterFraction || 0;
  if (waterFrac > 0) {
    const waterMass = impactor.mass * waterFrac;
    const surfaceCoverDelta = waterMass / 2e21; // calibrated for Earth-scale
    target.water = Math.min(1, target.water + surfaceCoverDelta);
  }

  // Atmospheric dust ejection — drives "nuclear winter" cooling. Dust
  // optical depth saturates to 1 at Chicxulub-ish yields.
  // 1 Mt → +0   ; 1e3 Mt → +0.0  ; 1e5 Mt → +0.4 ; 1e8 Mt → +1.0
  if (Mt > 1e3) {
    const dustAdd = Math.min(1, (Math.log10(Mt) - 3) / 5);
    target.dustOptical = Math.min(1, target.dustOptical + dustAdd);
  }

  // CO₂ from vaporised rock (and, for icy strikes, sublimated CO₂ ice).
  if (target.co2 !== undefined && Mt > 0) {
    target.co2 += Math.min(2000, Mt * 0.001);
  }

  // Volatile release thickens the atmosphere — a thin-atmosphere world like
  // Mars can be partially terraformed by a big-enough volatile-rich strike.
  // Saturates so a strike on Earth doesn't unrealistically multiply 1 bar.
  if (target.pressure !== undefined) {
    const dp = Math.min(0.4, Mt * 1e-7) * (waterFrac > 0 ? 1.5 : 1);
    target.pressure = Math.min(target.pressure + dp, 100);
  }

  // Population kill — sigmoid on log10(Mt), 50% kill at ~10⁴ Mt.
  if (target.population && target.population > 0) {
    const x = Math.log10(Math.max(Mt, 0.001)) - 4;
    const killFrac = 1 / (1 + Math.exp(-x * 1.6));
    const before = target.population;
    target.population = Math.max(0, target.population * (1 - killFrac));
    if (target.population < 1) target.population = 0;
    if (killFrac > 0.05) {
      target.events.unshift({
        time: state.simTime, type: 'CASUALTIES',
        description: `${(killFrac*100).toFixed(0)}% POPULATION LOST · ${formatPop(before)} → ${formatPop(target.population)}`,
      });
    }
  }

  // Biosphere damage — large impacts drop stages, planet-killers wipe.
  if (target.biosphereStage !== undefined && target.biosphereStage > 0) {
    let drop = 0;
    if (Mt > 1e8) drop = target.biosphereStage;       // Theia-class, full reset
    else if (Mt > 1e6) drop = 2;
    else if (Mt > 1e4) drop = 1;
    if (drop > 0) {
      target.biosphereStage = Math.max(0, target.biosphereStage - drop);
      target.habitableYears = -100; // forces a recovery delay
      target.biosphere = BIOSPHERE_STAGES[target.biosphereStage];
      target.events.unshift({
        time: state.simTime, type: 'EXTINCTION',
        description: `MASS EXTINCTION · DROPPED ${drop} STAGE${drop > 1 ? 'S' : ''}`,
      });
    }
  }

  target.events.unshift({
    time: state.simTime, type: 'IMPACT',
    description: `${formatYield(Mt)} ${impactor.composition || 'ROCKY'} IMPACT`,
    yield: Mt,
  });
  if (target.events.length > 10) target.events.length = 10;
}

function formatYield(Mt) {
  if (Mt < 0.001) return (Mt * 1e6).toExponential(1) + ' t';
  if (Mt < 1)     return (Mt * 1e3).toFixed(0) + ' kt';
  if (Mt < 1e6)   return Mt.toFixed(0) + ' Mt';
  return Mt.toExponential(1) + ' Mt';
}
function formatPop(n) {
  if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(0) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(0) + 'K';
  return n.toFixed(0);
}
