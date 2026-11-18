import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { backgroundOnFault } from "../src/model/physics.js";
import {
  EARTH_MOMENT_AM2,
  EARTH_RADIUS_M,
  adiabaticHeatFluxWm2,
  alongStrikeExtentM,
  antipodalGain,
  capLoadStress,
  classifyOutcome,
  clusterFaults,
  interpolateOffline,
  magnetopauseRadiusM,
  mixWater,
  netDamage,
  retentionVerdict,
  subductionIndex,
  transferredDeltaCfs,
} from "../src/model/globalPhysics.js";
import { assessGlobal, evaluateCore, prepareFaults } from "../src/model/globalScenario.js";

test("isostatic cap load is tensile at the center and radial compression in the annulus", () => {
  const center = capLoadStress(0, 0.8, 10e6, "isostatic");
  assert.ok(center.sigmaHoopPa < 0);
  assert.ok(center.sigmaRadialPa < 0);
  const annulus = capLoadStress(0.8, 0.8, 10e6, "isostatic");
  assert.ok(annulus.sigmaRadialPa > 0);
  const flexed = capLoadStress(0, 0.8, 10e6, "flexural");
  assert.ok(flexed.sigmaHoopPa > 0);
});

test("antipodal gain peaks at 180 degrees and is 1 far from the antipode", () => {
  const peak = antipodalGain(180, 12, 5);
  const equator = antipodalGain(90, 12, 5);
  assert.ok(Math.abs(peak - 5) < 1e-9);
  assert.ok(equator < 1.01);
  assert.ok(peak > equator);
});

test("stress transfer decays with distance and respects alignment", () => {
  const near = transferredDeltaCfs({
    stressDropPa: 3e6,
    lengthM: 100e3,
    distanceM: 0,
    exponent: 3,
    fraction: 0.5,
    alignment: 1,
  });
  const far = transferredDeltaCfs({
    stressDropPa: 3e6,
    lengthM: 100e3,
    distanceM: 500e3,
    exponent: 3,
    fraction: 0.5,
    alignment: 1,
  });
  const crossed = transferredDeltaCfs({
    stressDropPa: 3e6,
    lengthM: 100e3,
    distanceM: 0,
    exponent: 3,
    fraction: 0.5,
    alignment: 0,
  });
  assert.equal(near, 1.5e6);
  assert.ok(far < near);
  assert.equal(crossed, 0);
});

test("clusters link nearby failed faults and ignore stable ones", () => {
  const faults = [
    { id: "a", lon: 0, lat: 0, lengthM: 1000, failed: true, depthM: 1000 },
    { id: "b", lon: 0.1, lat: 0, lengthM: 2000, failed: true, depthM: 500 },
    { id: "c", lon: 40, lat: 0, lengthM: 9000, failed: true, depthM: 100 },
    { id: "d", lon: 0.05, lat: 0, lengthM: 8000, failed: false, depthM: 0 },
  ];
  const clusters = clusterFaults(faults, 50e3, 3_396_190);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].lengthM, 9000);
  assert.equal(clusters[1].count, 2);
  assert.equal(clusters[1].depthM, 1000);
});

test("water fraction matches the dry and wet end members", () => {
  const dry = { A: 8, n: 4.7, Q: 485e3, lambda: 0 };
  const wet = { A: 0.0612, n: 3.05, Q: 276e3, lambda: 0.4 };
  const left = mixWater(0, dry, wet, 0.3);
  const right = mixWater(1, dry, wet, 0.3);
  const mid = mixWater(0.5, dry, wet, 0.3);
  assert.ok(Math.abs(left.A - 8) < 1e-9);
  assert.equal(left.lambda, 0);
  assert.equal(left.frictionFactor, 1);
  assert.ok(Math.abs(right.A - 0.0612) < 1e-9);
  assert.equal(right.lambda, 0.4);
  assert.ok(Math.abs(right.frictionFactor - 0.7) < 1e-9);
  assert.ok(mid.A < dry.A && mid.A > wet.A);
  assert.ok(mid.n < dry.n && mid.n > wet.n);
});

test("damage heals and subduction index crosses 1 when driving wins", () => {
  const fresh = netDamage({ failedLengthM: 100, zoneLengthM: 100, damageRate: 5, ageYears: 0, healYears: 1e8 });
  const healed = netDamage({ failedLengthM: 100, zoneLengthM: 100, damageRate: 5, ageYears: 1e9, healYears: 1e8 });
  assert.ok(fresh > 0.9);
  assert.ok(healed < fresh);
  const weak = subductionIndex({
    tharsisCompressionPa: 0,
    basinDrivingPa: 0,
    plumeEnergyJ: 0,
    planetRadiusM: 3.4e6,
    lithosphereThicknessM: 100e3,
    cohesionPa: 2e6,
    mu: 0.6,
    lambda: 0,
    damage: 0,
    gravity: 3.71,
    mantleDensity: 3500,
    lithosphereDensity: 3500,
  });
  const broken = subductionIndex({
    tharsisCompressionPa: 50e6,
    basinDrivingPa: 0,
    plumeEnergyJ: 0,
    planetRadiusM: 3.4e6,
    lithosphereThicknessM: 100e3,
    cohesionPa: 0,
    mu: 0,
    lambda: 0,
    damage: 1,
    gravity: 3.71,
    mantleDensity: 3500,
    lithosphereDensity: 3600,
  });
  assert.ok(weak.index < 1);
  assert.ok(broken.index > 1);
  assert.equal(broken.initiates, true);
});

