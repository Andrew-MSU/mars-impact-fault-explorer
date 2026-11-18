/**
 * First-order Basin & Global calculations.
 *
 * These are browser estimates for Wheeler to explore. They are not a
 * spherical-harmonic lithosphere model and not a VPLanet run. Every free
 * number that is not taken from the parameter sheet is an argument, so the
 * page can put it on a slider. MODEL.md states which arguments are assumptions.
 *
 * Stress inside this file is compression-positive, matching physics.js.
 * ΔCFS uses the same unclamping-positive normal stress as King, Stein & Lin (1994).
 */

import { deltaCfsFromCompressionTensor, destinationPoint, haversineM } from "./physics.js";

export const GRAVITATIONAL_CONSTANT = 6.6743e-11;
export const VACUUM_PERMEABILITY = 1.25663706212e-6;
/** Present-day heating rates for the natural elements. See MODEL.md. */
export const HEAT_U_W_PER_KG = 9.7e-5;
export const HEAT_TH_W_PER_KG = 2.6e-5;
export const HEAT_K_W_PER_KG = 3.4e-9;
/** Gunell et al. (2018) value for Earth's dipole moment, comparison only. */
export const EARTH_MOMENT_AM2 = 7.77e22;
export const EARTH_RADIUS_M = 6.371e6;
const ANNULUS_WIDTH = 0.45;

function annulusShape(x) {
  return x * Math.exp((-0.5 * (x - 1) ** 2) / ANNULUS_WIDTH);
}

let annulusPeak = 1e-9;
for (let i = 0; i <= 500; i += 1) {
  annulusPeak = Math.max(annulusPeak, annulusShape(i / 40));
}

/**
 * Angular distance in degrees. Same geometry as the great-circle distance.
 */
export function angularSeparationDeg(lon1, lat1, lon2, lat2, radiusM) {
  const distance = haversineM(lon1, lat1, lon2, lat2, radiusM);
  return (distance / radiusM) * (180 / Math.PI);
}

export function antipode(lon, lat) {
  const flipped = lon + 180;
  return {
    lon: ((flipped + 540) % 360) - 180,
    lat: -lat,
  };
}

/**
 * Axisymmetric cap-load shape on a thin shell.
 *
 * `magnitudePa` is the peak isotropic tension (isostatic) or compression
 * (flexural) at the load center. The annulus carries radial stress of the
 * opposite sign. This is a smooth stand-in for the membrane pattern, not
 * Banerdt's spherical-harmonic solution. `support` "flexural" flips both signs.
 *
 * Returns compression-positive hoop and radial stress in pascals.
 */
export function capLoadStress(angularDistanceRad, capRadiusRad, magnitudePa, support = "isostatic") {
  const cap = Math.max(capRadiusRad, 1e-4);
  const x = Math.max(0, angularDistanceRad) / cap;
  const isotropy = Math.exp(-2 * x * x);
  const hoopShape = -Math.exp(-0.5 * x * x);
  const radialShape = -isotropy + (1 - isotropy) * (annulusShape(x) / annulusPeak);
  const sign = support === "flexural" ? -1 : 1;
  return {
    sigmaHoopPa: sign * magnitudePa * hoopShape,
    sigmaRadialPa: sign * magnitudePa * radialShape,
  };
}

/**
 * Horizontal compression-positive tensor in an east-north-up frame.
 * `east` and `north` are the components of the radial (from the load) unit vector.
 * At the load center the stress is isotropic in the horizontal plane.
 */
