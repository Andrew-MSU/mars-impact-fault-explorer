#!/usr/bin/env python3
"""Build data/measured_dips.json from Wheeler's tables.

Inputs (committed so this can be re-run; copied from
Andrew-MSU/mars-tectonic-reactivation, data/derived):

    data/source/measured/sd_measurements_qa.csv
        Wheeler Feer's nine three-point strike/dip measurements.
    data/source/measured/hirise_fisher_means.csv
        Fisher means along his polygon walls (method note section 7).
    data/source/measured/hirise_sim_fisher_means.csv
        The same fit guided by SIM 3292 traces (method note section 8).
    data/source/measured/hirise_sim_wall_pairs.csv
        Opposed graben-wall pairs. Summary statistics only; not a dip default.

Literature 60°/30° are read from data/parameters.json so the fallback in this
file cannot drift from the parameter sheet. Re-run this script after changing
those two rows.

Cerberus3 was delivered with dip exactly 90°. That is an error. The catalog
uses dip_3pt (61.3°) for Cerberus3 and for every other site.
"""

from __future__ import annotations

import csv
import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "source" / "measured"
OUT = ROOT / "data" / "measured_dips.json"
PARAMETERS = ROOT / "data" / "parameters.json"

REGION_IDS = {
    "Valles Marineris": "valles_marineris",
    "Cerberus Fossae": "cerberus_fossae",
    "Feature 11 (~88E 12N)": "isidis_planitia",
}

WHEELER_METHOD = (
    "Three-point plane on a HiRISE DTM triangle, right-hand rule. "
    "dip_deg is dip_3pt, the recomputed three-point solution, not the "
    "delivered Dip column. Measured by Wheeler Feer."
)
POLYGON_METHOD = (
    "Fisher mean of poles to 60 m robust planes, confidence classes A and B, "
    "at stations every 200 m along Wheeler's polygon walls. The wall is the "
    "steepest 40 m Horn slope facing into the polygon. Method note section 7."
)
SIM_METHOD = (
    "Same HiRISE 60 m-plane Fisher mean. Stations follow a SIM 3292 trace "
    "and the wall is the steepest 40 m slope within 2 km whose dip direction "
    "is within 45° of the trace normal. Method note section 8."
)
PAIR_METHOD = (
    "Opposed graben walls from the SIM-guided HiRISE fit: A/B walls on both "
    "sides of one graben-axis station, both dipping toward the axis. "
    "Intersection depth projects the two 60 m planes and is not a fault depth. "
    "Method note section 8."
)

CAVEAT = (
    "These dips are surface wall and scarp slopes measured on HiRISE DTMs. "
    "They are a proxy for fault dip near the surface, not a measured fault "
    "plane at depth. Degraded walls, talus, and wrinkle-ridge flank slopes "
    "can understate the true fault dip, especially at Isidis."
)

FIT_SUMMARY = (
    "A segment uses a measured dip direction when its strike is within 30° "
    "of that wall set and its right-hand normal is within 45° of the measured "
    "dip direction. Otherwise the dip direction stays the right-hand normal "
    "of the trace. The literature source does not substitute a measured direction."
)


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return round(float(text), 4)


def read_csv(name: str) -> list[dict[str, str]]:
    with (SOURCE / name).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def short_id(ref_layer: str) -> str:
    return ref_layer.split("_", 1)[0]


def load_literature() -> dict[str, dict]:
    catalog = json.loads(PARAMETERS.read_text(encoding="utf-8"))
    by_key = {item["key"]: item for item in catalog["parameters"]}
    specs = {
        "normal": ("theta_normal", "Wilkins and Schultz (2003) MOLA scarp modeling. Sheet key theta_normal."),
        "thrust": ("theta_thrust", "Schultz and Watters (2001) elastic dislocation model. Sheet key theta_thrust."),
    }
    literature = {}
    for kinematics, (key, method) in specs.items():
        item = by_key[key]
        literature[kinematics] = {
            "kind": "literature",
            "population": "literature",
            "measurement_class": "literature_default",
            "dip_deg": item["value"],
            "min": item["min"],
            "max": item["max"],
            "n": None,
            "confidence": "literature",
            "low_confidence": False,
            "parameter_key": key,
            "source_file": "data/parameters.json",
            "method": method,
            "doi": item["doi"],
            "summary": (
                f"Literature default from the parameter sheet: {item['value']:g}° "
                f"(slider {item['min']:g}–{item['max']:g}°). {item['note']}"
            ),
        }
    return literature


