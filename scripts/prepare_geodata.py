#!/usr/bin/env python3
"""Build regional MOLA heightmaps and SIM 3292 fault GeoJSON.

Topography
    MGS MOLA MEGDR median topography, 32 pixels per degree.
    Product MEGT90N000FB (PDS Geosciences Node), signed 16-bit big-endian,
    5760 rows x 11520 columns, meters relative to the GMM3 areoid.
    https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg032/megt90n000fb.img

    The global grid is not committed (126 MB). This script clips and
    area-averages it into the small int16 tiles under public/terrain/.

Faults
    USGS SIM 3292 structure layer (Tanaka et al., 2014, doi:10.3133/sim3292),
    read from the USGS Astrogeology pygeoapi collection
    mars/global_geologic_map/structure and filtered to tectonic lines.
    Graben axes and pit-crater chains are tagged normal; wrinkle ridges are
    tagged thrust. One Isidis scarp that coincides with Amenthes Rupes is
    tagged thrust and labeled as provisional (SIM 3292 codes it as erosional).

    Drop-in replacement: overwrite public/faults/<region>.geojson with a
    FeatureCollection of LineStrings. properties.kinematics should be
    "normal" or "thrust". Optional numeric properties: dip_deg,
    dip_azimuth_deg (clockwise from north, direction of dip).
"""

from __future__ import annotations

import hashlib
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
TERRAIN_DIR = PUBLIC / "terrain"
FAULT_DIR = PUBLIC / "faults"
REGION_PATH = ROOT / "data" / "regions.json"
SOURCE_PATH = ROOT / "data" / "geodata_sources.json"

MOLA_URL = (
    "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/"
    "mgsl_300x/meg032/megt90n000fb.img"
)
MOLA_PPD = 32
MOLA_ROWS = 180 * MOLA_PPD
MOLA_COLS = 360 * MOLA_PPD
STRUCTURE_URL = (
    "https://astrogeology.usgs.gov/pygeoapi/collections/"
    "mars/global_geologic_map/structure/items"
)
USER_AGENT = "mars-impact-fault-explorer/0.1 (research; MSU geology)"
MARS_R = 3_396_190.0

REGIONS = [
    {
        "id": "valles_marineris",
        "name": "Valles Marineris",
        "west": -108.0,
        "east": -42.0,
        "south": -18.0,
        "north": 2.0,
        "regime_default": "normal",
        "crust_key": "d_crust_VM",
        "impact": [-70.2, -9.2],
        "max_cols": 700,
        "summary": (
            "Equatorial canyon system on the east flank of Tharsis. "
            "Extensional troughs and grabens; the spreadsheet normal-fault dip applies."
        ),
    },
    {
        "id": "cerberus_fossae",
        "name": "Cerberus Fossae",
        "west": 153.0,
        "east": 176.0,
        "south": 4.0,
        "north": 13.5,
        "regime_default": "normal",
        "crust_key": "d_crust_CF",
        "impact": [166.2, 9.2],
        "max_cols": 736,
        "summary": (
            "Young graben system in Elysium Planitia, southeast of Elysium Mons. "
            "The long fossae are the normal-fault targets."
        ),
    },
    {
        "id": "isidis_planitia",
        "name": "Isidis Planitia",
        "west": 78.0,
        "east": 116.0,
        "south": -2.0,
        "north": 22.0,
        "regime_default": "thrust",
        "crust_key": "d_crust_Isidis",
        "impact": [93.5, 12.5],
        "max_cols": 560,
        "summary": (
            "Noachian impact basin with a thin crust. Wrinkle ridges and the "
            "Amenthes Rupes scarp are treated as thrusts (spreadsheet dip 30°)."
        ),
    },
]


def load_mola(path: Path) -> bytes:
    data = path.read_bytes()
    expected = MOLA_ROWS * MOLA_COLS * 2
    if len(data) != expected:
        raise SystemExit(f"{path} is {len(data)} bytes, expected {expected}")
    return data


