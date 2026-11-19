/**
 * Run the Mars Impact Fault Explorer's Basin & Global model from the
 * command line, and write the JSON file the website knows how to load.
 *
 * This is the same math as the Basin & Global page (src/model/globalScenario.js).
 * It is a first-order estimate. It is not VPLanet, and it is not a
 * finite-element model.
 *
 * Edit the KNOBS section, save, and run again from the repository root:
 *
 *   node challenge/run_explorer_model.mjs
 *
 * Leave the code below the knobs alone until the first run has worked.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EARLY_TE_KM, GLOBAL_AUX, PRESENT_TE_KM, buildGlobalParams, creepEnds } from "../src/globalAux.js";
import { DEFAULT_DIP_SOURCE, resolveDip, resolveDipAzimuth } from "../src/model/dips.js";
import { classifyOutcome } from "../src/model/globalPhysics.js";
import { MARS_RADIUS_M } from "../src/model/physics.js";
import { assessGlobal, evaluateCore, prepareFaults, withWater } from "../src/model/globalScenario.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// ---------------------------------------------------------------------------
// KNOBS. These are the numbers worth changing. One change at a time.
// ---------------------------------------------------------------------------

// "early" uses the early-Mars heat flow, a wetter starting point available
// through the water knob, and a 15 km elastic thickness.
// "present" uses today's heat flow and a 100 km elastic thickness.
const EPOCH = "early";

// Impactor diameter in meters. The point-load model is meant for impactors
// under about 80 km (80_000 m). Larger values are still run, because that is
// where spin stirring can appear, and the printout marks them.
const DIAMETERS_M = [1_000, 10_000, 50_000, 100_000, 300_000];

// 0 is dry rock. 1 is wet rock (weaker faults, wet creep). The website's
// water slider is this same number.
const WATER_FRACTIONS = [0, 1];

// Where the impactor hits. Longitude is degrees east (negative is west),
// latitude is degrees north (negative is south).
// Hellas is the default: a large basin, and a useful place to ask the question.
// Valles Marineris is about -70.2, -9.2. Isidis is about 87, 12.9.
const IMPACT_LON = 70.5;
const IMPACT_LAT = -42.4;

// Speed in m/s (10_000 is 10 km/s). Angle is degrees from horizontal.
// 90 is straight down. 45 is the most common impact angle.
const VELOCITY_M_S = 10_000;
const ANGLE_DEG = 45;

// Which core is written into the website file.
// "bml"          1650 km metallic core plus a 150 km molten silicate layer.
// "homogeneous"  1830 km core, no molten layer. The spreadsheet's VPLanet row.
// "inner"        613 km solid inner core inside the 1650 km core.
// The other two are always printed in the comparison table.
const CORE_PRESET = "bml";

// Multiplies radiogenic heating. 1 uses the spreadsheet abundances.
// 2 doubles them. 0.5 cuts them in half.
const RADIO_SCALE = 1;

// Leave null to use 15 km on early Mars and 100 km for the present day.
// Set a number (in km) to override the elastic thickness.
const TE_KM_OVERRIDE = null;

const POINT_LOAD_LIMIT_M = 80_000;

// ---------------------------------------------------------------------------
// Below here is the run itself.
// ---------------------------------------------------------------------------

const catalog = JSON.parse(readFileSync(join(root, "data/parameters.json"), "utf8"));
const regions = JSON.parse(readFileSync(join(root, "data/regions.json"), "utf8")).regions;
const faultFile = JSON.parse(readFileSync(join(root, "public/faults/sim3292_global.geojson"), "utf8"));

function fail(message) {
  console.error(`\nStopped: ${message}\n`);
  process.exit(1);
}

function sheet(key) {
  const row = catalog.parameters.find((item) => item.key === key);
  if (!row) fail(`The parameter sheet has no row named ${key}.`);
  return row;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function focusRegionId(lon, lat) {
  const region = regions.find((item) => lon >= item.west && lon <= item.east && lat >= item.south && lat <= item.north);
  return region ? region.id : null;
}

function presets() {
  const bmlKm = sheet("R_core_BML").value;
  const homogeneousKm = sheet("R_core_std").value;
  const mass = sheet("M_core");
  return {
    bml: {
      id: "bml",
      name: "1650 km + 150 km melt",
      coreRadiusM: bmlKm * 1000,
      bmlM: 150e3,
      innerRadiusM: 0,
      coreMassKg: mass.min,
    },
    homogeneous: {
      id: "homogeneous",
      name: "1830 km homogeneous",
      coreRadiusM: homogeneousKm * 1000,
      bmlM: 0,
      innerRadiusM: 0,
      coreMassKg: mass.value,
    },
    inner: {
      id: "inner",
      name: "613 km inner core",
      coreRadiusM: bmlKm * 1000,
      bmlM: 150e3,
      innerRadiusM: 613e3,
      coreMassKg: mass.min,
    },
  };
}

function makeState() {
  if (EPOCH !== "early" && EPOCH !== "present") fail('EPOCH must be "early" or "present".');
  if (!Array.isArray(DIAMETERS_M) || DIAMETERS_M.length === 0) fail("DIAMETERS_M needs at least one diameter, in meters.");
  if (DIAMETERS_M.some((value) => !(value > 0))) fail("Every diameter must be a positive number of meters.");
  if (!Array.isArray(WATER_FRACTIONS) || WATER_FRACTIONS.length === 0) fail("WATER_FRACTIONS needs at least one value.");
  if (WATER_FRACTIONS.some((value) => !(value >= 0 && value <= 1))) fail("Each water fraction must be from 0 (dry) to 1 (wet).");
  const coreCatalog = presets();
  if (!coreCatalog[CORE_PRESET]) fail('CORE_PRESET must be "bml", "homogeneous", or "inner".');

  const values = {};
  for (const parameter of catalog.parameters) values[parameter.key] = parameter.value;
  // The page loads on the 1650 km core, so the core mass starts at the
  // basal-melt value (the bottom of the sheet range). Presets replace it.
  values.M_core = sheet("M_core").min;

  const aux = {};
  for (const [key, spec] of Object.entries(GLOBAL_AUX)) aux[key] = spec.value;
  aux.diameter_m = DIAMETERS_M[0];
  aux.velocity_m_s = VELOCITY_M_S;
  aux.density_impactor = 3000;
  aux.angle_deg = ANGLE_DEG;
  aux.efficiency = 1e-4;
  aux.excavation_fraction = 0.25;
  aux.quality_factor = 500;
  aux.criticality = 0.85;
  aux.k_thermal = 2.5;
  aux.radio_scale = RADIO_SCALE;
  aux.water_fraction = WATER_FRACTIONS[0];
  aux.te_km = TE_KM_OVERRIDE == null
    ? (EPOCH === "early" ? EARLY_TE_KM : PRESENT_TE_KM)
    : TE_KM_OVERRIDE;

  return {
    epoch: EPOCH,
    regime: "normal",
    modulus: "rock_mass",
    cohesion: "rock_mass",
    impact: { lon: IMPACT_LON, lat: IMPACT_LAT },
    capAtMoho: true,
    seed: "mapped",
    support: "isostatic",
    radioMode: "bsm",
    dipSource: DEFAULT_DIP_SOURCE,
    values,
    aux,
  };
}

function attachDips(params, state) {
  params.resolveDip = (fault) => {
    if (fault.dipDeg != null) return fault.dipDeg;
    const regionId = focusRegionId(fault.lon, fault.lat);
    return resolveDip({
      regionId: regionId || "valles_marineris",
      source: regionId ? state.dipSource : "literature",
      kinematics: fault.kinematics,
    }).dipDeg;
  };
  params.resolveAzimuth = (fault) => resolveDipAzimuth({
    strikeDeg: fault.strikeDeg,
    regionId: focusRegionId(fault.lon, fault.lat),
    source: state.dipSource,
    kinematics: fault.kinematics,
    explicitAzimuthDeg: fault.explicitAzimuthDeg,
  }).dipAzimuthDeg;
  return params;
}

function applyCore(params, preset) {
  return {
    ...params,
    coreRadiusM: preset.coreRadiusM,
    bmlM: preset.bmlM,
    innerRadiusM: preset.innerRadiusM,
    coreMassKg: preset.coreMassKg,
  };
}

function standoffOverRp(core) {
  const radius = core.retention?.nominalRadiusM;
  if (!(radius > 0)) return 1;
  return radius / MARS_RADIUS_M;
}

function rowFrom(result, core, diameterM, water) {
  const protective = Boolean(core.protective);
  return {
    impactor_diameter_m: diameterM,
    water_fraction: water,
    dynamo_on: protective,
    regime: classifyOutcome({
      anySlip: result.anySlip,
      lidBreaks: result.lidBreaks,
      protective,
    }),
    time_to_onset_yr: protective ? finiteOrNull(core.onsetYears) : null,
    duration_yr: protective ? finiteOrNull(core.durationYears) : null,
    magnetic_moment_Am2: core.momentAm2,
    standoff_over_rp: standoffOverRp(core),
    pathway: core.pathway,
  };
}

function sci(value) {
  if (value == null || !Number.isFinite(value)) return "null";
  if (value === 0) return "0";
  return value.toExponential(3);
}

function km(meters) {
  return `${meters / 1000} km`;
}

const state = makeState();
const coreCatalog = presets();
const selected = coreCatalog[CORE_PRESET];
const base = attachDips(buildGlobalParams(state, catalog), state);
const ends = creepEnds(state);
const faults = prepareFaults(faultFile.features || []);
if (faults.length < 100) fail("The global fault catalog did not load. Run this from a full checkout of the repository.");

const total = DIAMETERS_M.length * WATER_FRACTIONS.length;
console.log("Mars Impact Fault Explorer, command-line run");
console.log(`Epoch: ${EPOCH} Mars. Elastic thickness: ${state.aux.te_km} km.`);
console.log(`Impact site: longitude ${IMPACT_LON}, latitude ${IMPACT_LAT}.`);
console.log(`Speed ${VELOCITY_M_S / 1000} km/s, angle ${ANGLE_DEG} degrees from horizontal.`);
console.log(`Website file uses this core: ${selected.name}.`);
console.log("Same equations as the Basin & Global page. This is not a VPLanet run.");
console.log(`Faults in the catalog: ${faults.length}. Cases to run: ${total}.`);
console.log("");

const baselineRuns = [];
const comparison = [];
let done = 0;

for (const diameterM of DIAMETERS_M) {
  for (const water of WATER_FRACTIONS) {
    done += 1;
    const wetness = water === 0 ? "dry" : water === 1 ? "wet" : `water ${water}`;
    console.log(`Running ${done}/${total}: ${km(diameterM)} impactor, ${wetness}...`);
    const params = applyCore(
      { ...withWater(base, water, ends.dry, ends.wet), diameterM, includeImpact: true },
      selected,
    );
    const result = assessGlobal(faults, params, { detail: false });
    const pathway = {
      qSlabWm2: result.subduction.qSlabWm2,
      slabOnsetYears: result.subduction.slabOnsetYears,
      slabDurationYears: result.subduction.slabDurationYears,
      subductionInitiates: result.subduction.initiates,
    };
    const sourced = {
      ...params,
      includeImpact: true,
      massKg: result.source.massKg,
      coupledJ: result.source.coupledJ,
    };
    const byCore = {};
    for (const preset of Object.values(coreCatalog)) {
      const core = evaluateCore(applyCore(sourced, preset), pathway);
      byCore[preset.id] = core;
      comparison.push({
        impactor_diameter_m: diameterM,
        water_fraction: water,
        core: preset.id,
        core_name: preset.name,
        regime: classifyOutcome({
          anySlip: result.anySlip,
          lidBreaks: result.lidBreaks,
          protective: core.protective,
        }),
        dynamo_on: Boolean(core.protective),
        past_gunell_peak: Boolean(core.retention?.pastPeak),
        pathway: core.pathway,
        time_to_onset_yr: core.protective ? finiteOrNull(core.onsetYears) : null,
        duration_yr: core.protective ? finiteOrNull(core.durationYears) : null,
        magnetic_moment_Am2: core.momentAm2,
        standoff_over_rp: standoffOverRp(core),
        q_cmb_mW_m2: core.qCmbWm2 * 1000,
        q_adiabatic_mW_m2: core.qAdWm2 * 1000,
        spin_ratio: core.spinRatio,
        stirring: core.stirring,
        fast_pathway_protective: core.fastProtective,
        slow_pathway_protective: core.slowProtective,
        background_already_protective: core.backgroundProtective,
        subduction_index: result.subduction.index,
        lid_breaks: result.lidBreaks,
        any_slip: result.anySlip,
        point_load_model_valid: diameterM < POINT_LOAD_LIMIT_M,
      });
    }
    baselineRuns.push(rowFrom(result, byCore[selected.id], diameterM, water));
  }
}

const catalogOut = {
  schema: "mars-explorer-offline-run/v1",
  example: false,
  label: [
    `Explorer Basin & Global model, ${EPOCH} Mars,`,
    `impact at longitude ${IMPACT_LON}, latitude ${IMPACT_LAT}.`,
    `Core in this file: ${selected.name}.`,
    "Impactors of 80 km and larger are outside the point-load model's validity;",
    "those rows are included so the fast spin-stirring pathway can be seen.",
    "Practice result from the website's own equations. Not a VPLanet integration.",
  ].join(" "),
  source: "challenge/run_explorer_model.mjs, which calls assessGlobal in src/model/globalScenario.js",
  gunell_gate_Am2: base.gunellPeakAm2,
  point_load_valid_below_m: POINT_LOAD_LIMIT_M,
  axes: ["impactor_diameter_m", "water_fraction"],
  outputs: ["dynamo_on", "regime", "time_to_onset_yr", "duration_yr", "magnetic_moment_Am2", "standoff_over_rp"],
  runs: baselineRuns,
};

const background = [];
for (const water of WATER_FRACTIONS) {
  const params = applyCore(
    { ...withWater(base, water, ends.dry, ends.wet), diameterM: DIAMETERS_M[0], includeImpact: false },
    selected,
  );
  const result = assessGlobal(faults, params, { detail: false });
  const core = result.core;
  background.push({
    water_fraction: water,
    regime: result.regime,
    dynamo_on: Boolean(core.protective),
    magnetic_moment_Am2: core.momentAm2,
    pathway: core.pathway,
    q_cmb_mW_m2: core.qCmbWm2 * 1000,
    q_adiabatic_mW_m2: core.qAdWm2 * 1000,
    subduction_index: result.subduction.index,
    lid_breaks: result.lidBreaks,
    any_slip: result.anySlip,
    stirring: core.stirring,
    spin_ratio: core.spinRatio,
  });
}

const comparisonOut = {
  what_this_is: "Three cores, side by side, for the same impacts. Read this table to answer the core-size question. The website loads baseline_offline_run.json, not this file. The slab and the faults are computed on the selected core; the other two columns swap only the core, which is what the website's three core buttons do.",
  selected_core: selected.id,
  gunell_gate_Am2: base.gunellPeakAm2,
  stirring_turns_on_when_spin_ratio_reaches: base.spinThreshold,
  background_no_impactor: background,
  point_load_valid_below_m: POINT_LOAD_LIMIT_M,
  rows: comparison,
};

const outDir = join(here, "output");
mkdirSync(outDir, { recursive: true });
const baselinePath = join(outDir, "baseline_offline_run.json");
const comparisonPath = join(outDir, "core_sensitivity.json");
writeFileSync(baselinePath, `${JSON.stringify(catalogOut, null, 2)}\n`);
writeFileSync(comparisonPath, `${JSON.stringify(comparisonOut, null, 2)}\n`);

console.log("");
console.log("Background, no impactor, selected core. Compare each table row with this.");
console.log("water  regime  dynamo_on  moment_A_m2   q_cmb_mW/m2  q_adiabatic_mW/m2  subduction_index");
for (const row of background) {
  console.log(
    [
      String(row.water_fraction).padStart(5),
      String(row.regime).padStart(7),
      String(row.dynamo_on).padStart(10),
      sci(row.magnetic_moment_Am2).padStart(13),
      row.q_cmb_mW_m2.toFixed(2).padStart(12),
      row.q_adiabatic_mW_m2.toFixed(2).padStart(18),
      row.subduction_index.toExponential(3).padStart(17),
    ].join("  "),
  );
}

console.log("");
console.log("Website file (the selected core only)");
console.log("diameter_km  water  regime   dynamo_on  moment_A_m2   pathway      onset_yr   valid_model");
for (const run of baselineRuns) {
  const valid = run.impactor_diameter_m < POINT_LOAD_LIMIT_M ? "yes" : "NO (>80 km)";
  const onset = run.time_to_onset_yr == null ? "null" : sci(run.time_to_onset_yr);
  console.log(
    [
      String(run.impactor_diameter_m / 1000).padStart(11),
      String(run.water_fraction).padStart(6),
      String(run.regime).padStart(7),
      String(run.dynamo_on).padStart(10),
      sci(run.magnetic_moment_Am2).padStart(13),
      String(run.pathway).padStart(12),
      onset.padStart(10),
      valid.padStart(12),
    ].join("  "),
  );
}

console.log("");
console.log("Core comparison (moment in A m^2). Gunell gate is 2.5e24.");
console.log("diameter_km  water  core            dynamo_on  moment_A_m2   pathway");
for (const row of comparison) {
  console.log(
    [
      String(row.impactor_diameter_m / 1000).padStart(11),
      String(row.water_fraction).padStart(6),
      row.core.padEnd(14),
      String(row.dynamo_on).padStart(10),
      sci(row.magnetic_moment_Am2).padStart(13),
      String(row.pathway).padStart(12),
    ].join("  "),
  );
}

console.log("");
console.log("You should now see two files:");
console.log(`  ${baselinePath}`);
console.log(`  ${comparisonPath}`);
console.log("Next: python3 challenge/validate_offline_run.py challenge/output/baseline_offline_run.json");
