import catalog from "../data/parameters.json";
import references from "../data/references.json";
import regionFile from "../data/regions.json";
import { MARS_GRAVITY, azimuthDeg, destinationPoint, haversineM } from "./model/physics.js";
import { LOCAL_RADIUS_M, onsetDiameter, prepareGrid, repeatedImpacts, runImpact, stressHistory, sweepDiameters } from "./model/scenario.js";
import { logSpace } from "./model/physics.js";
import { createView, makeProjector } from "./scene.js";
import { drawDepth, drawSeries, drawSweep } from "./plots.js";

const REGIONS = regionFile.regions;
const YEAR_S = 365.25 * 24 * 3600;
const ANORTHITE = { n: 3, A: 398 };

const AUX = {
  diameter_m: { name: "Impactor diameter", value: 1000, min: 30, max: 80000, units: "m", log: true, source: "Scenario input. Not in the spreadsheet." },
  velocity_m_s: { name: "Impact velocity", value: 10000, min: 5000, max: 25000, units: "m/s", source: "Scenario input. Mars impact speeds are typically several to about 20 km/s." },
  density_impactor: { name: "Impactor density", value: 3000, min: 500, max: 8000, units: "kg/m³", source: "Scenario input. 3000 is a stony body; irons are near 8000 and cometary ice near 500." },
  angle_deg: { name: "Impact angle from horizontal", value: 45, min: 10, max: 90, units: "degrees", source: "Scenario input. 90° is vertical. 45° is the most probable impact angle." },
  efficiency: { name: "Seismic efficiency k", value: 1e-4, min: 1e-6, max: 1e-2, units: "E_seismic / E_coupled", log: true, source: "Schultz & Gault (1975). The slider spans the range discussed for planetary impacts, including Teanby & Wookey (2011)." },
  stress_drop_mpa: { name: "Stress drop", value: 3, min: 0.3, max: 30, units: "MPa", source: "Converts seismic energy to seismic moment. A typical earthquake stress drop, not a measured Mars impact." },
  excavation_fraction: { name: "Permanent excavation fraction", value: 0.25, min: 0.05, max: 1, units: "of transient cavity", source: "Model assumption. Complex-crater collapse puts most of the transient cavity back." },
  quality_factor: { name: "Seismic quality factor Q", value: 500, min: 50, max: 2000, units: "dimensionless", source: "Model assumption for anelastic attenuation. Not in the spreadsheet." },
  lambda: { name: "Pore-pressure ratio λ", value: 0, min: 0, max: 0.8, units: "P / σ_v", source: "Model assumption. The present-day preset uses 0 (dry). The early-Mars preset sets 0.4." },
  criticality: { name: "Stress criticality χ", value: 0.85, min: 0, max: 1, units: "fraction of failure", source: "Model assumption. 1 means an optimally oriented fault is already at failure." },
  k_thermal: { name: "Crustal thermal conductivity", value: 2.5, min: 1.5, max: 4, units: "W/m/K", source: "Not in the spreadsheet. Mid-range basaltic conductivity used to turn heat flux into a geotherm." },
  interval_years: { name: "Repeat interval", value: 1e6, min: 1e3, max: 1e8, units: "years", log: true, source: "Scenario input for the repeated-impact series." },
  n_events: { name: "Number of impacts", value: 12, min: 2, max: 24, units: "events", step: 1, source: "Scenario input for the repeated-impact series." },
  exaggeration: { name: "Vertical exaggeration", value: 12, min: 1, max: 40, units: "display only", source: "Display only. It does not enter the stress calculation." },
};

const CATEGORY_ORDER = ["Rheology", "Creep", "Thermal", "Fault geometry", "Crustal structure", "VPLanet / interior"];

const app = document.querySelector("#app");
const state = createState();
applyUrl(state);