def elev_nearest(data: bytes, lat: float, lon: float) -> int:
    lon_e = lon % 360.0
    i = int(round((90.0 - lat) * MOLA_PPD - 0.5))
    j = int(round(lon_e * MOLA_PPD - 0.5))
    i = max(0, min(MOLA_ROWS - 1, i))
    j = max(0, min(MOLA_COLS - 1, j))
    offset = (i * MOLA_COLS + j) * 2
    return int.from_bytes(data[offset : offset + 2], "big", signed=True)


def sanity_check_mola(data: bytes) -> None:
    olympus = elev_nearest(data, 18.6, 226.0)
    hellas = elev_nearest(data, -42.4, 70.0)
    print(f"MOLA check: Olympus Mons ~ {olympus} m, Hellas ~ {hellas} m")
    if olympus < 14000:
        raise SystemExit(f"Olympus Mons elevation {olympus} m is too low; grid orientation is wrong")
    if hellas > -5000:
        raise SystemExit(f"Hellas elevation {hellas} m is too high; grid orientation is wrong")


def resample(data: bytes, region: dict) -> tuple[list[int], int, int, int, int]:
    west, east = region["west"], region["east"]
    south, north = region["south"], region["north"]
    span_lon = east - west
    span_lat = north - south
    cols = region["max_cols"]
    rows = max(40, int(round(cols * span_lat / span_lon)))
    heights = [0] * (cols * rows)
    elev_min = 10**9
    elev_max = -10**9
    for iy in range(rows):
        lat0 = north - span_lat * iy / rows
        lat1 = north - span_lat * (iy + 1) / rows
        i0 = int(math.floor((90.0 - lat0) * MOLA_PPD))
        i1 = int(math.ceil((90.0 - lat1) * MOLA_PPD))
        i0 = max(0, min(MOLA_ROWS - 1, i0))
        i1 = max(i0 + 1, min(MOLA_ROWS, i1))
        for ix in range(cols):
            lon0 = west + span_lon * ix / cols
            lon1 = west + span_lon * (ix + 1) / cols
            j0 = int(math.floor((lon0 % 360.0) * MOLA_PPD))
            j1 = int(math.ceil((lon1 % 360.0) * MOLA_PPD))
            # Regions used here do not cross the antimeridian.
            j0 = max(0, min(MOLA_COLS - 1, j0))
            j1 = max(j0 + 1, min(MOLA_COLS, j1))
            total = 0
            count = 0
            for i in range(i0, i1):
                base = i * MOLA_COLS
                for j in range(j0, j1):
                    offset = (base + j) * 2
                    total += int.from_bytes(data[offset : offset + 2], "big", signed=True)
                    count += 1
            value = int(round(total / count)) if count else 0
            heights[iy * cols + ix] = value
            elev_min = min(elev_min, value)
            elev_max = max(elev_max, value)
    return heights, cols, rows, elev_min, elev_max


