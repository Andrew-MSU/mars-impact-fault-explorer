function esc(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function sci(value, unit = "") {
  if (!Number.isFinite(value)) return "—";
  return `${value.toExponential(2)}${unit ? ` ${unit}` : ""}`;
}

function years(value) {
  if (value == null) return "—";
  if (!Number.isFinite(value)) return "steady while the budget stays above the adiabat";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} Gyr`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} Myr`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kyr`;
  return `${value.toFixed(0)} yr`;
}

function mw(value) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function km(meters, momentAm2 = 1) {
  if (!(momentAm2 > 0) || meters == null || !Number.isFinite(meters)) return "n/a (no field)";
  return `${(meters / 1000).toFixed(0)} km`;
}

function viscosityText(eta) {
  if (!Number.isFinite(eta)) return "not defined";
  if (eta > 1e24) {
    return `${eta.toExponential(2)} Pa·s — effectively rigid. Dry diabase at mid-BDT temperature creeps so slowly that the Maxwell time is longer than the age of Mars, so repeated impacts do not relax.`;
  }
  return `${eta.toExponential(2)} Pa·s`;
}

export function dynamoStatus(core) {
  const q = core.qCmbWm2 * 1e3;
  const ad = core.qAdWm2 * 1e3;
  const gap = q - ad;
  const spin = Number.isFinite(core.spinRatio) ? core.spinRatio.toExponential(2) : "—";
  if (core.pathway === "background" && core.backgroundProtective) {
    return `Background heat flow already passes the retention tests (q_cmb ${q.toFixed(2)} vs q_adiabatic ${ad.toFixed(2)} mW/m²). This impact is not what turns the dynamo on.`;
  }
  if (!(core.qCmbWm2 > core.qAdWm2)) {
    return `No thermal dynamo at these settings: q_cmb is ${q.toFixed(2)} mW/m² and q_adiabatic is ${ad.toFixed(2)} mW/m² (short by ${Math.abs(gap).toFixed(2)} mW/m²). A thermal moment needs q_cmb above the adiabat, which means a higher mantle heat flux, lower core conductivity, or less radiogenic heating. Stirring is ${core.stirring ? "on" : "off"} (ΔΩ/Ω = ${spin}). fast pathway protective: ${core.fastProtective ? "yes" : "no"}.`;
  }
  if (!core.protective) {
    return `q_cmb ${q.toFixed(2)} mW/m² is above q_adiabatic ${ad.toFixed(2)} mW/m², so a thermal moment is estimated, but it does not clear the Gunell peak and both standoffs. Raising β or the super-adiabatic flux would grow the moment; this page does not adjust those to force a dynamo. Stirring ΔΩ/Ω = ${spin}.`;
  }
  return pathwayText(core);
}

const TIPS = {
  "q_cmb": "Heat flow at the base of the crust, minus mantle heating, spread over the core surface.",
  "q_ad": "Conductive flux down the core adiabat. A thermal moment needs q_cmb above this.",
  "q_adiabatic": "Conductive flux down the core adiabat. A thermal moment needs q_cmb above this.",
  "Mw": "Moment magnitude from the seismic energy. Not a measured earthquake.",
  "Moment magnitude": "Moment magnitude from the seismic energy. Not a measured earthquake.",
  "ΔΩ/Ω": "Fractional spin change from the impact. Stirring turns on only above the threshold.",
  "Past Gunell peak": "Gunell et al. (2018) cusp-escape peak. Protective cases must lie past it.",
  "Nominal standoff": "Magnetopause altitude at nominal solar wind. n/a when there is no moment.",
  "Storm standoff": "Magnetopause altitude at storm solar wind. n/a when there is no moment.",
  "vs Earth": "This moment divided by Earth's. n/a when there is no moment.",
};

function cell(label, value) {
  const tip = TIPS[label];
  const name = tip ? `<abbr class="term" title="${esc(tip)}">${label}</abbr>` : label;
  return `<div><dt>${name}</dt><dd>${value}</dd></div>`;
}

const REGIME_TEXT = {
  none: "No reactivation",
  slip: "Faults slip",
  lid: "Lid breaks",
  dynamo: "Dynamo turns on",
};

function pathwayText(core) {
  if (core.pathway === "background") {
    return "The background heat budget already passes the retention tests. No impact is required at these settings.";
  }
  if (core.pathway === "fast-stir") return "Fast pathway: impact-driven core stirring (Le Bars et al. 2011 mechanism).";
  if (core.pathway === "fast-thermal") return "Fast pathway: the thermal criterion is met during the impact window.";
  if (core.pathway === "slow") return "Slow pathway: the weak zone initiates subduction and the cold slab raises core heat flow.";
  if (core.protective) return "A pathway clears the retention tests.";
  if (core.thermalOn && core.suppressed) {
    return "The background heat flow is above the adiabat, but core-top heating suppresses it. The moment still misses the retention tests.";
  }
  if (core.momentAm2 > 0) return "A field is estimated, and it is still below the retention tests (Gunell peak, nominal standoff, or storm standoff).";
  return "Neither pathway produces a protective field at these settings.";
}

function column(title, lines) {
  return `<section class="compare-col"><h3>${title}</h3><dl class="metrics">${lines.map(([name, value]) => cell(name, value)).join("")}</dl></section>`;
}

function coreLines(core) {
  return [
    ["q_cmb", `${(core.qCmbWm2 * 1e3).toFixed(2)} mW/m²`],
    ["q_ad", `${(core.qAdWm2 * 1e3).toFixed(2)} mW/m²`],
    ["Thermal", core.thermalOn ? "above adiabat" : "below adiabat"],
    ["Moment", sci(core.momentAm2, "A m²")],
    ["vs Earth", core.momentAm2 > 0 ? `${(core.momentAm2 / 7.77e22).toFixed(2)}×` : "n/a (no field)"],
    ["Nominal standoff", km(core.retention.nominalAltitudeM, core.momentAm2)],
    ["Storm standoff", km(core.retention.stormAltitudeM, core.momentAm2)],
    ["Past Gunell peak", core.retention.pastPeak ? "yes" : "no"],
    ["Protective", core.protective ? "yes" : "no"],
  ];
}

export function renderGlobalResults(host, payload) {
  const { result, dry, wet, cores, smallest, offline, faultCount, density } = payload;
  const core = result.core;
  const zone = result.weakZone;
  const densityNote = density > 8000 || density < 5000
    ? `<p class="banner">Core density implied by M_core and the active radius is ${density.toFixed(0)} kg/m³. The sheet's ~6000 kg/m³ belongs to the 1830 km core. The baseline preset pairs 1650 km with the sheet's BML mass, 1.17×10²³ kg.</p>`
    : "";
  const offlineBlock = offline?.available
    ? `<section class="offline">
        <h3>Offline runs</h3>
        <p class="banner">${esc(offline.label || "Offline file")}${offline.example ? " This file is an example, not science." : ""}</p>
        ${offline.thresholdWarning ? `<p class="banner">The neighboring runs disagree on dynamo on/off or on the regime. Those outputs are not interpolated across the threshold.</p>` : ""}
        ${offline.extrapolated ? `<p class="meta">The current sliders sit outside the offline grid. Edge values were used.</p>` : ""}
        ${offline.values ? `<dl class="metrics">
          ${cell("Regime", offline.values.regime == null ? "threshold" : esc(offline.values.regime))}
          ${cell("Dynamo flag", offline.values.dynamo_on == null ? "threshold" : String(offline.values.dynamo_on))}
          ${cell("Onset", years(offline.values.time_to_onset_yr))}
          ${cell("Duration", years(offline.values.duration_yr))}
          ${cell("Moment", sci(offline.values.magnetic_moment_Am2, "A m²"))}
        </dl>` : `<p class="meta">${esc(offline.reason || "No interpolated value.")}</p>`}
      </section>`
    : `<p class="meta">Offline runs: none loaded. The numbers above are the browser estimate. A real VPLanet sweep can be selected below. The shipped EXAMPLE file is not science.</p>`;
  const best = smallest?.best;
  const smallestText = !smallest
    ? "The search over size, speed, angle, and a few published sites runs with the regime map."
    : smallest.background
    ? "The background budget is already protective, so there is no smallest impact. Lower q_m or raise core conductivity if you want the impact to be what turns the dynamo on."
    : best
      ? `Smallest protective case on the coarse grid: ${km(best.diameterM)} impactor at ${(best.velocityMs / 1000).toFixed(0)} km/s, angle ${best.angleDeg}°, ${esc(best.name)} (${best.lat.toFixed(1)}°, ${best.lon.toFixed(1)}°). Onset ${years(best.onsetYears)}. Duration ${years(best.durationYears)}. Moment ${sci(best.momentAm2, "A m²")}. Pathway ${esc(best.pathway)}.`
      : "No cell on the coarse grid is protective. The grid is diameter, speed, angle, and a handful of published sites. It is not a continuous optimum.";
  const zoneLabel = zone.traceLengthM > zone.lengthM * 1.05
    ? `${km(zone.lengthM)} along strike (sum of traces ${km(zone.traceLengthM)})`
    : `${km(zone.lengthM)} along strike`;
  const impactLine = payload.impactCompare
    ? `${payload.impactCompare.changed} faults change failure state because of this impact. Largest impact-only ΔCFS is ${(payload.impactCompare.maxImpactMpa).toFixed(2)} MPa against a background CFS of ${(payload.impactCompare.backgroundMpa).toFixed(2)} MPa at that fault. Without the impact the regime is ${REGIME_TEXT[payload.impactCompare.baselineRegime] || payload.impactCompare.baselineRegime}.`
    : "Impact-only comparison computes with the result.";
  host.innerHTML = `
    <div class="result-card">
    <p class="tag">Basin &amp; Global · first-order browser estimate</p>
    <h2>${REGIME_TEXT[result.regime] || result.regime}</h2>
    <p class="verdict">${pathwayText(core)}</p>
    <p class="status-line">${dynamoStatus(core)}</p>
    ${result.source.magnitude >= 11 || result.source.finalM >= 1e6 ? `<p class="banner">Beyond model validity. At 80 km the impactor is already about Mw 11–12 with a crater of order 1000 km. This case is Mw ${mw(result.source.magnitude)} and a ${km(result.source.finalM)} crater. The calculation still runs; it is not a prediction.</p>` : ""}
    <dl class="metrics">
      ${cell("Mw", mw(result.source.magnitude))}
      ${cell("Final crater", km(result.source.finalM))}
      ${cell("q_cmb", `${(core.qCmbWm2 * 1e3).toFixed(2)} mW/m²`)}
      ${cell("q_adiabatic", `${(core.qAdWm2 * 1e3).toFixed(2)} mW/m²`)}
      ${cell("Subduction index", Number.isFinite(result.subduction.index) ? result.subduction.index.toFixed(2) : "∞")}
      ${cell("Protective", core.protective ? "yes" : "no")}
      ${cell("Along-strike extent", zoneLabel)}
      ${cell("Faults moved by impact", payload.impactCompare ? String(payload.impactCompare.changed) : "—")}
    </dl>
    </div>
    <details class="result-details">
    <summary>Full numbers, pathways, and fault table</summary>
    ${core.qCmbWm2 < 0 ? `<p class="meta">q_cmb is negative. Mantle radiogenic power exceeds the heat flow at the base of the crust, so this steady budget does not cool the core. Raise q_m, lower U/Th/K, or set a negative mantle secular fraction.</p>` : ""}
    <p class="banner">Not a VPLanet run and not a spherical lithosphere model. The authoritative thermal history is the offline model. Every free number is a slider.</p>
    ${densityNote}
    <dl class="metrics">
      ${cell("Moment magnitude", `Mw ${mw(result.source.magnitude)}`)}
      ${cell("Final crater", km(result.source.finalM))}
      ${cell("Catalog faults", String(faultCount))}
      ${cell("Reactivated", `${result.reactivatedCount} (${(result.fractionFailed * 100).toFixed(1)}% of area)`)}
      ${cell("Excavated", String(result.excavatedCount))}
      ${cell("Along-strike extent", zoneLabel)}
      ${cell("Weak-zone depth", `${km(zone.depthM)} vs Te ${km(zone.elasticM)}`)}
      ${cell("Ductile continuation", zone.ductileBlockedByMoho ? "idle: Moho is above the BDT, so faults never reach it" : `${km(zone.ductileM || 0)} added`)}
      ${cell("Cuts elastic lid", zone.cutsLithosphere ? "yes" : "no")}
      ${cell("Damage", zone.damage.toFixed(2))}
      ${cell("Subduction index", Number.isFinite(result.subduction.index) ? result.subduction.index.toFixed(2) : "∞")}
      ${cell("Subduction", result.subduction.initiates ? "initiates" : "does not")}
      ${cell("q_cmb", `${(core.qCmbWm2 * 1e3).toFixed(2)} mW/m²`)}
      ${cell("q_adiabatic", `${(core.qAdWm2 * 1e3).toFixed(2)} mW/m²`)}
      ${cell("q_slab", `${(core.qSlabWm2 * 1e3).toFixed(3)} mW/m²`)}
      ${cell("Core-top heating", `${(core.qSuppressWm2 * 1e3).toFixed(3)} mW/m² for ${years(core.suppressionYears)}`)}
      ${cell("Thermal criterion", core.thermalOn ? "above adiabat" : "below adiabat")}
      ${cell("Stirring", core.stirring ? `on (ΔΩ/Ω = ${core.spinRatio.toExponential(2)})` : `off (ΔΩ/Ω = ${core.spinRatio.toExponential(2)})`)}
      ${cell("Moment", sci(core.momentAm2, "A m²"))}
      ${cell("Earth's moment", "7.77×10²² A m² (comparison)")}
      ${cell("Nominal standoff", km(core.retention.nominalAltitudeM, core.momentAm2))}
      ${cell("Storm standoff", km(core.retention.stormAltitudeM, core.momentAm2))}
      ${cell("vs Earth", core.momentAm2 > 0 ? `${(core.momentAm2 / 7.77e22).toFixed(2)}×` : "n/a (no field)")}
      ${cell("Past Gunell peak", core.retention.pastPeak ? "yes" : "no")}
      ${cell("Protective", core.protective ? "yes" : "no")}
      ${cell("Onset", years(core.onsetYears))}
      ${cell("Duration", years(core.durationYears))}
      ${cell("Viscosity at mid-BDT", viscosityText(result.viscosity.etaPaS))}
      ${cell("Impact", `${result.antipode ? "" : ""}${payload.impact.lat.toFixed(1)}°, ${payload.impact.lon.toFixed(1)}°`)}
      ${cell("Antipode", `${payload.antipode.lat.toFixed(1)}°, ${payload.antipode.lon.toFixed(1)}°`)}
    </dl>
    <p class="meta">${impactLine}</p>
    <p class="meta">Earth's moment at Mars, with these pressures, would stand off ${km(core.earth.nominalAltitudeM, core.earthMomentAm2 || 1)} nominally. Gunell's cusp peak is about 30× that moment, so an Earth-strength field does not pass the peak test. Their model also has escape falling back toward the unmagnetized rate past the peak, not to zero. Stirring moment from this impact: ${sci(core.impactStirMomentAm2 || 0, "A m²")}. Fast pathway protective only if that impact pathway itself supplies protection the background lacks: ${core.fastProtective ? "yes" : "no"}.</p>
    <h3>Smallest protective impact</h3>
    <p class="verdict">${smallestText}</p>
    <h3>Dry and wet, same impact</h3>
    <div class="compare">
      ${dry ? column("Dry", [
        ["Regime", REGIME_TEXT[dry.regime]],
        ["λ", dry.lambda.toFixed(2)],
        ["Friction factor", dry.friction.toFixed(2)],
        ["Subduction index", Number.isFinite(dry.subduction) ? dry.subduction.toFixed(2) : "∞"],
        ["Protective", dry.protective ? "yes" : "no"],
        ["Moment", sci(dry.moment, "A m²")],
        ["Viscosity", sci(dry.eta, "Pa·s")],
      ]) : ""}
      ${wet ? column("Wet", [
        ["Regime", REGIME_TEXT[wet.regime]],
        ["λ", wet.lambda.toFixed(2)],
        ["Friction factor", wet.friction.toFixed(2)],
        ["Subduction index", Number.isFinite(wet.subduction) ? wet.subduction.toFixed(2) : "∞"],
        ["Protective", wet.protective ? "yes" : "no"],
        ["Moment", sci(wet.moment, "A m²")],
        ["Viscosity", sci(wet.eta, "Pa·s")],
      ]) : ""}
    </div>
    <h3>Core presets, same fault result</h3>
    <p class="meta">These three use the current slab and stirring, and swap only the core geometry and the sheet mass that goes with each preset. The inner-core column does not invent compositional power.</p>
    <div class="compare compare-3">
      ${cores ? column("1650 km + 150 km melt", coreLines(cores.bml)) : ""}
      ${cores ? column("1830 km homogeneous", coreLines(cores.stahler)) : ""}
      ${cores ? column("613 km inner core", coreLines(cores.inner)) : ""}
    </div>
    ${offlineBlock}
    <table>
      <thead><tr><th>Fault</th><th>Type</th><th>km</th><th>CFS MPa</th><th>Impact ΔCFS</th><th>Status</th></tr></thead>
      <tbody>
        ${(result.faults || []).map((fault) => `<tr>
          <td>${esc(fault.name)}</td>
          <td>${fault.kinematics}</td>
          <td>${(fault.distanceM / 1000).toFixed(0)}</td>
          <td>${(fault.cfs / 1e6).toFixed(1)}</td>
          <td>${Number.isFinite(fault.impactDeltaCfs) ? (fault.impactDeltaCfs / 1e6).toFixed(2) : "—"}</td>
          <td>${fault.inWeakZone ? "weak zone" : fault.status}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="meta">CFS includes the background deficit, so a negative value is still stable. Impact ΔCFS is the impact's own static plus dynamic change at the depth that sets the total. The table is the eight faults closest to failure. Gold faults on the globe are the weak zone. Along-strike extent is the great-circle span of the zone, not the sum of its traces, and it is capped at one circumference.</p>
    </details>
  `;
}
