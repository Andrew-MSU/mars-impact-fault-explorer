/**
 * First-order Mars impact and Coulomb-stress functions.
 *
 * Units are SI unless a function name says otherwise. Angles that enter
 * trigonometric functions are converted from degrees at the boundary.
 * Compression is positive in stress tensors. The Coulomb normal-stress
 * change returned to callers is unclamping-positive, so
 * ΔCFS = Δτ + μ Δσ_n matches King, Stein & Lin (1994).
 *
 * The equations and the assumptions behind them are written out in MODEL.md.
 */

export const MARS_GRAVITY = 3.71;
export const MARS_RADIUS_M = 3_396_190;
export const GAS_CONSTANT = 8.314462618;
/**
 * Deepest depth at which a fault is tested.
 * With the Moho cap on, that is the shallower of the BDT and the crust.
 * With the cap off, faults are tested down to the BDT even where that is below the Moho.
 */
export function brittleDepthLimitM({ bdtM, crustM, capAtMoho = true }) {
  const bdt = Math.max(bdtM, 1);
  if (!capAtMoho) return bdt;
  return Math.min(bdt, Math.max(crustM, 1));
}

/**
 * Depths from the surface to `limitM`, including the limit itself.
 * The last sample sits on the limit so a failure that reaches the BDT is not
 * missed by a midpoint that stops short of it. `dz` is the bin thickness used for area.
 */
export function depthSampleZs(limitM, steps) {
  const n = Math.max(2, Math.round(steps) || 2);
  const limit = Math.max(limitM, 1);
  const dz = limit / n;
  const zs = [];
  for (let step = 0; step < n; step += 1) {
    zs.push(step === n - 1 ? limit : (step + 0.5) * dz);
  }
  return { zs, dz, limit, steps: n };
}

/** Rim diameter of the simple-to-complex transition used for Mars. */
export const SIMPLE_COMPLEX_MARS_M = 7000;
/** A fault this close to the failure envelope, as a fraction of strength, is "near failure". */
export const NEAR_FAILURE_FRACTION = 0.05;
/** Peak ground velocity is capped so the far-field pulse cannot exceed this fraction of Vs. */
export const PGV_CAP_FRACTION = 0.05;

const TRANSIENT_CRATER_PREFACTOR = 1.161;

export function impactorMassKg(diameterM, densityKgM3) {
  const radius = diameterM / 2;
  return (4 / 3) * Math.PI * radius ** 3 * densityKgM3;
}

export function kineticEnergyJ(massKg, velocityMs) {
  return 0.5 * massKg * velocityMs * velocityMs;
}

/** θ is the impact angle from horizontal. A vertical impact has θ = 90°. */
export function coupledEnergyJ(kineticJ, angleFromHorizontalDeg) {
  const theta = (angleFromHorizontalDeg * Math.PI) / 180;
  return kineticJ * Math.sin(theta);
}

export function seismicEnergyJ(coupledJ, efficiency) {
  return efficiency * coupledJ;
}

/** Kanamori (1977): log10(E_s in joules) = 1.5 Mw + 4.8. */
export function momentMagnitude(energyJ) {
  if (!(energyJ > 0)) return -Infinity;
  return (Math.log10(energyJ) - 4.8) / 1.5;
}

export function shearModulusPa(youngsPa, poisson) {
  return youngsPa / (2 * (1 + poisson));
}

export function shearVelocityMs(shearModulus, densityKgM3) {
  return Math.sqrt(shearModulus / densityKgM3);
}

export function seismicMomentNm(energyJ, shearModulus, stressDropPa) {
  return (2 * shearModulus * energyJ) / stressDropPa;
}

/**
 * Transient crater diameter, gravity regime.
 * Collins, Melosh & Marcus (2005), after Holsapple pi-group scaling.
 * D, v, g in m, m/s, m/s². θ from horizontal.
 */