def write_terrain(region: dict, heights: list[int], cols: int, rows: int, elev_min: int, elev_max: int) -> dict:
    TERRAIN_DIR.mkdir(parents=True, exist_ok=True)
    raw = b"".join(int(v).to_bytes(2, "little", signed=True) for v in heights)
    bin_name = f"{region['id']}.bin"
    (TERRAIN_DIR / bin_name).write_bytes(raw)
    meta = {
        "file": f"terrain/{bin_name}",
        "width": cols,
        "height": rows,
        "west": region["west"],
        "east": region["east"],
        "south": region["south"],
        "north": region["north"],
        "elev_min_m": elev_min,
        "elev_max_m": elev_max,
        "encoding": "int16 little-endian meters, row-major, north to south, west to east",
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    (TERRAIN_DIR / f"{region['id']}.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(
        f"terrain {region['id']}: {cols}x{rows}  "
        f"elev {elev_min} to {elev_max} m  ({len(raw)/1024:.0f} KB)"
    )
    return meta


def fetch_structures(west: float, south: float, east: float, north: float) -> list[dict]:
    features: list[dict] = []
    offset = 0
    limit = 500
    while True:
        query = urllib.parse.urlencode(
            {
                "f": "json",
                "bbox": f"{west},{south},{east},{north}",
                "limit": limit,
                "offset": offset,
            }
        )
        request = urllib.request.Request(
            STRUCTURE_URL + "?" + query,
            headers={"User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.load(response)
        batch = payload.get("features", [])
        features.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
        if offset > 20000:
            break
    return features


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * MARS_R * math.asin(min(1.0, math.sqrt(a))) / 1000.0


def line_length_km(coords: list[list[float]]) -> float:
    total = 0.0
    for (lon0, lat0), (lon1, lat1) in zip(coords, coords[1:]):
        total += haversine_km(lon0, lat0, lon1, lat1)
    return total


def perp_dist(point, start, end) -> float:
    # Equirectangular meters, good enough for Douglas-Peucker tolerances of ~0.05°.
    lat0 = math.radians(start[1])
    def xy(lon, lat):
        x = math.radians(lon) * MARS_R * math.cos(lat0)
        y = math.radians(lat) * MARS_R
        return x, y
    x, y = xy(*point)
    x0, y0 = xy(*start)
    x1, y1 = xy(*end)
    dx, dy = x1 - x0, y1 - y0
    if dx * dx + dy * dy == 0:
        return math.hypot(x - x0, y - y0)
    t = ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x0 + t * dx), y - (y0 + t * dy))


def douglas_peucker(coords: list[list[float]], tolerance_m: float) -> list[list[float]]:
    if len(coords) < 3:
        return coords
    end = len(coords) - 1
    worst_i = 1
    worst_d = -1.0
    for i in range(1, end):
        dist = perp_dist(coords[i], coords[0], coords[end])
        if dist > worst_d:
            worst_d = dist
            worst_i = i
    if worst_d > tolerance_m:
        left = douglas_peucker(coords[: worst_i + 1], tolerance_m)
        right = douglas_peucker(coords[worst_i:], tolerance_m)
        return left[:-1] + right
    return [coords[0], coords[end]]


def clip_segment(p0, p1, west, south, east, north):
    """Liang-Barsky clip of one segment to a lon/lat rectangle."""
    x0, y0 = p0
    x1, y1 = p1
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    checks = (
        (-dx, x0 - west),
        (dx, east - x0),
        (-dy, y0 - south),
        (dy, north - y0),
    )
    for p, q in checks:
        if abs(p) < 1e-15:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return None
            t0 = max(t0, r)
        else:
            if r < t0:
                return None
            t1 = min(t1, r)
    if t0 > t1:
        return None
    return (
        [x0 + t0 * dx, y0 + t0 * dy],
        [x0 + t1 * dx, y0 + t1 * dy],
    )


def clip_line(coords, west, south, east, north) -> list[list[list[float]]]:
    parts: list[list[list[float]]] = []
    current: list[list[float]] = []
    for p0, p1 in zip(coords, coords[1:]):
        clipped = clip_segment(p0, p1, west, south, east, north)
        if clipped is None:
            if len(current) >= 2:
                parts.append(current)
            current = []
            continue
        a, b = clipped
        if not current:
            current = [a, b]
        else:
            if abs(current[-1][0] - a[0]) > 1e-9 or abs(current[-1][1] - a[1]) > 1e-9:
                parts.append(current)
                current = [a, b]
            else:
                current.append(b)
    if len(current) >= 2:
        parts.append(current)
    return parts


def classify(props: dict, centroid: tuple[float, float]) -> tuple[str, str, str] | None:
    """Return (kinematics, name_prefix, basis) or None to drop the feature."""
    origin = (props.get("origin") or "").strip()
    interpretation = (props.get("interpreta") or "").strip()
    morphology = (props.get("morphology") or "").strip()
    if origin == "Tectonic" and interpretation in ("Graben axis", "Pit crater chain"):
        return (
            "normal",
            interpretation,
            "SIM 3292 tectonic graben / pit chain, assigned Andersonian normal slip. "
            "Dip comes from the theta_normal slider unless dip_deg is set.",
        )
    if origin == "Tectonic" and interpretation == "Wrinkle ridge":
        return (
            "thrust",
            "Wrinkle ridge",
            "SIM 3292 wrinkle ridge, assigned thrust slip (compressional ridge). "
            "Dip comes from the theta_thrust slider unless dip_deg is set.",
        )
    lon, lat = centroid
    if (
        morphology == "Ridge"
        and interpretation == "Scarp"
        and 108.0 <= lon <= 116.5
        and 0.0 <= lat <= 5.0
    ):
        return (
            "thrust",
            "Amenthes Rupes (candidate)",
            "Provisional. SIM 3292 codes this line as an erosional scarp, not a fault. "
            "It lies on the southern Isidis rim where Amenthes Rupes was modeled as a "
            "thrust by Schultz & Watters (2001, doi:10.1029/2000JE001369). "
            "Replace with Wheeler's fault layer when that GIS is ready.",
        )
    return None


def round_coord(value: float) -> float:
    return round(value, 4)


def build_faults(region: dict) -> dict:
    raw = fetch_structures(
        region["west"] - 0.4,
        region["south"] - 0.4,
        region["east"] + 0.4,
        region["north"] + 0.4,
    )
    features = []
    counts = {"normal": 0, "thrust": 0}
    for feature in raw:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "MultiLineString":
            continue
        props = feature.get("properties") or {}
        for line in geometry.get("coordinates") or []:
            if len(line) < 2:
                continue
            centroid_lon = sum(p[0] for p in line) / len(line)
            centroid_lat = sum(p[1] for p in line) / len(line)
            kind = classify(props, (centroid_lon, centroid_lat))
            if kind is None:
                continue
            kinematics, prefix, basis = kind
            for part in clip_line(line, region["west"], region["south"], region["east"], region["north"]):
                simplified = douglas_peucker(part, 2500.0)
                simplified = [[round_coord(p[0]), round_coord(p[1])] for p in simplified]
                # Drop consecutive duplicates left by rounding.
                dedup = [simplified[0]]
                for point in simplified[1:]:
                    if point != dedup[-1]:
                        dedup.append(point)
                if len(dedup) < 2:
                    continue
                length = line_length_km(dedup)
                if length < 25.0:
                    continue
                counts[kinematics] += 1
                index = counts[kinematics]
                name = prefix if prefix.startswith("Amenthes") else f"{prefix} {index}"
                features.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "id": f"{region['id']}-{kinematics[:1]}{index:03d}",
                            "name": name,
                            "kinematics": kinematics,
                            "dip_deg": None,
                            "dip_azimuth_deg": None,
                            "length_km": round(length, 1),
                            "source": "USGS SIM 3292",
                            "source_doi": "10.3133/sim3292",
                            "morphology": props.get("morphology"),
                            "interpretation": props.get("interpreta"),
                            "origin": props.get("origin"),
                            "kinematics_basis": basis,
                        },
                        "geometry": {"type": "LineString", "coordinates": dedup},
                    }
                )
    features.sort(key=lambda item: -item["properties"]["length_km"])
    collection = {
        "type": "FeatureCollection",
        "name": f"{region['name']} representative faults",
        "source": "USGS Scientific Investigations Map 3292 structure layer (Tanaka et al., 2014)",
        "source_doi": "10.3133/sim3292",
        "source_api": STRUCTURE_URL,
        "schema_note": (
            "Drop-in replacement for this file. Keep a GeoJSON FeatureCollection of "
            "LineStrings in degrees (longitude, latitude; west negative). "
            "properties.kinematics must be 'normal' or 'thrust'. "
            "Optional dip_deg overrides the spreadsheet dip slider. "
            "Optional dip_azimuth_deg (clockwise from north) overrides the default, "
            "which is the right-hand normal of each digitized segment. "
            "SIM 3292 stores graben axes and ridge crests, not dipping planes, so "
            "the default dip azimuth is only a placeholder."
        ),
        "features": features,
    }
    print(
        f"faults {region['id']}: {len(features)} features "
        f"({counts['normal']} normal, {counts['thrust']} thrust)"
    )
    return collection


