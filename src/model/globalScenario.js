/**
 * One global impact: shell stress, network ΔCFS, cascade, weak zone,
 * subduction index, and the two dynamo pathways.
 *
 * Fault geometry is prepared once. Sliders are passed in `p` on every call.
 */

import basinsFile from "../../data/basins.json" with { type: "json" };
import {
  MARS_GRAVITY,
  MARS_RADIUS_M,
  azimuthDeg,
  backgroundOnFault,
  brittleDepthLimitM,
  boussinesq,
  coupledEnergyJ,
  deltaCfsFromCompressionTensor,
  depthSampleZs,
  dynamicStressPa,
  effectiveViscosityPaS,
  finalCraterDiameterM,
  haversineM,
  impactorMassKg,
  insideExcavation,
  kineticEnergyJ,
  momentMagnitude,
  peakGroundVelocityMs,
  seismicEnergyJ,
  shearModulusPa,
  shearVelocityMs,
  temperatureK,
  tensorFromCylindrical,
  transientCavityVolumeM3,
  transientCraterDiameterM,
} from "./physics.js";
import {
  addTensors,
  adiabaticHeatFluxWm2,
  alongStrikeExtentM,
  angularSeparationDeg,
  antipodalGain,
  antipode,
  capLoadStress,
  classifyOutcome,
  cmbPowerW,
  coreDirectEffects,
  coreGravityMs2,
  effectiveLithosphereDensity,
  horizontalPrincipalTensor,
  netDamage,
  radiogenicPowerW,
  retentionVerdict,
  shellDeltaCfs,
  strikeAlignment,
  subductionIndex,
  thermalMomentAm2,
  transferredDeltaCfs,
} from "./globalPhysics.js";

export const BASINS = basinsFile.basins;
const VM = { west: -108, east: -42, south: -18, north: 2 };
const YEAR_S = 365.25 * 24 * 3600;
const ZERO = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

export function prepareFaults(features) {
  const faults = [];
  for (const feature of features || []) {
    const coords = feature?.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    let lengthM = 0;
    const steps = [];
    for (let i = 1; i < coords.length; i += 1) {
      const step = haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
      lengthM += step;
      steps.push(step);
    }
    if (!(lengthM > 0)) continue;
    let walked = 0;
    let lon = coords[0][0];
    let lat = coords[0][1];
    const half = lengthM / 2;
    for (let i = 1; i < coords.length; i += 1) {
      const step = steps[i - 1];
      if (walked + step >= half && step > 0) {
        const t = (half - walked) / step;
        lon = coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t;
        lat = coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t;
        break;
      }
      walked += step;
    }
    const start = coords[0];
    const end = coords[coords.length - 1];
    const strikeDeg = azimuthDeg(start[0], start[1], end[0], end[1]);
    const props = feature.properties || {};
    const explicitAzimuth = Number.isFinite(props.dip_azimuth_deg) ? props.dip_azimuth_deg : null;
    const dipAzimuthDeg = explicitAzimuth == null ? (strikeDeg + 90) % 360 : explicitAzimuth;
    faults.push({
      id: props.id || `fault-${faults.length}`,
      name: props.name || "Fault",
      kinematics: props.kinematics === "thrust" ? "thrust" : "normal",
      lon,
      lat,
      strikeDeg,
      lengthM,
      dipDeg: Number.isFinite(props.dip_deg) ? props.dip_deg : null,
      dipAzimuthDeg,
      explicitAzimuthDeg: explicitAzimuth,
      inValles: lon >= VM.west && lon <= VM.east && lat >= VM.south && lat <= VM.north,
    });
  }
  return faults;
}

function cloneZero() {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
}

function capTensor(lon, lat, centerLon, centerLat, capRadiusRad, magnitudePa, support) {
  if (!(Math.abs(magnitudePa) > 0) || !(capRadiusRad > 0)) return ZERO;
  const separation = angularSeparationDeg(centerLon, centerLat, lon, lat, MARS_RADIUS_M);
  const radial = capLoadStress((separation * Math.PI) / 180, capRadiusRad, magnitudePa, support);
  const bearing = (azimuthDeg(centerLon, centerLat, lon, lat) * Math.PI) / 180;
  return horizontalPrincipalTensor(radial.sigmaRadialPa, radial.sigmaHoopPa, Math.sin(bearing), Math.cos(bearing));
}

function mostCompressivePa(tensor) {
  const a = tensor[0][0];
  const b = tensor[1][1];
  const c = tensor[0][1];
  const half = 0.5 * (a + b);
  const root = Math.sqrt(Math.max(0, ((a - b) / 2) ** 2 + c * c));
  return half + root;
}

let cachedShells = null;
let cachedShellKey = "";
let cachedFaultRef = null;

