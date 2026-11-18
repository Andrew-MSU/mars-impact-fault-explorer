/**
 * Wires the pure physics functions to a fault set and an impact.
 * Geometry, background stress, temperature, and viscosity are built once.
 * Impact size, velocity, and location can then be changed without
 * rebuilding that grid.
 */

import {
  MARS_GRAVITY,
  MARS_RADIUS_M,
  azimuthDeg,
  backgroundOnFault,
  boussinesq,
  coupledEnergyJ,
  deltaCfsFromCompressionTensor,
  destinationPoint,
  dynamicStressPa,
  effectiveViscosityPaS,
  failureStatus,
  finalCraterDiameterM,
  haversineM,
  impactorMassKg,
  insideExcavation,
  kineticEnergyJ,
  maxwellTimeS,
  momentMagnitude,
  peakGroundVelocityMs,
  seismicEnergyJ,
  seismicMomentNm,
  shearModulusPa,
  shearVelocityMs,
  temperatureK,
  tensorFromCylindrical,
  transientCavityVolumeM3,
  transientCraterDiameterM,
} from "./physics.js";
import { resolveDipAzimuth } from "./dips.js";

const YEAR_S = 365.25 * 24 * 3600;
/** Fault area inside this distance is the "nearby" fraction drawn on the sweep. */
export const LOCAL_RADIUS_M = 250_000;

function resampleCoords(coordinates, spacingM) {
  if (coordinates.length < 2) return coordinates.map((pair) => [...pair]);
  const points = [[coordinates[0][0], coordinates[0][1]]];
  let carried = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const [lon0, lat0] = coordinates[i - 1];
    const [lon1, lat1] = coordinates[i];
    const length = haversineM(lon0, lat0, lon1, lat1);
    if (length < 1) continue;
    const bearing = azimuthDeg(lon0, lat0, lon1, lat1);
    let traveled = spacingM - carried;
    while (traveled < length) {
      const next = destinationPoint(lon0, lat0, bearing, traveled);
      points.push([next.lon, next.lat]);
      traveled += spacingM;
    }
    carried = length - (traveled - spacingM);
    points.push([lon1, lat1]);
    void bearing;
  }
  return points;
}

function faultSegments(fault, index, spacingM) {
  const coords = resampleCoords(fault.coordinates, spacingM);
  const segments = [];
  for (let i = 1; i < coords.length; i += 1) {
    const [lon0, lat0] = coords[i - 1];
    const [lon1, lat1] = coords[i];
    const lengthM = haversineM(lon0, lat0, lon1, lat1);
    if (lengthM < 100) continue;
    const strike = azimuthDeg(lon0, lat0, lon1, lat1);
    const fitted = resolveDipAzimuth({
      strikeDeg: strike,
      regionId: fault.regionId,
      source: fault.dipSource,
      kinematics: fault.kinematics,
      explicitAzimuthDeg: fault.dipAzimuthDeg,
    });
    segments.push({
      faultId: fault.id,
      faultName: fault.name,
      faultIndex: index,
      kinematics: fault.kinematics,
      lon0,
      lat0,
      lon1,
      lat1,
      midLon: (lon0 + lon1) / 2,
      midLat: (lat0 + lat1) / 2,
      lengthM,
      dipDeg: fault.dipDeg,
      dipAzimuthDeg: fitted.dipAzimuthDeg,
      dipAzimuthSource: fitted.source,
      dipAzimuthWallId: fitted.wallId,
    });
  }
  return segments;
}

/**
 * Background state along each fault segment. Independent of the impact.
 */