export function horizontalPrincipalTensor(sigmaRadialPa, sigmaHoopPa, east, north) {
  const norm = Math.hypot(east, north);
  if (norm < 1e-8) {
    return [
      [sigmaHoopPa, 0, 0],
      [0, sigmaHoopPa, 0],
      [0, 0, 0],
    ];
  }
  const erx = east / norm;
  const ery = north / norm;
  const etx = ery;
  const ety = -erx;
  const ee = sigmaRadialPa * erx * erx + sigmaHoopPa * etx * etx;
  const nn = sigmaRadialPa * ery * ery + sigmaHoopPa * ety * ety;
  const en = sigmaRadialPa * erx * ery + sigmaHoopPa * etx * ety;
  return [
    [ee, en, 0],
    [en, nn, 0],
    [0, 0, 0],
  ];
}

export function addTensors(a, b) {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) out[i][j] = a[i][j] + b[i][j];
  }
  return out;
}

/** ΔCFS from one shell tensor on one fault. */
export function shellDeltaCfs(tensor, fault) {
  return deltaCfsFromCompressionTensor(tensor, fault);
}

/**
 * Geometric envelope for antipodal focusing. Gain equals `peak` at 180°
 * and falls to 1 away from the antipode. This is not a wave simulation.
 */
export function antipodalGain(angularDistanceDeg, widthDeg, peak) {
  const gap = Math.abs(angularDistanceDeg - 180);
  const width = Math.max(widthDeg, 0.5);
  return 1 + (Math.max(peak, 1) - 1) * Math.exp(-0.5 * (gap / width) ** 2);
}

/**
 * Far-field stress transfer. At zero distance the added ΔCFS is
 * `fraction * stressDropPa * alignment`, and it decays as (L / (L + d))^exponent.
 */
export function transferredDeltaCfs({ stressDropPa, lengthM, distanceM, exponent, fraction, alignment }) {
  const length = Math.max(lengthM, 1);
  const decay = (length / (length + Math.max(distanceM, 0))) ** Math.max(exponent, 0);
  return fraction * stressDropPa * decay * Math.max(0, Math.min(1, alignment));
}

export function strikeAlignment(strikeADeg, strikeBDeg) {
  const diff = ((strikeADeg - strikeBDeg) * Math.PI) / 180;
  return Math.abs(Math.cos(diff));
}

/**
 * Connected components of failed faults. Two failed faults link when their
 * midpoints are within linkDistanceM. Returns every cluster, largest first.
 */
export function clusterFaults(faults, linkDistanceM, radiusM) {
  const failed = faults.filter((fault) => fault.failed);
  const parent = failed.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    let again = index;
    while (parent[again] !== cursor) {
      const next = parent[again];
      parent[again] = cursor;
      again = next;
    }
    return cursor;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < failed.length; i += 1) {
    for (let j = i + 1; j < failed.length; j += 1) {
      const distance = haversineM(failed[i].lon, failed[i].lat, failed[j].lon, failed[j].lat, radiusM);
      if (distance <= linkDistanceM) unite(i, j);
    }
  }
  const groups = new Map();
  failed.forEach((fault, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(fault);
  });
  return [...groups.values()]
    .map((members) => ({
      members,
      lengthM: members.reduce((sum, fault) => sum + fault.lengthM, 0),
      depthM: members.reduce((max, fault) => Math.max(max, fault.depthM || 0), 0),
      count: members.length,
    }))
    .sort((a, b) => b.lengthM - a.lengthM);
}

function unitVector(lonDeg, latDeg) {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

/**
 * Length-weighted mean of positions on the sphere.
 * A plain average of longitudes fails across the date line and near the poles.
 */
export function sphericalCentroid(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const weight = point.weight > 0 ? point.weight : 1;
    const [px, py, pz] = unitVector(point.lon, point.lat);
    x += weight * px;
    y += weight * py;
    z += weight * pz;
  }
  const norm = Math.hypot(x, y, z);
  if (!(norm > 0)) return { lon: 0, lat: 0 };
  return {
    lon: (Math.atan2(y, x) * 180) / Math.PI,
    lat: (Math.asin(Math.max(-1, Math.min(1, z / norm))) * 180) / Math.PI,
  };
}