function shellKey(p) {
  return [
    p.reboundFraction,
    p.support,
    p.tharsisRadiusDeg,
    p.tharsisLon,
    p.tharsisLat,
    p.tharsisPa,
    p.basinPa.hellas,
    p.basinPa.isidis,
    p.basinPa.argyre,
    p.basinPa.utopia,
    p.masconPa.hellas,
    p.masconPa.isidis,
    p.masconPa.argyre,
    p.masconPa.utopia,
  ].join("|");
}

function shellsFor(faults, p) {
  const key = shellKey(p);
  if (cachedFaultRef === faults && cachedShellKey === key && cachedShells) return cachedShells;
  cachedFaultRef = faults;
  cachedShellKey = key;
  cachedShells = faults.map((fault) => shellField(fault.lon, fault.lat, p));
  return cachedShells;
}

export function shellField(lon, lat, p) {
  const rebound = 1 - Math.min(1, Math.max(0, p.reboundFraction));
  const support = p.support === "flexural" ? "flexural" : "isostatic";
  const tharsisRadius = (Math.max(p.tharsisRadiusDeg, 1) * Math.PI) / 180;
  let tharsis = capTensor(lon, lat, p.tharsisLon, p.tharsisLat, tharsisRadius, rebound * p.tharsisPa, support);
  let basins = cloneZero();
  for (const basin of BASINS) {
    const cap = (basin.diameter_km * 1000) / (2 * MARS_RADIUS_M);
    const unload = capTensor(lon, lat, basin.lon, basin.lat, cap, -rebound * (p.basinPa[basin.id] || 0), support);
    const mascon = capTensor(lon, lat, basin.lon, basin.lat, cap, rebound * (p.masconPa[basin.id] || 0), support);
    basins = addTensors(basins, addTensors(unload, mascon));
  }
  return {
    tharsis,
    basins,
    total: addTensors(tharsis, basins),
    tharsisCompressionPa: Math.max(0, mostCompressivePa(tharsis)),
    basinCompressionPa: Math.max(0, mostCompressivePa(basins)),
  };
}

function sourceOf(p) {
  const massKg = impactorMassKg(p.diameterM, p.densityImpactor);
  const kineticJ = kineticEnergyJ(massKg, p.velocityMs);
  const coupledJ = coupledEnergyJ(kineticJ, p.angleDeg);
  const seismicJ = seismicEnergyJ(coupledJ, p.efficiency);
  const transientM = transientCraterDiameterM({
    diameterM: p.diameterM,
    velocityMs: p.velocityMs,
    densityImpactor: p.densityImpactor,
    densityTarget: p.density,
    gravity: p.gravity,
    angleDeg: p.angleDeg,
  });
  const finalM = finalCraterDiameterM(transientM, p.simpleComplexM);
  const volumeM3 = transientCavityVolumeM3(transientM);
  return {
    massKg,
    kineticJ,
    coupledJ,
    seismicJ,
    magnitude: momentMagnitude(seismicJ),
    transientM,
    finalM,
    volumeM3,
    forceDownN: -p.excavationFraction * p.density * volumeM3 * p.gravity,
    durationS: Math.sqrt(Math.max(transientM, 1) / p.gravity),
  };
}

function dipOf(fault, p) {
  if (fault.dipDeg != null) return fault.dipDeg;
  if (typeof p.resolveDip === "function") return p.resolveDip(fault);
  return fault.kinematics === "thrust" ? p.dipThrust : p.dipNormal;
}

function azimuthOf(fault, p) {
  if (typeof p.resolveAzimuth === "function") return p.resolveAzimuth(fault);
  return fault.dipAzimuthDeg;
}

function binIndex(lon, lat, step) {
  const x = Math.floor((((lon + 180) % 360) + 360) % 360 / step);
  const y = Math.floor((lat + 90) / step);
  return `${x}:${y}`;
}

function neighborIds(bins, lon, lat, step) {
  const xCount = Math.ceil(360 / step);
  const yCount = Math.ceil(180 / step);
  const x = Math.floor((((lon + 180) % 360) + 360) % 360 / step);
  const y = Math.floor((lat + 90) / step);
  const ids = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= yCount) continue;
      const xx = (x + dx + xCount) % xCount;
      const hit = bins.get(`${xx}:${yy}`);
      if (hit) ids.push(...hit);
    }
  }
  return ids;
}

/**
 * CMB heat flow, the two impact pathways, and the retention test.
 * `pathway` carries the slab term from the weak zone. Pass zeros for the
 * background core with no impact.
 */
