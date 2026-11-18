import catalog from "../data/parameters.json";
import references from "../data/references.json";
import regionFile from "../data/regions.json";
import { MARS_GRAVITY, azimuthDeg, destinationPoint, haversineM } from "./model/physics.js";
import {
  DEFAULT_DIP_SOURCE,
  DIP_CAVEAT,
  DIP_FIT_SUMMARY,
  DIP_SOURCES,
  dipCaveat,
  resolveDip,
  resolveDipAzimuth,
} from "./model/dips.js";
import { LOCAL_RADIUS_M, onsetDiameter, prepareGrid, refineOnsetDiameter, repeatedImpacts, runImpact, stressHistory, sweepDiameters } from "./model/scenario.js";
import { logSpace } from "./model/physics.js";
import { createView, makeProjector } from "./scene.js";
import { drawDepth, drawRegime, drawSeries, drawSweep } from "./plots.js";
import { EARLY_TE_KM, GLOBAL_AUX, PRESENT_TE_KM, buildGlobalParams, creepEnds } from "./globalAux.js";
import { GLOSSARY } from "./glossary.js";
import { assessGlobal, evaluateCore, prepareFaults, regimeMap, smallestProtective, withWater } from "./model/globalScenario.js";
import { interpolateOffline } from "./model/globalPhysics.js";
import { createGlobe } from "./globe.js";
import { renderGlobalResults } from "./globalResults.js";

const REGIONS = regionFile.regions;
const YEAR_S = 365.25 * 24 * 3600;
const ANORTHITE = { n: 3, A: 398 };

const AUX = {
  diameter_m: { name: "Impactor diameter", value: 1000, min: 30, max: 400000, units: "m", log: true, source: "Scenario input. Not in the spreadsheet. The regime map and the smallest-protective search use the same 1–400 km range. Values above 80 km are outside the point-load model's validity: an 80 km impactor is already about Mw 11–12 with a crater of order 1000 km." },
  velocity_m_s: { name: "Impact velocity", value: 10000, min: 5000, max: 25000, units: "m/s", source: "Scenario input. The slider runs from 5 to 25 km/s. Typical Mars impact speeds are several km/s up to about 20 km/s; 20–25 km/s is the high end of that range." },
  density_impactor: { name: "Impactor density", value: 3000, min: 500, max: 8000, units: "kg/m³", source: "Scenario input. 3000 is a stony body; irons are near 8000 and cometary ice near 500." },
  angle_deg: { name: "Impact angle from horizontal", value: 45, min: 10, max: 90, units: "degrees", source: "Scenario input. 90° is vertical. 45° is the most probable impact angle." },
  efficiency: { name: "Seismic efficiency k", value: 1e-4, min: 1e-6, max: 1e-2, units: "E_seismic / E_coupled", log: true, source: "Schultz & Gault (1975). The slider spans the range discussed for planetary impacts, including Teanby & Wookey (2011)." },
  stress_drop_mpa: { name: "Stress drop", value: 3, min: 0.3, max: 30, units: "MPa", source: "Converts seismic energy to seismic moment. A typical earthquake stress drop, not a measured Mars impact." },
  excavation_fraction: { name: "Permanent excavation fraction", value: 0.25, min: 0.05, max: 1, units: "of transient cavity", source: "Model assumption. Complex-crater collapse puts most of the transient cavity back." },
  quality_factor: { name: "Seismic quality factor Q", value: 500, min: 50, max: 2000, units: "dimensionless", source: "Model assumption for anelastic attenuation. Not in the spreadsheet." },
  lambda: { name: "Pore-pressure ratio λ", value: 0, min: 0, max: 0.8, units: "P / σ_v", source: "Model assumption. The present-day preset uses 0 (dry). The early-Mars preset sets 0.4." },
  criticality: { name: "Stress criticality χ", value: 0.85, min: 0, max: 1, units: "fraction of failure", source: "Model assumption. 1 means an optimally oriented fault is already at failure." },
  k_thermal: { name: "Crustal thermal conductivity", value: 2.5, min: 1.5, max: 4, units: "W/m/K", source: "Not in the spreadsheet. Mid-range basaltic conductivity used to turn heat flux into a geotherm." },
  interval_years: { name: "Repeat interval", value: 1e6, min: 1e3, max: 1e8, units: "years", log: true, mode: "local", source: "Scenario input for the repeated-impact series." },
  n_events: { name: "Number of impacts", value: 12, min: 2, max: 24, units: "events", step: 1, mode: "local", source: "Scenario input for the repeated-impact series." },
  exaggeration: { name: "Vertical exaggeration", value: 12, min: 1, max: 40, units: "display only", step: 1, mode: "local", source: "Display only. It does not enter the stress calculation." },
  ...GLOBAL_AUX,
};

const CATEGORY_ORDER = ["Rheology", "Creep", "Thermal", "Fault geometry", "Crustal structure", "VPLanet / interior"];
const DIP_KEYS = { theta_normal: "normal", theta_thrust: "thrust" };

const app = document.querySelector("#app");
const state = createState();
applyUrl(state);

app.innerHTML = `
  <header class="top">
    <div class="brand">
      <h1>Mars impact fault explorer</h1>
      <p>Wheeler Feer · Andrew Laskowski, Montana State University · first-order sandbox</p>
    </div>
    <div class="top-controls">
      <div class="modes">
        <button type="button" data-mode="local">Local</button>
        <button type="button" data-mode="global">Basin &amp; Global</button>
      </div>
      <div class="regions local-only" id="regions"></div>
      <div class="epochs">
        <button type="button" data-epoch="present">Present day</button>
        <button type="button" data-epoch="early">Early Mars</button>
      </div>
    </div>
    <div class="actions">
      <button type="button" id="about-open">About</button>
      <button type="button" id="glossary-open">Glossary</button>
      <button type="button" id="reset">Reset</button>
      <button type="button" id="share">Copy link</button>
      <button type="button" id="export-json">Export JSON</button>
      <button type="button" id="export-csv">Export CSV</button>
    </div>
  </header>
  <div class="workspace">
    <div class="stage">
      <div class="viewport">
        <canvas id="view" class="local-only"></canvas>
        <canvas id="globe" class="global-only"></canvas>
        <div class="legend local-only">
          <div><span class="sw-stable"></span>stable</div>
          <div><span class="sw-near"></span>near failure</div>
          <div><span class="sw-fail"></span>reactivated</div>
          <div><span class="sw-cave"></span>inside cavity</div>
        </div>
        <div class="legend global-only">
          <div><span class="sw-stable"></span>stable</div>
          <div><span class="sw-near"></span>near failure</div>
          <div><span class="sw-fail"></span>reactivated</div>
          <div><span class="sw-cave"></span>inside cavity</div>
          <div><span class="sw-weak"></span>weak zone</div>
          <div><span class="sw-impact"></span>impact</div>
          <div><span class="sw-anti"></span>antipode</div>
        </div>
        <div class="hud">
          <span class="local-only">Click the terrain to place the impact. Drag to orbit.</span>
          <span class="global-only">Click the globe to place the impact. Drag to orbit. Gold faults are the weak zone.</span>
          <button type="button" id="camera">Reset camera</button>
          <label class="local-only"><input type="checkbox" id="subsurface" checked /> Subsurface cutaway</label>
        </div>
      </div>
      <div class="plots">
        <section class="plot local-only"><h2>CFS vs depth, closest regime fault</h2><canvas id="depth-plot"></canvas></section>
        <section class="plot local-only"><h2>Reactivated fraction within 250 km</h2><canvas id="sweep-plot"></canvas></section>
        <section class="plot local-only"><h2>Repeated impacts: stress and area</h2><canvas id="series-plot"></canvas></section>
        <section class="plot global-only"><h2>Regime map. Click a cell to set diameter and velocity.</h2><canvas id="regime-plot"></canvas><div id="regime-tip" class="regime-tip" hidden></div></section>
      </div>
    </div>
    <aside class="sidebar">
      <div id="hint" class="hint">
        <p>Start in <strong>Local</strong> to drop an impact on Valles Marineris, Cerberus Fossae, or Isidis. Switch to <strong>Basin &amp; Global</strong> to follow one impact through the whole fault catalog toward a possible dynamo. The card at the top of this column is the result. About explains how to read it, and Glossary defines CFS, Mw, Te, and the dynamo terms.</p>
        <button type="button" id="hint-dismiss">Got it</button>
      </div>
      <div id="notice" class="notice" hidden></div>
      <section class="results" id="results"></section>
      <div class="controls" id="controls"></div>
    </aside>
  </div>
  <dialog id="about" class="about">
    <h2>How to use this page</h2>
    <p><strong>Local</strong> is one region at a time. The three regions are Valles Marineris (normal faults in the canyon system), Cerberus Fossae (young grabens in Elysium), and Isidis Planitia (a thin-crust basin whose mapped structures are thrusts and wrinkle ridges). Click the terrain to place the impact, or pick a reference fault and a distance. The headline is the fraction of that regime's fault area, within 250 km, that fails.</p>
    <p><strong>Basin &amp; Global</strong> uses the same impact on the full SIM 3292 fault catalog. It asks whether failed faults link into a weak zone, whether that zone can break the elastic lid and start subduction, and whether the core then runs a dynamo. The globe is the whole planet. Local-only controls (the reference fault, the distance slider, and the repeated-impact series) are hidden here.</p>
    <p>Read the result card first: the headline, Mw, crater size, and, in Basin &amp; Global, q_cmb against q_adiabatic. Open the details for the fault table. A negative CFS is still stable. Glossary defines the symbols. The regime map's outlined cell is the current diameter and velocity; click any cell to set those sliders.</p>
    <h2>What this is asking</h2>
    <p>The question is what kind of impact it takes to generate a protective Martian geodynamo, on whatever timescale the physics produces. One impact has two pathways.</p>
    <ol>
      <li><strong>Slow, structural.</strong> Faults cascade, link into a weak zone, and may start subduction. Cold lithosphere reaches the core-mantle boundary, core heat flow rises, and a dynamo can turn on.</li>
      <li><strong>Fast, core-direct.</strong> The impact changes the spin and stirs the liquid core (the mechanism in Le Bars et al. 2011 for the Moon). Heating the core top can instead suppress a dynamo (Roberts et al. 2009).</li>
    </ol>
    <p>The engineered comparison is an artificial magnetic shield at Mars–Sun L1 (Green et al. 2017). That concept stands the solar wind off upstream of the planet. This page does not turn their 1–2 T source into a planetary dipole. It is a different geometry.</p>
    <p>A field counts as protective only for atmosphere retention: the magnetopause stays above the upper atmosphere at nominal and storm solar-wind pressure, and the moment is past the cusp-escape peak in Gunell et al. (2018), where a weak field can increase loss. Earth's moment is a comparison only. In that paper, escape past the peak falls back toward the unmagnetized rate rather than to zero.</p>
    <p>The core baseline is a fully liquid, well-mixed metallic core about 1650 km in radius under a ~150 km molten silicate layer (Samuel et al. 2023; Khan et al. 2023). Khan's layer density rules out a stable iron layer on top of the core. Wheeler's spreadsheet flags 1830 km (Stähler et al. 2021) as the VPLanet baseline. That is a preset here, not the default. A 613 km solid inner core (Bi et al. 2025) is the other preset.</p>
    <p>Basin &amp; Global is a first-order browser estimate. The authoritative thermal history is the offline VPLanet / thermomechanical model. Choose an offline-run file to interpolate it. The shipped EXAMPLE file is not science. Equations, what is not interactive, and the assumptions to review are in MODEL.md.</p>
    <form method="dialog"><button value="close">Close</button></form>
  </dialog>
  <dialog id="glossary" class="about">
    <h2>Glossary</h2>
    <dl class="glossary">
      ${GLOSSARY.map((item) => `<dt>${item.term}</dt><dd><strong>${item.title}.</strong> ${item.text}</dd>`).join("")}
    </dl>
    <form method="dialog"><button value="close">Close</button></form>
  </dialog>
`;

