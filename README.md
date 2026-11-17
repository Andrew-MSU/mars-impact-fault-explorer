# Mars Impact Fault Explorer

A one-page, browser-only sandbox for Wheeler Feer. It asks whether an impact
can reactivate mapped faults at **Valles Marineris**, **Cerberus Fossae**, and
**Isidis Planitia**, and at what impactor size or repeat interval that starts.

Andrew Laskowski (Montana State University) is the PI. The longer project is
VPLanet coupled to a local finite-element fault model. This app is the
interactive front end and the first-order model those codes can replace.
The equations, the efficiency assumption, and the things the model does not
do are in [MODEL.md](MODEL.md).

After this pull request is merged, and after GitHub Pages is set to deploy
from GitHub Actions, the app is served from this repository's Pages site:

`https://andrew-msu.github.io/mars-impact-fault-explorer/`

## Using the app

The page is one screen.

- **Region** switches the MOLA terrain, the fault set, the crustal thickness,
  and the default stress regime (normal at Valles Marineris and Cerberus
  Fossae, thrust at Isidis).
- **Present day / Early Mars** switches the active \(T_s\), \(q_m\), \(H\),
  and brittle-ductile transition, selects dry or wet diabase creep, and sets
  the pore-pressure ratio to 0 or 0.4. Those four thermal quantities are the
  pairs in the parameter sheet. Both columns stay on the panel.
- **Click the terrain** to place the impact. Drag to orbit, scroll to zoom.
  The yellow ring is the final crater. Fault planes are colored stable,
  near failure, reactivated, or inside the excavation cavity. The south wall
  is a cutaway: crust above the Moho, mantle below, with the BDT marked.
  Vertical exaggeration is display-only.
- **Sliders** are grouped. Every sheet parameter shows its tabulated default,
  the parsed range, the units, and the source DOI. Reset on a row restores
  the sheet value. Parameters under "VPLanet / interior" are stored and
  exported; the fault calculation does not read them.
- The **results** panel is the verdict: magnitude, crater size, the fraction
  of regime-matching fault area within 250 km that fails, and the same
  fraction from the static load alone. The table lists the faults closest
  to failure.
- **Plots.** CFS against depth on the closest regime fault. Fraction of
  nearby fault area against impactor diameter, with the onset marked.
  A repeated-impact series at the chosen interval, with Maxwell relaxation.
- **Copy link** puts the current scenario in the query string. **Export JSON**
  and **Export CSV** download the inputs and the results. **Reset** returns
  the sheet defaults.

A 1 km stony impactor at 10 km/s (Mw about 7.3 with the default efficiency)
does not reactivate faults at the default sites. The sweep is where the
threshold shows up. With the default criticality (0.85) and efficiency
(\(10^{-4}\)), nearby failure begins at roughly a 7–20 km impactor,
Mw about 9–10, and it is still a small fraction of the fault area. That is
a result of this model, not a target it was tuned to hit. Raising criticality
toward 1, or the seismic efficiency, moves the onset to smaller impacts.

## Running it locally

Node 22 is what CI uses. Any current Node 20+ should be fine.

```bash
npm ci
npm test
python3 test/test_parameters.py
npm run dev
```

`npm run dev` serves the app with Vite. `npm run build` writes a static
site to `dist/`. `npm run preview` serves that build. There is no server
at runtime: the published site is the `dist/` directory.

## Data

### Parameter sheet

`data/source/Mars_Parameter_Spreadsheet.xlsx` is the literature-review
workbook (sheets `Modeling_Parameters` and `Literature_References`).

```bash
python3 -m pip install openpyxl
python3 scripts/convert_parameters.py
```

That rewrites `data/parameters.json` and `data/references.json`. The script
parses the messy `Uncertainty/Range` strings. Hand fixes, all recorded on
the parameter as `parse_note` and in `range_fix_log`:

- Early-Mars surface temperature is written `273+`. The slider max is closed at 300 K.
- Wet-diabase \(A\) has no range in the sheet (only \(n: \pm 0.2\)). The slider is a factor of three around \(6.12\times 10^{-2}\).
- U, Th, and K bulk-silicate rows mix a ± band with a second cited estimate. The slider spans the envelope of both.
- The combined creep rows share one units cell. \(n\) is shown as dimensionless and \(A\) as MPa\(^{-n}\) s\(^{-1}\).

Do not edit the JSON by hand if you can edit the workbook and re-run the
script. If you do edit the JSON, keep `min <= value <= max`, a DOI, and units.

### Terrain

Real MOLA topography, not a synthetic stand-in.

- Product: MGS MOLA MEGDR `MEGT90N000FB`, 32 pixels per degree, areoid-relative
  median topography, NASA PDS Geosciences Node.
- URL recorded in `data/geodata_sources.json`, with the sha256 of the grid
  this repository was built from.
- `scripts/prepare_geodata.py` downloads the 126 MB grid (or reads `MOLA_IMG`),
  checks that Olympus Mons is high and Hellas is deep, and writes area-averaged
  int16 tiles to `public/terrain/<region>.bin`. The global grid is not committed.