app.innerHTML = `
  <header class="top">
    <div class="brand">
      <h1>Mars impact fault explorer</h1>
      <p>Wheeler Feer · Andrew Laskowski, Montana State University · first-order reactivation sandbox</p>
    </div>
    <div class="top-controls">
      <div class="regions" id="regions"></div>
      <div class="epochs">
        <button type="button" data-epoch="present">Present day</button>
        <button type="button" data-epoch="early">Early Mars</button>
      </div>
    </div>
    <div class="actions">
      <button type="button" id="reset">Reset</button>
      <button type="button" id="share">Copy link</button>
      <button type="button" id="export-json">Export JSON</button>
      <button type="button" id="export-csv">Export CSV</button>
    </div>
  </header>
  <div class="workspace">
    <div class="stage">
      <div class="viewport">
        <canvas id="view"></canvas>
        <div class="legend">
          <div><span class="sw-stable"></span>stable</div>
          <div><span class="sw-near"></span>near failure</div>
          <div><span class="sw-fail"></span>reactivated</div>
          <div><span class="sw-cave"></span>inside cavity</div>
        </div>
        <div class="hud">
          <span>Click the terrain to place the impact. Drag to orbit.</span>
          <button type="button" id="camera">Reset camera</button>
          <label><input type="checkbox" id="subsurface" checked /> Subsurface cutaway</label>
        </div>
      </div>
      <div class="plots">
        <section class="plot"><h2>CFS vs depth, closest regime fault</h2><canvas id="depth-plot"></canvas></section>
        <section class="plot"><h2>Reactivated fraction within 250 km</h2><canvas id="sweep-plot"></canvas></section>
        <section class="plot"><h2>Repeated impacts: stress and area</h2><canvas id="series-plot"></canvas></section>
      </div>
    </div>
    <aside class="sidebar">
      <section class="results" id="results"></section>
      <div class="controls" id="controls"></div>
    </aside>
  </div>
`;

const regionHost = document.querySelector("#regions");
for (const region of REGIONS) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = region.name;
  button.dataset.region = region.id;
  regionHost.appendChild(button);
}

const view = createView(document.querySelector("#view"), {
  onPick(point) {
    state.impact = point;
    schedule(true);
  },
});

document.querySelectorAll("[data-epoch]").forEach((button) => {
  button.addEventListener("click", () => {
    state.epoch = button.dataset.epoch;
    state.creepMode = state.epoch === "early" ? "wet_diabase" : "dry_diabase";
    state.aux.lambda = state.epoch === "early" ? 0.4 : 0;
    syncControls();
    schedule(true);
  });
});
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
document.querySelector("#camera").addEventListener("click", () => view.resetCamera());
document.querySelector("#subsurface").addEventListener("change", (event) => {
  state.showSubsurface = event.target.checked;
  paintView();
});

const cache = new Map();
let token = 0;

buildControls();
syncControls();
let runTimer = 0;
let heavyTimer = 0;
let latest = null;

selectRegion(state.regionId, false);

function createState() {
  const values = {};
  for (const parameter of catalog.parameters) values[parameter.key] = parameter.value;
  const aux = {};
  for (const [key, spec] of Object.entries(AUX)) aux[key] = spec.value;
  return {
    regionId: REGIONS[0].id,
    epoch: "present",
    creepMode: "dry_diabase",
    modulus: "rock_mass",
    cohesion: "rock_mass",
    regime: REGIONS[0].regime_default,
    impact: { ...REGIONS[0].default_impact },
    selectedFaultId: null,
    showSubsurface: true,
    values,
    aux,
  };
}

function currentRegion() {
  return REGIONS.find((region) => region.id === state.regionId) || REGIONS[0];
}

function selectRegion(id, resetPlace) {
  state.regionId = id;
  const region = currentRegion();
  if (resetPlace) {
    state.regime = region.regime_default;
    state.impact = { ...region.default_impact };
    state.selectedFaultId = null;
  }
  syncControls();
  loadRegion(region);
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
  runTimer = requestAnimationFrame(() => compute(false));
  clearTimeout(heavyTimer);
  heavyTimer = setTimeout(() => compute(true), immediate ? 30 : 180);
}

function compute(heavy) {
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
  latest = { result, grid, spec, sweep, series, history, region, loaded };
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
    sampling: { spacingM: 20000, depthSteps: 8 },
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
  const pct = (value) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
  const onset = latest.sweep ? onsetDiameter(latest.sweep, "fractionLocal") : null;
  const onsetStatic = latest.sweep ? onsetDiameter(latest.sweep, "fractionLocalStatic") : null;
  const nearest = result.faults.length
    ? result.faults.reduce((best, fault) => (fault.minDistanceM < best.minDistanceM ? fault : best), result.faults[0])
    : null;
  const critical = result.critical;
  const host = document.querySelector("#results");
  host.innerHTML = `
    <p class="tag">${region.name} · ${state.epoch === "early" ? "early Mars" : "present day"} · ${regimeName} regime</p>
    <h2>${verdict(result, regimeName)}</h2>
    <p class="verdict">${onsetText(onset, onsetStatic, regimeName)}</p>
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
    </dl>
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
    <p class="meta">CFS is in MPa and includes the background deficit, so negative means still stable. The table shows the eight faults closest to failure.</p>
  `;
}