def wheeler_measurements() -> list[dict]:
    rows = []
    for raw in read_csv("sd_measurements_qa.csv"):
        delivered = parse_float(raw["Dip"])
        recomputed = parse_float(raw["dip_3pt"])
        site = short_id(raw["Ref_Layer"])
        correction = None
        if site == "Cerberus3":
            correction = (
                "Delivered dip is exactly 90°, which is an error. The same "
                "triplet recomputes to dip_3pt 61.3°, and a HiRISE plane through "
                "the triangle is about 61.5°. This catalog uses dip_3pt."
            )
        rows.append(
            {
                "id": site,
                "ref_layer": raw["Ref_Layer"],
                "region": raw["region"],
                "region_id": REGION_IDS[raw["region"]],
                "measurement_class": "wheeler_manual",
                "population": "wheeler",
                "lon": parse_float(raw["lon"]),
                "lat": parse_float(raw["lat"]),
                "z_m": parse_float(raw["z_m"]),
                "strike_deg": parse_float(raw["Strike"]),
                "delivered_dip_deg": delivered,
                "delivered_dip_direction_deg": parse_float(raw["Dip_Dir"]),
                "dip_deg": recomputed,
                "dip_direction_deg": parse_float(raw["dipdir_3pt"]),
                "dip_3pt_deg": recomputed,
                "dipdir_3pt_deg": parse_float(raw["dipdir_3pt"]),
                "triangle_side_min_m": parse_float(raw["tri_side_min_m"]),
                "triangle_side_max_m": parse_float(raw["tri_side_max_m"]),
                "triangle_relief_m": parse_float(raw["tri_relief_m"]),
                "qa_flags": raw.get("qa_flags") or "",
                "correction": correction,
                "source_file": "sd_measurements_qa.csv",
                "method": WHEELER_METHOD,
                "n": 1,
            }
        )
    return rows


def fisher_rows() -> list[dict]:
    specs = (
        ("hirise_fisher_means.csv", "polygon_walls", POLYGON_METHOD, False),
        ("hirise_sim_fisher_means.csv", "sim_traces", SIM_METHOD, True),
    )
    rows = []
    for filename, guide, method, has_structure in specs:
        for raw in read_csv(filename):
            region_name = raw["region"]
            structure = raw["structure"] if has_structure else None
            group = raw["group"] if not has_structure else raw["wall"]
            dip = parse_float(raw["mean_dip"])
            dipdir = parse_float(raw["mean_dipdir"])
            n = int(raw["n"]) if raw.get("n") else 0
            rows.append(
                {
                    "region": region_name,
                    "region_id": REGION_IDS[region_name],
                    "guide": guide,
                    "structure": structure,
                    "group": group,
                    "measurement_class": "hirise_programmatic",
                    "population": "hirise",
                    "axial_strike_deg": parse_float(raw["axial_mean_strike"]),
                    "n": n,
                    "dip_direction_deg": dipdir,
                    "dip_deg": dip,
                    "strike_rhr_deg": parse_float(raw["mean_strike_rhr"]),
                    "kappa": parse_float(raw["kappa"]),
                    "alpha95_deg": parse_float(raw["alpha95"]),
                    "median_dip40_deg": parse_float(raw["median_dip40"]),
                    "median_plane60_dip_deg": parse_float(raw.get("median_plane60_dip") or ""),
                    "median_offset_m": parse_float(raw.get("median_offset_m") or ""),
                    "source_file": filename,
                    "method": method,
                    "usable": bool(n and dip is not None and dipdir is not None and not group.startswith("all") and group != "class A only"),
                }
            )
    return rows


def find_fisher(rows: list[dict], region_id: str, guide: str, group: str, structure: str | None = None) -> dict:
    for row in rows:
        if row["region_id"] != region_id or row["guide"] != guide or row["group"] != group:
            continue
        if structure is not None and row["structure"] != structure:
            continue
        if not row["usable"]:
            continue
        return row
    raise KeyError((region_id, guide, structure, group))


