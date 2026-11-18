import assert from "node:assert/strict";
import test from "node:test";

import { destinationPoint } from "../src/model/physics.js";
import { prepareGrid } from "../src/model/scenario.js";
import {
  DEFAULT_DIP_SOURCE,
  DIP_CAVEAT,
  resolveDip,
  resolveDipAzimuth,
} from "../src/model/dips.js";

const REGIONS = ["valles_marineris", "cerberus_fossae", "isidis_planitia"];
const SOURCES = ["wheeler", "hirise", "literature"];

test("the default dip source is Wheeler's measurements", () => {
  assert.equal(DEFAULT_DIP_SOURCE, "wheeler");
});

test("defaults load from the measured catalog and the selector switches them", () => {
  const vm = resolveDip({ regionId: "valles_marineris", source: "wheeler", kinematics: "normal" });
  const vmHirise = resolveDip({ regionId: "valles_marineris", source: "hirise", kinematics: "normal" });
  const vmLiterature = resolveDip({ regionId: "valles_marineris", source: "literature", kinematics: "normal" });
  assert.ok(Math.abs(vm.dipDeg - 51.79) < 0.001);
  assert.ok(vm.min <= 36.9 && vm.max >= 66.4);
  assert.equal(vm.population, "wheeler");
  assert.equal(vm.badge, "Wheeler");
  assert.ok(Math.abs(vmHirise.dipDeg - 26.67) < 0.001);
  assert.equal(vmHirise.population, "hirise");
  assert.notEqual(vmHirise.dipDeg, vm.dipDeg);
  assert.equal(vmLiterature.dipDeg, 60);
  assert.equal(vmLiterature.min, 50);
  assert.equal(vmLiterature.max, 70);

  const cerberus = resolveDip({ regionId: "cerberus_fossae", source: "wheeler", kinematics: "normal" });
  const cerberusHirise = resolveDip({ regionId: "cerberus_fossae", source: "hirise", kinematics: "normal" });
  const cerberusLiterature = resolveDip({ regionId: "cerberus_fossae", source: "literature", kinematics: "normal" });
  assert.ok(Math.abs(cerberus.dipDeg - 54.57) < 0.001);
  assert.ok(cerberus.min <= 30.3 && cerberus.max >= 73.2);
  assert.match(cerberus.summary, /61\.3/);
  assert.match(cerberus.summary, /90/);
  assert.ok(Math.abs(cerberusHirise.dipDeg - 54.72) < 0.001);
  assert.equal(cerberusLiterature.dipDeg, 60);

  const isidis = resolveDip({ regionId: "isidis_planitia", source: "wheeler", kinematics: "thrust" });
  const isidisHirise = resolveDip({ regionId: "isidis_planitia", source: "hirise", kinematics: "thrust" });
  const isidisLiterature = resolveDip({ regionId: "isidis_planitia", source: "literature", kinematics: "thrust" });
  assert.ok(Math.abs(isidis.dipDeg - 15.61) < 0.001);
  assert.equal(isidis.n, 5);
  assert.equal(isidis.lowConfidence, true);
  assert.equal(isidis.badge, "low confidence");
  assert.match(isidis.summary, /[Ll]ow confidence/);
  assert.equal(isidisHirise.dipDeg, isidis.dipDeg);
  assert.equal(isidisHirise.lowConfidence, true);
  assert.equal(isidisLiterature.dipDeg, 30);
  assert.equal(isidisLiterature.min, 20);
  assert.equal(isidisLiterature.max, 40);
  assert.equal(isidisLiterature.lowConfidence, false);
});

test("a region without a measurement for that fault type keeps the literature fallback", () => {
  const thrust = resolveDip({ regionId: "valles_marineris", source: "wheeler", kinematics: "thrust" });
  assert.equal(thrust.dipDeg, 30);
  assert.equal(thrust.fallback, true);
  assert.equal(thrust.badge, "literature fallback");
  const normal = resolveDip({ regionId: "isidis_planitia", source: "hirise", kinematics: "normal" });
  assert.equal(normal.dipDeg, 60);
  assert.equal(normal.fallback, true);
});