function verdict(result, regimeName) {
  const fraction = result.fractionLocal;
  if (fraction == null) return `No ${regimeName} faults lie within 250 km of this impact.`;
  if (fraction <= 0) return `This impact does not reactivate ${regimeName} faults within 250 km.`;
  return `${(fraction * 100).toFixed(1)}% of the ${regimeName}-fault area within 250 km fails.`;
}

function onsetText(onset, onsetStatic, regimeName) {
  if (!latest.sweep) return "Magnitude sweep is computing.";
  const mag = (diameter) => {
    const row = latest.sweep.find((item) => item.diameterM === diameter);
    return row ? `Mw ${row.magnitude.toFixed(1)}` : "";
  };
  const immediate = onset
    ? `Immediate ${regimeName} reactivation begins at ${formatMeters(onset)} (${mag(onset)}).`
    : `No immediate ${regimeName} reactivation inside the sweep (40 m to 60 km).`;
  const sustained = onsetStatic
    ? ` Static-only onset is ${formatMeters(onsetStatic)} (${mag(onsetStatic)}).`
    : " Static stress alone does not reach failure inside the sweep.";
  return immediate + sustained;
}

function buildControls() {
  const host = document.querySelector("#controls");
  host.innerHTML = "";
  host.append(group("Impact scenario", "These are scenario inputs. They are not columns in the parameter sheet.", auxBlock([
    "diameter_m", "velocity_m_s", "density_impactor", "angle_deg", "efficiency",
  ]), true));
  const place = group("Where and how often", "Click the terrain, or set a distance from a mapped fault. The series uses the repeat interval.", `
    <div class="row">
      <header><label for="fault-select">Reference fault</label></header>
      <select id="fault-select"></select>
    </div>
    <div class="row">
      <header><label>Distance from the reference fault</label><span class="value" id="distance-readout"></span></header>
      <input id="distance" type="range" min="0" max="800" step="1" />
    </div>
    <div class="row">
      <header><label for="regime">Andersonian regime</label></header>
      <select id="regime">
        <option value="normal">Normal (extension)</option>
        <option value="thrust">Thrust (compression)</option>
      </select>
      <p class="meta">Sets the background stress. The fraction and the sweep use faults of this type. The other structures are still drawn.</p>
    </div>
  `, true);
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
    <div id="stress-aux"></div>
  `, true));
  document.querySelector("#stress-aux").append(auxBlock(["lambda", "criticality", "stress_drop_mpa", "excavation_fraction", "quality_factor", "k_thermal"]));

  for (const category of CATEGORY_ORDER) {
    const parameters = catalog.parameters.filter((item) => item.category === category);
    const note = category === "VPLanet / interior"
      ? "Exported for a later VPLanet run. The fault calculation does not read these."
      : category === "Thermal"
        ? "The epoch toggle chooses which of T_s, q_m, H, and Z_BDT is active. Both columns stay editable."
        : "Sheet value, range, and DOI. Reset restores the tabulated value.";
    const body = document.createElement("div");
    for (const item of parameters) body.append(parameterRow(item));
    host.append(group(category, note, body, category !== "VPLanet / interior" && category !== "Creep"));
  }
  host.append(assumptions());
  wireControls();
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
  row.className = "row";
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
    <div class="meta">${item.units}. Sheet default ${formatNumber(item.value)}. Range ${formatNumber(item.min)}–${formatNumber(item.max)}.
      ${doi ? `<a href="${doi}" target="_blank" rel="noreferrer">doi:${item.doi}</a>.` : ""}
      ${item.material ? ` ${item.material}.` : ""}
    </div>
    ${item.parse_note ? `<div class="meta">${item.parse_note}</div>` : ""}
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
        <li>Dip comes from the spreadsheet sliders. Dip azimuth defaults to the right-hand normal of each digitized segment. A GeoJSON file can override both.</li>
        <li>ΔCFS = Δτ + μ Δσ_n with Δσ_n positive in unclamping (King, Stein and Lin, 1994). Dynamic stress is added as a positive peak because the wave reverses; it does not accumulate.</li>
        <li>Static stress is the Boussinesq response to the missing crater mass. Inside the final crater the point-load solution is not used for the verdict: that rock is marked excavated.</li>
        <li>The crust is a flat elastic half-space. Topography changes the drawing and the overburden depth, not the Boussinesq geometry. The Moho and BDT are drawn parallel to the local surface at the single regional thickness.</li>
        <li>Viscous decay uses a Maxwell time from the selected creep law at the background differential stress, or η0 if that mode is selected. Cold shallow rock essentially does not relax.</li>
        <li>Failure is reported only down to the brittle-ductile transition. Nothing below the BDT is called reactivated.</li>
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
    const spec = row.dataset.aux ? AUX[row.dataset.aux] : parameter(row.dataset.key);
    const log = Boolean(spec.log || (spec.min > 0 && spec.max / spec.min > 80));
    const read = () => (row.dataset.aux ? state.aux[row.dataset.aux] : state.values[row.dataset.key]);
    const write = (value) => {
      const clamped = Math.min(spec.max, Math.max(spec.min, value));
      if (row.dataset.aux) state.aux[row.dataset.aux] = spec.step ? Math.round(clamped) : clamped;
      else state.values[row.dataset.key] = clamped;
      reflect(row, spec, log);
      schedule(false);
    };
    slider.addEventListener("input", () => write(fromSlider(slider.valueAsNumber / 1000, spec, log)));
    number.addEventListener("change", () => write(Number(number.value)));
    row.querySelector("[data-reset]").addEventListener("click", () => write(spec.value));
    reflect(row, spec, log);
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
  number.step = spec.step ? String(spec.step) : "any";
  row.querySelector("[data-readout]").textContent = `${formatNumber(value)} ${spec.units}`;
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
  document.querySelectorAll("[data-epoch]").forEach((button) => {
    button.classList.toggle("active", button.dataset.epoch === state.epoch);
  });
  document.querySelectorAll("[data-region]").forEach((button) => {
    button.classList.toggle("active", button.dataset.region === state.regionId);
  });
  const regime = document.querySelector("#regime");
  const modulus = document.querySelector("#modulus");
  const cohesion = document.querySelector("#cohesion");
  const creep = document.querySelector("#creep");
  if (regime) regime.value = state.regime;
  if (modulus) modulus.value = state.modulus;
  if (cohesion) cohesion.value = state.cohesion;
  if (creep) creep.value = state.creepMode;
  document.querySelectorAll("[data-aux], [data-key]").forEach((row) => {
    const spec = row.dataset.aux ? AUX[row.dataset.aux] : parameter(row.dataset.key);
    const log = Boolean(spec.log || (spec.min > 0 && spec.max / spec.min > 80));
    reflect(row, spec, log);
  });
  const epoch = state.epoch === "early" ? "early" : "present";
  const region = currentRegion();
  document.querySelectorAll("[data-key]").forEach((row) => {
    const key = row.dataset.key;
    const badge = row.querySelector("[data-badge]");
    let label = "";
    if (/_(present|early)$/.test(key)) label = key.endsWith(epoch) ? "active" : "other epoch";
    if (key === region.crust_key) label = "this region";
    else if (key.startsWith("d_crust_") && key !== "d_crust_global") label = "other region";
    badge.hidden = !label;
    badge.textContent = label;
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
  const azimuth = Number.isFinite(feature.properties.dip_azimuth_deg)
    ? feature.properties.dip_azimuth_deg
    : (strike + 90) % 360;
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
    if (Math.abs(state.values[item.key] - item.value) > Math.max(1e-9, Math.abs(item.value) * 1e-6)) {
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
    impact: state.impact,
    fault: state.selectedFaultId,
    showSubsurface: state.showSubsurface,
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
    if (payload.impact) target.impact = payload.impact;
    if (payload.fault) target.selectedFaultId = payload.fault;
    if (typeof payload.showSubsurface === "boolean") target.showSubsurface = payload.showSubsurface;
    for (const [key, value] of Object.entries(payload.overrides || {})) {
      if (key in target.values && Number.isFinite(value)) target.values[key] = value;
    }
    for (const [key, value] of Object.entries(payload.aux || {})) {
      if (key in target.aux && Number.isFinite(value)) target.aux[key] = value;
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
  const result = latest.result;
  return {
    app: "mars-impact-fault-explorer",
    version: "0.1.0",
    generated: new Date().toISOString(),
    region: latest.region.id,
    epoch: state.epoch,
    regime: state.regime,
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
  return `<dt>${name}</dt><dd>${value}</dd>`;
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

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 2200);
}

// Silence a lint-style unused import if the bundler keeps it. references is used above.
void references;
