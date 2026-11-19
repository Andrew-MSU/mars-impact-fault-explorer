import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { interpolateOffline } from "../src/model/globalPhysics.js";

const catalog = JSON.parse(readFileSync(new URL("../challenge/example/baseline_offline_run.json", import.meta.url), "utf8"));

test("the challenge example loads through the explorer interpolator", () => {
  assert.equal(catalog.schema, "mars-explorer-offline-run/v1");
  assert.equal(catalog.example, false);
  const dry = interpolateOffline(catalog, { impactor_diameter_m: 1000, water_fraction: 0 });
  assert.equal(dry.interpolated, true);
  assert.equal(dry.thresholdWarning, false);
  assert.equal(dry.values.dynamo_on, false);
  assert.equal(dry.values.regime, "slip");
  assert.equal(dry.values.time_to_onset_yr, null);
  assert.ok(dry.values.magnetic_moment_Am2 > 1e20);
  assert.ok(dry.values.magnetic_moment_Am2 < 1e21);
  assert.ok(dry.values.standoff_over_rp > 1);

  const wet = interpolateOffline(catalog, { impactor_diameter_m: 1000, water_fraction: 1 });
  assert.equal(wet.values.regime, "lid");
  assert.equal(wet.values.dynamo_on, false);

  // Dry is "slip" and wet is "lid", so the regime is not interpolated across water.
  const between = interpolateOffline(catalog, { impactor_diameter_m: 1000, water_fraction: 0.5 });
  assert.equal(between.thresholdWarning, true);
  assert.equal(between.values.regime, null);
  assert.equal(between.values.dynamo_on, false);
});
