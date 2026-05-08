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
  // Reported by the integrator each frame so the HUD telemetry stays honest.
  lastDt: 0,
  lastSubsteps: 0,
};