test("every dip default sits inside the slider range", () => {
  for (const regionId of REGIONS) {
    for (const source of SOURCES) {
      for (const kinematics of ["normal", "thrust"]) {
        const dip = resolveDip({ regionId, source, kinematics });
        assert.ok(
          dip.min <= dip.dipDeg && dip.dipDeg <= dip.max,
          `${regionId} ${source} ${kinematics} ${dip.dipDeg} outside ${dip.min}–${dip.max}`,
        );
        assert.ok(dip.summary.length > 40);
      }
    }
  }
});

test("the surface-slope caveat names talus and Isidis", () => {
  assert.match(DIP_CAVEAT, /talus/i);
  assert.match(DIP_CAVEAT, /Isidis/);
  assert.match(DIP_CAVEAT, /proxy/i);
});

test("opposed graben walls supply the dip direction when the segment is parallel to them", () => {
  const south = resolveDipAzimuth({
    strikeDeg: 110,
    regionId: "cerberus_fossae",
    source: "wheeler",
    kinematics: "normal",
  });
  assert.equal(south.source, "measured");
  assert.equal(south.wallId, "cerberus-graben-198");
  assert.ok(Math.abs(south.dipAzimuthDeg - 198.27) < 0.001);

  const north = resolveDipAzimuth({
    strikeDeg: 290,
    regionId: "cerberus_fossae",
    source: "hirise",
    kinematics: "normal",
  });
  assert.equal(north.source, "measured");
  assert.equal(north.wallId, "cerberus-polygon-021");
  assert.ok(Math.abs(north.dipAzimuthDeg - 20.54) < 0.001);

  const oblique = resolveDipAzimuth({
    strikeDeg: 0,
    regionId: "cerberus_fossae",
    source: "wheeler",
    kinematics: "normal",
  });
  assert.equal(oblique.source, "right-hand");
  assert.equal(oblique.dipAzimuthDeg, 90);
});

test("literature dips keep the right-hand normal, and an explicit azimuth wins", () => {
  const literature = resolveDipAzimuth({
    strikeDeg: 110,
    regionId: "cerberus_fossae",
    source: "literature",
    kinematics: "normal",
  });
  assert.equal(literature.source, "right-hand");
  assert.equal(literature.dipAzimuthDeg, 200);

  const explicit = resolveDipAzimuth({
    strikeDeg: 110,
    regionId: "cerberus_fossae",
    source: "wheeler",
    kinematics: "normal",
    explicitAzimuthDeg: 77,
  });
  assert.equal(explicit.source, "feature");
  assert.equal(explicit.dipAzimuthDeg, 77);
});

test("the Isidis wrinkle-ridge dip direction is used only when the segment faces that flank", () => {
  const facing = resolveDipAzimuth({
    strikeDeg: 242,
    regionId: "isidis_planitia",
    source: "wheeler",
    kinematics: "thrust",
  });
  assert.equal(facing.source, "measured");
  assert.equal(facing.wallId, "isidis-wrinkle-327");
  assert.ok(Math.abs(facing.dipAzimuthDeg - 326.8) < 0.001);

  const opposite = resolveDipAzimuth({
    strikeDeg: 62,
    regionId: "isidis_planitia",
    source: "hirise",
    kinematics: "thrust",
  });
  assert.equal(opposite.source, "right-hand");
  assert.equal(opposite.dipAzimuthDeg, 152);
});

test("prepareGrid keeps the slider dip and snaps only the azimuth", () => {
  const start = { lon: 157.4, lat: 10.1 };
  const end = destinationPoint(start.lon, start.lat, 110, 20_000);
  const grid = prepareGrid({
    faults: [
      {
        id: "cf-test",
        name: "Cerberus test",
        kinematics: "normal",
        dipDeg: 54.57,
        dipAzimuthDeg: null,
        regionId: "cerberus_fossae",
        dipSource: "wheeler",
        coordinates: [
          [start.lon, start.lat],
          [end.lon, end.lat],
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
      crustM: 35_000,
      bdtM: 40_000,
    },
    creep: { mode: "reference_viscosity", eta0: 1e21, prefactorA: 1, exponentN: 1, activationJmol: 1 },
    sampling: { spacingM: 100_000, depthSteps: 2 },
  });
  assert.equal(grid.segments.length, 1);
  const segment = grid.segments[0];
  assert.equal(segment.dipDeg, 54.57);
  assert.equal(segment.dipAzimuthSource, "measured");
  assert.equal(segment.dipAzimuthWallId, "cerberus-graben-198");
  assert.ok(Math.abs(segment.dipAzimuthDeg - 198.27) < 0.001);
});
