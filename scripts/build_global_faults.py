#!/usr/bin/env python3
"""Build a planet-wide SIM 3292 fault file for the Basin & Global mode.

The regional GeoJSON files stay as they are. This script asks the USGS
Astrogeology pygeoapi for the same structure layer, keeps tectonic graben
axes, pit-crater chains, and wrinkle ridges, and writes a simplified
FeatureCollection to public/faults/sim3292_global.geojson.

Lines shorter than MIN_LENGTH_KM are dropped so the browser can score the
whole catalog. That cut is a dataset choice, recorded in MODEL.md.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from prepare_geodata import (  # noqa: E402
    classify,
    douglas_peucker,
    fetch_structures,
    haversine_km,
)

OUT = ROOT / "public" / "faults" / "sim3292_global.geojson"
MIN_LENGTH_KM = 50.0
TOLERANCE_M = 20_000.0
LON_STEP = 60.0
LAT_STEP = 45.0


def norm_lon(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def fetch_tile(west: float, south: float, east: float, north: float) -> list[dict]:
    last = None
    for attempt in range(4):
        try:
            return fetch_structures(west, south, east, north)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(2.0 * (attempt + 1))
    raise SystemExit(f"tile {west},{south},{east},{north} failed: {last}")


def simplify_line(line: list) -> list[list[float]] | None:
    coords = [[norm_lon(float(p[0])), float(p[1])] for p in line if len(p) >= 2]
    # Drop segments that jump the antimeridian after wrapping; they are not
    # one fault trace.
    cleaned = [coords[0]] if coords else []
    for point in coords[1:]:
        if abs(point[0] - cleaned[-1][0]) > 180:
            break
        cleaned.append(point)
    if len(cleaned) < 2:
        return None
    simplified = douglas_peucker(cleaned, TOLERANCE_M)
    dedup = [[round(simplified[0][0], 3), round(simplified[0][1], 3)]]
    for lon, lat in simplified[1:]:
        point = [round(lon, 3), round(lat, 3)]
        if point != dedup[-1]:
            dedup.append(point)
    if len(dedup) < 2:
        return None
    return dedup


def main() -> None:
    features = []
    seen = set()
    counts = {"normal": 0, "thrust": 0, "raw": 0}
    tiles = []
    lon = -180.0
    while lon < 180.0:
        lat = -90.0
        while lat < 90.0:
            tiles.append((lon, lat, min(180.0, lon + LON_STEP), min(90.0, lat + LAT_STEP)))
            lat += LAT_STEP
        lon += LON_STEP

    for index, (west, south, east, north) in enumerate(tiles, start=1):
        raw = fetch_tile(west, south, east, north)
        counts["raw"] += len(raw)
        print(f"tile {index}/{len(tiles)} {west},{south},{east},{north}: {len(raw)} features", flush=True)
        for feature in raw:
            geometry = feature.get("geometry") or {}
            if geometry.get("type") != "MultiLineString":
                continue
            props = feature.get("properties") or {}
            object_id = props.get("objectid")
            for part_index, line in enumerate(geometry.get("coordinates") or []):
                if len(line) < 2:
                    continue
                key = (object_id, part_index)
                if key in seen:
                    continue
                centroid_lon = norm_lon(sum(p[0] for p in line) / len(line))
                centroid_lat = sum(p[1] for p in line) / len(line)
                kind = classify(props, (centroid_lon, centroid_lat))
                if kind is None:
                    continue
                simplified = simplify_line(line)
                if simplified is None:
                    continue
                length = 0.0
                for a, b in zip(simplified, simplified[1:]):
                    length += haversine_km(a[0], a[1], b[0], b[1])
                if length < MIN_LENGTH_KM:
                    continue
                seen.add(key)
                kinematics, prefix, basis = kind
                counts[kinematics] += 1
                serial = counts[kinematics]
                features.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "id": f"sim-{kinematics[:1]}{serial:04d}",
                            "name": f"{prefix} {serial}",
                            "kinematics": kinematics,
                            "dip_deg": None,
                            "dip_azimuth_deg": None,
                            "length_km": round(length, 1),
                            "source": "USGS SIM 3292",
                            "source_doi": "10.3133/sim3292",
                            "objectid": object_id,
                            "interpretation": props.get("interpreta"),
                            "origin": props.get("origin"),
                            "kinematics_basis": basis,
                        },
                        "geometry": {"type": "LineString", "coordinates": simplified},
                    }
                )

    features.sort(key=lambda item: -item["properties"]["length_km"])
    collection = {
        "type": "FeatureCollection",
        "name": "Mars tectonic structures, simplified from USGS SIM 3292",
        "source": "USGS Scientific Investigations Map 3292 structure layer (Tanaka et al., 2014)",
        "source_doi": "10.3133/sim3292",
        "filter": (
            f"Tectonic graben axes, pit-crater chains, and wrinkle ridges at least "
            f"{MIN_LENGTH_KM:.0f} km long after {TOLERANCE_M / 1000:.0f} km simplification. "
            "Other SIM 3292 lines (erosional scarps, rilles, contacts) are not included. "
            "Dip is not in SIM 3292; the explorer uses the sheet dip sliders unless dip_deg is set."
        ),
        "feature_count": len(features),
        "counts": {"normal": counts["normal"], "thrust": counts["thrust"]},
        "features": features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    print(
        f"wrote {OUT} features={len(features)} "
        f"normal={counts['normal']} thrust={counts['thrust']} raw={counts['raw']} "
        f"bytes={OUT.stat().st_size}"
    )


if __name__ == "__main__":
    main()