def main() -> None:
    import os

    img_path = Path(os.environ.get("MOLA_IMG", "/tmp/megt90n000fb.img"))
    if not img_path.exists():
        print(f"Downloading {MOLA_URL}")
        urllib.request.urlretrieve(MOLA_URL, img_path)
    data = load_mola(img_path)
    sanity_check_mola(data)
    source_sha = hashlib.sha256(data).hexdigest()

    FAULT_DIR.mkdir(parents=True, exist_ok=True)
    regions_out = []
    for region in REGIONS:
        heights, cols, rows, elev_min, elev_max = resample(data, region)
        terrain = write_terrain(region, heights, cols, rows, elev_min, elev_max)
        faults = build_faults(region)
        fault_name = f"{region['id']}.geojson"
        (FAULT_DIR / fault_name).write_text(json.dumps(faults), encoding="utf-8")
        regions_out.append(
            {
                "id": region["id"],
                "name": region["name"],
                "summary": region["summary"],
                "west": region["west"],
                "east": region["east"],
                "south": region["south"],
                "north": region["north"],
                "regime_default": region["regime_default"],
                "crust_key": region["crust_key"],
                "default_impact": {"lon": region["impact"][0], "lat": region["impact"][1]},
                "terrain": terrain,
                "faults": f"faults/{fault_name}",
            }
        )

    REGION_PATH.write_text(json.dumps({"regions": regions_out}, indent=2) + "\n", encoding="utf-8")
    SOURCE_PATH.write_text(
        json.dumps(
            {
                "topography": {
                    "product": "MGS MOLA MEGDR MEGT90N000FB",
                    "resolution": "32 pixels per degree",
                    "encoding": "MSB int16 meters, 5760 x 11520, areoid-relative topography",
                    "url": MOLA_URL,
                    "sha256": source_sha,
                    "citation": (
                        "Smith, D.E., et al., Mars Orbiter Laser Altimeter (MOLA) "
                        "Mission Experiment Gridded Data Records, NASA Planetary Data System. "
                        "Instrument summary: Smith et al. (2001), J. Geophys. Res. 106, "
                        "23689–23722, doi:10.1029/2000JE001364."
                    ),
                    "tiles": "public/terrain/*.bin are area-averaged clips of this grid. Real MOLA, not synthetic.",
                },
                "faults": {
                    "product": "USGS SIM 3292 Global Geologic Map of Mars, structure layer",
                    "doi": "10.3133/sim3292",
                    "citation": (
                        "Tanaka, K.L., Skinner, J.A., Jr., Dohm, J.M., Irwin, R.P., III, "
                        "Kolb, E.J., Fortezzo, C.M., Platz, T., Michael, G.G., and Hare, T.M., "
                        "2014, Geologic map of Mars: U.S. Geological Survey Scientific "
                        "Investigations Map 3292, doi:10.3133/sim3292."
                    ),
                    "api": STRUCTURE_URL,
                    "notes": (
                        "Lines are real SIM 3292 structures, simplified and clipped. "
                        "They are graben axes and wrinkle-ridge crests, not surveyed fault planes. "
                        "Dip azimuth defaults to the right-hand normal of the digitized trace. "
                        "Kinematics are assigned as documented in each feature's kinematics_basis."
                    ),
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {REGION_PATH}")


if __name__ == "__main__":
    main()
