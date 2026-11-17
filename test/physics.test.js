import assert from "node:assert/strict";
import test from "node:test";

import {
  MARS_RADIUS_M,
  azimuthDeg,
  backgroundOnFault,
  boussinesq,
  coupledEnergyJ,
  deltaCfsFromCompressionTensor,
  destinationPoint,
  dynamicStressPa,
  effectiveViscosityPaS,
  finalCraterDiameterM,
  haversineM,
  impactorMassKg,
  kineticEnergyJ,
  momentMagnitude,
  peakGroundVelocityMs,
  seismicEnergyJ,
  shearModulusPa,
  temperatureK,
  tensorFromCylindrical,
  transientCraterDiameterM,
} from "../src/model/physics.js";
import { onsetDiameter, prepareGrid, repeatedImpacts, runImpact, stressHistory } from "../src/model/scenario.js";

const MU30 = Math.tan(Math.PI / 6);

test("moment magnitude increases with seismic energy", () => {
  const small = momentMagnitude(1e12);
  const large = momentMagnitude(1e15);
  assert.ok(large > small);
  // log10(E) = 1.5 M + 4.8, so ×10 in energy is +2/3 magnitude.
  assert.ok(Math.abs(large - small - 2) < 1e-9);
});

test("seismic magnitude increases with impactor diameter, velocity, and efficiency", () => {
  const magnitudeFor = (diameter, velocity, efficiency) => {
    const mass = impactorMassKg(diameter, 3000);
    const energy = seismicEnergyJ(coupledEnergyJ(kineticEnergyJ(mass, velocity), 45), efficiency);
    return momentMagnitude(energy);
  };
  assert.ok(magnitudeFor(2000, 10_000, 1e-4) > magnitudeFor(1000, 10_000, 1e-4));
  assert.ok(magnitudeFor(1000, 20_000, 1e-4) > magnitudeFor(1000, 10_000, 1e-4));
  const low = magnitudeFor(1000, 10_000, 1e-5);
  const high = magnitudeFor(1000, 10_000, 1e-4);
  assert.ok(Math.abs(high - low - 2 / 3) < 1e-9);
});

test("a vertical impact couples more kinetic energy than a shallow one", () => {
  const kinetic = 1e18;
  assert.ok(coupledEnergyJ(kinetic, 90) > coupledEnergyJ(kinetic, 30));
  assert.ok(Math.abs(coupledEnergyJ(kinetic, 90) - kinetic) < 1e-6);
});

test("transient crater diameter matches the Collins-Holsapple expression and grows with size and speed", () => {
  const args = {
    diameterM: 1000,
    velocityMs: 10_000,
    densityImpactor: 3000,
    densityTarget: 2950,
    gravity: 3.71,
    angleDeg: 45,
  };
  const theta = (45 * Math.PI) / 180;
  const expected =
    1.161 *
    (3000 / 2950) ** (1 / 3) *
    1000 ** 0.78 *
    10_000 ** 0.44 *
    3.71 ** -0.22 *
    Math.sin(theta) ** (1 / 3);
  assert.ok(Math.abs(transientCraterDiameterM(args) / expected - 1) < 1e-12);
  assert.ok(transientCraterDiameterM({ ...args, diameterM: 2000 }) > expected);
  assert.ok(transientCraterDiameterM({ ...args, velocityMs: 15_000 }) > expected);
  assert.ok(transientCraterDiameterM({ ...args, gravity: 9.81 }) < expected);
  assert.ok(finalCraterDiameterM(expected) > expected);
});