export function prepareGrid(spec) {
  const spacingM = spec.sampling?.spacingM ?? 20_000;
  const depthSteps = spec.sampling?.depthSteps ?? 12;
  const bdtM = spec.thermal.bdtM;
  const dz = bdtM / depthSteps;
  const mu = shearModulusPa(spec.material.youngsPa, spec.material.poisson);
  const segments = [];
  spec.faults.forEach((fault, index) => {
    const piece = Math.max(spacingM, faultLength(fault) / 28);
    for (const segment of faultSegments(fault, index, piece)) {
      const depths = [];
      for (let step = 0; step < depthSteps; step += 1) {
        const z = (step + 0.5) * dz;
        const background = backgroundOnFault({
          depthM: z,
          density: spec.material.density,
          gravity: spec.material.gravity,
          phiDeg: spec.material.phiDeg,
          cohesionPa: spec.material.cohesionPa,
          lambda: spec.material.lambda,
          criticality: spec.material.criticality,
          regime: spec.material.regime,
          dipDeg: segment.dipDeg,
          kinematics: segment.kinematics,
        });
        const temperature = temperatureK(z, {
          surfaceK: spec.thermal.surfaceK,
          mantleFlux: spec.thermal.mantleFlux,
          heatProduction: spec.thermal.heatProduction,
          conductivity: spec.thermal.conductivity,
          crustM: spec.thermal.crustM,
        });
        const eta =
          spec.creep.mode === "reference_viscosity"
            ? spec.creep.eta0
            : effectiveViscosityPaS({
                stressDiffPa: background.differentialPa,
                temperatureK: temperature,
                prefactorA: spec.creep.prefactorA,
                exponentN: spec.creep.exponentN,
                activationJmol: spec.creep.activationJmol,
              });
        depths.push({
          z,
          dz,
          area: (segment.lengthM * dz) / Math.sin((segment.dipDeg * Math.PI) / 180),
          cfsBg: background.cfs,
          strength: background.strength,
          sigmaNeff: background.sigmaNeff,
          differentialPa: background.differentialPa,
          temperature,
          eta,
          tMaxwell: maxwellTimeS(eta, mu),
        });
      }
      segments.push({ ...segment, depths });
    }
  });
  return {
    segments,
    mu,
    vs: shearVelocityMs(mu, spec.material.density),
    bdtM,
    crustM: spec.thermal.crustM,
    regime: spec.material.regime,
  };
}

function faultLength(fault) {
  let total = 0;
  for (let i = 1; i < fault.coordinates.length; i += 1) {
    total += haversineM(
      fault.coordinates[i - 1][0],
      fault.coordinates[i - 1][1],
      fault.coordinates[i][0],
      fault.coordinates[i][1],
    );
  }
  return total;
}

function sourceTerms(impact, material) {
  const mass = impactorMassKg(impact.diameterM, impact.densityImpactor);
  const kinetic = kineticEnergyJ(mass, impact.velocityMs);
  const coupled = coupledEnergyJ(kinetic, impact.angleDeg);
  const seismic = seismicEnergyJ(coupled, impact.efficiency);
  const magnitude = momentMagnitude(seismic);
  const transient = transientCraterDiameterM({
    diameterM: impact.diameterM,
    velocityMs: impact.velocityMs,
    densityImpactor: impact.densityImpactor,
    densityTarget: material.density,
    gravity: material.gravity,
    angleDeg: impact.angleDeg,
  });
  const finalD = finalCraterDiameterM(transient);
  const volume = transientCavityVolumeM3(transient);
  const forceDown = -impact.excavationFraction * material.density * volume * material.gravity;
  return {
    massKg: mass,
    kineticJ: kinetic,
    coupledJ: coupled,
    seismicJ: seismic,
    magnitude,
    momentNm: seismicMomentNm(seismic, material.shearModulus, impact.stressDropPa),
    transientM: transient,
    finalM: finalD,
    volumeM3: volume,
    forceDownN: forceDown,
    durationS: Math.sqrt(Math.max(transient, 1) / material.gravity),
  };
}

function emptyTotals() {
  return { area: 0, immediate: 0, staticOnly: 0, near: 0 };
}

function addArea(bucket, area, status, staticFailed) {
  bucket.area += area;
  if (status === "reactivated" || status === "excavated") bucket.immediate += area;
  if (staticFailed || status === "excavated") bucket.staticOnly += area;
  if (status === "near") bucket.near += area;
}

/**
 * Apply one impact to a prepared grid.
 * `material` must include density, gravity, poisson, youngsPa, and shearModulus
 * (shearModulus is filled in by buildMaterial if missing).
 */
