// Shared mutable state. Modules import { state } and read/write its fields.

export const state = {
  bodies: [],
  simTime: 0,
  paused: true,
  warpIdx: 3,
  showTrails: true,
  showLabels: true,
  aimMode: false,
  aiming: false,
  aimStart: null,
  aimEnd: null,
};