def orientation_label(dipdir: float, dip: float) -> str:
    return f"{int(round(dipdir)) % 360:03.0f}/{dip:.0f}"


def wall_phrase(row: dict) -> str:
    label = orientation_label(row["dip_direction_deg"], row["dip_deg"])
    bits = [f"n={row['n']}"]
    if row["kappa"] is not None:
        bits.append(f"κ={row['kappa']:.2f}")
    if row["alpha95_deg"] is not None:
        bits.append(f"α95={row['alpha95_deg']:.2f}°")
    return f"{label} ({', '.join(bits)})"


def floor2(value: float) -> float:
    return math.floor(value * 100 + 1e-9) / 100


def ceil2(value: float) -> float:
    return math.ceil(value * 100 - 1e-9) / 100


def measurement_entry(sites: list[dict], summary: str) -> dict:
    dips = [site["dip_deg"] for site in sites]
    mean = statistics.fmean(dips)
    return {
        "kind": "measurements",
        "population": "wheeler",
        "measurement_class": "wheeler_manual",
        "dip_deg": round(mean, 2),
        "min": min(dips),
        "max": max(dips),
        "n": len(dips),
        "stdev_deg": round(statistics.stdev(dips), 2) if len(dips) > 1 else 0,
        "range_rule": "measured_min_max",
        "confidence": "wheeler_three_point",
        "low_confidence": False,
        "measurement_ids": [site["id"] for site in sites],
        "source_file": "sd_measurements_qa.csv",
        "method": WHEELER_METHOD,
        "summary": summary,
    }


def fisher_entry(walls: list[dict], summary: str, low_confidence: bool, confidence_note: str | None = None) -> dict:
    weight = sum(wall["n"] for wall in walls)
    mean = sum(wall["dip_deg"] * wall["n"] for wall in walls) / weight
    low = min(wall["dip_deg"] - wall["alpha95_deg"] for wall in walls)
    high = max(wall["dip_deg"] + wall["alpha95_deg"] for wall in walls)
    value = round(mean, 2)
    return {
        "kind": "fisher",
        "population": "hirise",
        "measurement_class": "hirise_programmatic",
        "dip_deg": value,
        "min": min(floor2(low), value),
        "max": max(ceil2(high), value),
        "n": weight,
        "range_rule": "mean_plus_minus_alpha95",
        "confidence": "hirise_fisher",
        "low_confidence": low_confidence,
        "confidence_note": confidence_note,
        "walls": [wall_phrase(wall) for wall in walls],
        "wall_ids": [wall["id"] for wall in walls],
        "source_files": sorted({wall["source_file"] for wall in walls}),
        "method": walls[0]["method"],
        "summary": summary,
    }


def fallback_entry(literature: dict, reason: str) -> dict:
    return {
        **literature,
        "kind": "literature_fallback",
        "fallback": True,
        "summary": f"{reason} {literature['summary']}",
    }


def azimuth_wall(row: dict, kinematics: str, wall_id: str) -> dict:
    row["id"] = wall_id
    row["azimuth_id"] = wall_id
    row["kinematics"] = kinematics
    row["label"] = wall_phrase(row)
    return row


def wall_pair_summary() -> dict:
    grouped: dict[str, list[dict]] = {"cerberus_fossae": [], "valles_marineris": []}
    rows = []
    for raw in read_csv("hirise_sim_wall_pairs.csv"):
        lat = parse_float(raw["station_lat"])
        region_id = "cerberus_fossae" if lat is not None and lat >= 0 else "valles_marineris"
        record = {
            "region_id": region_id,
            "measurement_class": "hirise_programmatic",
            "product_id": raw["product_id"],
            "station_lon": parse_float(raw["station_lon"]),
            "station_lat": lat,
            "dip_left_deg": parse_float(raw["plane60_dip_left"]),
            "dip_right_deg": parse_float(raw["plane60_dip_right"]),
            "wall_separation_m": parse_float(raw["wall_separation_m"]),
            "wall_intersection_depth_m": parse_float(raw["wall_intersection_depth_m"]),
            "source_file": "hirise_sim_wall_pairs.csv",
            "method": PAIR_METHOD,
        }
        rows.append(record)
        grouped[region_id].append(record)

    def median(values: list[float]) -> float:
        return round(statistics.median(values), 2)

    summary = {}
    for region_id, pairs in grouped.items():
        summary[region_id] = {
            "n": len(pairs),
            "median_dip_left_deg": median([pair["dip_left_deg"] for pair in pairs]),
            "median_dip_right_deg": median([pair["dip_right_deg"] for pair in pairs]),
            "median_wall_separation_m": median([pair["wall_separation_m"] for pair in pairs]),
            "median_intersection_depth_m": median([pair["wall_intersection_depth_m"] for pair in pairs]),
            "source_file": "hirise_sim_wall_pairs.csv",
            "method": PAIR_METHOD,
            "note": (
                "Supporting geometry for the opposed walls. Not used as a dip default. "
                "Latitude separates the rows: Cerberus stations are north of the equator "
                "and the Valles Marineris stations in this file are south of it."
            ),
        }
    return {"rows": rows, "by_region": summary}


