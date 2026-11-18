/**
 * Regional fault dips from data/measured_dips.json.
 * The page and the segment builder both call these functions, so the
 * selector, the slider, and the dip direction stay on the same table.
 */

import measured from "../../data/measured_dips.json" with { type: "json" };

export const DEFAULT_DIP_SOURCE = measured.default_source;
export const DIP_SOURCES = measured.sources;
export const DIP_CAVEAT = measured.caveat;
export const DIP_FIT_SUMMARY = measured.fit.summary;

const STRIKE_TOLERANCE = measured.fit.strike_tolerance_deg;
const DIP_DIRECTION_TOLERANCE = measured.fit.dip_direction_tolerance_deg;

export function undirectedDiffDeg(a, b) {
  const span = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(span, 180 - span);
}

export function directedDiffDeg(a, b) {
  const span = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(span, 360 - span);
}

function rightHandAzimuth(strikeDeg) {
  return ((strikeDeg + 90) % 360 + 360) % 360;
}

function present(entry) {
  const lowConfidence = Boolean(entry.low_confidence);
  let badge = "HiRISE";
  if (lowConfidence) badge = "low confidence";
  else if (entry.kind === "literature_fallback") badge = "literature fallback";
  else if (entry.population === "literature") badge = "literature";
  else if (entry.population === "wheeler") badge = "Wheeler";
  return {
    dipDeg: entry.dip_deg,
    min: entry.min,
    max: entry.max,
    n: entry.n,
    summary: entry.summary,
    confidence: entry.confidence,
    population: entry.population,
    measurementClass: entry.measurement_class,
    kind: entry.kind,
    lowConfidence,
    fallback: entry.kind === "literature_fallback" || entry.kind === "literature",
    badge,
    sourceFile: entry.source_file || (entry.source_files || []).join(", ") || null,
    method: entry.method || null,
  };
}

/**
 * Dip slider for one region, source, and fault type.
 * source is "wheeler", "hirise", or "literature".
 */
export function resolveDip({ regionId, source, kinematics }) {
  const selected = source || DEFAULT_DIP_SOURCE;
  const side = kinematics === "thrust" ? "thrust" : "normal";
  if (selected === "literature") return present(measured.literature[side]);
  const region = measured.regions[regionId];
  const entry = region?.kinematics?.[side]?.[selected];
  if (!entry) return present(measured.literature[side]);
  return present(entry);
}

/**
 * Dip direction for one fault segment.
 * An explicit GeoJSON azimuth wins. Literature, and any segment that is
 * not subparallel to a measured wall, keep the right-hand normal.
 */
export function resolveDipAzimuth({
  strikeDeg,
  regionId,
  source,
  kinematics,
  explicitAzimuthDeg,
}) {
  if (Number.isFinite(explicitAzimuthDeg)) {
    return { dipAzimuthDeg: explicitAzimuthDeg, source: "feature", wallId: null };
  }
  const rightHand = rightHandAzimuth(strikeDeg);
  if ((source !== "wheeler" && source !== "hirise") || !regionId) {
    return { dipAzimuthDeg: rightHand, source: "right-hand", wallId: null };
  }
  const side = kinematics === "thrust" ? "thrust" : "normal";
  let best = null;
  for (const wall of measured.azimuth_walls) {
    if (wall.region_id !== regionId || wall.kinematics !== side) continue;
    if (!Number.isFinite(wall.axial_strike_deg) || !Number.isFinite(wall.dip_direction_deg)) continue;
    const strikeDiff = undirectedDiffDeg(strikeDeg, wall.axial_strike_deg);
    if (strikeDiff > STRIKE_TOLERANCE) continue;
    const directionDiff = directedDiffDeg(rightHand, wall.dip_direction_deg);
    if (directionDiff > DIP_DIRECTION_TOLERANCE) continue;
    if (
      !best
      || directionDiff < best.directionDiff - 1e-9
      || (Math.abs(directionDiff - best.directionDiff) <= 1e-9 && wall.id < best.wall.id)
    ) {
      best = { wall, directionDiff };
    }
  }
  if (!best) return { dipAzimuthDeg: rightHand, source: "right-hand", wallId: null };
  return { dipAzimuthDeg: best.wall.dip_direction_deg, source: "measured", wallId: best.wall.id };
}