/**
 * Along-strike extent of a connected fault zone.
 * Endpoints of each trace are projected onto the mean strike through the
 * spherical centroid. The reported length is that great-circle span, at least
 * the longest single trace, and never longer than one circumference.
 * It is not the sum of the traces: parallel faults in one zone must not be
 * counted once per fault.
 */
export function alongStrikeExtentM(faults, radiusM) {
  const radius = Math.max(radiusM, 1);
  const circumference = 2 * Math.PI * radius;
  const traceLengthM = faults.reduce((sum, fault) => sum + Math.max(fault.lengthM || 0, 0), 0);
  if (!faults.length) {
    return { extentM: 0, centroidLon: 0, centroidLat: 0, traceLengthM: 0, capped: false, meanStrikeDeg: 0 };
  }
  const centroid = sphericalCentroid(faults.map((fault) => ({
    lon: fault.lon,
    lat: fault.lat,
    weight: Math.max(fault.lengthM || 0, 1),
  })));
  let cx = 0;
  let cy = 0;
  for (const fault of faults) {
    const weight = Math.max(fault.lengthM || 0, 1);
    const doubled = 2 * ((fault.strikeDeg || 0) * Math.PI) / 180;
    cx += weight * Math.cos(doubled);
    cy += weight * Math.sin(doubled);
  }
  const meanStrikeDeg = (Math.atan2(cy, cx) / 2) * (180 / Math.PI);
  const strike = (meanStrikeDeg * Math.PI) / 180;
  const lon = (centroid.lon * Math.PI) / 180;
  const lat = (centroid.lat * Math.PI) / 180;
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const along = [
    north[0] * Math.cos(strike) + east[0] * Math.sin(strike),
    north[1] * Math.cos(strike) + east[1] * Math.sin(strike),
    north[2] * Math.cos(strike) + east[2] * Math.sin(strike),
  ];
  const origin = unitVector(centroid.lon, centroid.lat);
  const angles = [];
  let longest = 0;
  for (const fault of faults) {
    const length = Math.max(fault.lengthM || 0, 0);
    longest = Math.max(longest, length);
    const half = Math.min(length / 2, Math.PI * radius);
    const faultStrike = Number.isFinite(fault.strikeDeg) ? fault.strikeDeg : meanStrikeDeg;
    for (const sign of [-1, 1]) {
      const end = half > 0
        ? destinationPoint(fault.lon, fault.lat, faultStrike, sign * half, radius)
        : { lon: fault.lon, lat: fault.lat };
      const vector = unitVector(end.lon, end.lat);
      const dotOrigin = vector[0] * origin[0] + vector[1] * origin[1] + vector[2] * origin[2];
      const dotAlong = vector[0] * along[0] + vector[1] * along[1] + vector[2] * along[2];
      angles.push(Math.atan2(dotAlong, dotOrigin));
    }
  }
  const span = angles.length ? Math.max(...angles) - Math.min(...angles) : 0;
  let extentM = Math.max(radius * span, Math.min(longest, circumference));
  const capped = extentM > circumference;
  extentM = Math.min(extentM, circumference);
  return {
    extentM,
    centroidLon: centroid.lon,
    centroidLat: centroid.lat,
    traceLengthM,
    capped,
    meanStrikeDeg: ((meanStrikeDeg % 360) + 360) % 360,
  };
}

/**
 * Damage from the failed fraction of a zone, healed exponentially.
 * Fresh damage is 1 − exp(−rate × failed/zone). Net damage multiplies by exp(−age/heal).
 */
export function netDamage({ failedLengthM, zoneLengthM, damageRate, ageYears, healYears }) {
  const fraction = zoneLengthM > 0 ? Math.max(0, failedLengthM) / zoneLengthM : 0;
  const fresh = 1 - Math.exp(-Math.max(0, damageRate) * fraction);
  if (!(healYears > 0)) return fresh;
  return fresh * Math.exp(-Math.max(0, ageYears) / healYears);
}