export function evaluateCore(p, pathway = {}) {
  const radiusM = Math.max(p.coreRadiusM, 1000);
  const innerM = Math.min(Math.max(p.innerRadiusM, 0), radiusM * 0.95);
  const bmlM = Math.max(p.bmlM, 0);
  // q_m is the heat flux at the base of the crust (planet radius minus crustal
  // thickness), not at the core or the base of the molten silicate layer.
  // That power is what remains for the core after mantle radiogenic heating.
  // q_cmb is the same power spread over the metallic-core surface.
  const crustBaseR = Math.max(p.planetRadiusM - Math.max(p.crustM, 0), 1);
  const baseArea = 4 * Math.PI * crustBaseR ** 2;
  const coreArea = 4 * Math.PI * radiusM ** 2;
  const basePower = p.mantleFlux * baseArea;
  const crustVolume = (4 / 3) * Math.PI * (p.planetRadiusM ** 3 - Math.max(p.planetRadiusM - p.crustM, 0) ** 3);
  const crustPower = p.crustalHeatWm3 * crustVolume;
  const radioPower = radiogenicPowerW({
    uraniumPpb: p.uraniumPpb,
    thoriumPpb: p.thoriumPpb,
    potassiumPpm: p.potassiumPpm,
    massKg: p.silicateMassKg,
    heatRatio: p.heatRatio,
    scale: p.radioScale,
  });
  const mantleRadio = p.radioMode === "split"
    ? p.crustalHeatWm3 * crustVolume +
      radiogenicPowerW({
        uraniumPpb: p.uraniumMantlePpb,
        thoriumPpb: p.thoriumMantlePpb,
        potassiumPpm: p.potassiumMantlePpm,
        massKg: Math.max(p.silicateMassKg - p.density * crustVolume, 0),
        heatRatio: p.heatRatio,
        scale: p.radioScale,
      }) -
      crustPower
    : Math.max(0, radioPower - crustPower);
  const cmbPower = cmbPowerW({
    baseOfCrustPowerW: basePower,
    mantleRadiogenicW: Math.max(0, mantleRadio),
    secularFraction: p.secularFraction,
  });
  const qMantle = (p.bmlTransfer * cmbPower) / coreArea;
  const qComp = p.qCompWm2;
  const density = p.coreMassKg / ((4 / 3) * Math.PI * radiusM ** 3);
  const gCore = coreGravityMs2(p.coreMassKg, radiusM);
  const qAd = adiabaticHeatFluxWm2({
    conductivity: p.kCore,
    expansivity: p.alphaCore,
    gravity: gCore,
    temperatureK: p.cmbTemperatureK,
    specificHeat: p.cpCore,
  });
  const direct = p.includeImpact
    ? coreDirectEffects({
        massKg: p.massKg,
        velocityMs: p.velocityMs,
        angleDeg: p.angleDeg,
        coupledEnergyJ: p.coupledJ,
        planetRadiusM: p.planetRadiusM,
        planetMassKg: p.planetMassKg,
        coreMassKg: p.coreMassKg,
        coreRadiusM: radiusM,
        innerRadiusM: innerM,
        coreDensity: density,
        spinCoupling: p.spinCoupling,
        rotationPeriodS: p.rotationPeriodS,
        moiFactor: p.moiFactor,
        threshold: p.spinThreshold,
        ohmicFraction: p.ohmicFraction,
        dipoleFraction: p.dipoleFraction,
        coreHeatFraction: p.coreHeatFraction,
        heatedLayerM: p.heatedLayerM,
        conductivity: p.kCore,
        specificHeat: p.cpCore,
        temperatureK: p.cmbTemperatureK,
      })
    : {
        stirring: false,
        momentAm2: 0,
        spinRatio: 0,
        diffusionYears: 0,
        suppressWm2: 0,
        deltaT: 0,
        deltaOmega: 0,
      };
  const qSlab = pathway.qSlabWm2 || 0;
  const slabOnset = pathway.slabOnsetYears;
  const diffusionYears = direct.diffusionYears || 0;
  const suppressNow = direct.suppressWm2 || 0;
  const qBackground = qMantle + qComp;
  const slabArrivesAfterHotLid = slabOnset == null || slabOnset > diffusionYears;
  const qSlow = qBackground + qSlab - (slabArrivesAfterHotLid ? 0 : suppressNow);
  const qFastThermal = qBackground - suppressNow;
  const momentOf = (q) =>
    thermalMomentAm2({
      beta: p.betaDynamo,
      density,
      expansivity: p.alphaCore,
      gravity: gCore,
      specificHeat: p.cpCore,
      qConvWm2: Math.max(0, q - qAd),
      coreRadiusM: radiusM,
      innerRadiusM: innerM,
      dipoleFraction: p.dipoleFraction,
    });
  const momentBackground = momentOf(qBackground);
  const momentSlow = qSlab > 0 ? momentOf(qSlow) : 0;
  const momentFastThermal = momentOf(qFastThermal);
  const momentStir = direct.momentAm2 || 0;
  const gate = (moment) =>
    retentionVerdict({
      momentAm2: moment,
      planetRadiusM: p.planetRadiusM,
      exobaseAltitudeM: p.exobaseM,
      nominalPressurePa: p.nominalPressurePa,
      stormPressurePa: p.stormPressurePa,
      gunellPeakMomentAm2: p.gunellPeakAm2,
    });
  const backgroundGate = gate(momentBackground);
  const slowGate = gate(momentSlow);
  const stirGate = gate(momentStir);
  const fastThermalGate = gate(momentFastThermal);
  const fastMoment = Math.max(momentStir, momentFastThermal);
  const fastGate = gate(fastMoment);
  const slowOn = Boolean(pathway.subductionInitiates) && slowGate.protective;
  const backgroundOn = backgroundGate.protective;
  // The fast thermal flux is the background flux minus core-top heating, so it
  // cannot create protection the background does not already have. Count the
  // fast pathway only when the impact itself supplies protection (stirring)
  // that the background lacks, or when a fast thermal moment is protective
  // without the background already being protective.
  const stirCausesProtection = Boolean(p.includeImpact && stirGate.protective && !backgroundOn);
  const fastThermalCausesProtection = Boolean(p.includeImpact && fastThermalGate.protective && !backgroundOn);
  const fastOn = stirCausesProtection || fastThermalCausesProtection;
  const suppressionRemovesProtection = Boolean(
    p.includeImpact && backgroundOn && suppressNow > 0 && !fastThermalGate.protective,
  );
  let onsetYears = null;
  let durationYears = null;
  let which = "none";
  if (backgroundOn) {
    onsetYears = 0;
    durationYears = Infinity;
    which = "background";
  } else if (fastOn) {
    onsetYears = 0;
    durationYears = stirGate.protective ? p.spinDurationYears : diffusionYears;
    which = stirGate.protective ? "fast-stir" : "fast-thermal";
  } else if (slowOn) {
    onsetYears = slabOnset;
    durationYears = pathway.slabDurationYears;
    which = "slow";
  }
  const bestMoment = Math.max(momentBackground, slowOn ? momentSlow : 0, fastOn ? fastMoment : 0);
  return {
    coreRadiusM: radiusM,
    innerRadiusM: innerM,
    bmlM,
    density,
    gravity: gCore,
    qAdWm2: qAd,
    qCmbWm2: qMantle,
    qCompWm2: qComp,
    qSlabWm2: qSlab,
    qSuppressWm2: suppressNow,
    qBackgroundWm2: qBackground,
    radioPowerW: radioPower,
    crustPowerW: crustPower,
    mantleRadioW: mantleRadio,
    basePowerW: basePower,
    cmbPowerW: cmbPower,
    thermalOn: qBackground > qAd,
    suppressed: p.includeImpact && qBackground > qAd && qFastThermal <= qAd,
    suppressionYears: diffusionYears,
    coreHeatingK: direct.deltaT || 0,
    stirring: Boolean(direct.stirring),
    spinRatio: direct.spinRatio || 0,
    momentBackgroundAm2: momentBackground,
    momentSlowAm2: momentSlow,
    momentStirAm2: momentStir,
    momentFastThermalAm2: momentFastThermal,
    momentAm2: bestMoment,
    backgroundProtective: backgroundOn,
    slowProtective: slowOn,
    fastProtective: fastOn,
    stirCausesProtection,
    fastThermalCausesProtection,
    suppressionRemovesProtection,
    impactStirMomentAm2: momentStir,
    impactFastThermalMomentAm2: momentFastThermal,
    protective: backgroundOn || slowOn || fastOn,
    onsetYears,
    durationYears,
    pathway: which,
    retention: gate(bestMoment),
    earth: gate(p.earthMomentAm2),
  };
}