def one_decimal(value: float) -> str:
    return f"{value:.1f}"


def build_catalog() -> dict:
    literature = load_literature()
    measurements = wheeler_measurements()
    fisher = fisher_rows()
    by_region: dict[str, list[dict]] = {}
    for site in measurements:
        by_region.setdefault(site["region_id"], []).append(site)

    vm = by_region["valles_marineris"]
    cf = by_region["cerberus_fossae"]
    vm_phrase = ", ".join(f"{site['id']} {one_decimal(site['dip_deg'])}°" for site in vm)
    cf_phrase = ", ".join(
        (
            f"{site['id']} {one_decimal(site['dip_deg'])}° (recomputed; delivered as 90°)"
            if site["id"] == "Cerberus3"
            else f"{site['id']} {one_decimal(site['dip_deg'])}°"
        )
        for site in cf
    )

    polygon_vm = [
        find_fisher(fisher, "valles_marineris", "polygon_walls", "dipping toward 209"),
        find_fisher(fisher, "valles_marineris", "polygon_walls", "dipping toward 29"),
    ]
    polygon_cf = [
        find_fisher(fisher, "cerberus_fossae", "polygon_walls", "dipping toward 200"),
        find_fisher(fisher, "cerberus_fossae", "polygon_walls", "dipping toward 20"),
    ]
    sim_vm_graben = [
        find_fisher(fisher, "valles_marineris", "sim_traces", "dipping toward 196", "Graben axis"),
        find_fisher(fisher, "valles_marineris", "sim_traces", "dipping toward 16", "Graben axis"),
    ]
    sim_vm_contact = [
        find_fisher(fisher, "valles_marineris", "sim_traces", "dipping toward 204", "Contact (Certain)"),
        find_fisher(fisher, "valles_marineris", "sim_traces", "dipping toward 24", "Contact (Certain)"),
    ]
    sim_cf_graben = [
        find_fisher(fisher, "cerberus_fossae", "sim_traces", "dipping toward 201", "Graben axis"),
        find_fisher(fisher, "cerberus_fossae", "sim_traces", "dipping toward 21", "Graben axis"),
    ]
    ridge = find_fisher(
        fisher, "isidis_planitia", "sim_traces", "dipping toward 332", "Wrinkle ridge"
    )

    walls = [
        azimuth_wall(polygon_vm[0], "normal", "vm-polygon-232"),
        azimuth_wall(polygon_vm[1], "normal", "vm-polygon-336"),
        azimuth_wall(sim_vm_contact[0], "normal", "vm-contact-205"),
        azimuth_wall(sim_vm_contact[1], "normal", "vm-contact-020"),
        azimuth_wall(sim_vm_graben[0], "normal", "vm-graben-194"),
        azimuth_wall(sim_vm_graben[1], "normal", "vm-graben-016"),
        azimuth_wall(polygon_cf[0], "normal", "cerberus-polygon-195"),
        azimuth_wall(polygon_cf[1], "normal", "cerberus-polygon-021"),
        azimuth_wall(sim_cf_graben[0], "normal", "cerberus-graben-198"),
        azimuth_wall(sim_cf_graben[1], "normal", "cerberus-graben-022"),
        azimuth_wall(ridge, "thrust", "isidis-wrinkle-327"),
    ]
    for row in fisher:
        row.setdefault("azimuth_id", None)

    vm_normal = measurement_entry(
        vm,
        (
            f"Mean of Wheeler Feer's four Valles Marineris three-point dips "
            f"({vm_phrase}): {round(statistics.fmean(site['dip_deg'] for site in vm), 2):.2f}°. "
            "The slider spans the measured minimum to maximum."
        ),
    )
    cf_normal = measurement_entry(
        cf,
        (
            f"Mean of Wheeler Feer's five Cerberus Fossae three-point dips "
            f"({cf_phrase}): {round(statistics.fmean(site['dip_deg'] for site in cf), 2):.2f}°. "
            "Cerberus3 was delivered as 90°; that is an error, so the mean uses "
            "dip_3pt (61.3°). The slider spans the measured minimum to maximum."
        ),
    )
    vm_hirise = fisher_entry(
        polygon_vm,
        (
            "HiRISE programmatic alternative for Valles Marineris normal faults: "
            "the n-weighted mean of the opposed outline-wall Fisher means, "
            f"{wall_phrase(polygon_vm[0])} and {wall_phrase(polygon_vm[1])}. "
            "The slider spans each mean ± its α95. These are generalized outline "
            "slopes and are gentler than Wheeler's mid-wall sites. "
            f"SIM contact walls {wall_phrase(sim_vm_contact[0])} and {wall_phrase(sim_vm_contact[1])}, "
            f"and SIM graben-axis walls {wall_phrase(sim_vm_graben[0])} and {wall_phrase(sim_vm_graben[1])}, "
            "are kept for dip direction when a segment is parallel to them."
        ),
        low_confidence=False,
    )
    cf_hirise = fisher_entry(
        polygon_cf,
        (
            "HiRISE programmatic alternative for Cerberus Fossae: the n-weighted "
            "mean of the opposed polygon-wall Fisher means, "
            f"{wall_phrase(polygon_cf[0])} and {wall_phrase(polygon_cf[1])}. "
            "The slider spans each mean ± its α95. The four HiRISE DTMs behind "
            "these walls all lie near 157–163°E. "
            f"SIM graben-axis walls {wall_phrase(sim_cf_graben[0])} and {wall_phrase(sim_cf_graben[1])} "
            "are about 4° gentler because the wider corridor also picks lower walls, "
            "so they set dip direction when they fit and do not set this slider."
        ),
        low_confidence=False,
    )
    isidis_thrust = fisher_entry(
        [ridge],
        (
            "No manual three-point measurements at Isidis. The dip is the Feature 11 "
            f"wrinkle-ridge Fisher mean {wall_phrase(ridge)}. "
            "Low confidence: five flank slopes on one ridge. A wrinkle-ridge flank "
            "understates the fault dip. The slider is that mean ± α95."
        ),
        low_confidence=True,
        confidence_note=(
            "Feature 11 is Wheeler's Isidis-area polygon. The polygon-wall fit there "
            "is three class-B points and is not used. The opposite wrinkle-ridge flank "
            "has n=2 and no Fisher mean."
        ),
    )
    # Same number when "Wheeler measured" is selected: it is adopted because
    # Wheeler has no Isidis measurement, and it stays flagged as a HiRISE fit.
    isidis_adopted = {
        **isidis_thrust,
        "adopted_because": (
            "Wheeler measured no three-point dips at Isidis, so the Wheeler "
            "source uses the Feature 11 wrinkle-ridge Fisher mean and keeps "
            "the low-confidence flag."
        ),
    }

    no_thrust = (
        "No thrust-dip measurement in this region. Wrinkle ridges here keep the "
        "literature thrust dip. The Feature 11 wrinkle-ridge mean belongs to Isidis, not this region."
    )
    no_normal = (
        "No normal-fault dip measurement at Isidis. Feature 11 contact slopes are "
        "unit-boundary topography and are not used as a normal-fault dip."
    )

    regions = {
        "valles_marineris": {
            "name": "Valles Marineris",
            "kinematics": {
                "normal": {"wheeler": vm_normal, "hirise": vm_hirise},
                "thrust": {
                    "wheeler": fallback_entry(literature["thrust"], no_thrust),
                    "hirise": fallback_entry(literature["thrust"], no_thrust),
                },
            },
        },
        "cerberus_fossae": {
            "name": "Cerberus Fossae",
            "kinematics": {
                "normal": {"wheeler": cf_normal, "hirise": cf_hirise},
                "thrust": {
                    "wheeler": fallback_entry(literature["thrust"], no_thrust),
                    "hirise": fallback_entry(literature["thrust"], no_thrust),
                },
            },
        },
        "isidis_planitia": {
            "name": "Isidis Planitia",
            "kinematics": {
                "normal": {
                    "wheeler": fallback_entry(literature["normal"], no_normal),
                    "hirise": fallback_entry(literature["normal"], no_normal),
                },
                "thrust": {"wheeler": isidis_adopted, "hirise": isidis_thrust},
            },
        },
    }

    return {
        "description": (
            "Fault dips measured by Wheeler Feer on HiRISE DTMs, plus programmatic "
            "HiRISE Fisher means. The explorer defaults to the Wheeler means where "
            "he measured them. Generated by scripts/convert_measured_dips.py."
        ),
        "upstream": (
            "Tables copied from Andrew-MSU/mars-tectonic-reactivation (private "
            "research repository), data/derived and the programmatic strike/dip "
            "note, sections 4, 7, and 8. They are committed in this public "
            "repository so the explorer's defaults can be regenerated."
        ),
        "caveat": CAVEAT,
        "default_source": "wheeler",
        "sources": [
            {
                "id": "wheeler",
                "label": "Wheeler measured (default)",
                "description": "Means of Wheeler Feer's three-point HiRISE dips, by region.",
            },
            {
                "id": "hirise",
                "label": "HiRISE programmatic",
                "description": "Fisher means of HiRISE wall planes along his polygons or SIM 3292 traces.",
            },
            {
                "id": "literature",
                "label": "Literature default",
                "description": "Parameter-sheet dips: 60° normal, 30° thrust.",
            },
        ],
        "fit": {
            "strike_tolerance_deg": 30,
            "dip_direction_tolerance_deg": 45,
            "summary": FIT_SUMMARY,
            "rule": (
                "Undirected strike difference to the wall set's axial mean strike "
                "must be within strike_tolerance_deg, and the directed difference "
                "between the segment's right-hand normal (strike + 90°) and the "
                "wall's dip direction must be within dip_direction_tolerance_deg. "
                "The 45° facing limit is the same cut the HiRISE wall detector used. "
                "Among walls that fit, the dip direction closest to the right-hand "
                "normal wins, so a trace is not flipped onto the opposite wall. "
                "The dip angle stays the regional slider. Individual three-point "
                "dips are not copied onto a SIM 3292 trace: the Valles Marineris "
                "sites sit tens to hundreds of kilometres off the nearest SIM "
                "tectonic line, and one wall triangle should not set a regional fault."
            ),
        },
        "literature": literature,
        "measurements": measurements,
        "fisher_means": fisher,
        "azimuth_walls": [
            {
                "id": wall["id"],
                "region_id": wall["region_id"],
                "kinematics": wall["kinematics"],
                "guide": wall["guide"],
                "structure": wall["structure"],
                "group": wall["group"],
                "measurement_class": "hirise_programmatic",
                "population": "hirise",
                "axial_strike_deg": wall["axial_strike_deg"],
                "dip_direction_deg": wall["dip_direction_deg"],
                "dip_deg": wall["dip_deg"],
                "n": wall["n"],
                "kappa": wall["kappa"],
                "alpha95_deg": wall["alpha95_deg"],
                "source_file": wall["source_file"],
                "method": wall["method"],
                "label": wall["label"],
            }
            for wall in walls
        ],
        "wall_pairs": wall_pair_summary(),
        "regions": regions,
    }


def main() -> None:
    payload = build_catalog()
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    for region_id, region in payload["regions"].items():
        for kinematics, sources in region["kinematics"].items():
            for source, entry in sources.items():
                print(
                    f"  {region_id:20} {kinematics:7} {source:11} "
                    f"{entry['dip_deg']:6.2f}°  [{entry['min']:.2f}, {entry['max']:.2f}]  "
                    f"n={entry['n']}  {entry['kind']}"
                )


if __name__ == "__main__":
    main()