/**
 * Water fraction blends the dry and wet end members.
 * A is interpolated in log space. Friction is multiplied by (1 − w × clayReduction).
 */
export function mixWater(fraction, dry, wet, clayReduction) {
  const w = Math.min(1, Math.max(0, fraction));
  const safeDryA = Math.max(dry.A, 1e-30);
  const safeWetA = Math.max(wet.A, 1e-30);
  return {
    fraction: w,
    A: Math.exp((1 - w) * Math.log(safeDryA) + w * Math.log(safeWetA)),
    n: (1 - w) * dry.n + w * wet.n,
    Q: (1 - w) * dry.Q + w * wet.Q,
    lambda: (1 - w) * dry.lambda + w * wet.lambda,
    frictionFactor: Math.max(0.05, 1 - w * Math.max(0, clayReduction)),
  };
}

/**
 * Force balance per unit length of a candidate plate boundary.
 * Positive buoyancy (lithosphere denser than the mantle) drives subduction.
 * Negative buoyancy resists it. Index ≥ 1 means driving meets the resistance.
 */
export function subductionIndex({
  tharsisCompressionPa,
  basinDrivingPa,
  plumeEnergyJ,
  planetRadiusM,
  lithosphereThicknessM,
  cohesionPa,
  mu,
  lambda,
  damage,
  gravity,
  mantleDensity,
  lithosphereDensity,
}) {
  const h = Math.max(lithosphereThicknessM, 1);
  const intact = Math.max(0, 1 - Math.min(1, Math.max(0, damage)));
  const meanEffective = Math.max(0, 1 - Math.min(0.95, lambda)) * lithosphereDensity * gravity * h * 0.5;
  const strength = (Math.max(0, cohesionPa) + Math.max(0, mu) * meanEffective) * h * intact;
  const contrast = (lithosphereDensity - mantleDensity) * gravity * h * h * 0.5;
  const buoyDrive = Math.max(0, contrast);
  const buoyResist = Math.max(0, -contrast);
  const volume = (4 / 3) * Math.PI * Math.max(planetRadiusM, 1) ** 3;
  const plumePressure = volume > 0 ? Math.max(0, plumeEnergyJ) / volume : 0;
  const plume = plumePressure * h;
  const tharsis = Math.max(0, tharsisCompressionPa) * h;
  const basin = Math.max(0, basinDrivingPa) * h;
  const driving = tharsis + basin + plume + buoyDrive;
  const resisting = strength + buoyResist;
  const index = resisting > 0 ? driving / resisting : driving > 0 ? Infinity : 0;
  return {
    index,
    initiates: index >= 1,
    driving,
    resisting,
    parts: { tharsis, basin, plume, buoyDrive, strength, buoyResist },
  };
}

export function effectiveLithosphereDensity({
  crustDensity,
  crustThicknessM,
  lithosphereThicknessM,
  mantleLithosphereDensity,
  eclogiteFraction,
  eclogiteDensity,
}) {
  const h = Math.max(lithosphereThicknessM, 1);
  const hc = Math.min(Math.max(crustThicknessM, 0), h);
  const fraction = Math.min(1, Math.max(0, eclogiteFraction));
  const crust = (1 - fraction) * crustDensity + fraction * eclogiteDensity;
  return (crust * hc + mantleLithosphereDensity * (h - hc)) / h;
}

/** Present-day elemental heating, scaled by the sheet's early/present crustal-H ratio. */
export function radiogenicPowerW({ uraniumPpb, thoriumPpb, potassiumPpm, massKg, heatRatio, scale }) {
  const perKg =
    uraniumPpb * 1e-9 * HEAT_U_W_PER_KG +
    thoriumPpb * 1e-9 * HEAT_TH_W_PER_KG +
    potassiumPpm * 1e-6 * HEAT_K_W_PER_KG;
  return perKg * Math.max(massKg, 0) * Math.max(heatRatio, 0) * Math.max(scale, 0);
}