const regionHost = document.querySelector("#regions");
for (const region of REGIONS) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = region.name;
  button.dataset.region = region.id;
  regionHost.appendChild(button);
}

app.dataset.mode = state.mode || "local";

const view = createView(document.querySelector("#view"), {
  onPick(point) {
    state.impact = point;
    schedule(true);
  },
});

const globe = createGlobe(document.querySelector("#globe"), {
  onPick(point) {
    state.impact = point;
    schedule(true);
  },
});

const offlineFiles = Object.entries(import.meta.glob("../data/offline_runs/*.json", { eager: true })).map(([path, mod]) => ({
  id: path.split("/").pop(),
  catalog: mod.default,
}));

document.querySelectorAll("[data-epoch]").forEach((button) => {
  button.addEventListener("click", () => applyEpoch(button.dataset.epoch, true));
});
document.querySelector("#glossary-open").addEventListener("click", () => document.querySelector("#glossary").showModal());
document.querySelector("#hint-dismiss").addEventListener("click", () => {
  document.querySelector("#hint").hidden = true;
  try { sessionStorage.setItem("mife-hint", "1"); } catch { /* private mode */ }
});
try {
  if (sessionStorage.getItem("mife-hint") === "1") document.querySelector("#hint").hidden = true;
} catch { /* private mode */ }
regionHost.addEventListener("click", (event) => {
  const button = event.target.closest("[data-region]");
  if (!button) return;
  selectRegion(button.dataset.region, true);
});
document.querySelector("#reset").addEventListener("click", () => {
  const regionId = state.regionId;
  Object.assign(state, createState());
  state.regionId = regionId;
  const region = currentRegion();
  state.regime = region.regime_default;
  state.impact = { ...region.default_impact };
  applyDipDefaults(state);
  history.replaceState(null, "", location.pathname);
  syncControls();
  schedule(true);
});
document.querySelector("#share").addEventListener("click", async () => {
  writeUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Link copied");
  } catch {
    toast("Link is in the address bar");
  }
});
document.querySelector("#export-json").addEventListener("click", () => downloadJson());
document.querySelector("#export-csv").addEventListener("click", () => downloadCsv());
document.querySelector("#camera").addEventListener("click", () => {
  if (state.mode === "global") globe.resetCamera();
  else view.resetCamera();
});
document.querySelector("#about-open").addEventListener("click", () => document.querySelector("#about").showModal());
document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode === "global" ? "global" : "local";
    app.dataset.mode = state.mode;
    if (state.mode === "global") {
      globe.resize();
      loadGlobalFaults();
    }
    syncControls();
    schedule(true);
  });
});
document.querySelector("#subsurface").addEventListener("change", (event) => {
  state.showSubsurface = event.target.checked;
  paintView();
});

const cache = new Map();
let token = 0;

buildControls();
syncControls();
wireRegimeMap();
let runTimer = 0;
let lightTimer = 0;
let heavyTimer = 0;
let latest = null;

selectRegion(state.regionId, false);

function createState() {
  const values = {};
  for (const parameter of catalog.parameters) values[parameter.key] = parameter.value;
  const coreMass = catalog.parameters.find((item) => item.key === "M_core");
  if (coreMass) values.M_core = coreMass.min;
  const aux = {};
  for (const [key, spec] of Object.entries(AUX)) aux[key] = spec.value;
  const next = {
    regionId: REGIONS[0].id,
    epoch: "present",
    creepMode: "dry_diabase",
    modulus: "rock_mass",
    cohesion: "rock_mass",
    regime: REGIONS[0].regime_default,
    impact: { ...REGIONS[0].default_impact },
    selectedFaultId: null,
    showSubsurface: true,
    dipSource: DEFAULT_DIP_SOURCE,
    mode: "local",
    capAtMoho: true,
    seed: "mapped",
    support: "isostatic",
    radioMode: "bsm",
    offlineId: "none",
    values,
    aux,
  };
  applyDipDefaults(next);
  return next;
}

function applyDipDefaults(target) {
  for (const [key, kinematics] of Object.entries(DIP_KEYS)) {
    target.values[key] = resolveDip({
      regionId: target.regionId,
      source: target.dipSource,
      kinematics,
    }).dipDeg;
  }
}

function dipSliderSpec(key) {
  const resolved = resolveDip({
    regionId: state.regionId,
    source: state.dipSource,
    kinematics: DIP_KEYS[key],
  });
  return { ...parameter(key), value: resolved.dipDeg, min: resolved.min, max: resolved.max, log: false, resolved };
}

function specFor(row) {
  if (row.dataset.aux) return AUX[row.dataset.aux];
  if (row.dataset.key in DIP_KEYS) return dipSliderSpec(row.dataset.key);
  return parameter(row.dataset.key);
}

function currentRegion() {
  return REGIONS.find((region) => region.id === state.regionId) || REGIONS[0];
}

function selectRegion(id, resetPlace) {
  const previous = currentRegion();
  const previousRegime = state.regime;
  state.regionId = id;
  const region = currentRegion();
  if (resetPlace) {
    state.regime = region.regime_default;
    state.impact = { ...region.default_impact };
    state.selectedFaultId = null;
    applyDipDefaults(state);
    const bits = [`${region.name} is now the region.`];
    if (previousRegime !== region.regime_default) {
      bits.push(`Andersonian regime set to ${region.regime_default}.`);
    }
    if (region.id === "isidis_planitia") {
      bits.push("Reference structures are wrinkle ridges (thrusts). The impact moved to the Isidis default, so the distance from the reference fault changes. The dip is the low-confidence wrinkle-ridge flank unless the literature source is selected.");
    } else if (previous?.id === "isidis_planitia") {
      bits.push("Left the Isidis thrust / wrinkle-ridge setup. The impact moved to this region's default.");
    } else {
      bits.push("The impact moved to this region's default, and the reference fault will be the longest structure of the active regime.");
    }
    showNotice(bits.join(" "));
  }
  syncControls();
  loadRegion(region);
}

function applyEpoch(epoch, announce) {
  const region = currentRegion();
  const before = {
    regime: state.regime,
    fault: state.selectedFaultId,
    lon: state.impact.lon,
    lat: state.impact.lat,
    te: state.aux.te_km,
  };
  state.epoch = epoch === "early" ? "early" : "present";
  state.creepMode = state.epoch === "early" ? "wet_diabase" : "dry_diabase";
  state.aux.lambda = state.epoch === "early" ? 0.4 : 0;
  state.aux.te_km = state.epoch === "early" ? EARLY_TE_KM : PRESENT_TE_KM;
  if (announce) {
    const moved = before.regime !== state.regime
      || before.fault !== state.selectedFaultId
      || before.lon !== state.impact.lon
      || before.lat !== state.impact.lat;
    const lines = [
      state.epoch === "early"
        ? `Early Mars: pore pressure λ set to 0.4, creep set to wet diabase, and elastic thickness Te set to ${EARLY_TE_KM} km (McKenzie, Barnett & Yuan 2002 southern-hemisphere fit; it was ${before.te} km). The early thermal column (surface temperature, mantle heat flux, crustal heat production, and the 30 km BDT) is now active.`
        : `Present day: λ set to 0, creep set to dry diabase, and Te set back to ${PRESENT_TE_KM} km. The present-day thermal column is active.`,
    ];
    if (region.id === "isidis_planitia") {
      lines.push(moved
        ? "Isidis also changed regime, reference fault, or impact location with this click."
        : "Isidis stays the region. Its regime stays thrust and its reference structures stay wrinkle ridges. This button does not move the impact or change the reference fault.");
    } else if (!moved) {
      lines.push(`${region.name} stays the region. Regime, reference fault, and impact location are unchanged.`);
    }
    showNotice(lines.join(" "));
  }
  syncControls();
  schedule(true);
}

function showNotice(text) {
  const node = document.querySelector("#notice");
  if (!node) return;
  node.hidden = false;
  node.textContent = text;
}

async function loadRegion(region) {
  const mine = ++token;
  if (!cache.has(region.id)) {
    const base = import.meta.env.BASE_URL;
    const [buffer, faults] = await Promise.all([
      fetch(base + region.terrain.file).then((response) => response.arrayBuffer()),
      fetch(base + region.faults).then((response) => response.json()),
    ]);
    const viewData = new DataView(buffer);
    const count = region.terrain.width * region.terrain.height;
    const heights = new Float64Array(count);
    for (let i = 0; i < count; i += 1) heights[i] = viewData.getInt16(i * 2, true);
    cache.set(region.id, { heights, faults });
  }
  if (mine !== token) return;
  const loaded = cache.get(region.id);
  if (!state.selectedFaultId) {
    const match = [...loaded.faults.features].sort((a, b) => b.properties.length_km - a.properties.length_km)
      .find((feature) => feature.properties.kinematics === state.regime);
    state.selectedFaultId = (match || loaded.faults.features[0])?.properties.id || null;
  }
  fillFaultSelect();
  syncControls();
  schedule(true);
}