test("adiabatic flux scales with conductivity and standoff falls as solar-wind pressure rises", () => {
  const cool = adiabaticHeatFluxWm2({
    conductivity: 20,
    expansivity: 1e-5,
    gravity: 3,
    temperatureK: 2000,
    specificHeat: 800,
  });
  const hot = adiabaticHeatFluxWm2({
    conductivity: 40,
    expansivity: 1e-5,
    gravity: 3,
    temperatureK: 2000,
    specificHeat: 800,
  });
  assert.ok(Math.abs(hot / cool - 2) < 1e-9);
  const low = magnetopauseRadiusM(1e22, 1e-9);
  const high = magnetopauseRadiusM(1e22, 8e-9);
  assert.ok(high < low);
  assert.equal(magnetopauseRadiusM(0, 1e-9), null);
});

test("an Earth-like moment stands off near 10 Earth radii", () => {
  const proton = 1.6726e-27;
  const pressure = 6.0e6 * proton * 4e5 ** 2;
  const radius = magnetopauseRadiusM(EARTH_MOMENT_AM2, pressure);
  const ratio = radius / EARTH_RADIUS_M;
  assert.ok(ratio > 8 && ratio < 12, `standoff ratio ${ratio}`);
});

test("retention requires both the Gunell peak and the exobase at storm pressure", () => {
  const common = {
    planetRadiusM: 3.396e6,
    exobaseAltitudeM: 220e3,
    nominalPressurePa: 0.7e-9,
    stormPressurePa: 3.5e-9,
  };
  const weak = retentionVerdict({ ...common, momentAm2: 1e21, gunellPeakMomentAm2: 2.5e24 });
  const strong = retentionVerdict({ ...common, momentAm2: 1e25, gunellPeakMomentAm2: 2.5e24 });
  assert.equal(weak.protective, false);
  assert.equal(strong.pastPeak, true);
  assert.equal(strong.nominalClears, true);
  assert.equal(strong.stormClears, true);
  assert.equal(strong.protective, true);
});

test("clay friction scale weakens the fault without changing the differential stress", () => {
  const base = {
    depthM: 10e3,
    density: 2950,
    gravity: 3.71,
    phiDeg: 31,
    cohesionPa: 2e6,
    lambda: 0,
    criticality: 0.5,
    regime: "normal",
    dipDeg: 60,
    kinematics: "normal",
  };
  const full = backgroundOnFault(base);
  const weak = backgroundOnFault({ ...base, muScale: 0.7 });
  assert.ok(Math.abs(full.differentialPa - weak.differentialPa) < 1);
  assert.ok(weak.strength < full.strength);
  assert.ok(weak.cfs > full.cfs);
});

test("regime priority is dynamo, then a broken lid, then slip", () => {
  assert.equal(classifyOutcome({ anySlip: true, lidBreaks: true, protective: true }), "dynamo");
  assert.equal(classifyOutcome({ anySlip: true, lidBreaks: true, protective: false }), "lid");
  assert.equal(classifyOutcome({ anySlip: true, lidBreaks: false, protective: false }), "slip");
  assert.equal(classifyOutcome({ anySlip: false, lidBreaks: false, protective: false }), "none");
});

test("offline interpolation warns across a dynamo threshold and blends moments", () => {
  const catalog = JSON.parse(readFileSync(new URL("../data/offline_runs/EXAMPLE.json", import.meta.url)));
  assert.equal(catalog.example, true);
  assert.equal(catalog.schema, "mars-explorer-offline-run/v1");
  const inside = interpolateOffline(catalog, { impactor_diameter_m: 1000, water_fraction: 0.5 });
  assert.equal(inside.thresholdWarning, false);
  assert.equal(inside.values.dynamo_on, false);
  const across = interpolateOffline(catalog, { impactor_diameter_m: 55000, water_fraction: 0 });
  assert.equal(across.thresholdWarning, true);
  assert.equal(across.values.dynamo_on, null);
  assert.equal(across.values.regime, null);
  assert.ok(across.values.magnetic_moment_Am2 > 1e18);
  assert.ok(across.values.magnetic_moment_Am2 < 1e23);
});