export function coreGravityMs2(coreMassKg, coreRadiusM) {
  return (GRAVITATIONAL_CONSTANT * coreMassKg) / Math.max(coreRadiusM, 1) ** 2;
}

/** Conductive heat flux down the core adiabat, q_ad = k α g T / c_p. */
export function adiabaticHeatFluxWm2({ conductivity, expansivity, gravity, temperatureK, specificHeat }) {
  if (!(specificHeat > 0)) return Infinity;
  return (conductivity * expansivity * gravity * temperatureK) / specificHeat;
}

/**
 * Steady CMB power. Heat flow at the base of the crust, minus radiogenic
 * heating in the mantle, minus a secular term (positive secularFraction
 * means the mantle is cooling and supplying part of q_m itself).
 */
export function cmbPowerW({ baseOfCrustPowerW, mantleRadiogenicW, secularFraction }) {
  const secular = secularFraction * baseOfCrustPowerW;
  return baseOfCrustPowerW - mantleRadiogenicW - secular;
}

/**
 * Dipole standoff from pressure balance:
 * R_mp = (μ0 M² / (8 π² P))^(1/6).
 * Returns null when there is no moment or no pressure, so callers can show
 * "n/a (no field)" instead of a standoff of minus the planetary radius.
 */
export function magnetopauseRadiusM(momentAm2, dynamicPressurePa) {
  if (!(momentAm2 > 0) || !(dynamicPressurePa > 0)) return null;
  const numerator = VACUUM_PERMEABILITY * momentAm2 * momentAm2;
  const denominator = 8 * Math.PI * Math.PI * dynamicPressurePa;
  return (numerator / denominator) ** (1 / 6);
}

/**
 * Retention test. The moment must lie past Gunell's cusp-escape peak, and
 * the standoff altitude must clear the upper atmosphere at both pressures.
 */
export function retentionVerdict({
  momentAm2,
  planetRadiusM,
  exobaseAltitudeM,
  nominalPressurePa,
  stormPressurePa,
  gunellPeakMomentAm2,
}) {
  const nominalR = magnetopauseRadiusM(momentAm2, nominalPressurePa);
  const stormR = magnetopauseRadiusM(momentAm2, stormPressurePa);
  const nominalAlt = nominalR == null ? null : nominalR - planetRadiusM;
  const stormAlt = stormR == null ? null : stormR - planetRadiusM;
  const pastPeak = momentAm2 > gunellPeakMomentAm2;
  const nominalClears = nominalAlt != null && nominalAlt >= exobaseAltitudeM;
  const stormClears = stormAlt != null && stormAlt >= exobaseAltitudeM;
  return {
    nominalRadiusM: nominalR,
    stormRadiusM: stormR,
    nominalAltitudeM: nominalAlt,
    stormAltitudeM: stormAlt,
    pastPeak,
    nominalClears,
    stormClears,
    protective: pastPeak && nominalClears && stormClears,
  };
}

/**
 * Mechanical stirring from an impact-driven spin change, and the conductive
 * suppression from heating the top of the core.
 *
 * Angular momentum delivered is coupling × m × v_tangential × R.
 * The core is left with ΔΩ = L / I_mantle. Stirring turns on when |ΔΩ| / Ω
 * exceeds the threshold. Core heating removes a heat flux
 * E_core / (area × diffusion time) while the hot lid diffuses.
 */