The 32 pixel/degree grid is the global product that still fits a laptop
checkout. 128 pixel/degree is a better target for Cerberus Fossae, where the
graben is only a few kilometers wide; swap the tiles when that is worth the
download. The JSON next to each `.bin` file records the bbox, size, and encoding.

### Faults

Real USGS SIM 3292 structure lines (Tanaka et al. 2014, doi:10.3133/sim3292),
clipped to each region and simplified. Graben axes and pit-crater chains are
tagged normal. Wrinkle ridges are tagged thrust. One Isidis scarp that sits
on Amenthes Rupes is tagged thrust and labeled provisional: SIM 3292 calls it
an erosional scarp, and the thrust interpretation is Schultz & Watters (2001).

These are ridge crests and graben axes, not dipping planes. Dip comes from
the sheet sliders (60° normal, 30° thrust). Dip azimuth defaults to the
right-hand normal of the digitized line.

To replace them with your own GIS layer, overwrite:

```
public/faults/valles_marineris.geojson
public/faults/cerberus_fossae.geojson
public/faults/isidis_planitia.geojson
```

Keep a GeoJSON `FeatureCollection` of `LineString`s in degrees
`(longitude, latitude)`, west negative. Required property: `kinematics`
of `normal` or `thrust`. Optional: `dip_deg`, `dip_azimuth_deg` (clockwise
from north, the direction of dip), `name`, `id`. The same note is in each
file as `schema_note`. Rebuild or refresh after replacing a file; Pages
picks up the change on the next deploy.

`scripts/prepare_geodata.py` can rebuild both the tiles and the fault files.
It needs network access to the PDS host and to the USGS Astrogeology
pygeoapi collection `mars/global_geologic_map/structure`.

## Tests

```bash
npm test
python3 test/test_parameters.py
```

The physics tests check that magnitude grows with energy, diameter, velocity,
and seismic efficiency; that the crater diameter matches the Collins–Holsapple
expression; that extension raises ΔCFS on a normal fault and lowers it on a
thrust (and the reverse for compression); that a critically stressed optimal
fault sits on the failure envelope; and that repeated impacts accumulate and
then relax. The Python tests check the range parser and the committed catalog.

## GitHub Pages

`.github/workflows/pages.yml` runs the tests, builds `dist/`, and uploads it
as an artifact on every pull request. On a push to `main` it also deploys
with `actions/deploy-pages`.

The repository setting **Settings → Pages → Build and deployment → Source**
must be **GitHub Actions**. The workflow cannot flip that switch. Until it
is set, the deploy job has nothing to publish to, and the build artifact is
still the preview.

## Layout, if you are changing the model

| Path | What it is |
| --- | --- |
| `src/model/physics.js` | Pure functions. No DOM. Safe to unit test. |
| `src/model/scenario.js` | Fault sampling, one impact, the diameter sweep, the time series. |
| `src/main.js` | Page, sliders, URL, export. |
| `src/scene.js` | three.js terrain, fault planes, cutaway. |
| `src/plots.js` | Canvas figures. |
| `data/` | Sheet JSON, region metadata, geodata provenance. |
| `public/terrain`, `public/faults` | Static tiles. Vite copies them into `dist/`. |

A FEM stress field can replace `runImpact` without touching the page, as long
as it returns the same per-segment `display.profile` (`z`, `cfs`, `status`)
and the same summary fields (`source`, `fractionLocal`, `faults`). A VPLanet
run can replace the active \(T(z)\) and the viscosity by writing a new
`temperatureK` and `effectiveViscosityPaS`, or by feeding their output in as
the epoch preset.

## Next modeling phase

1. **Wheeler's GIS fault layer**, with a real dip and dip azimuth per fault,
   dropped in as the GeoJSON above. SIM 3292 axes are only a stand-in.
2. **FEM coupling.** Replace the Boussinesq point load with the local
   finite-element stress change on those planes. Keep ΔCFS and the same
   depth sampling so the page still draws.
3. **VPLanet output.** Ingest a \(T(z,t)\) and a viscosity profile instead of
   the four-column epoch switch and the lab creep law. The core radius,
   core mass, and radionuclide sliders are already exported for that run.
4. **Finer topography at Cerberus Fossae** (64 or 128 pixel/degree MOLA),
   if the fossae themselves need to be visible rather than the plains they
   cut.
5. **A better static source** than a point mass: a distributed crater load,
   flexure, and, later, the isostatic and thermal loads the project cares
   about on million-year timescales.

## Sources actually used

- **Topography:** real MOLA MEGDR 32 pixel/degree (`MEGT90N000FB`). Not synthetic.
- **Faults:** real USGS SIM 3292 structures, with the kinematics assignment
  described above. Not a traced cartoon, and not yet Wheeler's fault layer.
- **Parameters:** the project spreadsheet, converted by `scripts/convert_parameters.py`.
- **Craters, magnitude, Coulomb stress, creep:** the relations in MODEL.md.
  Seismic efficiency, stress drop, excavation fraction, \(Q\), criticality,
  pore pressure, and conductivity are explicit assumptions with sliders.