export function runImpact(grid, impact, material) {
  const source = sourceTerms(impact, {
    ...material,
    shearModulus: material.shearModulus ?? grid.mu,
  });
  const rim = Math.max(source.finalM / 2, 1000);
  const all = emptyTotals();
  const regime = emptyTotals();
  const local = emptyTotals();
  const byFault = new Map();
  let critical = null;
  const samples = [];

  for (const segment of grid.segments) {
    const distance = haversineM(impact.lon, impact.lat, segment.midLon, segment.midLat);
    const bearing = azimuthDeg(impact.lon, impact.lat, segment.midLon, segment.midLat);
    const east = Math.sin((bearing * Math.PI) / 180);
    const north = Math.cos((bearing * Math.PI) / 180);
    const evalR = Math.max(distance, rim);
    let fault = byFault.get(segment.faultId);
    if (!fault) {
      fault = {
        id: segment.faultId,
        name: segment.faultName,
        kinematics: segment.kinematics,
        lengthM: 0,
        minDistanceM: Infinity,
        immediateArea: 0,
        staticArea: 0,
        nearArea: 0,
        area: 0,
        maxCfs: -Infinity,
        maxStaticCfs: -Infinity,
        failedDepthMin: null,
        failedDepthMax: null,
        closestProfile: null,
        closestDistance: Infinity,
      };
      byFault.set(segment.faultId, fault);
    }
    fault.lengthM += segment.lengthM;
    fault.minDistanceM = Math.min(fault.minDistanceM, distance);
    const profile = [];
    let segmentMax = -Infinity;

    for (const depth of segment.depths) {
      const load = boussinesq({
        forceDownN: source.forceDownN,
        radiusM: evalR,
        depthM: depth.z,
        poisson: material.poisson,
      });
      const tensor = tensorFromCylindrical({ ...load, east, north });
      const resolved = deltaCfsFromCompressionTensor(tensor, {
        dipDeg: segment.dipDeg,
        dipAzimuthDeg: segment.dipAzimuthDeg,
        kinematics: segment.kinematics,
        mu: Math.tan((material.phiDeg * Math.PI) / 180),
      });
      const pgv = peakGroundVelocityMs({
        seismicEnergy: source.seismicJ,
        density: material.density,
        shearVelocity: grid.vs,
        durationS: source.durationS,
        distanceM: evalR,
        qualityFactor: impact.qualityFactor,
      });
      const dDynamic = dynamicStressPa(pgv, material.density, grid.vs);
      const excavated = insideExcavation({
        horizontalM: distance,
        depthM: depth.z,
        finalDiameterM: source.finalM,
        transientDiameterM: source.transientM,
      });
      const cfsStatic = depth.cfsBg + resolved.deltaCfs;
      const cfs = cfsStatic + dDynamic;
      const status = failureStatus(cfs, depth.strength, excavated);
      const staticFailed = depth.cfsBg + resolved.deltaCfs >= 0;
      addArea(all, depth.area, status, staticFailed);
      if (segment.kinematics === grid.regime) {
        addArea(regime, depth.area, status, staticFailed);
        if (distance <= LOCAL_RADIUS_M) addArea(local, depth.area, status, staticFailed);
      }
      fault.area += depth.area;
      if (status === "reactivated" || status === "excavated") {
        fault.immediateArea += depth.area;
        fault.failedDepthMin = fault.failedDepthMin == null ? depth.z : Math.min(fault.failedDepthMin, depth.z);
        fault.failedDepthMax = fault.failedDepthMax == null ? depth.z : Math.max(fault.failedDepthMax, depth.z);
      }
      if (staticFailed || status === "excavated") fault.staticArea += depth.area;
      if (status === "near") fault.nearArea += depth.area;
      fault.maxCfs = Math.max(fault.maxCfs, cfs);
      fault.maxStaticCfs = Math.max(fault.maxStaticCfs, cfsStatic);
      segmentMax = Math.max(segmentMax, cfs);
      const row = {
        z: depth.z,
        area: depth.area,
        cfsBg: depth.cfsBg,
        dStatic: resolved.deltaCfs,
        dDynamic,
        deltaTau: resolved.deltaTau,
        deltaSigmaNUnclamp: resolved.deltaSigmaNUnclamp,
        cfs,
        status,
        strength: depth.strength,
        temperature: depth.temperature,
        eta: depth.eta,
        tMaxwell: depth.tMaxwell,
        excavated,
      };
      profile.push(row);
      samples.push({
        area: depth.area,
        kinematics: segment.kinematics,
        local: distance <= LOCAL_RADIUS_M,
        cfsBg: depth.cfsBg,
        dStatic: resolved.deltaCfs,
        dDynamic,
        tMaxwell: depth.tMaxwell,
        excavated,
        strength: depth.strength,
      });
      if (segment.kinematics === grid.regime && !excavated) {
        if (!critical || cfsStatic > critical.cfsStatic) {
          critical = {
            faultId: segment.faultId,
            faultName: segment.faultName,
            lon: segment.midLon,
            lat: segment.midLat,
            z: depth.z,
            cfsBg: depth.cfsBg,
            dStatic: resolved.deltaCfs,
            dDynamic,
            cfsStatic,
            cfs,
            temperature: depth.temperature,
            eta: depth.eta,
            tMaxwell: depth.tMaxwell,
            distanceM: distance,
          };
        }
      }
    }
    if (distance < fault.closestDistance) {
      fault.closestDistance = distance;
      fault.closestProfile = profile;
    }
    segment.display = { distance, profile, maxCfs: segmentMax };
  }

  const faults = [...byFault.values()]
    .map((fault) => ({
      ...fault,
      fraction: fractionOf(fault.immediateArea, fault.area),
      fractionStatic: fractionOf(fault.staticArea, fault.area),
      fractionNear: fractionOf(fault.nearArea, fault.area),
    }))
    .sort((a, b) => b.maxCfs - a.maxCfs);

  return {
    source,
    faults,
    samples,
    fractionAll: fractionOf(all.immediate, all.area),
    fractionAllStatic: fractionOf(all.staticOnly, all.area),
    fractionRegime: fractionOf(regime.immediate, regime.area),
    fractionRegimeStatic: fractionOf(regime.staticOnly, regime.area),
    fractionRegimeNear: fractionOf(regime.near, regime.area),
    fractionLocal: fractionOf(local.immediate, local.area),
    fractionLocalStatic: fractionOf(local.staticOnly, local.area),
    localRadiusM: LOCAL_RADIUS_M,
    regimeArea: regime.area,
    allArea: all.area,
    critical,
    grid,
  };
}