export function coreDirectEffects({
  massKg,
  velocityMs,
  angleDeg,
  coupledEnergyJ,
  planetRadiusM,
  planetMassKg,
  coreMassKg,
  coreRadiusM,
  innerRadiusM,
  coreDensity,
  spinCoupling,
  rotationPeriodS,
  moiFactor,
  threshold,
  ohmicFraction,
  dipoleFraction,
  coreHeatFraction,
  heatedLayerM,
  conductivity,
  specificHeat,
  temperatureK,
}) {
  const tangential = velocityMs * Math.cos((Math.min(90, Math.max(0, angleDeg)) * Math.PI) / 180);
  const angularMomentum = Math.max(0, spinCoupling) * massKg * tangential * planetRadiusM;
  const inertiaPlanet = Math.max(moiFactor, 0.05) * planetMassKg * planetRadiusM ** 2;
  const outer = Math.max(coreRadiusM, 1);
  const inner = Math.min(Math.max(innerRadiusM, 0), outer * 0.95);
  const shellFactor = 1 - (inner / outer) ** 5;
  const inertiaCore = 0.4 * coreMassKg * outer ** 2 * Math.max(shellFactor, 1e-6);
  const inertiaMantle = Math.max(inertiaPlanet - inertiaCore, 0.05 * inertiaPlanet);
  const deltaOmega = angularMomentum / inertiaMantle;
  const omega = (2 * Math.PI) / Math.max(rotationPeriodS, 1);
  const ratio = Math.abs(deltaOmega) / omega;
  const stirring = ratio >= threshold && ohmicFraction > 0;
  const kinetic = 0.5 * inertiaCore * deltaOmega ** 2;
  const volume = (4 / 3) * Math.PI * (outer ** 3 - inner ** 3);
  let moment = 0;
  if (stirring && volume > 0 && coreDensity > 0) {
    const energyDensity = (Math.max(0, ohmicFraction) * kinetic) / volume;
    const bField = Math.sqrt(2 * VACUUM_PERMEABILITY * Math.max(energyDensity, 0));
    moment = ((4 * Math.PI) / VACUUM_PERMEABILITY) * bField * outer ** 3 * Math.max(0, dipoleFraction);
  }
  const kappa = conductivity / Math.max(coreDensity * specificHeat, 1e-6);
  const layer = Math.max(heatedLayerM, 1);
  const diffusionS = (layer * layer) / Math.max(kappa, 1e-12);
  const area = 4 * Math.PI * outer ** 2;
  const deposited = Math.max(0, coreHeatFraction) * Math.max(coupledEnergyJ, 0);
  const suppressWm2 = diffusionS > 0 ? deposited / (area * diffusionS) : 0;
  const deltaT = deposited / Math.max(coreDensity * specificHeat * area * layer, 1);
  return {
    angularMomentum,
    deltaOmega,
    omega,
    spinRatio: ratio,
    stirring,
    momentAm2: moment,
    diffusionYears: diffusionS / (365.25 * 24 * 3600),
    suppressWm2,
    deltaT,
    heated: deposited > 0 && temperatureK > 0,
  };
}

/**
 * Thermal dipole moment. β is a dimensionless prefactor (an assumption).
 * Buoyancy flux uses the super-adiabatic CMB heat flux.
 * B = β √(ρ μ0) (F d)^(1/3), with F = α g q_conv / (ρ c_p).
 */
export function thermalMomentAm2({
  beta,
  density,
  expansivity,
  gravity,
  specificHeat,
  qConvWm2,
  coreRadiusM,
  innerRadiusM,
  dipoleFraction,
}) {
  if (!(qConvWm2 > 0) || !(density > 0) || !(specificHeat > 0)) return 0;
  const length = Math.max(coreRadiusM - Math.max(innerRadiusM, 0), 1);
  const buoyancy = (expansivity * gravity * qConvWm2) / (density * specificHeat);
  const bField = Math.max(0, beta) * Math.sqrt(density * VACUUM_PERMEABILITY) * (buoyancy * length) ** (1 / 3);
  return ((4 * Math.PI) / VACUUM_PERMEABILITY) * bField * coreRadiusM ** 3 * Math.max(0, dipoleFraction);
}

