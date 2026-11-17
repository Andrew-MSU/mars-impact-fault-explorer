#!/usr/bin/env python3
"""Convert the Mars parameter spreadsheet into JSON the app and tests read.

Source workbook (committed so this can be re-run):

    data/source/Mars_Parameter_Spreadsheet.xlsx

Sheets:
    Modeling_Parameters  -> data/parameters.json
    Literature_References -> data/references.json

Range strings in the sheet are inconsistent (parenthetical asides, ± bands,
two-variable cells, an open "273+" bound). Parsing rules and every hand fix
are written into parameters.json under "range_fix_log" and onto each parameter
as "parse_note".
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = ROOT / "data" / "source" / "Mars_Parameter_Spreadsheet.xlsx"
PARAMETERS_OUT = ROOT / "data" / "parameters.json"
REFERENCES_OUT = ROOT / "data" / "references.json"

NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"

# Keys that the first-order fault model actually reads. Everything else is
# kept so it can be edited, exported, and handed to VPLanet later.
USED_BY_MODEL = {
    "E_intact",
    "E_rm",
    "nu",
    "C_0_intact",
    "C_0_rm",
    "phi",
    "Q_crust_dry",
    "n_dry",
    "A_dry",
    "Q_crust_wet",
    "n_wet",
    "A_wet",
    "Q_andesite",
    "eta_0",
    "T_s_present",
    "T_s_early",
    "q_m_present",
    "q_m_early",
    "H_present",
    "H_early",
    "theta_normal",
    "theta_thrust",
    "Z_BDT_present",
    "Z_BDT_early",
    "d_crust_global",
    "d_crust_VM",
    "d_crust_CF",
    "d_crust_Isidis",
    "rho_crust",
}

CATEGORY = {
    "E_intact": "Rheology",
    "E_rm": "Rheology",
    "nu": "Rheology",
    "C_0_intact": "Rheology",
    "C_0_rm": "Rheology",
    "phi": "Rheology",
    "Q_crust_dry": "Creep",
    "n_dry": "Creep",
    "A_dry": "Creep",
    "Q_crust_wet": "Creep",
    "n_wet": "Creep",
    "A_wet": "Creep",
    "Q_andesite": "Creep",
    "eta_0": "Creep",
    "T_s_present": "Thermal",
    "T_s_early": "Thermal",
    "q_m_present": "Thermal",
    "q_m_early": "Thermal",
    "H_present": "Thermal",
    "H_early": "Thermal",
    "theta_normal": "Fault geometry",
    "theta_thrust": "Fault geometry",
    "Z_BDT_present": "Crustal structure",
    "Z_BDT_early": "Crustal structure",
    "d_crust_global": "Crustal structure",
    "d_crust_VM": "Crustal structure",
    "d_crust_CF": "Crustal structure",
    "d_crust_Isidis": "Crustal structure",
    "rho_crust": "Crustal structure",
}

# The combined creep rows share one units cell ("Dim., MPa^-n s^-1").
# Split that into the quantity each key actually carries.
UNIT_OVERRIDE = {
    "n_dry": "dimensionless",
    "n_wet": "dimensionless",
    "A_dry": "MPa^-n s^-1",
    "A_wet": "MPa^-n s^-1",
}

# Multiply the tabulated number to get SI for the forward model.
# The UI keeps the spreadsheet units; scenario.js applies to_si.
TO_SI = {
    "GPa": 1e9,
    "MPa": 1e6,
    "kJ/mol": 1e3,
    "mW/m^2": 1e-3,
    "km": 1e3,
}


def strip_parens(text: str) -> str:
    return re.sub(r"\([^)]*\)", " ", text)


def parse_scalar(text: str) -> float:
    match = re.fullmatch(rf"\s*({NUMBER})\s*", text.strip())
    if not match:
        raise ValueError(f"not a single number: {text!r}")
    return float(match.group(1))


def parse_value_list(text: str) -> list[float]:
    values = [float(item) for item in re.findall(NUMBER, text)]
    if not values:
        raise ValueError(f"no numeric value in {text!r}")
    return values


def parse_simple_range(text: str) -> tuple[float, float, str | None]:
    """Parse one min-max string. Returns (min, max, note).

    note is set only when a hand fix closes an open bound.
    """
    raw = text.strip()
    plus_minus = re.fullmatch(
        rf"\s*({NUMBER})\s*±\s*({NUMBER})\s*(?:\([^)]*\))?\s*[-–]\s*({NUMBER})\s*(?:\([^)]*\))?\s*",
        raw,
    )
    if plus_minus:
        center = float(plus_minus.group(1))
        delta = float(plus_minus.group(2))
        other = float(plus_minus.group(3))
        low = center - delta
        high = max(center + delta, other)
        note = (
            "Hand fix: the cell mixes a ± band on the first estimate with a second "
            f"cited estimate ({other:g}). The slider spans min(center−Δ, second) to "
            "max(center+Δ, second)."
        )
        return low, high, note

    cleaned = strip_parens(raw)
    note = None
    if re.search(r"273\s*\+", cleaned):
        cleaned = re.sub(r"273\s*\+", "300", cleaned)
        note = (
            "Hand fix: the sheet writes the warm/wet end as '273+' (above the "
            "freezing point of pure water) with no upper number. The slider max "
            "is closed at 300 K."
        )
    match = re.fullmatch(
        rf"\s*({NUMBER})\s*\+?\s*[-–]\s*({NUMBER})\s*\+?\s*",
        cleaned,
    )
    if not match:
        raise ValueError(f"could not parse range {text!r} (cleaned {cleaned!r})")
    low = float(match.group(1))
    high = float(match.group(2))
    if high < low:
        low, high = high, low
        note = ((note + " ") if note else "") + "Hand fix: swapped reversed bounds."
    return low, high, note


def parse_compound_range(text: str) -> dict[str, tuple[float, float]]:
    """Parse 'n: 4.1-5.3; A: 4.0-12.0' or 'n: ±0.2' into symbol -> (min, max).

    A bare ± is returned as a one-sided delta under key 'symbol±' by storing
    the delta as (nan handling): we return ('n', None) via a sentinel.
    """
    found: dict[str, tuple[float, float] | float] = {}
    for symbol, low, high in re.findall(
        rf"([A-Za-z]+)\s*:\s*({NUMBER})\s*[-–]\s*({NUMBER})",
        text,
    ):
        found[symbol.lower()] = (float(low), float(high))
    for symbol, delta in re.findall(rf"([A-Za-z]+)\s*:\s*±\s*({NUMBER})", text):
        key = symbol.lower()
        if key not in found:
            found[key] = float(delta)  # type: ignore[assignment]
    return found  # type: ignore[return-value]


def split_parameter_row(row: dict) -> list[dict]:
    """Split a two-variable spreadsheet row into separate slider records."""
    keys = [part.strip() for part in row["key"].split(",")]
    names = split_names(row["name"], len(keys))
    values = parse_value_list(str(row["value"]))
    if len(keys) == 1:
        low, high, note = parse_simple_range(str(row["range"]))
        return [
            {
                **row,
                "name": names[0],
                "value": values[0],
                "min": low,
                "max": high,
                "parse_note": note,
            }
        ]
    if len(values) != len(keys):
        raise ValueError(f"{row['key']}: {len(values)} values for {keys}")
    compound = parse_compound_range(str(row["range"]))
    records = []
    for key, name, value in zip(keys, names, values):
        symbol = key.split("_")[0].lower()
        spec = compound.get(symbol)
        note = None
        if isinstance(spec, tuple):
            low, high = spec
        elif isinstance(spec, float):
            low, high = value - spec, value + spec
            note = (
                f"Range taken from '{symbol}: ±{spec:g}' in the Uncertainty/Range cell."
            )
        else:
            # The wet-diabase row quotes n only. A has no published window in the sheet.
            low, high = value / 3.0, value * 3.0
            note = (
                "Hand fix: the Uncertainty/Range cell constrains n only "
                f"('{row['range']}'). No range is given for {key}. The slider uses "
                "a factor-of-three window around the tabulated value so the "
                "prefactor can be varied. Replace it when a cited uncertainty is adopted."
            )
        if high < low:
            low, high = high, low
        records.append(
            {
                **row,
                "key": key,
                "name": name,
                "value": value,
                "min": low,
                "max": high,
                "parse_note": note,
            }
        )
    return records


def split_names(name: str, count: int) -> list[str]:
    if count == 1:
        return [name]
    # "Creep Stress Exponent & Pre-Exponential Factor (Dry Diabase)"
    match = re.match(r"^(.*)\(([^)]+)\)\s*$", name)
    tail = f" ({match.group(2)})" if match else ""
    if "Exponent" in name and "Pre-Exponential" in name:
        return [
            f"Creep stress exponent n{tail}",
            f"Creep pre-exponential factor A{tail}",
        ]
    return [f"{name} [{i + 1}]" for i in range(count)]


def load_rows(xlsx: Path) -> tuple[list[dict], list[dict]]:
    import openpyxl

    workbook = openpyxl.load_workbook(xlsx, data_only=True)
    sheet = workbook["Modeling_Parameters"]
    parameters = []
    header = [cell.value for cell in next(sheet.iter_rows(max_row=1))]
    expected = [
        "Parameter_Name",
        "Variable_Key",
        "Value",
        "Uncertainty/Range",
        "Units",
        "Material_Type or Region",
        "Method",
        "Source_DOI",
        "Short_Note",
    ]
    if header != expected:
        raise SystemExit(f"Unexpected header: {header}")
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not row or row[1] is None:
            continue
        base = {
            "name": str(row[0]).strip(),
            "key": str(row[1]).strip(),
            "value": row[2],
            "range": str(row[3]).strip(),
            "units": str(row[4]).strip(),
            "material": str(row[5]).strip() if row[5] else "",
            "method": str(row[6]).strip() if row[6] else "",
            "doi": str(row[7]).strip() if row[7] else "",
            "note": str(row[8]).strip() if row[8] else "",
        }
        parameters.extend(split_parameter_row(base))

    references = []
    ref_sheet = workbook["Literature_References"]
    for row in ref_sheet.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        references.append(
            {
                "citation": str(row[0]).strip(),
                "title": str(row[1]).strip(),
                "journal": str(row[2]).strip(),
                "year": int(row[3]) if row[3] is not None else None,
                "doi": str(row[4]).strip(),
                "url": str(row[5]).strip(),
            }
        )
    return parameters, references


def finalize(record: dict) -> dict:
    units = UNIT_OVERRIDE.get(record["key"], record["units"])
    parse_note = record.get("parse_note")
    if record["key"] in UNIT_OVERRIDE and record["units"] != units:
        extra = (
            f"Hand fix: the spreadsheet units cell {record['units']!r} covered both "
            f"symbols in this row. {record['key']} is shown in {units}."
        )
        parse_note = f"{parse_note} {extra}" if parse_note else extra
    return {
        "key": record["key"],
        "name": record["name"],
        "value": record["value"],
        "min": record["min"],
        "max": record["max"],
        "units": units,
        "to_si": TO_SI.get(units, 1.0),
        "material": record["material"],
        "method": record["method"],
        "doi": record["doi"],
        "note": record["note"],
        "category": CATEGORY.get(record["key"], "VPLanet / interior"),
        "used_by_model": record["key"] in USED_BY_MODEL,
        "range_raw": record["range"],
        "parse_note": parse_note,
    }


def build(xlsx: Path) -> tuple[dict, list[dict]]:
    rows, references = load_rows(xlsx)
    parameters = [finalize(row) for row in rows]
    keys = [item["key"] for item in parameters]
    if len(keys) != len(set(keys)):
        raise SystemExit(f"Duplicate keys: {keys}")
    for item in parameters:
        if not (item["min"] <= item["value"] <= item["max"]):
            raise SystemExit(
                f"{item['key']} value {item['value']} outside [{item['min']}, {item['max']}]"
            )
        if item["min"] == item["max"]:
            raise SystemExit(f"{item['key']} has a zero-width range")
    fix_log = [
        {
            "key": item["key"],
            "range_raw": item["range_raw"],
            "min": item["min"],
            "max": item["max"],
            "parse_note": item["parse_note"],
        }
        for item in parameters
        if item["parse_note"]
    ]
    payload = {
        "title": "Mars fault-reactivation parameters",
        "description": (
            "Converted from Modeling_Parameters in "
            "data/source/Mars_Parameter_Spreadsheet.xlsx. "
            "Values are the spreadsheet Value column. min/max come from "
            "Uncertainty/Range, with the hand fixes listed in range_fix_log."
        ),
        "source_workbook": "data/source/Mars_Parameter_Spreadsheet.xlsx",
        "parameters": parameters,
        "range_fix_log": fix_log,
    }
    return payload, references


def main(argv: list[str]) -> None:
    xlsx = Path(argv[1]) if len(argv) > 1 else DEFAULT_XLSX
    payload, references = build(xlsx)
    PARAMETERS_OUT.parent.mkdir(parents=True, exist_ok=True)
    PARAMETERS_OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    REFERENCES_OUT.write_text(
        json.dumps(
            {
                "description": (
                    "Citations from the Literature_References sheet of the "
                    "parameter workbook."
                ),
                "references": references,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(payload['parameters'])} parameters "
        f"({len(payload['range_fix_log'])} with parse notes) -> {PARAMETERS_OUT}"
    )
    print(f"Wrote {len(references)} references -> {REFERENCES_OUT}")


if __name__ == "__main__":
    main(sys.argv)
