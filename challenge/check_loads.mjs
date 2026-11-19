/**
 * Ask the website's own loader to read an offline-run file.
 *
 *   node challenge/check_loads.mjs challenge/output/baseline_offline_run.json
 *
 * This does not open a browser. It calls interpolateOffline, which is the
 * function the Basin & Global page uses when an offline file is selected.
 */

import { readFileSync } from "node:fs";
import { interpolateOffline } from "../src/model/globalPhysics.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node challenge/check_loads.mjs <offline-run.json>");
  process.exit(1);
}

let catalog;
try {
  catalog = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(`Could not read ${path}: ${error.message}`);
  process.exit(1);
}

const first = catalog.runs?.[0];
if (!first) {
  console.error("The loader found no runs. Validate the file and read the message.");
  process.exit(1);
}

const query = {};
for (const axis of catalog.axes || []) query[axis] = first[axis];
const loaded = interpolateOffline(catalog, query);

if (!loaded.interpolated || !loaded.values) {
  console.error("The loader did not accept this file.");
  console.error(loaded.reason || "No values were returned.");
  process.exit(1);
}

console.log("The explorer's loader accepted this file.");
console.log(`Queried the first grid point: ${JSON.stringify(query)}`);
console.log(`dynamo_on: ${loaded.values.dynamo_on}`);
console.log(`regime: ${loaded.values.regime}`);
console.log(`magnetic_moment_Am2: ${loaded.values.magnetic_moment_Am2}`);
console.log(`standoff_over_rp: ${loaded.values.standoff_over_rp}`);
console.log(`time_to_onset_yr: ${loaded.values.time_to_onset_yr}`);
if (loaded.thresholdWarning) {
  console.log("The neighboring runs disagree on dynamo on/off or on the regime. The page will leave those fields blank at points between them.");
}
if (loaded.extrapolated) {
  console.log("That query sits on the edge of a one-point grid. On the website, other slider positions will say they are outside the grid and will reuse this edge.");
}