test("extension raises ΔCFS on a normal fault and lowers it on a thrust", () => {
  // Uniaxial east-west extension of 1 MPa. Fault dips east (azimuth 90°).
  const extension = [
    [-1e6, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const compression = [
    [1e6, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const normal = deltaCfsFromCompressionTensor(extension, {
    dipDeg: 60,
    dipAzimuthDeg: 90,
    kinematics: "normal",
    mu: MU30,
  });
  const thrust = deltaCfsFromCompressionTensor(extension, {
    dipDeg: 30,
    dipAzimuthDeg: 90,
    kinematics: "thrust",
    mu: MU30,
  });
  const thrustSqueezed = deltaCfsFromCompressionTensor(compression, {
    dipDeg: 30,
    dipAzimuthDeg: 90,
    kinematics: "thrust",
    mu: MU30,
  });
  const normalSqueezed = deltaCfsFromCompressionTensor(compression, {
    dipDeg: 60,
    dipAzimuthDeg: 90,
    kinematics: "normal",
    mu: MU30,
  });

  const expected = (dSigH, dipDeg, kinematics) => {
    const dip = (dipDeg * Math.PI) / 180;
    const shearNormalSense = -dSigH * Math.sin(dip) * Math.cos(dip);
    const deltaTau = kinematics === "thrust" ? -shearNormalSense : shearNormalSense;
    const unclamp = -dSigH * Math.sin(dip) ** 2;
    return deltaTau + MU30 * unclamp;
  };

  assert.ok(Math.abs(normal.deltaCfs - expected(-1e6, 60, "normal")) / 1e6 < 1e-9);
  assert.ok(Math.abs(thrust.deltaCfs - expected(-1e6, 30, "thrust")) / 1e6 < 1e-9);
  assert.ok(normal.deltaCfs > 0, "extension promotes normal slip");
  assert.ok(thrust.deltaCfs < 0, "extension inhibits thrust slip");
  assert.ok(thrustSqueezed.deltaCfs > 0, "compression promotes thrust slip");
  assert.ok(normalSqueezed.deltaCfs < 0, "compression inhibits normal slip");
  assert.ok(normal.deltaSigmaNUnclamp > 0);
  assert.equal(normal.deltaCfs, normal.deltaTau + MU30 * normal.deltaSigmaNUnclamp);
});

test("a critically stressed optimal fault sits on the failure envelope", () => {
  const phi = 31;
  const normal = backgroundOnFault({
    depthM: 10_000,
    density: 2950,
    gravity: 3.71,
    phiDeg: phi,
    cohesionPa: 2e6,
    lambda: 0,
    criticality: 1,
    regime: "normal",
    dipDeg: 45 + phi / 2,
    kinematics: "normal",
  });
  assert.ok(Math.abs(normal.cfs) < 1e-3 * normal.strength);
  const thrust = backgroundOnFault({
    depthM: 10_000,
    density: 2950,
    gravity: 3.71,
    phiDeg: phi,
    cohesionPa: 2e6,
    lambda: 0,
    criticality: 1,
    regime: "thrust",
    dipDeg: 45 - phi / 2,
    kinematics: "thrust",
  });
  assert.ok(Math.abs(thrust.cfs) < 1e-3 * thrust.strength);
});

test("a non-optimal fault and a subcritical stress state are stable", () => {
  const base = {
    depthM: 10_000,
    density: 2950,
    gravity: 3.71,
    phiDeg: 31,
    cohesionPa: 2e6,
    lambda: 0,
    criticality: 1,
    regime: "normal",
    dipDeg: 80,
    kinematics: "normal",
  };
  const steep = backgroundOnFault(base);
  assert.ok(steep.cfs < 0);
  const relaxed = backgroundOnFault({ ...base, dipDeg: 45 + 31 / 2, criticality: 0.5 });
  assert.ok(relaxed.cfs < -1e6);
});

test("higher cohesion makes the background fault more stable", () => {
  const args = {
    depthM: 8_000,
    density: 2950,
    gravity: 3.71,
    phiDeg: 31,
    lambda: 0,
    criticality: 0.7,
    regime: "normal",
    dipDeg: 60,
    kinematics: "normal",
  };
  const weak = backgroundOnFault({ ...args, cohesionPa: 0.5e6 });
  const strong = backgroundOnFault({ ...args, cohesionPa: 6e6 });
  assert.ok(strong.cfs < weak.cfs);
});

test("Boussinesq vertical stress on the load axis matches 3P / (2 π z²)", () => {
  const force = 1e12;
  const depth = 5000;
  const field = boussinesq({ forceDownN: force, radiusM: 0, depthM: depth, poisson: 0.25 });
  const expected = (3 * force) / (2 * Math.PI * depth * depth);
  assert.ok(Math.abs(field.sigmaZ / expected - 1) < 1e-9);
  assert.ok(field.sigmaZ > 0);
});

test("radial cylindrical stress rotates into the east component", () => {
  const tensor = tensorFromCylindrical({
    sigmaR: -2e6,
    sigmaTheta: 0,
    sigmaZ: 0,
    tauRZ: 0,
    east: 1,
    north: 0,
  });
  assert.ok(Math.abs(tensor[0][0] + 2e6) < 1);
  assert.ok(Math.abs(tensor[1][1]) < 1);
  assert.ok(Math.abs(tensor[2][2]) < 1);
});

test("crater unloading favors a radial normal fault and inhibits a thrust", () => {
  // At r ≈ 3z the horizontal stress in the annulus is extensional. Closer
  // than about one depth, the point-load solution's Poisson term flips the
  // horizontal sign; that near field is inside the excavation cavity.
  const depth = 10_000;
  const field = boussinesq({
    forceDownN: -1e16,
    radiusM: 3 * depth,
    depthM: depth,
    poisson: 0.25,
  });
  assert.ok(field.sigmaR < 0, "unloading puts the annulus in radial extension");
  assert.ok(field.sigmaZ < 0, "unloading reduces vertical compression");
  const tensor = tensorFromCylindrical({ ...field, east: 1, north: 0 });
  const normal = deltaCfsFromCompressionTensor(tensor, {
    dipDeg: 60,
    dipAzimuthDeg: 90,
    kinematics: "normal",
    mu: MU30,
  });
  const thrust = deltaCfsFromCompressionTensor(tensor, {
    dipDeg: 30,
    dipAzimuthDeg: 90,
    kinematics: "thrust",
    mu: MU30,
  });
  assert.ok(normal.deltaCfs > 0);
  assert.ok(thrust.deltaCfs < 0);
});

test("peak ground velocity and dynamic stress fall with distance", () => {
  const near = peakGroundVelocityMs({
    seismicEnergy: 1e15,
    density: 2950,
    shearVelocity: 2000,
    durationS: 5,
    distanceM: 20_000,
    qualityFactor: 500,
  });
  const far = peakGroundVelocityMs({
    seismicEnergy: 1e15,
    density: 2950,
    shearVelocity: 2000,
    durationS: 5,
    distanceM: 200_000,
    qualityFactor: 500,
  });
  assert.ok(near > far);
  assert.ok(near <= 0.05 * 2000);
  assert.ok(dynamicStressPa(near, 2950, 2000) > dynamicStressPa(far, 2950, 2000));
});

test("geotherm starts at the surface temperature and warms downward", () => {
  const thermal = {
    surfaceK: 210,
    mantleFlux: 0.0145,
    heatProduction: 1.42e-7,
    conductivity: 2.5,
    crustM: 45_000,
  };
  assert.ok(Math.abs(temperatureK(0, thermal) - 210) < 1e-9);
  const shallow = temperatureK(1000, thermal);
  const deep = temperatureK(20_000, thermal);
  assert.ok(deep > shallow);
  const z = 1000;
  const closedForm =
    210 +
    (thermal.mantleFlux * z) / thermal.conductivity +
    (thermal.heatProduction / (2 * thermal.conductivity)) * z * (2 * thermal.crustM - z);
  assert.ok(Math.abs(temperatureK(z, thermal) - closedForm) < 1e-6);
});

test("cold crust does not creep and wet diabase is weaker than dry diabase when hot", () => {
  const cold = effectiveViscosityPaS({
    stressDiffPa: 50e6,
    temperatureK: 300,
    prefactorA: 8,
    exponentN: 4.7,
    activationJmol: 485e3,
  });
  // 300 K is far below the dislocation-creep window. The Maxwell time is
  // longer than the age of the solar system, which the series treats as no relaxation.
  assert.ok(cold > 1e40);
  const shared = { stressDiffPa: 100e6, temperatureK: 1100 };
  const dry = effectiveViscosityPaS({
    ...shared,
    prefactorA: 8,
    exponentN: 4.7,
    activationJmol: 485e3,
  });
  const wet = effectiveViscosityPaS({
    ...shared,
    prefactorA: 0.0612,
    exponentN: 3.05,
    activationJmol: 276e3,
  });
  assert.ok(Number.isFinite(dry) && Number.isFinite(wet));
  assert.ok(wet < dry);
});

test("great-circle distance of one degree of latitude is the Martian radius times π/180", () => {
  const distance = haversineM(0, 0, 0, 1);
  assert.ok(Math.abs(distance - (MARS_RADIUS_M * Math.PI) / 180) / distance < 1e-12);
  const there = destinationPoint(10, -20, 0, 50_000);
  assert.ok(there.lat > -20);
  assert.ok(Math.abs(there.lon - 10) < 1e-6);
  const back = haversineM(10, -20, there.lon, there.lat);
  assert.ok(Math.abs(back - 50_000) < 0.01);
  assert.ok(Math.abs(azimuthDeg(0, 0, 0, 1)) < 1e-9);
});

function toySpec(overrides = {}) {
  return {
    faults: [
      {
        id: "n1",
        name: "Normal test",
        kinematics: "normal",
        dipDeg: 60,
        dipAzimuthDeg: 90,
        coordinates: [
          [0, 0],
          [0, 1],
        ],
      },
      {
        id: "t1",
        name: "Thrust test",
        kinematics: "thrust",
        dipDeg: 30,
        dipAzimuthDeg: 90,
        coordinates: [
          [1.2, 0],
          [1.2, 0.4],
        ],
      },
    ],
    material: {
      youngsPa: 15e9,
      poisson: 0.25,
      cohesionPa: 2e6,
      phiDeg: 31,
      lambda: 0,
      criticality: 0.9,
      regime: "normal",
      density: 2950,
      gravity: 3.71,
    },
    thermal: {
      surfaceK: 210,
      mantleFlux: 0.02,
      heatProduction: 1.4e-7,
      conductivity: 2.5,
      crustM: 45_000,
      bdtM: 40_000,
    },
    creep: {
      mode: "creep",
      prefactorA: 8,
      exponentN: 4.7,
      activationJmol: 485e3,
      eta0: 1e21,
    },
    sampling: { spacingM: 30_000, depthSteps: 6 },
    ...overrides,
  };
}

test("a larger impact reactivates a larger fraction of the regime-matching faults", () => {
  const grid = prepareGrid(toySpec());
  const impact = {
    lon: 0.15,
    lat: 0.5,
    velocityMs: 12_000,
    densityImpactor: 3000,
    angleDeg: 45,
    efficiency: 5e-4,
    stressDropPa: 3e6,
    excavationFraction: 0.25,
    qualityFactor: 400,
  };
  const material = toySpec().material;
  const small = runImpact(grid, { ...impact, diameterM: 200 }, material);
  const large = runImpact(grid, { ...impact, diameterM: 20_000 }, material);
  assert.ok(large.source.magnitude > small.source.magnitude);
  assert.ok(large.source.finalM > small.source.finalM);
  assert.ok((large.fractionRegime ?? 0) >= (small.fractionRegime ?? 0));
  const rows = [small, large].map((result, index) => ({
    diameterM: index === 0 ? 200 : 20_000,
    fractionRegime: result.fractionRegime,
  }));
  if ((large.fractionRegime ?? 0) > 0 && !(small.fractionRegime > 0)) {
    assert.equal(onsetDiameter(rows), 20_000);
  }
});

test("repeated impacts accumulate static stress and viscous relaxation can shed it", () => {
  const samples = [
    {
      area: 1,
      kinematics: "normal",
      cfsBg: -2e6,
      dStatic: 1e6,
      dDynamic: 0,
      tMaxwell: Infinity,
      excavated: false,
      strength: 10e6,
    },
  ];
  const stuck = repeatedImpacts(samples, { intervalYears: 1e6, count: 3, regime: "normal" });
  // Each impact adds 1 MPa of static ΔCFS against a 2 MPa deficit.
  // The second impact lands exactly on the failure envelope.
  assert.equal(stuck.points[0].fractionSustained, 0);
  assert.equal(stuck.points[1].fractionSustained, 1);
  assert.equal(stuck.onsetSustainedYears, 1e6);

  const history = stressHistory({
    cfsBg: -1e6,
    dStatic: 1e6,
    dDynamic: 0,
    tMaxwell: 1,
    intervalYears: 1e6,
    count: 4,
  });
  const relaxed = history.points.filter((point) => point.phase === "relaxed");
  assert.ok(relaxed.every((point) => Math.abs(point.accumulated) < 1));
});

test("brittle grid does not place samples below the BDT", () => {
  const grid = prepareGrid(toySpec());
  for (const segment of grid.segments) {
    for (const depth of segment.depths) {
      assert.ok(depth.z < 40_000);
      assert.ok(depth.z > 0);
    }
  }
  assert.ok(grid.segments.some((segment) => segment.kinematics === "normal"));
  assert.ok(grid.segments.some((segment) => segment.kinematics === "thrust"));
});

test("shear modulus uses the rock-mass Young's modulus", () => {
  const mu = shearModulusPa(15e9, 0.25);
  assert.ok(Math.abs(mu - 15e9 / 2.5) < 1);
});
