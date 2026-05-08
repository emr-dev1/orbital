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

// Major moons of the other planets. Built as full physics bodies parented
// to their planet, with a `displayOrbitScale` so the (small, close-to-the-
// planet) orbits are visible at our compressed render scale. Elements are
// approximate epoch-J2000 values relative to each parent's equatorial
// reference; the visualisation doesn't need them inertially perfect.
//
// Color picks are vibe-coded from real spectra: Io's volcanic yellow,
// Europa's icy white-blue, Ganymede's grey-tan, Callisto's dark grey,
// Titan's hazy orange, Enceladus' bright white, etc.
export const MOON_LIST = [
  // ── Mars ──────────────────────────────────────────────────────────────
  { name: 'PHOBOS',   parent: 'MARS',    mass: 1.06e16, rad: 11.27e3,  color: 0x8a7560,
    a: 9376e3,        e: 0.0151, i: 1.08*DEG,  Omega: 0,            omega: 0,             M0: 0,
    rotPeriod: 27554, tilt: 0,   displayOrbitScale: 200, tidallyLocked: true },
  { name: 'DEIMOS',   parent: 'MARS',    mass: 1.5e15,  rad: 6.2e3,    color: 0x9a8a78,
    a: 23460e3,       e: 0.0002, i: 1.79*DEG,  Omega: 0,            omega: 0,             M0: Math.PI,
    rotPeriod: 109079,tilt: 0,   displayOrbitScale: 80, tidallyLocked: true },
  // ── Jupiter (Galileans) ───────────────────────────────────────────────
  { name: 'IO',       parent: 'JUPITER', mass: 8.93e22, rad: 1.821e6,  color: 0xe6c97a,
    a: 421800e3,      e: 0.0041, i: 0.04*DEG,  Omega: 43.977*DEG,    omega: 84.129*DEG,   M0: 342*DEG,
    rotPeriod: 152854,tilt: 0,   displayOrbitScale: 28, tidallyLocked: true },
  { name: 'EUROPA',   parent: 'JUPITER', mass: 4.80e22, rad: 1.561e6,  color: 0xd6d2c8,
    a: 671034e3,      e: 0.009,  i: 0.47*DEG,  Omega: 219.106*DEG,   omega: 88.97*DEG,    M0: 171*DEG,
    rotPeriod: 306822,tilt: 0,   displayOrbitScale: 22, tidallyLocked: true,
    // Europa's subsurface ocean — set up the data for the future habitability sim.
    water: 0.05, biosphere: 'PREBIOTIC?', habitability: 0.15 },
  { name: 'GANYMEDE', parent: 'JUPITER', mass: 1.482e23,rad: 2.634e6,  color: 0xa39885,
    a: 1070400e3,     e: 0.0013, i: 0.18*DEG,  Omega: 63.552*DEG,    omega: 192.417*DEG,  M0: 317*DEG,
    rotPeriod: 618153,tilt: 0,   displayOrbitScale: 18, tidallyLocked: true },
  { name: 'CALLISTO', parent: 'JUPITER', mass: 1.076e23,rad: 2.410e6,  color: 0x6f6258,
    a: 1882700e3,     e: 0.0074, i: 0.19*DEG,  Omega: 298.848*DEG,   omega: 52.643*DEG,   M0: 181*DEG,
    rotPeriod: 1441931,tilt: 0,  displayOrbitScale: 14, tidallyLocked: true },
  // ── Saturn ────────────────────────────────────────────────────────────
  { name: 'TITAN',    parent: 'SATURN',  mass: 1.345e23,rad: 2.575e6,  color: 0xd9954a,
    a: 1221870e3,     e: 0.0288, i: 0.348*DEG, Omega: 28.06*DEG,     omega: 78.30*DEG,    M0: 11*DEG,
    rotPeriod: 1377684,tilt: 0,  displayOrbitScale: 16, tidallyLocked: true,
    // Titan has methane lakes. Atmosphere thicker than Earth's.
    atmosphere: 'N₂ 95% · CH₄ 5%', pressure: 1.45, water: 0, habitability: 0.12,
    biosphere: 'STERILE', notes: 'METHANE LAKES · DENSE NITROGEN ATMOSPHERE' },
  { name: 'ENCELADUS',parent: 'SATURN',  mass: 1.08e20, rad: 252e3,    color: 0xf0f0f8,
    a: 238037e3,      e: 0.0047, i: 0.009*DEG, Omega: 0,             omega: 0,            M0: 91*DEG,
    rotPeriod: 118386,tilt: 0,   displayOrbitScale: 65, tidallyLocked: true,
    // Active cryovolcanism — strong subsurface ocean candidate for life.
    water: 0.10, habitability: 0.20, biosphere: 'PREBIOTIC?',
    notes: 'CRYOVOLCANIC PLUMES · SUBSURFACE OCEAN' },
  // ── Uranus ────────────────────────────────────────────────────────────
  { name: 'TITANIA',  parent: 'URANUS',  mass: 3.4e21,  rad: 788e3,    color: 0x7a8088,
    a: 435910e3,      e: 0.0011, i: 0.34*DEG,  Omega: 0,             omega: 0,            M0: 0,
    rotPeriod: 752683,tilt: 0,   displayOrbitScale: 26, tidallyLocked: true },
  // ── Neptune ───────────────────────────────────────────────────────────
  { name: 'TRITON',   parent: 'NEPTUNE', mass: 2.14e22, rad: 1.353e6,  color: 0xb0a89e,
    a: 354759e3,      e: 0.000016, i: 156.865*DEG, Omega: 172.43*DEG, omega: 344.05*DEG,  M0: 264*DEG,
    rotPeriod: -507772, tilt: 0, displayOrbitScale: 30, tidallyLocked: true,
    notes: 'RETROGRADE ORBIT · LIKELY CAPTURED KUIPER BELT OBJECT' },
];

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