function line(id, lon, lat, kinematics = "normal") {
  return {
    type: "Feature",
    properties: { id, name: id, kinematics, length_km: 80 },
    geometry: {
      type: "LineString",
      coordinates: [
        [lon - 0.4, lat],
        [lon + 0.4, lat],
      ],
    },
  };
}

function params(overrides) {
  return {
    lon: 0,
    lat: 0,
    diameterM: 1000,
    velocityMs: 10e3,
    densityImpactor: 3000,
    angleDeg: 45,
    efficiency: 1e-4,
    excavationFraction: 0.25,
    qualityFactor: 500,
    density: 2950,
    gravity: 3.71,
    simpleComplexM: 7000,
    youngsPa: 15e9,
    poisson: 0.25,
    cohesionPa: 2e6,
    phiDeg: 31,
    criticality: 0,
    regime: "normal",
    dipNormal: 60,
    dipThrust: 30,
    lambda: 0,
    frictionFactor: 1,
    clayReduction: 0,
    surfaceK: 210,
    mantleFlux: 0.0145,
    crustalHeatWm3: 1.42e-7,
    kCrust: 2.5,
    crustM: 50e3,
    bdtM: 40e3,
    heatRatio: 1,
    planetRadiusM: 3_396_190,
    planetMassKg: 6.417e23,
    support: "isostatic",
    reboundFraction: 1,
    tharsisLon: -100,
    tharsisLat: 0,
    tharsisRadiusDeg: 50,
    tharsisPa: 0,
    basinPa: { hellas: 0, isidis: 0, argyre: 0, utopia: 0 },
    masconPa: { hellas: 0, isidis: 0, argyre: 0, utopia: 0 },
    antipodePeak: 5,
    antipodeWidthDeg: 12,
    staticCutoffM: 2000e3,
    transferFraction: 0,
    transferExponent: 3,
    transferRangeM: 400e3,
    cascadePasses: 4,
    cascadeStressPa: 3e6,
    linkDistanceM: 150e3,
    seed: "mapped",
    damageRate: 1,
    damageAgeYears: 1,
    healYears: 1e8,
    ductileFraction: 0,
    teM: 100e3,
    hLithM: 100e3,
    lidLengthFactor: 3,
    plumeFraction: 0,
    slabVelocityMs: 1e-10,
    mantleDensity: 3500,
    depletion: 0,
    eclogiteFraction: 0,
    eclogiteDensity: 3500,
    cpRock: 1200,
    coreRadiusM: 1650e3,
    bmlM: 150e3,
    innerRadiusM: 0,
    coreMassKg: 1.17e23,
    cmbTemperatureK: 2200,
    kCore: 40,
    alphaCore: 1e-5,
    cpCore: 850,
    bmlTransfer: 1,
    secularFraction: 0,
    qCompWm2: 0,
    betaDynamo: 0.05,
    radioScale: 1,
    radioMode: "bsm",
    uraniumPpb: 16,
    thoriumPpb: 56,
    potassiumPpm: 305,
    uraniumMantlePpb: 10,
    thoriumMantlePpb: 36,
    potassiumMantlePpm: 190,
    silicateMassKg: 4.88e23,
    spinCoupling: 0,
    spinThreshold: 0.02,
    ohmicFraction: 0.01,
    dipoleFraction: 0.2,
    spinDurationYears: 1e4,
    coreHeatFraction: 0,
    heatedLayerM: 100e3,
    rotationPeriodS: 88775,
    moiFactor: 0.364,
    exobaseM: 220e3,
    nominalPressurePa: 0.7e-9,
    stormPressurePa: 3.5e-9,
    gunellPeakAm2: 2.5e24,
    earthMomentAm2: EARTH_MOMENT_AM2,
    includeImpact: true,
    depthSteps: 3,
    ...overrides,
  };
}

test("a nearer fault sees a larger impact stress, and transfer raises its neighbor", () => {
  const faults = prepareFaults([
    line("near", 5, 0),
    line("neighbor", 5.5, 0),
    line("far", 80, 0),
  ]);
  const overrides = {
    diameterM: 1000,
    efficiency: 1e-2,
    transferFraction: 0,
    staticCutoffM: 1,
    criticality: 1,
    cohesionPa: 0,
    phiDeg: 30,
    antipodePeak: 1,
    bdtM: 20e3,
  };
  const quiet = assessGlobal(faults, params(overrides), { detail: true });
  const byId = new Map(quiet.statuses.map((row) => [row.id, row]));
  assert.ok(byId.get("near").cfs > byId.get("far").cfs);
  const pushed = assessGlobal(
    faults,
    params({ ...overrides, transferFraction: 1, cascadeStressPa: 50e6, transferRangeM: 500e3 }),
    { detail: true },
  );
  const pushedById = new Map(pushed.statuses.map((row) => [row.id, row]));
  assert.ok(pushedById.get("neighbor").cfs > byId.get("neighbor").cfs);
});

