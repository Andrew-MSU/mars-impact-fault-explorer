#!/usr/bin/env python3
"""Check that a JSON file is one the Mars Impact Fault Explorer can load.

Usage, from the repository root:

    python3 challenge/validate_offline_run.py challenge/output/baseline_offline_run.json

Windows, if python3 is not the command that works:

    py -3 challenge/validate_offline_run.py challenge/output/baseline_offline_run.json

Exit 0 means the file is ready. Exit 1 means it is not, and the message says why.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCHEMA = "mars-explorer-offline-run/v1"
REQUIRED_AXES = ("impactor_diameter_m", "water_fraction")
REQUIRED_OUTPUTS = (
    "dynamo_on",
    "regime",
    "time_to_onset_yr",
    "duration_yr",
    "magnetic_moment_Am2",
    "standoff_over_rp",
)
REGIMES = {"none", "slip", "lid", "dynamo"}


class Problem(Exception):
    pass


def reject_constant(token):
    raise Problem(
        f"The file contains {token}. The website cannot read NaN or Infinity. Use null for a missing time."
    )


def load(path: Path):
    if not path.is_file():
        raise Problem(f"No file at {path}. Check the path, and run the simulation first.")
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        raise Problem(f"{path} is empty.")
    try:
        data = json.loads(text, parse_constant=reject_constant)
    except Problem:
        raise
    except json.JSONDecodeError as exc:
        raise Problem(f"{path} is not valid JSON ({exc}). A trailing comma is a common cause.") from exc
    if not isinstance(data, dict):
        raise Problem("The top level must be a JSON object, the kind that starts with {.")
    return data


def require(condition, message):
    if not condition:
        raise Problem(message)


def number_or_none(value, label):
    if value is None:
        return None
    require(isinstance(value, (int, float)) and not isinstance(value, bool), f"{label} must be a number or null.")
    require(value == value and value not in (float("inf"), float("-inf")), f"{label} must be a finite number or null.")
    return float(value)


def check(data):
    require(data.get("schema") == SCHEMA, f'schema must be exactly "{SCHEMA}".')
    require(data.get("example") is False, "example must be false. true marks a fake grid, and the website will say so.")
    label = data.get("label")
    require(isinstance(label, str) and label.strip(), "label must be a short sentence saying what this run is.")

    axes = data.get("axes")
    require(isinstance(axes, list) and axes, "axes must be a non-empty list.")
    require(all(isinstance(name, str) and name for name in axes), "every axis name must be a string.")
    require(len(set(axes)) == len(axes), "an axis name is repeated.")
    for name in REQUIRED_AXES:
        require(name in axes, f"axes must include {name}. The website looks the run up by impactor size and water.")

    outputs = data.get("outputs")
    require(isinstance(outputs, list) and outputs, "outputs must list the fields the website will read.")
    for name in REQUIRED_OUTPUTS:
        require(name in outputs, f"outputs must include {name}.")

    runs = data.get("runs")
    require(isinstance(runs, list) and runs, "runs must be a non-empty list. Each item is one simulation.")

    seen = {}
    edges = {name: set() for name in axes}
    for index, run in enumerate(runs):
        where = f"runs[{index}]"
        require(isinstance(run, dict), f"{where} must be an object.")
        for name in axes:
            require(name in run, f"{where} is missing the axis {name}.")
            value = number_or_none(run[name], f"{where}.{name}")
            require(value is not None, f"{where}.{name} must be a number.")
            edges[name].add(value)
        key = tuple(run[name] for name in axes)
        require(key not in seen, f"{where} repeats another run with the same axis values {key}.")
        seen[key] = index

        flag = run.get("dynamo_on")
        require(isinstance(flag, bool), f"{where}.dynamo_on must be true or false, not a number.")
        regime = run.get("regime")
        require(regime in REGIMES, f"{where}.regime must be one of none, slip, lid, dynamo.")
        require(
            flag == (regime == "dynamo"),
            f"{where}: dynamo_on is {flag} but regime is {regime}. They have to agree. "
            "dynamo_on means the field passed the Gunell gate and the standoff tests.",
        )

        onset = number_or_none(run.get("time_to_onset_yr"), f"{where}.time_to_onset_yr")
        duration = number_or_none(run.get("duration_yr"), f"{where}.duration_yr")
        if flag:
            require(onset is not None and onset >= 0, f"{where}.time_to_onset_yr must be a number of years when dynamo_on is true.")
            require(duration is None or duration >= 0, f"{where}.duration_yr must be years, or null if the model does not give an end time.")
        else:
            require(onset is None, f"{where}.time_to_onset_yr must be null when dynamo_on is false.")
            require(duration is None, f"{where}.duration_yr must be null when dynamo_on is false.")

        moment = number_or_none(run.get("magnetic_moment_Am2"), f"{where}.magnetic_moment_Am2")
        require(moment is not None and moment >= 0, f"{where}.magnetic_moment_Am2 must be a number of A m^2, zero or positive.")
        standoff = number_or_none(run.get("standoff_over_rp"), f"{where}.standoff_over_rp")
        require(standoff is not None and standoff > 0, f"{where}.standoff_over_rp must be a positive number. Use 1 when there is no field.")

        for name in outputs:
            require(name in run, f"{where} is missing output {name}, which is listed in outputs.")

    # Every combination of the axis values has to exist, or the website
    # reports a hole and refuses to interpolate.
    missing = []

    def walk(prefix):
        depth = len(prefix)
        if depth == len(axes):
            key = tuple(prefix)
            if key not in seen:
                missing.append(key)
            return
        for value in sorted(edges[axes[depth]]):
            walk(prefix + [value])

    walk([])
    if missing:
        shown = ", ".join(str(item) for item in missing[:4])
        raise Problem(
            "The grid has a hole. Every combination of the axis values needs a run. "
            f"Missing {len(missing)} combination(s), including {shown}."
        )
    return len(runs)


def main(argv):
    if len(argv) != 2 or argv[1] in {"-h", "--help"}:
        print(__doc__.strip())
        return 0 if len(argv) == 2 else 1
    path = Path(argv[1])
    try:
        count = check(load(path))
    except Problem as exc:
        print(f"Not valid: {exc}")
        print("The website will not treat this file as a finished run until the line above is fixed.")
        return 1
    print(f"Valid. {path} has {count} run(s) in the explorer schema.")
    print("The website can load this file. Copy it to data/offline_runs/ and restart the dev server when you want to see it on the page.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