export function classifyOutcome({ anySlip, lidBreaks, protective }) {
  if (protective) return "dynamo";
  if (lidBreaks) return "lid";
  if (anySlip) return "slip";
  return "none";
}

function axisEdges(runs, axis) {
  const values = [...new Set(runs.map((run) => run[axis]).filter((value) => Number.isFinite(value)))];
  values.sort((a, b) => a - b);
  return values;
}

function bracket(values, target) {
  if (!values.length) return null;
  if (target <= values[0]) return { lo: values[0], hi: values[0], extrapolated: target < values[0] - Math.abs(values[0]) * 1e-9 };
  if (target >= values[values.length - 1]) {
    const edge = values[values.length - 1];
    return { lo: edge, hi: edge, extrapolated: target > edge + Math.abs(edge) * 1e-9 };
  }
  for (let i = 0; i < values.length - 1; i += 1) {
    if (target >= values[i] && target <= values[i + 1]) {
      return { lo: values[i], hi: values[i + 1], extrapolated: false };
    }
  }
  return null;
}

/**
 * Multilinear interpolation on a rectilinear offline grid.
 * Boolean and regime outputs are returned only when every corner agrees.
 * A disagreement sets thresholdWarning and leaves that output null.
 */
export function interpolateOffline(catalog, query) {
  if (!catalog || !Array.isArray(catalog.runs) || catalog.runs.length === 0) {
    return { available: false, thresholdWarning: false, values: null, extrapolated: false };
  }
  const axes = Array.isArray(catalog.axes) ? catalog.axes : [];
  const brackets = axes.map((axis) => {
    const edges = axisEdges(catalog.runs, axis);
    const target = Number(query?.[axis]);
    return { axis, ...bracket(edges, Number.isFinite(target) ? target : edges[0]) };
  });
  if (brackets.some((item) => !item || item.lo == null)) {
    return { available: true, interpolated: false, thresholdWarning: false, values: null, extrapolated: false, reason: "grid hole" };
  }
  const cornerCount = 2 ** axes.length;
  const corners = [];
  for (let mask = 0; mask < cornerCount; mask += 1) {
    const wanted = {};
    axes.forEach((axis, index) => {
      const edge = brackets[index];
      wanted[axis] = mask & (1 << index) ? edge.hi : edge.lo;
    });
    const found = catalog.runs.find((run) => axes.every((axis) => run[axis] === wanted[axis]));
    if (!found) {
      return { available: true, interpolated: false, thresholdWarning: false, values: null, extrapolated: false, reason: "missing corner" };
    }
    corners.push({ wanted, run: found, mask });
  }
  const weights = corners.map((corner) => {
    let weight = 1;
    axes.forEach((axis, index) => {
      const edge = brackets[index];
      const span = edge.hi - edge.lo;
      const t = span === 0 ? 0 : (Number(query[axis]) - edge.lo) / span;
      const onHi = corner.mask & (1 << index);
      weight *= onHi ? t : 1 - t;
    });
    return weight;
  });
  const outputs = catalog.outputs || Object.keys(corners[0].run).filter((key) => !axes.includes(key));
  const values = {};
  let thresholdWarning = false;
  for (const key of outputs) {
    const samples = corners.map((corner) => corner.run[key]);
    const categorical = samples.some((value) => typeof value === "boolean" || typeof value === "string");
    if (categorical) {
      const agreed = samples.every((value) => value === samples[0]);
      if (agreed) values[key] = samples[0];
      else {
        values[key] = null;
        thresholdWarning = true;
      }
    } else if (samples.every((value) => value == null)) {
      values[key] = null;
    } else {
      values[key] = samples.reduce((sum, value, index) => sum + (Number(value) || 0) * weights[index], 0);
    }
  }
  return {
    available: true,
    interpolated: true,
    example: Boolean(catalog.example),
    label: catalog.label || "",
    thresholdWarning,
    extrapolated: brackets.some((item) => item.extrapolated),
    values,
  };
}