function schedule(immediate) {
  cancelAnimationFrame(runTimer);
  clearTimeout(lightTimer);
  clearTimeout(heavyTimer);
  if (immediate) {
    runTimer = requestAnimationFrame(() => compute(false));
    heavyTimer = setTimeout(() => compute(true), 40);
  } else {
    lightTimer = setTimeout(() => compute(false), 200);
    heavyTimer = setTimeout(() => compute(true), 500);
  }
}

let globalFeatures = null;
let globalPrepared = null;
let globalLoading = false;

function loadGlobalFaults() {
  if (globalPrepared || globalLoading) return;
  globalLoading = true;
  const host = document.querySelector("#results");
  if (host && state.mode === "global") host.innerHTML = "<p>Loading the SIM 3292 catalog…</p>";
  fetch(`${import.meta.env.BASE_URL}faults/sim3292_global.geojson`)
    .then((response) => {
      if (!response.ok) throw new Error(`catalog ${response.status}`);
      return response.json();
    })
    .then((data) => {
      globalFeatures = data.features || [];
      globalPrepared = prepareFaults(globalFeatures);
      globe.setFaults(globalFeatures);
      globalLoading = false;
      schedule(true);
    })
    .catch(() => {
      globalLoading = false;
      const node = document.querySelector("#results");
      if (node) node.innerHTML = "<p>The global SIM 3292 file did not load.</p>";
    });
}