export function transientCraterDiameterM({
  diameterM,
  velocityMs,
  densityImpactor,
  densityTarget,
  gravity,
  angleDeg,
}) {
  const theta = (Math.min(90, Math.max(0.5, angleDeg)) * Math.PI) / 180;
  return (
    TRANSIENT_CRATER_PREFACTOR *
    (densityImpactor / densityTarget) ** (1 / 3) *
    diameterM ** 0.78 *
    velocityMs ** 0.44 *
    gravity ** -0.22 *
    Math.sin(theta) ** (1 / 3)
  );
}

/** Simple crater 1.25 D_tc; complex crater uses the Croft/Collins enlargement. */
export function finalCraterDiameterM(transientM, simpleComplexM = SIMPLE_COMPLEX_MARS_M) {
  const simple = 1.25 * transientM;
  if (simple < simpleComplexM) return simple;
  return (1.17 * transientM ** 1.13) / simpleComplexM ** 0.13;
}

/** Paraboloid cavity with depth D_tc / 3. Volume = π D² d / 8. */
export function transientCavityVolumeM3(transientDiameterM) {
  const depth = transientDiameterM / 3;
  return (Math.PI * transientDiameterM * transientDiameterM * depth) / 8;
}

/**
 * Steady geotherm. z = 0 is the surface. Crustal heat production is uniform
 * from 0 to crustM and zero below. qMantle is the heat flux into the base
 * of the crust (W/m²), H is volumetric heat production (W/m³).
 */
export function temperatureK(depthM, { surfaceK, mantleFlux, heatProduction, conductivity, crustM }) {
  const z = Math.max(0, depthM);
  const crust = Math.max(crustM, 1);
  const k = conductivity;
  const temperatureAt = (zz) =>
    surfaceK +
    (mantleFlux * zz) / k +
    (heatProduction / (2 * k)) * zz * (2 * crust - zz);
  if (z <= crust) return temperatureAt(z);
  return temperatureAt(crust) + (mantleFlux / k) * (z - crust);
}

/**
 * Dislocation-creep effective viscosity.
 * ε̇ = A σ^n exp(−Q/RT), with σ in MPa and A in MPa^−n s^−1.
 * η = σ / (2 ε̇). Returns Pa·s, or Infinity when the rate underflows.
 */
export function effectiveViscosityPaS({ stressDiffPa, temperatureK: tempK, prefactorA, exponentN, activationJmol }) {
  if (!(tempK > 0) || !(prefactorA > 0) || !(exponentN > 0)) return Infinity;
  const sigmaPa = Math.max(stressDiffPa, 1e5);
  const sigmaMPa = sigmaPa / 1e6;
  const exponent = -activationJmol / (GAS_CONSTANT * tempK);
  if (exponent < -700) return Infinity;
  const rate = prefactorA * sigmaMPa ** exponentN * Math.exp(exponent);
  if (!(rate > 0) || !Number.isFinite(rate)) return Infinity;
  return sigmaPa / (2 * rate);
}

export function maxwellTimeS(viscosityPaS, shearModulus) {
  if (!Number.isFinite(viscosityPaS) || !(shearModulus > 0)) return Infinity;
  return viscosityPaS / shearModulus;
}

/**
 * Andersonian total stresses and the Coulomb stress on one fault.
 * criticality = 1 puts an optimally oriented fault on the failure envelope.
 * criticality = 0 is lithostatic (no shear). Pore pressure is λ σ_v.
 * regime "normal": σ_v is σ1. regime "thrust": σ_v is σ3.
 * CFS = τ_rake − (C + μ σ_n'), negative when stable.
 */