test("along-strike extent is the span of the zone, not the sum of parallel traces", () => {
  const faults = [
    { lon: 0, lat: 0, strikeDeg: 90, lengthM: 1000e3 },
    { lon: 0, lat: 0.2, strikeDeg: 90, lengthM: 1000e3 },
    { lon: 0, lat: -0.2, strikeDeg: 90, lengthM: 1000e3 },
  ];
  const zone = alongStrikeExtentM(faults, 3_396_190);
  assert.ok(zone.traceLengthM > 2.9e6);
  assert.ok(zone.extentM < 1.4e6, `extent ${zone.extentM}`);
  assert.ok(zone.extentM > 0.9e6);
  assert.ok(Math.abs(zone.centroidLat) < 0.05);
});

test("CMB power uses the base-of-crust area, and a zero moment has no standoff", () => {
  const core = evaluateCore(params({
    mantleFlux: 0.02,
    crustalHeatWm3: 0,
    radioMode: "bsm",
    uraniumPpb: 0,
    thoriumPpb: 0,
    potassiumPpm: 0,
    secularFraction: 0,
    bmlTransfer: 1,
    includeImpact: false,
  }));
  const crustR = params().planetRadiusM - params().crustM;
  const expected = 0.02 * (crustR / params().coreRadiusM) ** 2;
  assert.ok(Math.abs(core.qCmbWm2 - expected) / expected < 1e-6, `${core.qCmbWm2} vs ${expected}`);
  const quiet = evaluateCore(params({
    mantleFlux: 0,
    crustalHeatWm3: 0,
    uraniumPpb: 0,
    thoriumPpb: 0,
    potassiumPpm: 0,
    includeImpact: false,
  }));
  assert.equal(quiet.momentAm2, 0);
  assert.equal(quiet.retention.nominalAltitudeM, null);
  assert.equal(quiet.fastProtective, false);
});

test("fastProtective stays false when the background is already protective", () => {
  const core = evaluateCore(params({
    mantleFlux: 5,
    crustalHeatWm3: 0,
    uraniumPpb: 0,
    thoriumPpb: 0,
    potassiumPpm: 0,
    gunellPeakAm2: 0,
    exobaseM: 0,
    includeImpact: true,
    massKg: 1e15,
    velocityMs: 10e3,
    angleDeg: 20,
    coupledJ: 1e20,
    spinCoupling: 0,
    coreHeatFraction: 0,
  }), { subductionInitiates: false });
  assert.equal(core.backgroundProtective, true);
  assert.equal(core.fastProtective, false);
});

test("ductile continuation applies only once failure reaches the BDT", () => {
  const faults = prepareFaults([line("a", 0.2, 0), line("b", 0.4, 0)]);
  const reached = assessGlobal(faults, params({
    bdtM: 20e3,
    crustM: 50e3,
    capAtMoho: true,
    teM: 40e3,
    ductileFraction: 1,
    criticality: 1,
    cohesionPa: 0,
    phiDeg: 30,
    dipNormal: 60,
    transferFraction: 0,
    tharsisPa: 0,
    diameterM: 50_000,
    efficiency: 1e-2,
    staticCutoffM: 5e6,
  }), { detail: false });
  assert.equal(reached.weakZone.reachedBdt, reached.weakZone.depthM >= 20e3 * 0.999);
  if (reached.weakZone.reachedBdt) {
    assert.ok(reached.weakZone.ductileM > 0);
    assert.ok(reached.weakZone.effectiveDepthM <= 50e3);
  }
  const blocked = assessGlobal(faults, params({
    bdtM: 100e3,
    crustM: 20e3,
    capAtMoho: true,
    teM: 100e3,
    ductileFraction: 1,
    criticality: 1,
    cohesionPa: 0,
    phiDeg: 30,
    transferFraction: 0,
    tharsisPa: 0,
  }), { detail: false });
  assert.equal(blocked.weakZone.ductileM, 0);
  assert.equal(blocked.weakZone.ductileBlockedByMoho, true);
  assert.ok(blocked.weakZone.depthM <= 20e3 + 1);
});

test("the shipped global catalog is real SIM 3292 lines, not an empty placeholder", () => {
  const catalog = JSON.parse(readFileSync(new URL("../public/faults/sim3292_global.geojson", import.meta.url)));
  assert.ok(catalog.features.length > 500);
  assert.equal(catalog.source_doi, "10.3133/sim3292");
  const sample = catalog.features[0];
  assert.ok(sample.properties.kinematics === "normal" || sample.properties.kinematics === "thrust");
  assert.ok(sample.geometry.coordinates.length >= 2);
  assert.ok(sample.properties.length_km >= 50);
});
