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
  // Reported by the integrator each frame so the HUD telemetry stays honest.
  lastDt: 0,
  lastSubsteps: 0,
};