// Per-body descriptors for the BODY INSPECTOR panel. Static reference values
// for now; the dynamic ones (`water`, `iceCover`, `co2`, `population`,
// `biosphere`, `habitability`, `surfaceTemp`) are also seeded onto each Body
// at world-build time so future climate/biosphere simulations can mutate
// them per impact / per simulated year.
export const BODY_INFO = {
  SUN: {
    type: 'STAR', class: 'G2V YELLOW DWARF',
    surfaceTemp: 5778,        // K
    coreTemp:    1.57e7,
    luminosity:  3.828e26,    // W
    age:         4.6e9,       // years
    composition: 'H 73% · HE 25%',
    fusion:      'P-P CHAIN',
  },
  MERCURY: {
    type: 'TERRESTRIAL',
    surfaceGravity: 3.7,      // m/s²
    surfaceTemp: 440, surfaceTempMin: 100, surfaceTempMax: 700,
    atmosphere: 'EXOSPHERE', pressure: 1e-15,
    water: 0, iceCover: 0,
    biosphere: 'STERILE', habitability: 0,
    notes: 'NO ATMOSPHERE · EXTREME TEMP SWINGS',
  },
  VENUS: {
    type: 'TERRESTRIAL',
    surfaceGravity: 8.87,
    surfaceTemp: 737,
    atmosphere: 'CO₂ 96.5% · N₂ 3.5%', pressure: 92,
    water: 0, iceCover: 0,
    biosphere: 'STERILE', habitability: 0,
    notes: 'RUNAWAY GREENHOUSE · LEAD MELTS AT SURFACE',
  },
  EARTH: {
    type: 'TERRESTRIAL',
    surfaceGravity: 9.81,
    surfaceTemp: 288,
    atmosphere: 'N₂ 78% · O₂ 21% · AR 1%', pressure: 1.013,
    water: 0.71, iceCover: 0.10, co2: 425,
    biosphere: 'COMPLEX MULTICELLULAR', habitability: 1.0,
    population: 8.1e9,
    notes: 'KNOWN HARBOR FOR LIFE',
  },
  MOON: {
    type: 'NATURAL SATELLITE', parent: 'EARTH',
    surfaceGravity: 1.62, surfaceTemp: 250,
    atmosphere: 'NONE', pressure: 0,
    water: 0.001, iceCover: 0.001,
    biosphere: 'STERILE', habitability: 0,
    notes: 'TIDALLY LOCKED · ICE IN POLAR CRATERS',
  },
  MARS: {
    type: 'TERRESTRIAL',
    surfaceGravity: 3.72, surfaceTemp: 210,
    atmosphere: 'CO₂ 95% · N₂ 3% · AR 2%', pressure: 0.006,
    water: 0.03, iceCover: 0.05,
    biosphere: 'STERILE', habitability: 0.10,
    notes: 'POLAR ICE · POSSIBLE PAST LIFE',
  },
  JUPITER: {
    type: 'GAS GIANT',
    surfaceGravity: 24.79, cloudTopTemp: 165,
    atmosphere: 'H₂ 89% · HE 10%',
    moons: 95,
    notes: 'NO SOLID SURFACE · GREAT RED SPOT IS A 100M-YEAR STORM',
  },
  SATURN: {
    type: 'GAS GIANT',
    surfaceGravity: 10.44, cloudTopTemp: 134,
    atmosphere: 'H₂ 96% · HE 3%',
    moons: 146,
    notes: 'LESS DENSE THAN WATER · PROMINENT RING SYSTEM',
  },
  URANUS: {
    type: 'ICE GIANT',
    surfaceGravity: 8.69, cloudTopTemp: 76,
    atmosphere: 'H₂ 83% · HE 15% · CH₄ 2%',
    moons: 27,
    notes: 'ROLLS ON ITS SIDE (97° TILT)',
  },
  NEPTUNE: {
    type: 'ICE GIANT',
    surfaceGravity: 11.15, cloudTopTemp: 72,
    atmosphere: 'H₂ 80% · HE 19% · CH₄ 1%',
    moons: 16,
    notes: 'SUPERSONIC WINDS (2100 KM/H)',
  },
};
