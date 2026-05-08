// Pure constants and data tables. No state, no side effects.

export const G = 6.674e-11;
export const AU = 1.496e11;
export const DAY = 86400;
export const C_LIGHT = 299792458;    // m/s — used in 1PN GR correction
export const RENDER_SCALE = 1e9;     // meters per render-unit (1 unit = 1 Gm)
export const TNT_J = 4.184e9;        // joules per ton TNT

// Adaptive timestep: aim for ~50 physics substeps per Moon orbit (Moon is
// the fastest body in the system → it sets the stability ceiling).
// Moon period = 2.36e6 s, so dt_substep ≤ ~47 ks. Cap substeps per frame.
export const DT_MAX_SUBSTEP = 47000;
export const MAX_SUBSTEPS_PER_FRAME = 200;

const DEG = Math.PI / 180;

// Real solar system data (J2000-ish, simplified circular orbits at t=0).
// IAU convention: tilt = obliquity to orbit (degrees). rotPeriod is the
// SIDEREAL day in seconds, always positive — retrograde rotation falls out
// naturally from the >90° tilt (Venus 177°, Uranus 98°), which flips the
// spin axis through the equator. No need to also negate rotPeriod.
export const PLANET_DATA = [
  { name: 'SUN',     mass: 1.989e30, r: 0,           T: 0,        rad: 6.96e8,  color: 0xffcc66, glow: true,
    rotPeriod: 25.05*86400,  tilt: 7.25 },
  { name: 'MERCURY', mass: 3.301e23, r: 0.387*AU,    T: 87.97,    rad: 2.44e6,  color: 0xa39989,
    rotPeriod: 58.646*86400, tilt: 0.034 },
  { name: 'VENUS',   mass: 4.867e24, r: 0.723*AU,    T: 224.7,    rad: 6.05e6,  color: 0xe8c891,
    rotPeriod: 243.025*86400, tilt: 177.36 },
  { name: 'EARTH',   mass: 5.972e24, r: 1.000*AU,    T: 365.25,   rad: 6.37e6,  color: 0x4a90d9,
    rotPeriod: 86164.1,      tilt: 23.44 },
  { name: 'MARS',    mass: 6.417e23, r: 1.524*AU,    T: 686.97,   rad: 3.39e6,  color: 0xc1440e,
    rotPeriod: 88642.7,      tilt: 25.19 },
  { name: 'JUPITER', mass: 1.898e27, r: 5.203*AU,    T: 4332.6,   rad: 6.99e7,  color: 0xd8b48c,
    rotPeriod: 35730,        tilt: 3.13 },
  { name: 'SATURN',  mass: 5.683e26, r: 9.537*AU,    T: 10759.2,  rad: 5.82e7,  color: 0xe6d4a0, ring: true,
    rotPeriod: 38362,        tilt: 26.73 },
  { name: 'URANUS',  mass: 8.681e25, r: 19.19*AU,    T: 30688.5,  rad: 2.54e7,  color: 0x8fd4d6,
    rotPeriod: 62064,        tilt: 97.77 },
  { name: 'NEPTUNE', mass: 1.024e26, r: 30.07*AU,    T: 60182,    rad: 2.46e7,  color: 0x4166f5,
    rotPeriod: 57996,        tilt: 28.32 },
];

export const MOON_DATA = {
  name: 'MOON', mass: 7.342e22, r: 3.84e8, T: 27.32, rad: 1.737e6, color: 0xbfc4cc,
  rotPeriod: 27.32*86400, tilt: 6.68,
};

// J2000 heliocentric orbital elements (NASA fact-sheet values, simplified).
// a = semi-major axis (m), e = eccentricity, i = inclination to ecliptic (rad),
// Omega = longitude of ascending node (rad), omega = argument of perihelion (rad),
// M0 = mean anomaly at J2000 epoch (rad).
export const ORBITAL_ELEMENTS = {
  MERCURY: { a: 0.387098*AU,  e: 0.205630, i: 7.005*DEG, Omega: 48.331*DEG,  omega: 29.124*DEG,  M0: 174.796*DEG },
  VENUS:   { a: 0.723332*AU,  e: 0.006772, i: 3.395*DEG, Omega: 76.680*DEG,  omega: 54.884*DEG,  M0: 50.115*DEG  },
  EARTH:   { a: 1.000000*AU,  e: 0.016710, i: 0.000*DEG, Omega: 0.000*DEG,   omega: 102.937*DEG, M0: 357.529*DEG },
  MARS:    { a: 1.523679*AU,  e: 0.093394, i: 1.850*DEG, Omega: 49.578*DEG,  omega: 286.502*DEG, M0: 19.412*DEG  },
  JUPITER: { a: 5.204267*AU,  e: 0.048775, i: 1.305*DEG, Omega: 100.464*DEG, omega: 273.867*DEG, M0: 20.020*DEG  },
  SATURN:  { a: 9.582172*AU,  e: 0.055723, i: 2.485*DEG, Omega: 113.665*DEG, omega: 339.392*DEG, M0: 317.020*DEG },
  URANUS:  { a: 19.229412*AU, e: 0.044405, i: 0.773*DEG, Omega: 74.006*DEG,  omega: 96.998*DEG,  M0: 142.238*DEG },
  NEPTUNE: { a: 30.103658*AU, e: 0.011214, i: 1.770*DEG, Omega: 131.784*DEG, omega: 273.187*DEG, M0: 256.228*DEG },
};

// Moon J2000 geocentric elements (relative to ecliptic).
export const MOON_ELEMENTS = {
  a: 384400e3, e: 0.0549, i: 5.145*DEG,
  Omega: 125.08*DEG, omega: 318.06*DEG, M0: 135.27*DEG,
};

export const WARP_LEVELS = [
  { dt: 60,             label: '1 min/s'   },
  { dt: 600,            label: '10 min/s'  },
  { dt: 3600,           label: '1 hr/s'    },
  { dt: 86400,          label: '1 day/s'   },
  { dt: 86400*7,        label: '1 wk/s'    },
  { dt: 86400*30,       label: '1 mo/s'    },
  { dt: 86400*180,      label: '6 mo/s'    },
  { dt: 86400*365,      label: '1 yr/s'    },
  { dt: 86400*365*5,    label: '5 yr/s'    },
  { dt: 86400*365*20,   label: '20 yr/s'   },
];

export const REF_EVENTS = [
  { t: 0.0001, label: 'Small bolide / fireball' },
  { t: 0.015,  label: 'Hiroshima bomb' },
  { t: 15,     label: 'Tunguska 1908' },
  { t: 100000, label: 'Meteor Crater (Arizona)' },
  { t: 1e8,    label: 'Chicxulub (dinosaur extinction)' },
  { t: 1e11,   label: 'Theia (Moon-forming)' },
];

// Per-body camera distance (in render units = Gm).
export const NAV_DIST = {
  SUN: 80, MERCURY: 8, VENUS: 12, EARTH: 12, MOON: 4,
  MARS: 8, JUPITER: 60, SATURN: 70, URANUS: 30, NEPTUNE: 30,
};
export const NAV_ORDER = ['SUN','MERCURY','VENUS','EARTH','MOON','MARS','JUPITER','SATURN','URANUS','NEPTUNE'];