function representativeViscosity(p) {
  const depth = Math.max(p.bdtM * 0.5, 1000);
  const background = backgroundOnFault({
    depthM: depth,
    density: p.density,
    gravity: p.gravity,
    phiDeg: p.phiDeg,
    cohesionPa: p.cohesionPa,
    lambda: p.lambda,
    criticality: p.criticality,
    regime: p.regime,
    dipDeg: p.dipNormal,
    kinematics: "normal",
    muScale: p.frictionFactor,
  });
  const temperature = temperatureK(depth, {
    surfaceK: p.surfaceK,
    mantleFlux: p.mantleFlux,
    heatProduction: p.crustalHeatWm3,
    conductivity: p.kCrust,
    crustM: p.crustM,
  });
  const eta = effectiveViscosityPaS({
    stressDiffPa: background.differentialPa,
    temperatureK: temperature,
    prefactorA: p.creepA,
    exponentN: p.creepN,
    activationJmol: p.creepQ,
  });
  return { depthM: depth, temperatureK: temperature, etaPaS: eta, differentialPa: background.differentialPa };
}

export function assessGlobal(faults, p, options = {}) {
  const detail = options.detail !== false;
  const includeImpact = p.includeImpact !== false;
  const working = { ...p, includeImpact };
  const mu = shearModulusPa(working.youngsPa, working.poisson);
  const vs = shearVelocityMs(mu, working.density);
  const source = includeImpact
    ? sourceOf(working)
    : {
        massKg: 0,
        kineticJ: 0,
        coupledJ: 0,
        seismicJ: 0,
        magnitude: -Infinity,
        transientM: 0,
        finalM: 0,
        volumeM3: 0,
        forceDownN: 0,
        durationS: 1,
      };
  working.massKg = source.massKg;
  working.coupledJ = source.coupledJ;
  const focus = antipode(working.lon, working.lat);
  const nDepth = Math.max(2, working.depthSteps || 8);
  const capAtMoho = working.capAtMoho !== false;
  const statuses = detail ? new Array(faults.length) : null;
  const crustOf = (fault) => {
    const regions = working.crustRegions || [];
    for (const region of regions) {
      if (fault.lon >= region.west && fault.lon <= region.east && fault.lat >= region.south && fault.lat <= region.north) {
        return region.crustM;
      }
    }
    return working.crustM;
  };
  const shells = shellsFor(faults, working);
  const state = faults.map((fault, faultIndex) => {
    const dip = dipOf(fault, working);
    const shell = shells[faultIndex];
    const crustM = crustOf(fault);
    const limitM = brittleDepthLimitM({ bdtM: working.bdtM, crustM, capAtMoho });
    const sampled = depthSampleZs(limitM, nDepth);
    const dz = sampled.dz;
    let cfs = -Infinity;
    let backgroundAtPeak = -Infinity;
    let impactAtPeak = 0;
    let failedDepth = 0;
    let excavated = false;
    let strengthAtFail = 1;
    const distance = includeImpact ? haversineM(working.lon, working.lat, fault.lon, fault.lat) : Infinity;
    const angular = includeImpact ? angularSeparationDeg(working.lon, working.lat, fault.lon, fault.lat, MARS_RADIUS_M) : 0;
    const gain = includeImpact ? antipodalGain(angular, working.antipodeWidthDeg, working.antipodePeak) : 1;
    const bearing = includeImpact ? azimuthDeg(working.lon, working.lat, fault.lon, fault.lat) : 0;
    const east = Math.sin((bearing * Math.PI) / 180);
    const north = Math.cos((bearing * Math.PI) / 180);
    const evalR = Math.max(distance, source.finalM / 2, 1000);
    const staticAllowed = includeImpact && distance <= working.staticCutoffM;
    const pgv = includeImpact
      ? peakGroundVelocityMs({
          seismicEnergy: source.seismicJ,
          density: working.density,
          shearVelocity: vs,
          durationS: source.durationS,
          distanceM: Math.max(distance, 1000),
          qualityFactor: working.qualityFactor,
        })
      : 0;
    const dDynamic = dynamicStressPa(pgv, working.density, vs) * gain;
    for (const z of sampled.zs) {
      const background = backgroundOnFault({
        depthM: z,
        density: working.density,
        gravity: working.gravity,
        phiDeg: working.phiDeg,
        cohesionPa: working.cohesionPa,
        lambda: working.lambda,
        criticality: working.criticality,
        regime: working.regime,
        dipDeg: dip,
        kinematics: fault.kinematics,
        muScale: working.frictionFactor,
      });
      const shellCfs = shellDeltaCfs(shell.total, {
        dipDeg: dip,
        dipAzimuthDeg: azimuthOf(fault, working),
        kinematics: fault.kinematics,
        mu: background.mu,
      }).deltaCfs;
      let dStatic = 0;
      const dug = includeImpact && insideExcavation({
        horizontalM: distance,
        depthM: z,
        finalDiameterM: source.finalM,
        transientDiameterM: source.transientM,
      });
      if (dug) excavated = true;
      if (staticAllowed && !dug) {
        const field = boussinesq({
          forceDownN: source.forceDownN,
          radiusM: evalR,
          depthM: z,
          poisson: working.poisson,
        });
        const tensor = tensorFromCylindrical({ ...field, east, north });
        dStatic = deltaCfsFromCompressionTensor(tensor, {
          dipDeg: dip,
          dipAzimuthDeg: azimuthOf(fault, working),
          kinematics: fault.kinematics,
          mu: background.mu,
        }).deltaCfs;
      }
      const impactDelta = dStatic + (dug ? 0 : dDynamic);
      const backgroundTotal = background.cfs + shellCfs;
      const total = backgroundTotal + impactDelta;
      if (total > cfs) {
        cfs = total;
        backgroundAtPeak = backgroundTotal;
        impactAtPeak = impactDelta;
        strengthAtFail = background.strength;
      }
      if (!dug && total >= 0) failedDepth = z;
    }
    const failed = failedDepth > 0 || cfs >= 0;
    return {
      fault,
      cfs,
      backgroundCfs: backgroundAtPeak,
      impactDeltaCfs: impactAtPeak,
      failed,
      failedDepth,
      excavated,
      strength: strengthAtFail,
      distance,
      shell,
      dip,
      crustM,
      depthLimitM: limitM,
    };
  });

  const stepDeg = 8;
  const bins = new Map();
  state.forEach((row, index) => {
    const key = binIndex(row.fault.lon, row.fault.lat, stepDeg);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(index);
  });
  const shed = new Set();
  const range = working.transferRangeM;
  for (let pass = 0; pass < working.cascadePasses; pass += 1) {
    const sources = [];
    for (let i = 0; i < state.length; i += 1) {
      if (state[i].failed && !state[i].excavated && !shed.has(i)) sources.push(i);
    }
    if (!sources.length) break;
    for (const i of sources) {
      shed.add(i);
      const from = state[i];
      const near = neighborIds(bins, from.fault.lon, from.fault.lat, stepDeg);
      for (const j of near) {
        if (j === i) continue;
        const to = state[j];
        const distance = haversineM(from.fault.lon, from.fault.lat, to.fault.lon, to.fault.lat);
        if (distance > range) continue;
        const extra = transferredDeltaCfs({
          stressDropPa: working.cascadeStressPa,
          lengthM: from.fault.lengthM,
          distanceM: distance,
          exponent: working.transferExponent,
          fraction: working.transferFraction,
          alignment: strikeAlignment(from.fault.strikeDeg, to.fault.strikeDeg),
        });
        to.cfs += extra;
        if (!to.failed && to.cfs >= 0) {
          to.failed = true;
          const shallow = (to.depthLimitM || working.bdtM) / Math.max(2, nDepth) * 0.5;
          to.failedDepth = Math.max(to.failedDepth, shallow);
        }
      }
    }
  }

  const failedRows = state.filter((row) => row.failed && !row.excavated);
  const vmRows = state.filter((row) => row.fault.inValles);
  const pool = working.seed === "valles_marineris"
    ? state.filter((row) => row.fault.inValles || (row.failed && !row.excavated))
    : failedRows;
  const parent = pool.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    return cursor;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  if (working.seed === "valles_marineris") {
    const vmIndexes = [];
    pool.forEach((row, index) => {
      if (row.fault.inValles) vmIndexes.push(index);
    });
    for (let i = 1; i < vmIndexes.length; i += 1) unite(vmIndexes[0], vmIndexes[i]);
  }
  const poolBins = new Map();
  pool.forEach((row, index) => {
    const key = binIndex(row.fault.lon, row.fault.lat, stepDeg);
    if (!poolBins.has(key)) poolBins.set(key, []);
    poolBins.get(key).push(index);
  });
  for (let i = 0; i < pool.length; i += 1) {
    if (working.seed === "valles_marineris" && !pool[i].failed && !pool[i].fault.inValles) continue;
    const near = neighborIds(poolBins, pool[i].fault.lon, pool[i].fault.lat, stepDeg);
    for (const j of near) {
      if (j <= i) continue;
      const distance = haversineM(pool[i].fault.lon, pool[i].fault.lat, pool[j].fault.lon, pool[j].fault.lat);
      if (distance <= working.linkDistanceM) unite(i, j);
    }
  }
  const groups = new Map();
  pool.forEach((row, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  });
  let zoneRows = [];
  if (working.seed === "valles_marineris" && vmRows.length) {
    const root = find(pool.findIndex((row) => row.fault.inValles));
    zoneRows = groups.get(root) || vmRows;
  } else {
    let best = [];
    for (const group of groups.values()) {
      const length = group.reduce((sum, row) => sum + row.fault.lengthM, 0);
      const bestLength = best.reduce((sum, row) => sum + row.fault.lengthM, 0);
      if (length > bestLength) best = group;
    }
    zoneRows = best;
  }
  const traceLengthM = zoneRows.reduce((sum, row) => sum + row.fault.lengthM, 0);
  const failedLengthM = zoneRows.filter((row) => row.failed).reduce((sum, row) => sum + row.fault.lengthM, 0);
  const geometry = alongStrikeExtentM(zoneRows.map((row) => row.fault), working.planetRadiusM || MARS_RADIUS_M);
  const zoneLengthM = geometry.extentM;
  const zoneDepthM = zoneRows.reduce((max, row) => Math.max(max, row.failedDepth || 0), 0);
  const damage = netDamage({
    failedLengthM,
    zoneLengthM: traceLengthM,
    damageRate: working.damageRate,
    ageYears: working.damageAgeYears,
    healYears: working.healYears,
  });
  // Ductile continuation is the stretch from the BDT down toward Te. It applies
  // only when brittle failure actually reaches the BDT. A Moho cap above the BDT
  // stops the fault in the crust, so the slider then adds nothing.
  const reachedBdt = zoneDepthM >= working.bdtM * (1 - 1e-4);
  const ductile = reachedBdt ? working.ductileFraction * Math.max(0, working.teM - working.bdtM) : 0;
  let effectiveDepthM = zoneDepthM + ductile;
  const deepest = zoneRows.reduce((best, row) => ((row.failedDepth || 0) > (best?.failedDepth || 0) ? row : best), null);
  if (capAtMoho && deepest) effectiveDepthM = Math.min(effectiveDepthM, deepest.crustM);
  const crustForCap = deepest ? deepest.crustM : working.crustM;
  const ductileBlockedByMoho = capAtMoho && crustForCap < working.bdtM * (1 - 1e-4);
  const cuts = zoneLengthM > 0 && effectiveDepthM >= working.teM;
  const longEnough = zoneLengthM >= working.lidLengthFactor * Math.max(working.teM, 1);
  const centroidLon = zoneRows.length ? geometry.centroidLon : working.lon;
  const centroidLat = zoneRows.length ? geometry.centroidLat : working.lat;
  const zoneShell = shellField(centroidLon, centroidLat, working);
  const hLith = Math.max(working.hLithM, 1);
  const rhoMl = working.mantleDensity - working.depletion;
  const rhoLith = effectiveLithosphereDensity({
    crustDensity: working.density,
    crustThicknessM: working.crustM,
    lithosphereThicknessM: hLith,
    mantleLithosphereDensity: rhoMl,
    eclogiteFraction: working.eclogiteFraction,
    eclogiteDensity: working.eclogiteDensity,
  });
  const subduction = subductionIndex({
    tharsisCompressionPa: zoneShell.tharsisCompressionPa,
    basinDrivingPa: zoneShell.basinCompressionPa,
    plumeEnergyJ: includeImpact ? working.plumeFraction * source.coupledJ : 0,
    planetRadiusM: working.planetRadiusM,
    lithosphereThicknessM: hLith,
    cohesionPa: working.cohesionPa,
    mu: Math.tan((working.phiDeg * Math.PI) / 180) * working.frictionFactor,
    lambda: working.lambda,
    damage,
    gravity: working.gravity,
    mantleDensity: working.mantleDensity,
    lithosphereDensity: rhoLith,
  });
  const slabSpeed = working.slabVelocityMs;
  const mantleColumn = Math.max(working.planetRadiusM - working.crustM - working.coreRadiusM - working.bmlM, 0);
  const slabOnsetYears = subduction.initiates && slabSpeed > 0 ? mantleColumn / slabSpeed / YEAR_S : null;
  const slabDurationYears = subduction.initiates && slabSpeed > 0 ? zoneLengthM / slabSpeed / YEAR_S : null;
  const slabTemperature = temperatureK(Math.min(hLith, working.bdtM), {
    surfaceK: working.surfaceK,
    mantleFlux: working.mantleFlux,
    heatProduction: working.crustalHeatWm3,
    conductivity: working.kCrust,
    crustM: working.crustM,
  });
  const deltaT = Math.max(0, working.cmbTemperatureK - slabTemperature);
  const slabPower = subduction.initiates ? rhoLith * hLith * zoneLengthM * slabSpeed * working.cpRock * deltaT : 0;
  const qSlab = slabPower / (4 * Math.PI * Math.max(working.coreRadiusM, 1) ** 2);
  const core = evaluateCore(working, {
    qSlabWm2: qSlab,
    slabOnsetYears,
    slabDurationYears,
    subductionInitiates: subduction.initiates,
  });
  let area = 0;
  let failedArea = 0;
  let excavatedArea = 0;
  let maxImpactDelta = 0;
  let backgroundAtMaxImpact = 0;
  for (const row of state) {
    const dip = Math.max(row.dip, 5);
    const column = row.depthLimitM || working.bdtM;
    const piece = (row.fault.lengthM * column) / Math.sin((dip * Math.PI) / 180);
    area += piece;
    if (row.excavated) excavatedArea += piece;
    else if (row.failed) {
      const rowDz = row.depthLimitM / Math.max(2, nDepth);
      failedArea += (row.fault.lengthM * Math.max(row.failedDepth, rowDz)) / Math.sin((dip * Math.PI) / 180);
    }
    if (Math.abs(row.impactDeltaCfs) > Math.abs(maxImpactDelta)) {
      maxImpactDelta = row.impactDeltaCfs;
      backgroundAtMaxImpact = row.backgroundCfs;
    }
  }
  const lidBreaks = (cuts && longEnough) || subduction.initiates;
  const anySlip = failedArea > 0 || excavatedArea > 0;
  const regime = classifyOutcome({ anySlip, lidBreaks, protective: core.protective });
  if (detail) {
    const weakIds = new Set(zoneRows.map((row) => row.fault.id));
    state.forEach((row, index) => {
      let status = "stable";
      if (row.excavated) status = "excavated";
      else if (row.failed) status = "reactivated";
      else if (row.cfs >= -0.05 * Math.max(row.strength, 1)) status = "near";
      statuses[index] = {
        id: row.fault.id,
        name: row.fault.name,
        kinematics: row.fault.kinematics,
        lon: row.fault.lon,
        lat: row.fault.lat,
        distanceM: row.distance,
        cfs: row.cfs,
        backgroundCfs: row.backgroundCfs,
        impactDeltaCfs: row.impactDeltaCfs,
        failedDepthM: row.failedDepth,
        status,
        inWeakZone: weakIds.has(row.fault.id),
      };
    });
  }
  const ranked = detail
    ? [...statuses].sort((a, b) => b.cfs - a.cfs).slice(0, 8)
    : [];
  return {
    source,
    antipode: focus,
    faultCount: faults.length,
    failedIds: state.filter((row) => (row.failed && !row.excavated) || row.excavated).map((row) => row.fault.id),
    reactivatedCount: state.filter((row) => row.failed && !row.excavated).length,
    maxImpactDeltaCfs: maxImpactDelta,
    backgroundCfsAtMaxImpact: backgroundAtMaxImpact,
    excavatedCount: state.filter((row) => row.excavated).length,
    fractionFailed: area > 0 ? failedArea / area : 0,
    fractionExcavated: area > 0 ? excavatedArea / area : 0,
    weakZone: {
      seed: working.seed,
      count: zoneRows.length,
      vmCount: vmRows.length,
      lengthM: zoneLengthM,
      traceLengthM,
      failedLengthM,
      lengthCapped: geometry.capped,
      depthM: zoneDepthM,
      effectiveDepthM,
      elasticM: working.teM,
      bdtM: working.bdtM,
      reachedBdt,
      ductileM: ductile,
      ductileBlockedByMoho,
      capAtMoho,
      cutsLithosphere: cuts && longEnough,
      damage,
      centroidLon,
      centroidLat,
    },
    subduction: { ...subduction, slabOnsetYears, slabDurationYears, qSlabWm2: qSlab, lithosphereDensity: rhoLith },
    core,
    lidBreaks,
    anySlip,
    regime,
    viscosity: representativeViscosity(working),
    faults: ranked,
    statuses,
  };
}