function fractionOf(part, total) {
  if (!(total > 0)) return null;
  return part / total;
}

export function repeatedImpacts(samples, { intervalYears, count, regime }) {
  const chosen = samples.filter((sample) => sample.kinematics === regime);
  const dt = intervalYears * YEAR_S;
  const state = chosen.map((sample) => ({
    sample,
    accumulated: 0,
    decay: Number.isFinite(sample.tMaxwell) && sample.tMaxwell > 0
      ? Math.exp(-dt / sample.tMaxwell)
      : 1,
  }));
  const area = chosen.reduce((sum, sample) => sum + sample.area, 0);
  const points = [];
  let onsetImmediate = null;
  let onsetSustained = null;
  for (let event = 0; event < count; event += 1) {
    let atImpact = 0;
    let between = 0;
    for (const item of state) {
      item.accumulated += item.sample.dStatic;
      const spiked = item.sample.cfsBg + item.accumulated + item.sample.dDynamic;
      const sustained = item.sample.cfsBg + item.accumulated;
      if (item.sample.excavated || spiked >= 0) atImpact += item.sample.area;
      if (item.sample.excavated || sustained >= 0) between += item.sample.area;
      item.accumulated *= item.decay;
    }
    const tYears = event * intervalYears;
    const fractionAtImpact = area > 0 ? atImpact / area : null;
    const fractionSustained = area > 0 ? between / area : null;
    points.push({ tYears, fractionAtImpact, fractionSustained });
    if (onsetImmediate == null && fractionAtImpact > 0) onsetImmediate = tYears;
    if (onsetSustained == null && fractionSustained > 0) onsetSustained = tYears;
  }
  return { points, onsetImmediateYears: onsetImmediate, onsetSustainedYears: onsetSustained, area };
}

/** CFS history at one sample, including the post-impact spike and the relaxed value. */
export function stressHistory({ cfsBg, dStatic, dDynamic, tMaxwell, intervalYears, count }) {
  const dt = intervalYears * YEAR_S;
  const decay = Number.isFinite(tMaxwell) && tMaxwell > 0 ? Math.exp(-dt / tMaxwell) : 1;
  let accumulated = 0;
  const points = [];
  let crossed = null;
  for (let event = 0; event < count; event += 1) {
    accumulated += dStatic;
    const tYears = event * intervalYears;
    const cfsStatic = cfsBg + accumulated;
    const cfsTotal = cfsStatic + dDynamic;
    points.push({ tYears, phase: "impact", cfsStatic, cfsTotal, accumulated });
    if (crossed == null && cfsTotal >= 0) crossed = tYears;
    accumulated *= decay;
    points.push({
      tYears: tYears + intervalYears * (count === 1 ? 1 : 0.999),
      phase: "relaxed",
      cfsStatic: cfsBg + accumulated,
      cfsTotal: cfsBg + accumulated,
      accumulated,
    });
  }
  return { points, crossedYears: crossed };
}

export function sweepDiameters(grid, impact, material, diameters) {
  return diameters.map((diameterM) => {
    const result = runImpact(grid, { ...impact, diameterM }, material);
    return {
      diameterM,
      coupledJ: result.source.coupledJ,
      seismicJ: result.source.seismicJ,
      magnitude: result.source.magnitude,
      finalCraterM: result.source.finalM,
      fractionRegime: result.fractionRegime,
      fractionRegimeStatic: result.fractionRegimeStatic,
      fractionLocal: result.fractionLocal,
      fractionLocalStatic: result.fractionLocalStatic,
      fractionAll: result.fractionAll,
    };
  });
}

export function onsetDiameter(rows, key = "fractionRegime") {
  const hit = rows.find((row) => row[key] > 0);
  return hit ? hit.diameterM : null;
}

export { MARS_GRAVITY, MARS_RADIUS_M, YEAR_S };
