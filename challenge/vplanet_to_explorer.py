#!/usr/bin/env python3
"""Turn a VPLanet ThermInt forward file into the explorer's offline-run JSON.

From the repository root, after `vplanet vpl.in` has written a forward file:

    python3 challenge/vplanet_to_explorer.py challenge/vplanet/template -o challenge/output/vplanet_offline_run.json

The directory must contain mars.in, case.json, and one *.forward file.
Several directories can be passed. Each directory is one grid point.
The axis values (impactor size and water) come from that directory's case.json.

What this script decides:

  magnetic_moment_Am2   largest moment during the run, in A m^2
  dynamo_on             true only if some sample passes the same protective
                        test the website uses: moment above 2.5e24 A m^2, and
                        the magnetopause clears 220 km altitude at the nominal
                        solar-wind pressure and at five times that pressure
  regime                "dynamo" when dynamo_on is true, otherwise "none".
                        ThermInt does not know about faults, so it cannot
                        report "slip" or "lid".
  time_to_onset_yr      first time the protective test passes, in years
  duration_yr           how long the samples stay past the test
  standoff_over_rp      magnetopause radius divided by the planet radius,
                        at the nominal pressure, using the peak moment

A positive VPLanet moment that is still below 2.5e24 stays dynamo_on false.
That is the Gunell gate, not a failed file.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

# ThermInt's output units in VPLanet 2.5 (src/thermint.h):
# one magnetic-moment unit is Earth's moment, 80e21 A m^2.
# The magnetopause column is in units of 9.103 Earth radii.
# This build's Earth radius is 6,378,100 m (mars radius / 0.533).
EMAGMOM_AM2 = 80e21
EARTH_RADIUS_M = 6_378_100
EMAGPAUSE_IN_EARTH_RADII = 9.103

# Same retention test as src/model/globalPhysics.js.
MU0 = 1.25663706212e-6
GUNELL_AM2 = 2.5e24
EXOBASE_M = 220_000
NOMINAL_PRESSURE_PA = 0.7e-9
STORM_PRESSURE_PA = 5 * NOMINAL_PRESSURE_PA

REQUIRED_COLUMNS = ("Time", "MagMom")


class Problem(Exception):
    pass


def read_output_order(mars_in: Path):
    for raw in mars_in.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line.startswith("saOutputOrder"):
            parts = line.split()[1:]
            return [part.lstrip("-") for part in parts if part and part != "$"]
    raise Problem(f"{mars_in} has no saOutputOrder line, so the columns in the forward file are unknown.")


def read_radius_m(mars_in: Path):
    for raw in mars_in.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line.startswith("dRadius"):
            value = float(line.split()[1])
            if value < 0:
                return abs(value) * EARTH_RADIUS_M
            # A positive radius is in the primary file's length unit.
            # These templates use AU. 1 AU = 1.495978707e11 m.
            return value * 1.495978707e11
    raise Problem(f"{mars_in} has no dRadius line.")


def read_case(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise Problem(f"{path} is not valid JSON ({exc}).") from exc
    for key in ("impactor_diameter_m", "water_fraction"):
        if key not in data or isinstance(data[key], bool) or not isinstance(data[key], (int, float)):
            raise Problem(f"{path} needs a number for {key}.")
    return data


def read_forward(path: Path, columns):
    rows = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < len(columns):
            raise Problem(
                f"{path} line {line_number} has {len(parts)} numbers, and saOutputOrder lists {len(columns)} columns."
            )
        try:
            values = [float(part) for part in parts[: len(columns)]]
        except ValueError as exc:
            raise Problem(f"{path} line {line_number} has a value that is not a number.") from exc
        rows.append(dict(zip(columns, values)))
    if not rows:
        raise Problem(f"{path} has no data rows. The integration may not have finished.")
    return rows


def magnetopause_radius_m(moment_am2, pressure_pa):
    if not (moment_am2 > 0) or not (pressure_pa > 0):
        return None
    return (MU0 * moment_am2 * moment_am2 / (8 * math.pi * math.pi * pressure_pa)) ** (1.0 / 6.0)


def protective(moment_am2, planet_radius_m):
    if not (moment_am2 > GUNELL_AM2):
        return False
    nominal = magnetopause_radius_m(moment_am2, NOMINAL_PRESSURE_PA)
    storm = magnetopause_radius_m(moment_am2, STORM_PRESSURE_PA)
    if nominal is None or storm is None:
        return False
    return (nominal - planet_radius_m) >= EXOBASE_M and (storm - planet_radius_m) >= EXOBASE_M


def summarize(rows, planet_radius_m):
    missing = [name for name in REQUIRED_COLUMNS if name not in rows[0]]
    if missing:
        raise Problem(
            "mars.in saOutputOrder is missing "
            + ", ".join(missing)
            + ". The template's line already includes -Time and -MagMom."
        )
    times_gyr = [row["Time"] for row in rows]
    moments_earth = [row["MagMom"] for row in rows]
    moments = [value * EMAGMOM_AM2 for value in moments_earth]
    flags = [protective(moment, planet_radius_m) for moment in moments]
    peak_index = max(range(len(moments)), key=lambda index: moments[index])
    peak = moments[peak_index]
    nominal = magnetopause_radius_m(peak, NOMINAL_PRESSURE_PA)
    standoff = 1.0 if nominal is None else nominal / planet_radius_m

    if any(flags):
        onset_gyr = next(time for time, flag in zip(times_gyr, flags) if flag)
        spans = []
        for index in range(len(times_gyr)):
            if index + 1 < len(times_gyr):
                spans.append(times_gyr[index + 1] - times_gyr[index])
            elif index:
                spans.append(times_gyr[index] - times_gyr[index - 1])
            else:
                spans.append(0.0)
        duration_yr = sum(span for span, flag in zip(spans, flags) if flag) * 1e9
        onset_yr = onset_gyr * 1e9
        dynamo_on = True
    else:
        onset_yr = None
        duration_yr = None
        dynamo_on = False

    positive = [time for time, moment in zip(times_gyr, moments_earth) if moment > 0]
    return {
        "dynamo_on": dynamo_on,
        "regime": "dynamo" if dynamo_on else "none",
        "time_to_onset_yr": onset_yr,
        "duration_yr": duration_yr,
        "magnetic_moment_Am2": peak,
        "standoff_over_rp": standoff,
        "vplanet_peak_moment_earth_units": moments_earth[peak_index],
        "vplanet_moment_was_positive": bool(positive),
        "vplanet_moment_positive_from_Gyr": positive[0] if positive else None,
        "vplanet_moment_positive_until_Gyr": positive[-1] if positive else None,
        "vplanet_final_time_Gyr": times_gyr[-1],
    }


def convert_directory(directory: Path):
    mars_in = directory / "mars.in"
    case_path = directory / "case.json"
    if not mars_in.is_file():
        raise Problem(f"{directory} has no mars.in.")
    if not case_path.is_file():
        raise Problem(f"{directory} has no case.json. Copy it from challenge/vplanet/template/.")
    forwards = sorted(directory.glob("*.forward"))
    if not forwards:
        raise Problem(
            f"{directory} has no .forward file. Run `vplanet vpl.in` in that directory first. "
            "You should see a line that says Simulation completed."
        )
    if len(forwards) > 1:
        names = ", ".join(path.name for path in forwards)
        raise Problem(f"{directory} has more than one .forward file ({names}). Keep the mars one and move the others aside.")
    columns = read_output_order(mars_in)
    rows = read_forward(forwards[0], columns)
    case = read_case(case_path)
    summary = summarize(rows, read_radius_m(mars_in))
    summary["impactor_diameter_m"] = case["impactor_diameter_m"]
    summary["water_fraction"] = case["water_fraction"]
    return case, summary


def build_catalog(directories):
    runs = []
    labels = []
    for directory in directories:
        case, summary = convert_directory(directory)
        runs.append(summary)
        if case.get("label"):
            labels.append(str(case["label"]))
    return {
        "schema": "mars-explorer-offline-run/v1",
        "example": False,
        "label": labels[0] if len(labels) == 1 else "VPLanet ThermInt runs converted for the explorer.",
        "source": "challenge/vplanet_to_explorer.py",
        "model_limit": (
            "Stock VPLanet ThermInt uses Earth's 3481 km core for the liquidus, the adiabat, "
            "and the magnetic moment. There is no 1650/1830/613 km input. "
            "dynamo_on uses the Gunell 2.5e24 A m^2 gate plus the nominal and storm standoff tests. "
            "A positive VPLanet moment below that gate is recorded in magnetic_moment_Am2 with dynamo_on false."
        ),
        "gunell_gate_Am2": GUNELL_AM2,
        "axes": ["impactor_diameter_m", "water_fraction"],
        "outputs": [
            "dynamo_on",
            "regime",
            "time_to_onset_yr",
            "duration_yr",
            "magnetic_moment_Am2",
            "standoff_over_rp",
        ],
        "runs": runs,
    }


def main(argv):
    parser = argparse.ArgumentParser(description="Convert VPLanet ThermInt output to the explorer schema.")
    parser.add_argument("directories", nargs="+", type=Path, help="Directory that contains mars.in, case.json, and a .forward file")
    parser.add_argument("-o", "--output", type=Path, required=True, help="Where to write the explorer JSON")
    args = parser.parse_args(argv)
    try:
        catalog = build_catalog(args.directories)
    except Problem as exc:
        print(f"Could not convert: {exc}")
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    run = catalog["runs"][0]
    print(f"Wrote {args.output} with {len(catalog['runs'])} run(s).")
    print(f"Peak moment: {run['magnetic_moment_Am2']:.6e} A m^2 ({run['vplanet_peak_moment_earth_units']:.4f} Earth units).")
    print(f"VPLanet moment was positive: {run['vplanet_moment_was_positive']}.")
    if run["vplanet_moment_was_positive"]:
        print(
            "Positive from "
            f"{run['vplanet_moment_positive_from_Gyr']:.3f} Gyr "
            f"through {run['vplanet_moment_positive_until_Gyr']:.3f} Gyr."
        )
    print(f"Passes the Gunell gate (dynamo_on): {run['dynamo_on']}.")
    print("Next: python3 challenge/validate_offline_run.py " + str(args.output))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