export function withWater(p, fraction, dry, wet) {
  const w = Math.min(1, Math.max(0, fraction));
  const A = Math.exp((1 - w) * Math.log(Math.max(dry.A, 1e-30)) + w * Math.log(Math.max(wet.A, 1e-30)));
  return {
    ...p,
    creepA: A,
    creepN: (1 - w) * dry.n + w * wet.n,
    creepQ: (1 - w) * dry.Q + w * wet.Q,
    lambda: (1 - w) * dry.lambda + w * wet.lambda,
    frictionFactor: Math.max(0.05, 1 - w * p.clayReduction),
    waterFraction: w,
  };
}

export function regimeMap(faults, p, diameters, velocities) {
  const rows = [];
  for (const velocityMs of velocities) {
    for (const diameterM of diameters) {
      const result = assessGlobal(faults, { ...p, diameterM, velocityMs, includeImpact: true }, { detail: false });
      rows.push({
        diameterM,
        velocityMs,
        regime: result.regime,
        protective: result.core.protective,
        fractionFailed: result.fractionFailed,
        subductionIndex: result.subduction.index,
        momentAm2: result.core.momentAm2,
      });
    }
  }
  return rows;
}

/**
 * Smallest impactor diameter on the supplied grid that is protective.
 * Not monotonic: core heating can suppress a larger impact, so every cell is scored.
 */