function computeGlobal(heavy) {
  if (!globalPrepared) {
    loadGlobalFaults();
    return;
  }
  const params = buildGlobalParams(state, catalog);
  params.resolveDip = (fault) => {
    if (fault.dipDeg != null) return fault.dipDeg;
    const regionId = focusRegionId(fault.lon, fault.lat);
    return resolveDip({
      regionId: regionId || state.regionId,
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
  const result = assessGlobal(globalPrepared, params, { detail: true });
  const baseline = assessGlobal(globalPrepared, { ...params, includeImpact: false }, { detail: false });
  const baseIds = new Set(baseline.failedIds || []);
  const nowIds = new Set(result.failedIds || []);
  let changed = 0;
  for (const id of new Set([...baseIds, ...nowIds])) {
    if (baseIds.has(id) !== nowIds.has(id)) changed += 1;
  }
  const impactCompare = {
    changed,
    baselineRegime: baseline.regime,
    baselineReactivated: baseline.reactivatedCount,
    maxImpactMpa: (result.maxImpactDeltaCfs || 0) / 1e6,
    backgroundMpa: (result.backgroundCfsAtMaxImpact || 0) / 1e6,
  };
  const ends = creepEnds(state);
  let dry = latest?.dry || null;
  let wet = latest?.wet || null;
  let map = latest?.map || null;
  let smallest = latest?.smallest || null;
  if (heavy) {
    const dryParams = withWater(params, 0, ends.dry, ends.wet);
    const wetParams = withWater(params, 1, ends.dry, ends.wet);
    const dryRun = assessGlobal(globalPrepared, dryParams, { detail: false });
    const wetRun = assessGlobal(globalPrepared, wetParams, { detail: false });
    dry = summarizeSide(dryRun, dryParams);
    wet = summarizeSide(wetRun, wetParams);
    const diameters = logSpace(1e3, 4e5, 7);
    const velocities = [6000, 10000, 15000, 22000];
    map = regimeMap(globalPrepared, params, diameters, velocities);
    const background = assessGlobal(globalPrepared, { ...params, includeImpact: false }, { detail: false });
    smallest = {
      background: background.core.protective,
      ...smallestProtective(globalPrepared, params, {
        diameters: logSpace(1e3, 4e5, 5),
        velocities: [8000, 15000],
        angles: [30, 90],
        locations: searchLocations(params),
      }),
    };
  }
  const pathway = {
    qSlabWm2: result.subduction.qSlabWm2,
    slabOnsetYears: result.subduction.slabOnsetYears,
    slabDurationYears: result.subduction.slabDurationYears,
    subductionInitiates: result.subduction.initiates,
  };
  const mass = parameter("M_core");
  const sourced = { ...params, includeImpact: true, massKg: result.source.massKg, coupledJ: result.source.coupledJ };
  const cores = {
    bml: evaluateCore({ ...sourced, coreRadiusM: state.values.R_core_BML * 1000, bmlM: 150e3, innerRadiusM: 0, coreMassKg: mass.min }, pathway),
    stahler: evaluateCore({ ...sourced, coreRadiusM: state.values.R_core_std * 1000, bmlM: 0, innerRadiusM: 0, coreMassKg: mass.value }, pathway),
    inner: evaluateCore({ ...sourced, coreRadiusM: state.values.R_core_BML * 1000, bmlM: 150e3, innerRadiusM: 613e3, coreMassKg: mass.min }, pathway),
  };
  const offlineCatalog = offlineFiles.find((file) => file.id === state.offlineId)?.catalog;
  const offline = state.offlineId === "none" || !offlineCatalog
    ? { available: false }
    : interpolateOffline(offlineCatalog, {
        impactor_diameter_m: state.aux.diameter_m,
        water_fraction: state.aux.water_fraction,
      });
  latest = { mode: "global", result, dry, wet, map, smallest, params };
  renderGlobalResults(document.querySelector("#results"), {
    result,
    dry,
    wet,
    cores,
    smallest,
    offline,
    faultCount: globalPrepared.length,
    density: result.core.density,
    impact: state.impact,
    antipode: result.antipode,
    impactCompare,
  });
  globe.show({
    statuses: result.statuses,
    impactLon: state.impact.lon,
    impactLat: state.impact.lat,
    antipodeLon: result.antipode.lon,
    antipodeLat: result.antipode.lat,
  });
  drawRegime(document.querySelector("#regime-plot"), map, {
    diameterM: state.aux.diameter_m,
    velocityMs: state.aux.velocity_m_s,
  });
  writeUrl();
}

function summarizeSide(run, sideParams) {
  return {
    regime: run.regime,
    lambda: sideParams.lambda,
    friction: sideParams.frictionFactor,
    subduction: run.subduction.index,
    protective: run.core.protective,
    moment: run.core.momentAm2,
    eta: run.viscosity.etaPaS,
  };
}

function focusRegionId(lon, lat) {
  const region = REGIONS.find((item) => lon >= item.west && lon <= item.east && lat >= item.south && lat <= item.north);
  return region ? region.id : null;
}

function searchLocations(params) {
  return [
    { name: "Clicked site", lon: params.lon, lat: params.lat },
    { name: "Hellas", lon: 70.5, lat: -42.4 },
    { name: "Isidis", lon: 87, lat: 12.9 },
    { name: "Argyre", lon: -43.3, lat: -49.7 },
    { name: "Valles Marineris", lon: -70.2, lat: -9.2 },
    { name: "Tharsis center", lon: params.tharsisLon, lat: params.tharsisLat },
  ];
}

function compute(heavy) {
  if (state.mode === "global") {
    computeGlobal(heavy);
    return;
  }
  const region = currentRegion();
  const loaded = cache.get(region.id);
  if (!loaded) return;
  const spec = buildSpec(region, loaded.faults);
  const grid = prepareGrid(spec);
  const material = spec.material;
  let result = runImpact(grid, spec.impact, material);
  let sweep = latest?.sweep || null;
  let series = latest?.series || null;
  let history = latest?.history || null;
  if (heavy) {
    const displayed = grid.segments.map((segment) => segment.display);
    const diameters = logSpace(40, 60000, 22);
    if (!diameters.some((value) => Math.abs(value - spec.impact.diameterM) / spec.impact.diameterM < 0.02)) {
      diameters.push(spec.impact.diameterM);
      diameters.sort((a, b) => a - b);
    }
    sweep = sweepDiameters(grid, spec.impact, material, diameters);
    grid.segments.forEach((segment, index) => {
      segment.display = displayed[index];
    });
    series = repeatedImpacts(result.samples.filter((sample) => sample.local), {
      intervalYears: state.aux.interval_years,
      count: state.aux.n_events,
      regime: state.regime,
    });
    history = result.critical
      ? stressHistory({
          cfsBg: result.critical.cfsBg,
          dStatic: result.critical.dStatic,
          dDynamic: result.critical.dDynamic,
          tMaxwell: result.critical.tMaxwell,
          intervalYears: state.aux.interval_years,
          count: state.aux.n_events,
        })
      : null;
  }
  const onsetRefined = heavy
    ? {
        immediate: refineOnsetDiameter(grid, spec.impact, material, "fractionLocal", { minM: 40, maxM: 400000 }),
        staticOnly: refineOnsetDiameter(grid, spec.impact, material, "fractionLocalStatic", { minM: 40, maxM: 400000 }),
      }
    : latest?.onsetRefined || null;
  latest = { result, grid, spec, sweep, series, history, region, loaded, onsetRefined };
  renderResults();
  paintView();
  paintPlots();
  writeUrl();
}

function buildSpec(region, featureCollection) {
  const epoch = state.epoch === "early" ? "early" : "present";
  const youngKey = state.modulus === "intact" ? "E_intact" : "E_rm";
  const cohesionKey = state.cohesion === "intact" ? "C_0_intact" : "C_0_rm";
  const creep = creepOf(epoch);
  const faults = featureCollection.features.map((feature) => {
    const kinematics = feature.properties.kinematics;
    const dip = Number.isFinite(feature.properties.dip_deg)
      ? feature.properties.dip_deg
      : state.values[kinematics === "thrust" ? "theta_thrust" : "theta_normal"];
    return {
      id: feature.properties.id,
      name: feature.properties.name,
      kinematics,
      dipDeg: dip,
      dipAzimuthDeg: Number.isFinite(feature.properties.dip_azimuth_deg) ? feature.properties.dip_azimuth_deg : null,
      regionId: region.id,
      dipSource: state.dipSource,
      coordinates: feature.geometry.coordinates,
    };
  });
  return {
    faults,
    material: {
      youngsPa: state.values[youngKey] * parameter(youngKey).to_si,
      poisson: state.values.nu,
      cohesionPa: state.values[cohesionKey] * parameter(cohesionKey).to_si,
      phiDeg: state.values.phi,
      lambda: state.aux.lambda,
      criticality: state.aux.criticality,
      regime: state.regime,
      density: state.values.rho_crust,
      gravity: MARS_GRAVITY,
    },
    thermal: {
      surfaceK: state.values[`T_s_${epoch}`],
      mantleFlux: state.values[`q_m_${epoch}`] * parameter(`q_m_${epoch}`).to_si,
      heatProduction: state.values[`H_${epoch}`],
      conductivity: state.aux.k_thermal,
      crustM: state.values[region.crust_key] * parameter(region.crust_key).to_si,
      bdtM: state.values[`Z_BDT_${epoch}`] * parameter(`Z_BDT_${epoch}`).to_si,
    },
    creep,
    sampling: { spacingM: 20000, depthSteps: 8, capAtMoho: state.capAtMoho !== false },
    impact: {
      lon: state.impact.lon,
      lat: state.impact.lat,
      diameterM: state.aux.diameter_m,
      velocityMs: state.aux.velocity_m_s,
      densityImpactor: state.aux.density_impactor,
      angleDeg: state.aux.angle_deg,
      efficiency: state.aux.efficiency,
      stressDropPa: state.aux.stress_drop_mpa * 1e6,
      excavationFraction: state.aux.excavation_fraction,
      qualityFactor: state.aux.quality_factor,
    },
  };
}

function creepOf() {
  const eta0 = state.values.eta_0;
  if (state.creepMode === "reference_viscosity") {
    return { mode: "reference_viscosity", eta0, prefactorA: 1, exponentN: 1, activationJmol: 1 };
  }
  if (state.creepMode === "anorthite") {
    return { mode: "creep", eta0, prefactorA: ANORTHITE.A, exponentN: ANORTHITE.n, activationJmol: state.values.Q_andesite * 1e3 };
  }
  if (state.creepMode === "wet_diabase") {
    return { mode: "creep", eta0, prefactorA: state.values.A_wet, exponentN: state.values.n_wet, activationJmol: state.values.Q_crust_wet * 1e3 };
  }
  return { mode: "creep", eta0, prefactorA: state.values.A_dry, exponentN: state.values.n_dry, activationJmol: state.values.Q_crust_dry * 1e3 };
}

function parameter(key) {
  return catalog.parameters.find((item) => item.key === key);
}

function paintView() {
  if (!latest) return;
  const region = latest.region;
  const projector = makeProjector(region, latest.loaded.heights);
  const young = latest.spec.material.youngsPa;
  void young;
  view.show({
    regionId: region.id,
    cols: region.terrain.width,
    rows: region.terrain.height,
    heights: latest.loaded.heights,
    ve: state.aux.exaggeration,
    widthM: projector.widthM,
    heightM: projector.heightM,
    elevMax: region.terrain.elev_max_m,
    projector,
    segments: latest.grid.segments,
    impact: state.impact,
    craterFinalM: latest.result.source.finalM,
    bdtM: latest.spec.thermal.bdtM,
    crustM: latest.spec.thermal.crustM,
    showSubsurface: state.showSubsurface,
  });
}

function paintPlots() {
  const result = latest?.result;
  const profileFault = regimeFault(result) || result?.faults?.[0];
  drawDepth(document.querySelector("#depth-plot"), profileFault?.closestProfile);
  drawSweep(
    document.querySelector("#sweep-plot"),
    latest?.sweep,
    state.aux.diameter_m,
    latest?.sweep ? onsetDiameter(latest.sweep) : null,
  );
  drawSeries(
    document.querySelector("#series-plot"),
    latest?.history,
    latest?.series,
    latest?.series?.onsetImmediateYears,
  );
}

function regimeFault(result) {
  if (!result) return null;
  return result.faults
    .filter((fault) => fault.kinematics === state.regime)
    .sort((a, b) => a.minDistanceM - b.minDistanceM)[0];
}

function renderResults() {
  const result = latest.result;
  const region = latest.region;
  const source = result.source;
  const regimeName = state.regime === "thrust" ? "thrust" : "normal";
  const activeDip = resolveDip({ regionId: region.id, source: state.dipSource, kinematics: regimeName });
  const sourceLabel = DIP_SOURCES.find((item) => item.id === state.dipSource)?.label || state.dipSource;
  const segmentCount = latest.grid.segments.length;
  const fittedCount = latest.grid.segments.filter((segment) => segment.dipAzimuthSource === "measured").length;
  const pct = (value) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
  const onset = latest.onsetRefined?.immediate?.diameterM ?? (latest.sweep ? onsetDiameter(latest.sweep, "fractionLocal") : null);
  const onsetStatic = latest.onsetRefined?.staticOnly?.diameterM ?? (latest.sweep ? onsetDiameter(latest.sweep, "fractionLocalStatic") : null);
  const nearest = result.faults.length
    ? result.faults.reduce((best, fault) => (fault.minDistanceM < best.minDistanceM ? fault : best), result.faults[0])
    : null;
  const critical = result.critical;
  const host = document.querySelector("#results");
  host.innerHTML = `
    <div class="result-card">
    <p class="tag">${region.name} · ${state.epoch === "early" ? "early Mars" : "present day"} · ${regimeName} regime · dip ${formatNumber(activeDip.dipDeg)}° · ${escapeHtml(sourceLabel)}${activeDip.lowConfidence ? " · low confidence" : ""}</p>
    <p class="caveat">${escapeHtml(dipCaveat({ regionId: region.id, source: state.dipSource }))}</p>
    <h2>${verdict(result, regimeName)}</h2>
    <p class="verdict">${onsetText(onset, onsetStatic, regimeName)}</p>
    ${extremeBanner(source, state.aux.diameter_m)}
    <dl class="metrics">
      ${metric("Moment magnitude", `Mw ${source.magnitude.toFixed(2)}`)}
      ${metric("Coupled energy", sci(source.coupledJ, "J"))}
      ${metric("Seismic energy", sci(source.seismicJ, "J"))}
      ${metric("Final crater", `${(source.finalM / 1000).toFixed(1)} km`)}
      ${metric("Transient crater", `${(source.transientM / 1000).toFixed(1)} km`)}
      ${metric(`Within ${LOCAL_RADIUS_M / 1000} km, failing now`, pct(result.fractionLocal))}
      ${metric("Within 250 km, static only", pct(result.fractionLocalStatic))}
      ${metric("Whole region, failing now", pct(result.fractionRegime))}
      ${metric("Nearest structure", nearest ? `${nearest.name}, ${(nearest.minDistanceM / 1000).toFixed(0)} km` : "—")}
      ${metric("Relaxation time", critical ? formatMaxwell(critical.tMaxwell) : "—")}
      ${metric("Critical depth", critical ? `${(critical.z / 1000).toFixed(1)} km on ${critical.faultName}` : "—")}
      ${metric("Impact", `${state.impact.lat.toFixed(2)}°, ${state.impact.lon.toFixed(2)}°`)}
      ${metric("Fault depth limit", `${(latest.grid.depthLimitM / 1000).toFixed(1)} km (${latest.grid.capAtMoho ? "Moho cap on" : "Moho cap off"})`)}
    </dl>
    </div>
    <details class="result-details" open>
    <summary>Fault table</summary>
    <table>
      <thead><tr><th>Fault</th><th>Type</th><th>km</th><th>Fail</th><th>CFS</th><th>Depths</th></tr></thead>
      <tbody>
        ${result.faults.slice(0, 8).map((fault) => `<tr>
          <td>${escapeHtml(fault.name)}</td>
          <td>${fault.kinematics}</td>
          <td>${(fault.minDistanceM / 1000).toFixed(0)}</td>
          <td>${pct(fault.fraction)}</td>
          <td>${(fault.maxCfs / 1e6).toFixed(1)}</td>
          <td>${fault.failedDepthMin == null ? "—" : `${(fault.failedDepthMin / 1000).toFixed(0)}–${(fault.failedDepthMax / 1000).toFixed(0)}`}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="meta">${fittedCount} of ${segmentCount} fault segments use a measured dip direction. The others use the right-hand normal of the trace. CFS is in MPa and includes the background deficit, so negative means still stable. The table shows the eight faults closest to failure. Faults are sampled down to ${latest.grid.capAtMoho ? "the shallower of the BDT and this region's crust" : "the BDT, including below the Moho"}.</p>
    </details>
  `;
}

function verdict(result, regimeName) {
  const fraction = result.fractionLocal;
  if (fraction == null) return `No ${regimeName} faults lie within 250 km of this impact.`;
  if (fraction <= 0) return `This impact does not reactivate ${regimeName} faults within 250 km.`;
  return `${(fraction * 100).toFixed(1)}% of the ${regimeName}-fault area within 250 km fails.`;
}

function onsetText(onset, onsetStatic, regimeName) {
  if (!latest.sweep && !latest.onsetRefined) return "Magnitude sweep is computing.";
  const magOf = (kind, diameter) => {
    const refined = latest.onsetRefined?.[kind];
    if (refined?.diameterM && Math.abs(refined.diameterM - diameter) / diameter < 0.02 && Number.isFinite(refined.magnitude)) {
      return `Mw ${refined.magnitude.toFixed(1)}`;
    }
    const row = latest.sweep?.find((item) => item.diameterM === diameter);
    return row ? `Mw ${row.magnitude.toFixed(1)}` : (refined?.magnitude ? `Mw ${refined.magnitude.toFixed(1)}` : "");
  };
  const immediate = onset
    ? `Immediate ${regimeName} reactivation begins at an impactor diameter of ${formatMeters(onset)} (${magOf("immediate", onset)}).`
    : `No immediate ${regimeName} reactivation from an impactor diameter of 40 m to 400 km.`;
  const sustained = onsetStatic
    ? `Static-only onset is an impactor diameter of ${formatMeters(onsetStatic)} (${magOf("staticOnly", onsetStatic)}).`
    : "Static stress alone does not reach failure from 40 m to 400 km.";
  let note = "";
  if (onset && onsetStatic) {
    const ratio = Math.max(onset, onsetStatic) / Math.min(onset, onsetStatic);
    if (ratio < 1.03) {
      note = " The two diameters agree to within 3% after bisection, so the match is in the stresses: dynamic stress does not move the threshold here. It is not a coarse-grid artifact.";
    } else {
      note = " The two diameters were refined by bisection, so a gap between them is the dynamic stress, not the spacing of the sweep.";
    }
  }
  return `${immediate} ${sustained}${note}`;
}

function extremeBanner(source, diameterM) {
  const extreme = diameterM >= 80000 || source.finalM >= 1e6 || source.magnitude >= 11;
  if (!extreme) return "";
  return `<p class="banner">Beyond model validity. At 80 km the impactor is already about Mw 11–12 with a crater of order 1000 km. This case is Mw ${source.magnitude.toFixed(1)} and a ${(source.finalM / 1000).toFixed(0)} km crater. The point-load and seismic-efficiency calculation still runs; it is not a prediction.</p>`;
}

function buildControls() {
  const host = document.querySelector("#controls");
  host.innerHTML = "";
  host.append(group("Impact scenario", "These are scenario inputs. They are not columns in the parameter sheet.", auxBlock([
    "diameter_m", "velocity_m_s", "density_impactor", "angle_deg", "efficiency",
  ]), true));
  const place = group("Where and how often", "", `
    <p class="group-note local-only">Click the terrain, or set a distance from a mapped fault.</p>
    <p class="group-note global-only">Click the globe to place the impact. The reference fault and the distance slider are local-only and are hidden here.</p>
    <div class="row local-only">
      <header><label for="fault-select">Reference fault</label></header>
      <select id="fault-select"></select>
    </div>
    <div class="row local-only">
      <header><label>Distance from the reference fault</label><span class="value" id="distance-readout"></span></header>
      <input id="distance" type="range" min="0" max="800" step="1" />
    </div>
    <div class="row local-only">
      <header><label for="regime">Andersonian regime</label></header>
      <select id="regime">
        <option value="normal">Normal (extension)</option>
        <option value="thrust">Thrust (compression)</option>
      </select>
      <p class="meta">Sets the background stress. The fraction and the sweep use faults of this type. The other structures are still drawn.</p>
    </div>
  `, true);
  place.querySelector("div").append(dipSourceBlock());
  place.append(auxBlock(["interval_years", "n_events", "exaggeration"]));
  host.append(place);
  host.append(group("Stress and strength", "Background stress, and which sheet values the failure envelope uses.", `
    <div class="row"><header><label for="modulus">Young's modulus</label></header>
      <select id="modulus"><option value="rock_mass">Fractured rock mass (E_rm)</option><option value="intact">Intact basalt (E_intact)</option></select></div>
    <div class="row"><header><label for="cohesion">Cohesion on the fault</label></header>
      <select id="cohesion"><option value="rock_mass">Rock-mass cohesion (reactivation)</option><option value="intact">Intact cohesion</option></select>
      <p class="meta">Reactivation of an existing fault should use the rock-mass cohesion. Intact cohesion is there for comparison.</p></div>
    <div class="row"><header><label for="creep">Viscosity for the time series</label></header>
      <select id="creep">
        <option value="dry_diabase">Dry diabase creep (present-day preset)</option>
        <option value="wet_diabase">Wet diabase creep (early-Mars preset)</option>
        <option value="anorthite">Wet anorthite creep (n = 3, A = 398, from the Q_andesite note)</option>
        <option value="reference_viscosity">Mantle reference viscosity η0 everywhere</option>
      </select>
      <p class="meta">Anorthite uses the wet n and A quoted in the sheet note. Sliding Q_andesite toward the dry end does not replace those constants.</p></div>
    <div class="row">
      <header><label for="cap-moho">Cap faults at Moho</label></header>
      <label class="check"><input id="cap-moho" type="checkbox" checked /> On</label>
      <p class="meta">On by default. Faults are tested only down to the shallower of the BDT and the crust. Local mode uses that region's crust (Valles Marineris 45 km, Cerberus Fossae 35 km, Isidis 15 km). Basin &amp; Global uses the same regional crust inside those windows and the global crust (50 km) elsewhere. Off continues the grid to the BDT even below the Moho. Ductile continuation still applies only when failure reaches the BDT, so with the cap on and a Moho above the BDT that slider does nothing.</p>
    </div>
    <div id="stress-aux"></div>
  `, true));
  document.querySelector("#stress-aux").append(auxBlock(["lambda", "criticality", "stress_drop_mpa", "excavation_fraction", "quality_factor", "k_thermal"]));

  for (const category of CATEGORY_ORDER) {
    const parameters = catalog.parameters.filter((item) => item.category === category);
    const note = category === "VPLanet / interior"
      ? "Local mode exports these and does not use them. Basin & Global reads core radius presets, core mass, CMB temperature, U/Th/K, mantle mass, and the mantle heat flux."
      : category === "Thermal"
        ? "The epoch toggle chooses which of T_s, q_m, H, and Z_BDT is active. Both columns stay editable."
        : category === "Fault geometry"
          ? "These two sliders are the dip angles the calculation uses. Their defaults and ranges follow the dip source and the region. Reset on a row restores that default. The sheet values 60° and 30° are the literature source only."
          : "Sheet value, range, and DOI. Reset restores the tabulated value.";
    const body = document.createElement("div");
    for (const item of parameters) body.append(parameterRow(item));
    host.append(group(category, note, body, category !== "VPLanet / interior" && category !== "Creep"));
  }
  appendGlobalControls(host);
  host.append(assumptions());
  wireControls();
  wireGlobal();
}

function appendGlobalControls(host) {
  const water = group("Water", "Basin & Global only. The slider blends the sheet's dry and wet diabase, the two pore-pressure ends, and clay friction. The creep dropdown above is the local-mode viscosity.", `
    <div class="row-line">
      <button type="button" id="water-dry">Dry</button>
      <button type="button" id="water-wet">Wet</button>
    </div>
  `, true);
  water.classList.add("global-only");
  water.append(auxBlock(["water_fraction", "lambda_dry", "lambda_wet", "clay_reduction"]));
  host.append(water);

  const shell = group("Thin-shell stress", "Tharsis plus the four basins. Isostatic support is extension under a load. Flexural flips the signs. Set the magnitudes to 0 to see the impact alone. Rebound = 1 removes the loads.", `
    <div class="row"><header><label for="support">Support</label></header>
      <select id="support"><option value="isostatic">Isostatic / membrane</option><option value="flexural">Flexural (signs flipped)</option></select>
      <p class="meta">A smooth cap-load shape, not Banerdt's spherical-harmonic solution. The magnitude sliders are the free parameters.</p></div>
    <div class="row"><header><label for="global-regime">Andersonian regime added to the shell</label></header>
      <select id="global-regime"><option value="normal">Normal (extension)</option><option value="thrust">Thrust (compression)</option></select>
      <p class="meta">Same control as local mode. Criticality still scales this uniform field. It is added on top of the shell, so lower one of them if everything is already failed.</p></div>
  `, false);
  shell.classList.add("global-only");
  shell.append(auxBlock([
    "tharsis_mpa", "tharsis_lon", "tharsis_lat", "tharsis_radius_deg", "rebound_fraction",
    "hellas_unload_mpa", "isidis_unload_mpa", "argyre_unload_mpa", "utopia_unload_mpa",
    "hellas_mascon_mpa", "isidis_mascon_mpa", "argyre_mascon_mpa", "utopia_mascon_mpa",
    "antipode_peak", "antipode_width_deg", "static_cutoff_km",
  ]));
  host.append(shell);

  const cascade = group("Cascade and weak zone", "Failed faults shed stress onto neighbors, then connected failures become a weak zone. Valles Marineris can be treated as one candidate plate boundary (Yin 2012) instead of clustering only the faults that fail.", `
    <div class="row"><header><label for="seed">Weak-zone seed</label></header>
      <select id="seed"><option value="mapped">Mapped faults that fail</option><option value="valles_marineris">Valles Marineris as a plate boundary</option></select>
      <p class="meta">Yin (2012, doi:10.1130/L192.1) is the candidate-boundary choice. The default uses only faults the cascade reactivates.</p></div>
  `, false);
  cascade.classList.add("global-only");
  cascade.append(auxBlock([
    "transfer_fraction", "transfer_exponent", "transfer_range_km", "cascade_passes", "cascade_stress_drop_mpa",
    "link_distance_km", "damage_rate", "heal_years", "damage_age_years", "te_km", "lid_length_factor", "ductile_fraction",
  ]));
  host.append(cascade);

  const forces = group("Subduction force balance", "Driving forces over the strength and buoyancy of the weakened lid. Index ≥ 1 initiates subduction. Presets set depletion and eclogite fraction.", `
    <div class="row-line">
      <button type="button" data-lith="depleted">Depleted</button>
      <button type="button" data-lith="fertile">Fertile</button>
      <button type="button" data-lith="eclogite">Eclogitized</button>
    </div>
    <p class="meta">Depleted subtracts 50 kg/m³. Fertile subtracts nothing. Eclogitized keeps the depletion and sets half the crust to the eclogite density. All three are starting points, not inversions.</p>
  `, false);
  forces.classList.add("global-only");
  forces.append(auxBlock([
    "h_lith_km", "plume_fraction", "slab_velocity_cmyr", "rho_mantle", "depletion_kgm3", "eclogite_fraction", "eclogite_density", "cp_rock",
  ]));
  host.append(forces);

  const core = group("Core and dynamo", "First-order CMB heat flow versus the adiabatic threshold, then a magnetic moment and a magnetopause. The authoritative version is the offline model. Core conductivity is not in Wheeler's sheet.", `
    <div class="row-line">
      <button type="button" data-core="bml">1650 km + melt</button>
      <button type="button" data-core="stahler">1830 km homogeneous</button>
      <button type="button" data-core="inner">613 km inner core</button>
    </div>
    <p class="meta">1650 km is the Samuel / Khan baseline and copies R_core_BML plus the sheet's BML mass (the bottom of the M_core range, 1.17×10²³ kg) and a 150 km molten layer. 1830 km is Stähler et al. (2021), the value Wheeler's spreadsheet flags as the VPLanet baseline, with the sheet's homogeneous mass and no molten layer. The inner-core button sets 613 km (Bi et al. 2025, ±67 km) inside the 1650 km core. It does not fill in compositional flux.</p>
    <div class="row"><header><label for="radio-mode">Radiogenic budget</label></header>
      <select id="radio-mode"><option value="bsm">Bulk silicate U/Th/K on M_mantle</option><option value="split">Crustal H plus depleted-mantle U/Th/K</option></select></div>
  `, true);
  core.classList.add("global-only");
  core.append(auxBlock([
    "core_radius_km", "bml_km", "inner_core_km", "k_core", "alpha_core", "cp_core", "bml_transfer",
    "secular_fraction", "q_comp_mw", "beta_dynamo", "radio_scale", "dipole_fraction",
  ]));
  host.append(core);

  const fast = group("Fast core pathway", "Spin stirring can turn a dynamo on. Core-top heating can turn a thermal dynamo off. Both fractions are assumptions.", "", false);
  fast.classList.add("global-only");
  fast.append(auxBlock([
    "spin_coupling", "spin_threshold", "ohmic_fraction", "spin_duration_yr", "core_heat_fraction", "heated_layer_km",
    "mars_mass_kg", "moi_factor", "sol_seconds",
  ]));
  host.append(fast);

  const shield = group("Atmosphere retention", "The moment must clear the exobase at nominal and storm pressure and sit past the Gunell cusp peak. Earth's moment is only a comparison.", "", false);
  shield.classList.add("global-only");
  shield.append(auxBlock(["exobase_km", "p_sw_npa", "storm_factor", "gunell_peak_Am2"]));
  host.append(shield);

  const offline = group("Offline model", "Offline-run files shipped with the page are interpolated when you select one. The browser estimate stays on screen either way. EXAMPLE is not a model result.", `
    <div class="row"><header><label for="offline-file">Offline file</label></header>
      <select id="offline-file"><option value="none">Browser estimate only</option></select>
      <p class="meta">Sharp thresholds are not interpolated. If neighboring runs disagree on dynamo on/off or on the regime, those fields are left blank and the page says so.</p></div>
  `, false);
  offline.classList.add("global-only");
  host.append(offline);
  const offlineSelect = offline.querySelector("#offline-file");
  for (const file of offlineFiles) {
    const option = document.createElement("option");
    option.value = file.id;
    option.textContent = file.catalog?.example ? `${file.id} (example, not science)` : file.id;
    offlineSelect.append(option);
  }
}

function wireGlobal() {
  document.querySelector("#cap-moho").addEventListener("change", (event) => {
    state.capAtMoho = event.target.checked;
    schedule(true);
  });
  document.querySelector("#water-dry").addEventListener("click", () => {
    state.aux.water_fraction = 0;
    syncControls();
    schedule(true);
  });
  document.querySelector("#water-wet").addEventListener("click", () => {
    state.aux.water_fraction = 1;
    syncControls();
    schedule(true);
  });
  document.querySelectorAll("[data-core]").forEach((button) => {
    button.addEventListener("click", () => {
      const mass = parameter("M_core");
      if (button.dataset.core === "bml") {
        state.aux.core_radius_km = state.values.R_core_BML;
        state.aux.bml_km = 150;
        state.aux.inner_core_km = 0;
        state.values.M_core = mass.min;
      } else if (button.dataset.core === "stahler") {
        state.aux.core_radius_km = state.values.R_core_std;
        state.aux.bml_km = 0;
        state.aux.inner_core_km = 0;
        state.values.M_core = mass.value;
      } else {
        state.aux.core_radius_km = state.values.R_core_BML;
        state.aux.bml_km = 150;
        state.aux.inner_core_km = 613;
        state.values.M_core = mass.min;
      }
      syncControls();
      schedule(true);
    });
  });
  document.querySelectorAll("[data-lith]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.lith === "fertile") {
        state.aux.depletion_kgm3 = 0;
        state.aux.eclogite_fraction = 0;
      } else if (button.dataset.lith === "eclogite") {
        state.aux.depletion_kgm3 = 50;
        state.aux.eclogite_fraction = 0.5;
      } else {
        state.aux.depletion_kgm3 = 50;
        state.aux.eclogite_fraction = 0;
      }
      syncControls();
      schedule(true);
    });
  });
  document.querySelector("#support").addEventListener("change", (event) => {
    state.support = event.target.value;
    schedule(true);
  });
  document.querySelector("#global-regime").addEventListener("change", (event) => {
    state.regime = event.target.value;
    schedule(true);
  });
  document.querySelector("#seed").addEventListener("change", (event) => {
    state.seed = event.target.value;
    schedule(true);
  });
  document.querySelector("#radio-mode").addEventListener("change", (event) => {
    state.radioMode = event.target.value;
    schedule(true);
  });
  document.querySelector("#offline-file").addEventListener("change", (event) => {
    state.offlineId = event.target.value;
    schedule(false);
  });
}

function dipSourceBlock() {
  const row = document.createElement("div");
  row.className = "row";
  const options = DIP_SOURCES.map((source) => `<option value="${source.id}">${escapeHtml(source.label)}</option>`).join("");
  row.innerHTML = `
    <header><label for="dip-source">Dip source</label></header>
    <select id="dip-source" class="dip-source">${options}</select>
    <p class="meta" id="dip-source-note"></p>
    <p class="meta" id="dip-fit-note"></p>
    <p class="caveat" id="dip-caveat"></p>
  `;
  row.querySelector("#dip-caveat").textContent = "";
  row.querySelector("#dip-fit-note").textContent = DIP_FIT_SUMMARY;
  return row;
}

function group(title, note, body, open) {
  const details = document.createElement("details");
  details.className = "group";
  if (open) details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = title;
  details.append(summary);
  if (note) {
    const p = document.createElement("p");
    p.className = "group-note";
    p.textContent = note;
    details.append(p);
  }
  if (typeof body === "string") {
    const wrap = document.createElement("div");
    wrap.innerHTML = body;
    details.append(wrap);
  } else {
    details.append(body);
  }
  return details;
}

function auxBlock(keys) {
  const fragment = document.createDocumentFragment();
  for (const key of keys) fragment.append(auxRow(key));
  return fragment;
}

function auxRow(key) {
  const spec = AUX[key];
  const row = document.createElement("div");
  row.className = spec.mode ? `row ${spec.mode}-only` : "row";
  row.dataset.aux = key;
  row.innerHTML = `
    <header>
      <label for="aux-${key}">${spec.name}</label>
      <span class="value" data-readout></span>
    </header>
    <div class="row-line">
      <input id="aux-${key}" data-slider type="range" min="0" max="1000" step="1" />
      <input data-number type="number" />
      <button type="button" class="linkish" data-reset>reset</button>
    </div>
    <div class="meta">${spec.units}. Default ${formatNumber(spec.value)}. ${spec.source}</div>
  `;
  return row;
}

function parameterRow(item) {
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.key = item.key;
  const doi = item.doi ? `https://doi.org/${item.doi}` : "";
  const dip = item.key in DIP_KEYS;
  row.innerHTML = `
    <header>
      <label for="p-${item.key}">${item.name}<span class="badge" data-badge hidden></span></label>
      <span class="value" data-readout></span>
    </header>
    <div class="row-line">
      <input id="p-${item.key}" data-slider type="range" min="0" max="1000" step="1" />
      <input data-number type="number" />
      <button type="button" class="linkish" data-reset>reset</button>
    </div>
    <div class="meta"${dip ? " data-dip-meta" : ""}>${dip ? "" : `${item.units}. Sheet default ${formatNumber(item.value)}. Range ${formatNumber(item.min)}–${formatNumber(item.max)}.
      ${doi ? `<a href="${doi}" target="_blank" rel="noreferrer">doi:${item.doi}</a>.` : ""}
      ${item.material ? ` ${item.material}.` : ""}`}
    </div>
    ${!dip && item.parse_note ? `<div class="meta">${item.parse_note}</div>` : ""}
  `;
  return row;
}

function assumptions() {
  const details = document.createElement("details");
  details.className = "group";
  details.innerHTML = `
    <summary>Assumptions and limitations</summary>
    <div class="assumptions">
      <ul>
        <li>This is a first-order elastic and Coulomb calculation, not a finite-element model and not a VPLanet run. Equations and citations are in MODEL.md.</li>
        <li>Terrain is real MOLA MEGDR topography (32 pixels per degree), clipped and averaged. Fault lines are real USGS SIM 3292 structures. They are graben axes and wrinkle-ridge crests, not surveyed fault planes.</li>
        <li>Fault dip defaults to Wheeler Feer's HiRISE three-point measurements where he made them: about 52° in Valles Marineris and about 55° in Cerberus Fossae, with Cerberus3 corrected from the delivered 90° to the recomputed 61.3°. Isidis has no manual measurement, so its thrust dip is the low-confidence Feature 11 wrinkle-ridge Fisher mean, about 16°. The dip source can switch to the HiRISE programmatic wall means or to the literature fallback of 60° normal and 30° thrust.</li>
        <li>${escapeHtml(DIP_CAVEAT)}</li>
        <li>Dip direction follows a measured wall when the segment is subparallel to that wall. Other segments, and the literature source, use the right-hand normal of the digitized trace. A GeoJSON file can still set dip_deg and dip_azimuth_deg.</li>
        <li>ΔCFS = Δτ + μ Δσ_n with Δσ_n positive in unclamping (King, Stein and Lin, 1994). Dynamic stress is added as a positive peak because the wave reverses; it does not accumulate.</li>
        <li>Static stress is the Boussinesq response to the missing crater mass. Inside the final crater the point-load solution is not used for the verdict: that rock is marked excavated.</li>
        <li>The crust is a flat elastic half-space. Topography changes the drawing and the overburden depth, not the Boussinesq geometry. The Moho and BDT are drawn parallel to the local surface at the single regional thickness.</li>
        <li>Viscous decay uses a Maxwell time from the selected creep law at the background differential stress, or η0 if that mode is selected. Cold shallow rock essentially does not relax.</li>
        <li>Failure is reported only down to the brittle-ductile transition. Nothing below the BDT is called reactivated.</li>
        <li>Basin &amp; Global is a separate first-order estimate: a thin-shell load, a fault cascade, a subduction index, and a parameterized dynamo. It is not VPLanet. The assumptions and the quantities that are not interactive are in MODEL.md.</li>
      </ul>
      <p>Sheet references: ${references.references.map((item) => item.citation).join("; ")}.</p>
    </div>
  `;
  return details;
}

function wireControls() {
  document.querySelectorAll("[data-aux], [data-key]").forEach((row) => {
    const slider = row.querySelector("[data-slider]");
    const number = row.querySelector("[data-number]");
    const logFor = (spec) => spec.log === true || (spec.log !== false && spec.min > 0 && spec.max / spec.min > 80);
    const write = (value) => {
      const spec = specFor(row);
      const clamped = snapToSpec(Math.min(spec.max, Math.max(spec.min, value)), spec);
      if (row.dataset.aux) state.aux[row.dataset.aux] = spec.step ? Math.round(clamped) : clamped;
      else state.values[row.dataset.key] = clamped;
      reflect(row, spec, logFor(spec));
      schedule(false);
    };
    slider.addEventListener("input", () => {
      const spec = specFor(row);
      write(fromSlider(slider.valueAsNumber / 1000, spec, logFor(spec)));
    });
    number.addEventListener("change", () => write(Number(number.value)));
    row.querySelector("[data-reset]").addEventListener("click", () => write(specFor(row).value));
    const initial = specFor(row);
    reflect(row, initial, logFor(initial));
  });
  document.querySelector("#regime").addEventListener("change", (event) => {
    state.regime = event.target.value;
    schedule(true);
  });
  document.querySelector("#modulus").addEventListener("change", (event) => {
    state.modulus = event.target.value;
    schedule(true);
  });
  document.querySelector("#cohesion").addEventListener("change", (event) => {
    state.cohesion = event.target.value;
    schedule(true);
  });
  document.querySelector("#creep").addEventListener("change", (event) => {
    state.creepMode = event.target.value;
    schedule(true);
  });
  document.querySelector("#distance").addEventListener("input", (event) => {
    const fault = selectedFault();
    if (!fault) return;
    state.impact = placeAtDistance(fault, Number(event.target.value));
    schedule(false);
  });
  document.querySelector("#dip-source").addEventListener("change", (event) => {
    state.dipSource = event.target.value;
    applyDipDefaults(state);
    syncControls();
    schedule(true);
  });
  document.querySelector("#fault-select").addEventListener("change", (event) => {
    state.selectedFaultId = event.target.value;
    const fault = selectedFault();
    if (!fault) return;
    state.impact = placeAtDistance(fault, Number(document.querySelector("#distance").value));
    schedule(false);
  });
}

function reflect(row, spec, log) {
  const value = row.dataset.aux ? state.aux[row.dataset.aux] : state.values[row.dataset.key];
  row.querySelector("[data-slider]").value = String(toSlider(value, spec, log) * 1000);
  const number = row.querySelector("[data-number]");
  number.value = String(roundForInput(value));
  number.min = String(spec.min);
  number.max = String(spec.max);
  number.step = spec.step ? String(spec.step) : (spec.log ? "any" : String(linearStep(spec)));
  row.querySelector("[data-readout]").textContent = withUnits(value, spec.units);
  row.classList.toggle("extreme", row.dataset.aux === "diameter_m" && value >= 80000);
}

function fromSlider(t, spec, log) {
  if (!log) return spec.min + t * (spec.max - spec.min);
  return Math.exp(Math.log(spec.min) + t * (Math.log(spec.max) - Math.log(spec.min)));
}

function toSlider(value, spec, log) {
  if (!log) return (value - spec.min) / (spec.max - spec.min || 1);
  return (Math.log(value) - Math.log(spec.min)) / (Math.log(spec.max) - Math.log(spec.min) || 1);
}

function syncControls() {
  app.dataset.mode = state.mode;
  document.querySelectorAll("[data-epoch]").forEach((button) => {
    button.classList.toggle("active", button.dataset.epoch === state.epoch);
  });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  document.querySelectorAll("[data-region]").forEach((button) => {
    button.classList.toggle("active", button.dataset.region === state.regionId);
  });
  const regime = document.querySelector("#regime");
  const modulus = document.querySelector("#modulus");
  const cohesion = document.querySelector("#cohesion");
  const creep = document.querySelector("#creep");
  if (regime) regime.value = state.regime;
  const globalRegime = document.querySelector("#global-regime");
  const support = document.querySelector("#support");
  const seed = document.querySelector("#seed");
  const radioMode = document.querySelector("#radio-mode");
  const offlineFile = document.querySelector("#offline-file");
  if (globalRegime) globalRegime.value = state.regime;
  if (support) support.value = state.support;
  if (seed) seed.value = state.seed;
  if (radioMode) radioMode.value = state.radioMode;
  if (offlineFile) offlineFile.value = state.offlineId;
  if (modulus) modulus.value = state.modulus;
  if (cohesion) cohesion.value = state.cohesion;
  if (creep) creep.value = state.creepMode;
  document.querySelectorAll("[data-aux], [data-key]").forEach((row) => {
    const spec = specFor(row);
    const log = spec.log === true || (spec.log !== false && spec.min > 0 && spec.max / spec.min > 80);
    reflect(row, spec, log);
  });
  const capMoho = document.querySelector("#cap-moho");
  if (capMoho) capMoho.checked = state.capAtMoho !== false;
  const dipSelect = document.querySelector("#dip-source");
  if (dipSelect) dipSelect.value = state.dipSource;
  const dipNote = document.querySelector("#dip-source-note");
  if (dipNote) {
    const normalDip = resolveDip({ regionId: state.regionId, source: state.dipSource, kinematics: "normal" });
    const thrustDip = resolveDip({ regionId: state.regionId, source: state.dipSource, kinematics: "thrust" });
    dipNote.textContent = `Normal faults ${formatNumber(normalDip.dipDeg)}° (${normalDip.badge}). Thrust faults ${formatNumber(thrustDip.dipDeg)}° (${thrustDip.badge}).`;
  }
  const dipCaveatNode = document.querySelector("#dip-caveat");
  if (dipCaveatNode) dipCaveatNode.textContent = dipCaveat({ regionId: state.regionId, source: state.dipSource });
  const epoch = state.epoch === "early" ? "early" : "present";
  const region = currentRegion();
  document.querySelectorAll("[data-key]").forEach((row) => {
    const key = row.dataset.key;
    const badge = row.querySelector("[data-badge]");
    let label = "";
    if (/_(present|early)$/.test(key)) label = key.endsWith(epoch) ? "active" : "other epoch";
    if (key === region.crust_key) label = "this region";
    else if (key.startsWith("d_crust_") && key !== "d_crust_global") label = "other region";
    if (key in DIP_KEYS) {
      const resolved = resolveDip({ regionId: region.id, source: state.dipSource, kinematics: DIP_KEYS[key] });
      label = resolved.badge;
      const meta = row.querySelector("[data-dip-meta]");
      if (meta) {
        const summary = resolved.summary.trim().replace(/[.!?]$/, "");
        meta.textContent = `${summary}. Active range ${formatNumber(resolved.min)}–${formatNumber(resolved.max)}°.`;
      }
    }
    badge.hidden = !label;
    badge.textContent = label;
    badge.classList.toggle("low", label === "low confidence");
    row.classList.toggle("inactive", label === "other epoch" || label === "other region");
  });
  const distance = document.querySelector("#distance");
  if (distance) {
    const fault = selectedFault();
    if (fault) {
      const km = distanceToFault(fault, state.impact) / 1000;
      distance.value = String(Math.max(0, Math.min(800, Math.round(km))));
      document.querySelector("#distance-readout").textContent = `${km.toFixed(0)} km`;
    }
  }
  const subsurface = document.querySelector("#subsurface");
  if (subsurface) subsurface.checked = state.showSubsurface;
}

function fillFaultSelect() {
  const select = document.querySelector("#fault-select");
  if (!select) return;
  const loaded = cache.get(state.regionId);
  if (!loaded) return;
  const features = [...loaded.faults.features].sort((a, b) => b.properties.length_km - a.properties.length_km);
  select.innerHTML = features.map((feature) => {
    const props = feature.properties;
    return `<option value="${props.id}">${escapeHtml(props.name)} · ${props.kinematics} · ${props.length_km} km</option>`;
  }).join("");
  if (!features.some((feature) => feature.properties.id === state.selectedFaultId)) {
    state.selectedFaultId = features[0]?.properties.id || null;
  }
  select.value = state.selectedFaultId || "";
}

function selectedFault() {
  const loaded = cache.get(state.regionId);
  if (!loaded || !state.selectedFaultId) return null;
  return loaded.faults.features.find((feature) => feature.properties.id === state.selectedFaultId) || null;
}

function placeAtDistance(feature, kilometers) {
  const coords = feature.geometry.coordinates;
  const mid = coords[Math.floor(coords.length / 2)];
  const end = coords[coords.length - 1];
  const start = coords[0];
  const strike = azimuthDeg(start[0], start[1], end[0], end[1]);
  const azimuth = resolveDipAzimuth({
    strikeDeg: strike,
    regionId: state.regionId,
    source: state.dipSource,
    kinematics: feature.properties.kinematics,
    explicitAzimuthDeg: feature.properties.dip_azimuth_deg,
  }).dipAzimuthDeg;
  return destinationPoint(mid[0], mid[1], azimuth, kilometers * 1000);
}

function distanceToFault(feature, impact) {
  let best = Infinity;
  const coords = feature.geometry.coordinates;
  for (let i = 0; i < coords.length; i += 1) {
    best = Math.min(best, haversineM(impact.lon, impact.lat, coords[i][0], coords[i][1]));
  }
  return best;
}

function writeUrl() {
  const overrides = {};
  for (const item of catalog.parameters) {
    const baseline = item.key in DIP_KEYS
      ? resolveDip({ regionId: state.regionId, source: state.dipSource, kinematics: DIP_KEYS[item.key] }).dipDeg
      : item.value;
    if (Math.abs(state.values[item.key] - baseline) > Math.max(1e-9, Math.abs(baseline) * 1e-6)) {
      overrides[item.key] = state.values[item.key];
    }
  }
  const aux = {};
  for (const [key, spec] of Object.entries(AUX)) {
    if (Math.abs(state.aux[key] - spec.value) > Math.max(1e-12, Math.abs(spec.value) * 1e-6)) aux[key] = state.aux[key];
  }
  const payload = {
    v: 1,
    region: state.regionId,
    epoch: state.epoch,
    creepMode: state.creepMode,
    modulus: state.modulus,
    cohesion: state.cohesion,
    regime: state.regime,
    dipSource: state.dipSource,
    impact: state.impact,
    fault: state.selectedFaultId,
    showSubsurface: state.showSubsurface,
    mode: state.mode,
    capAtMoho: state.capAtMoho !== false,
    seed: state.seed,
    support: state.support,
    radioMode: state.radioMode,
    offlineId: state.offlineId,
    overrides,
    aux,
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = new URL(location.href);
  url.searchParams.set("s", encoded);
  history.replaceState(null, "", url);
}

function applyUrl(target) {
  const encoded = new URL(location.href).searchParams.get("s");
  if (!encoded) return;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (payload.region && REGIONS.some((region) => region.id === payload.region)) target.regionId = payload.region;
    if (payload.epoch === "early" || payload.epoch === "present") target.epoch = payload.epoch;
    if (payload.creepMode) target.creepMode = payload.creepMode;
    if (payload.modulus) target.modulus = payload.modulus;
    if (payload.cohesion) target.cohesion = payload.cohesion;
    if (payload.regime === "normal" || payload.regime === "thrust") target.regime = payload.regime;
    if (DIP_SOURCES.some((item) => item.id === payload.dipSource)) target.dipSource = payload.dipSource;
    applyDipDefaults(target);
    if (payload.impact) target.impact = payload.impact;
    if (payload.fault) target.selectedFaultId = payload.fault;
    if (typeof payload.showSubsurface === "boolean") target.showSubsurface = payload.showSubsurface;
    if (payload.mode === "global" || payload.mode === "local") target.mode = payload.mode;
    if (typeof payload.capAtMoho === "boolean") target.capAtMoho = payload.capAtMoho;
    if (payload.seed === "mapped" || payload.seed === "valles_marineris") target.seed = payload.seed;
    if (payload.support === "isostatic" || payload.support === "flexural") target.support = payload.support;
    if (payload.radioMode === "bsm" || payload.radioMode === "split") target.radioMode = payload.radioMode;
    if (typeof payload.offlineId === "string") target.offlineId = payload.offlineId;
    for (const [key, value] of Object.entries(payload.overrides || {})) {
      if (key in target.values && Number.isFinite(value)) target.values[key] = value;
    }
    for (const [key, kinematics] of Object.entries(DIP_KEYS)) {
      const resolved = resolveDip({ regionId: target.regionId, source: target.dipSource, kinematics });
      target.values[key] = Math.min(resolved.max, Math.max(resolved.min, target.values[key]));
    }
    for (const [key, value] of Object.entries(payload.aux || {})) {
      if (key in target.aux && Number.isFinite(value)) target.aux[key] = value;
    }
    if (!payload.aux || !Number.isFinite(payload.aux.te_km)) {
      target.aux.te_km = target.epoch === "early" ? EARLY_TE_KM : PRESENT_TE_KM;
    }
  } catch {
    // A bad share link should not block the defaults.
  }
}

function downloadJson() {
  if (!latest) return;
  const payload = exportPayload();
  download("mars-impact-scenario.json", JSON.stringify(payload, finiteReplacer, 2), "application/json");
}

function downloadCsv() {
  if (!latest) return;
  if (latest.mode === "global") {
    const lines = ["diameter_m,velocity_m_s,regime,protective,fraction_failed,subduction_index,moment_Am2"];
    for (const row of latest.map || []) {
      lines.push([row.diameterM, row.velocityMs, row.regime, row.protective, row.fractionFailed, row.subductionIndex, row.momentAm2].join(","));
    }
    download("mars-impact-regime-map.csv", lines.join("\n"), "text/csv");
    return;
  }
  const lines = ["section,diameter_m,coupled_J,magnitude,fraction_immediate,fraction_static"];
  for (const row of latest.sweep || []) {
    lines.push(["sweep", row.diameterM, row.coupledJ, row.magnitude, row.fractionRegime, row.fractionRegimeStatic].join(","));
  }
  lines.push("section,fault,depth_m,cfs_background_Pa,delta_static_Pa,delta_dynamic_Pa,cfs_Pa,status");
  const fault = regimeFault(latest.result);
  for (const row of fault?.closestProfile || []) {
    lines.push(["profile", csvEscape(fault.name), row.z, row.cfsBg, row.dStatic, row.dDynamic, row.cfs, row.status].join(","));
  }
  download("mars-impact-scenario.csv", lines.join("\n"), "text/csv");
}

function exportPayload() {
  if (latest?.mode === "global") {
    const result = latest.result;
    return {
      app: "mars-impact-fault-explorer",
      version: "0.2.0",
      generated: new Date().toISOString(),
      mode: "global",
      epoch: state.epoch,
      regime: state.regime,
      seed: state.seed,
      support: state.support,
      radioMode: state.radioMode,
      impact: state.impact,
      parameters: catalog.parameters.map((item) => ({
        key: item.key,
        value: state.values[item.key],
        units: item.units,
      })),
      auxiliary: state.aux,
      source: result.source,
      outcome: result.regime,
      weakZone: result.weakZone,
      subduction: {
        index: result.subduction.index,
        initiates: result.subduction.initiates,
        qSlabWm2: result.subduction.qSlabWm2,
      },
      core: result.core,
      note: "Browser estimate. Not a VPLanet run.",
    };
  }
  const result = latest.result;
  return {
    app: "mars-impact-fault-explorer",
    version: "0.1.0",
    generated: new Date().toISOString(),
    region: latest.region.id,
    epoch: state.epoch,
    regime: state.regime,
    dipSource: state.dipSource,
    dip: {
      normal: resolveDip({ regionId: latest.region.id, source: state.dipSource, kinematics: "normal" }),
      thrust: resolveDip({ regionId: latest.region.id, source: state.dipSource, kinematics: "thrust" }),
      caveat: DIP_CAVEAT,
    },
    creepMode: state.creepMode,
    modulus: state.modulus,
    cohesion: state.cohesion,
    impact: latest.spec.impact,
    parameters: catalog.parameters.map((item) => ({
      key: item.key,
      name: item.name,
      value: state.values[item.key],
      units: item.units,
      min: item.min,
      max: item.max,
      doi: item.doi,
      used_by_model: item.used_by_model,
      parse_note: item.parse_note,
    })),
    auxiliary: state.aux,
    source: {
      magnitude: result.source.magnitude,
      coupledJ: result.source.coupledJ,
      seismicJ: result.source.seismicJ,
      kineticJ: result.source.kineticJ,
      transientM: result.source.transientM,
      finalM: result.source.finalM,
    },
    fractionRegime: result.fractionRegime,
    fractionRegimeStatic: result.fractionRegimeStatic,
    fractionLocal: result.fractionLocal,
    fractionLocalStatic: result.fractionLocalStatic,
    localRadiusM: result.localRadiusM,
    faults: result.faults.map((fault) => ({
      id: fault.id,
      name: fault.name,
      kinematics: fault.kinematics,
      minDistanceM: fault.minDistanceM,
      fraction: fault.fraction,
      fractionStatic: fault.fractionStatic,
      maxCfsPa: fault.maxCfs,
      failedDepthMinM: fault.failedDepthMin,
      failedDepthMaxM: fault.failedDepthMax,
    })),
    sweep: latest.sweep,
    series: latest.series,
    critical: result.critical,
  };
}

function finiteReplacer(key, value) {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function download(filename, text, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function metric(name, value) {
  const tips = {
    "Moment magnitude": "From the seismic energy via Kanamori (1977). Not a measured earthquake.",
    Mw: "From the seismic energy via Kanamori (1977). Not a measured earthquake.",
  };
  const tip = tips[name];
  const label = tip ? `<abbr class="term" title="${escapeHtml(tip)}">${name}</abbr>` : name;
  return `<dt>${label}</dt><dd>${value}</dd>`;
}

function sci(value, unit) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toExponential(2)} ${unit}`;
}

function formatMeters(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function formatMaxwell(seconds) {
  if (!Number.isFinite(seconds)) return "no relaxation in the cold crust";
  const years = seconds / YEAR_S;
  if (years > 4.5e9) return "longer than the age of Mars";
  if (years >= 1e9) return `${(years / 1e9).toFixed(2)} Gyr`;
  if (years >= 1e6) return `${(years / 1e6).toFixed(2)} Myr`;
  if (years >= 1e3) return `${(years / 1e3).toFixed(1)} kyr`;
  return `${years.toFixed(0)} yr`;
}

function linearStep(spec) {
  const span = Math.abs(spec.max - spec.min);
  if (span > 500) return 1;
  if (span > 50) return 0.1;
  if (span > 5) return 0.01;
  return 0.001;
}

function snapToSpec(value, spec) {
  if (!Number.isFinite(value)) return spec.min;
  let next = value;
  if (spec.step) next = Math.round(value / spec.step) * spec.step;
  else if (spec.log) next = Number(value.toPrecision(4));
  else {
    const step = linearStep(spec);
    next = Math.round(value / step) * step;
  }
  return Math.min(spec.max, Math.max(spec.min, next));
}

function withUnits(value, units) {
  const singular = Math.abs(value - 1) < 1e-9;
  let label = units;
  if (singular && units === "years") label = "year";
  else if (singular && units === "events") label = "event";
  else if (singular && units === "iterations") label = "iteration";
  return `${formatNumber(value)} ${label}`.trim();
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1e5)) return value.toExponential(3);
  if (abs >= 100) return value.toFixed(1).replace(/\.0$/, "");
  if (abs >= 1) return String(Math.round(value * 1000) / 1000);
  return String(Math.round(value * 1e6) / 1e6);
}

function roundForInput(value) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 1e6)) return Number(value.toExponential(6));
  return Math.round(value * 1e6) / 1e6;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function csvEscape(text) {
  const value = String(text);
  return value.includes(",") ? `"${value}"` : value;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function wireRegimeMap() {
  const canvas = document.querySelector("#regime-plot");
  const tip = document.querySelector("#regime-tip");
  if (!canvas || canvas.dataset.wired) return;
  canvas.dataset.wired = "1";
  const hit = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return (canvas._regimeCells || []).find((cell) => x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h);
  };
  canvas.addEventListener("mousemove", (event) => {
    const cell = hit(event);
    if (!cell || !tip) {
      if (tip) tip.hidden = true;
      return;
    }
    const regime = cell.row?.regime || "none";
    const names = { none: "no slip (beige)", slip: "faults slip", lid: "lid breaks", dynamo: "protective dynamo" };
    tip.hidden = false;
    tip.textContent = `${(cell.diameterM / 1000).toFixed(cell.diameterM >= 10000 ? 0 : 1)} km, ${(cell.velocityMs / 1000).toFixed(0)} km/s: ${names[regime] || regime}. Subduction index ${Number.isFinite(cell.row?.subductionIndex) ? cell.row.subductionIndex.toFixed(2) : "—"}. ${cell.outlined ? "This is the outlined cell, the one nearest the current sliders." : "Click to set the diameter and velocity sliders."}`;
  });
  canvas.addEventListener("mouseleave", () => { if (tip) tip.hidden = true; });
  canvas.addEventListener("click", (event) => {
    const cell = hit(event);
    if (!cell) return;
    state.aux.diameter_m = cell.diameterM;
    state.aux.velocity_m_s = cell.velocityMs;
    syncControls();
    schedule(false);
  });
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 2200);
}

// Silence a lint-style unused import if the bundler keeps it. references is used above.
void references;