export function backgroundOnFault({
  depthM,
  density,
  gravity,
  phiDeg,
  cohesionPa,
  lambda,
  criticality,
  regime,
  dipDeg,
  kinematics,
  muScale = 1,
}) {
  const depth = Math.max(depthM, 0);
  const sigmaV = density * gravity * depth;
  const pore = Math.min(0.95, Math.max(0, lambda)) * sigmaV;
  const sigmaVeff = Math.max(0, sigmaV - pore);
  const phi = (phiDeg * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const k = (1 + sinPhi) / (1 - sinPhi);
  const mu = Math.tan(phi) * (Number.isFinite(muScale) ? muScale : 1);
  const chi = Math.min(1, Math.max(0, criticality));
  const cohesion = Math.max(0, cohesionPa);
  let sigmaHeff;
  if (regime === "thrust") {
    const sigma3 = sigmaVeff;
    const sigma1crit = k * sigma3 + 2 * cohesion * Math.sqrt(k);
    sigmaHeff = sigma3 + chi * (sigma1crit - sigma3);
  } else {
    const sigma1 = sigmaVeff;
    const sigma3crit = (sigma1 - 2 * cohesion * Math.sqrt(k)) / k;
    const sigma3floor = Math.max(0, sigma3crit);
    sigmaHeff = sigma1 - chi * (sigma1 - sigma3floor);
  }
  const sigmaH = sigmaHeff + pore;
  const dip = (dipDeg * Math.PI) / 180;
  const s = Math.sin(dip);
  const c = Math.cos(dip);
  const sigmaN = sigmaH * s * s + sigmaV * c * c;
  const sigmaNeff = sigmaN - pore;
  const tauNormalSense = (sigmaV - sigmaH) * s * c;
  const tau = kinematics === "thrust" ? -tauNormalSense : tauNormalSense;
  const strength = cohesion + mu * Math.max(sigmaNeff, 0);
  return {
    sigmaV,
    sigmaH,
    porePressure: pore,
    sigmaN,
    sigmaNeff,
    tau,
    strength,
    cfs: tau - strength,
    mu,
    frictionK: k,
    differentialPa: Math.abs(sigmaVeff - sigmaHeff),
  };
}

/**
 * Boussinesq stresses under a vertical point load on a half-space.
 * z is positive downward, P is positive downward, compression is positive.
 * ν is Poisson's ratio. r and z are meters.
 */
export function boussinesq({ forceDownN, radiusM, depthM, poisson }) {
  const z = Math.max(depthM, 1);
  const r = Math.max(radiusM, 0);
  const radius = Math.hypot(r, z);
  const r2 = radius * radius;
  const r3 = r2 * radius;
  const r5 = r3 * r2;
  const coeff = forceDownN / (2 * Math.PI);
  const oneMinus2v = 1 - 2 * poisson;
  return {
    sigmaR: coeff * ((3 * z * r * r) / r5 - oneMinus2v / (radius * (radius + z))),
    sigmaTheta: coeff * oneMinus2v * (1 / (radius * (radius + z)) - z / r3),
    sigmaZ: (3 * forceDownN * z * z * z) / (2 * Math.PI * r5),
    tauRZ: (3 * forceDownN * r * z * z) / (2 * Math.PI * r5),
  };
}

/**
 * Rotate cylindrical Boussinesq stresses into a local east-north-up frame.
 * `east` and `north` are the horizontal unit vector from the load toward
 * the sample. The returned matrix is compression-positive, components
 * [east, north, up].
 */
export function tensorFromCylindrical({ sigmaR, sigmaTheta, sigmaZ, tauRZ, east, north }) {
  let erx = east;
  let ery = north;
  const norm = Math.hypot(erx, ery);
  if (norm < 1e-12) {
    erx = 1;
    ery = 0;
  } else {
    erx /= norm;
    ery /= norm;
  }
  // êr, êθ, ê_down. êr × êθ = down = −up.
  const basis = [
    [erx, ery, 0],
    [ery, -erx, 0],
    [0, 0, -1],
  ];
  const local = [
    [sigmaR, 0, tauRZ],
    [0, sigmaTheta, 0],
    [tauRZ, 0, sigmaZ],
  ];
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        for (let l = 0; l < 3; l += 1) {
          sum += basis[k][i] * local[k][l] * basis[l][j];
        }
      }
      out[i][j] = sum;
    }
  }
  return out;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function matVec(matrix, vector) {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

/**
 * Resolve a compression-positive ENU stress change onto a dipping fault.
 * dipAzimuthDeg is the compass direction of steepest descent (clockwise
 * from north). kinematics selects the rake: normal is down-dip, thrust is
 * up-dip. Δσ_n is unclamping-positive.
 */
export function deltaCfsFromCompressionTensor(sigmaComp, { dipDeg, dipAzimuthDeg, kinematics, mu }) {
  const dip = (dipDeg * Math.PI) / 180;
  const azimuth = (dipAzimuthDeg * Math.PI) / 180;
  const east = Math.sin(azimuth);
  const north = Math.cos(azimuth);
  const normal = [Math.sin(dip) * east, Math.sin(dip) * north, Math.cos(dip)];
  const tension = sigmaComp.map((row) => row.map((value) => -value));
  const traction = matVec(tension, normal);
  const sigmaN = dot(normal, traction);
  const shear = [
    traction[0] - sigmaN * normal[0],
    traction[1] - sigmaN * normal[1],
    traction[2] - sigmaN * normal[2],
  ];
  const downDip = [Math.cos(dip) * east, Math.cos(dip) * north, -Math.sin(dip)];
  const slip = kinematics === "thrust" ? downDip.map((value) => -value) : downDip;
  const deltaTau = dot(shear, slip);
  return {
    deltaTau,
    deltaSigmaNUnclamp: sigmaN,
    deltaCfs: deltaTau + mu * sigmaN,
  };
}

export function peakGroundVelocityMs({
  seismicEnergy,
  density,
  shearVelocity,
  durationS,
  distanceM,
  qualityFactor,
}) {
  const distance = Math.max(distanceM, 1);
  const duration = Math.max(durationS, 1e-3);
  const rms = Math.sqrt(
    seismicEnergy / (2 * Math.PI * distance * distance * density * shearVelocity * duration),
  );
  const frequency = 1 / duration;
  const attenuation = Math.exp(
    (-Math.PI * frequency * distance) / (qualityFactor * shearVelocity),
  );
  const peak = Math.SQRT2 * rms * attenuation;
  return Math.min(PGV_CAP_FRACTION * shearVelocity, peak);
}

export function dynamicStressPa(pgv, density, shearVelocity) {
  return density * shearVelocity * pgv;
}

/** True when the sample sits inside the idealized excavation cavity. */
export function insideExcavation({ horizontalM, depthM, finalDiameterM, transientDiameterM }) {
  const depthLimit = transientDiameterM / 3;
  if (!(depthLimit > 0) || depthM >= depthLimit) return false;
  const radius = (finalDiameterM / 2) * Math.sqrt(Math.max(0, 1 - depthM / depthLimit));
  return horizontalM < radius;
}

export function haversineM(lon1, lat1, lon2, lat2, radius = MARS_RADIUS_M) {
  const lat1r = (lat1 * Math.PI) / 180;
  const lat2r = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Azimuth clockwise from north, in degrees. */
export function azimuthDeg(lon1, lat1, lon2, lat2) {
  const lat1r = (lat1 * Math.PI) / 180;
  const lat2r = (lat2 * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x =
    Math.cos(lat1r) * Math.sin(lat2r) -
    Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function destinationPoint(lon, lat, azimuth, distanceM, radius = MARS_RADIUS_M) {
  const angular = distanceM / radius;
  const bearing = (azimuth * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  let lonDeg = (lon2 * 180) / Math.PI;
  lonDeg = ((lonDeg + 540) % 360) - 180;
  return { lon: lonDeg, lat: (lat2 * 180) / Math.PI };
}

export function logSpace(min, max, count) {
  const start = Math.log(min);
  const end = Math.log(max);
  const values = [];
  const steps = Math.max(1, count - 1);
  for (let i = 0; i < count; i += 1) {
    values.push(Math.exp(start + ((end - start) * i) / steps));
  }
  return values;
}

export function failureStatus(cfs, strength, excavated) {
  if (excavated) return "excavated";
  if (cfs >= 0) return "reactivated";
  if (cfs >= -NEAR_FAILURE_FRACTION * Math.max(strength, 1)) return "near";
  return "stable";
}