export function smallestProtective(faults, p, grid) {
  let best = null;
  const trials = [];
  for (const place of grid.locations) {
    for (const angleDeg of grid.angles) {
      for (const velocityMs of grid.velocities) {
        for (const diameterM of grid.diameters) {
          const result = assessGlobal(
            faults,
            { ...p, diameterM, velocityMs, angleDeg, lon: place.lon, lat: place.lat, includeImpact: true },
            { detail: false },
          );
          const trial = {
            diameterM,
            velocityMs,
            angleDeg,
            lon: place.lon,
            lat: place.lat,
            name: place.name,
            regime: result.regime,
            protective: result.core.protective,
            onsetYears: result.core.onsetYears,
            durationYears: result.core.durationYears,
            momentAm2: result.core.momentAm2,
            pathway: result.core.pathway,
            standoffNominalM: result.core.retention.nominalAltitudeM,
          };
          trials.push(trial);
          if (!result.core.protective) continue;
          const better =
            !best ||
            diameterM < best.diameterM - 1 ||
            (Math.abs(diameterM - best.diameterM) <= 1 && result.source.kineticJ < best.kineticJ);
          if (better) best = { ...trial, kineticJ: result.source.kineticJ };
        }
      }
    }
  }
  return { best, trials: trials.length };
}
