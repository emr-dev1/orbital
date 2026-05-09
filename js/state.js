// Shared mutable state. Modules import { state } and read/write its fields.

export const state = {
  bodies: [],
  simTime: 0,
  paused: true,
  warpIdx: 3,
  showTrails: true,
  showLabels: true,
  aimMode: false,
  aimStart: null,
  aimEnd: null,
  // Asteroid spawn point in RENDER UNITS (Y=0 ecliptic). null until the user
  // enters aim mode; updated by clicks in empty space while aiming.
  launchSpawn: null,
  launchComposition: 'ROCKY', // ROCKY / ICY / IRON / CARBONACEOUS — drives density + waterFraction
  // Black-hole forge state. While bhMode is on, scene clicks reposition
  // bhSpawn (in render units, ecliptic plane). The forge panel renders a
  // ghost BH at that spot and a predicted trajectory through the system.
  bhMode: false,
  bhSpawn: null,
  // Reported by the integrator each frame so the HUD telemetry stays honest.
  lastDt: 0,
  lastSubsteps: 0,
};
