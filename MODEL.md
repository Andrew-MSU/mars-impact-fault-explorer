# First-order impact and fault model

This note is the calculation behind the Mars Impact Fault Explorer. It is a
sandbox for Wheeler Feer, for the Research Catalyst project *Preliminary
Modeling of Induced Tectonic Activity to Restart a Martian Magnetic Dynamo
for Terraforming Applications* (PI: Andrew Laskowski). It is not a finite-element
model and it does not run VPLanet. Both of those are meant to replace pieces
of this calculation later, through the same inputs.

Local mode is the regional calculation below. **Basin & Global** mode, the
last section of this note, follows one impact from the global fault network
to a possible geodynamo. That section is still a first-order browser estimate.

Compression is positive in the stress tensor. The Coulomb normal-stress
change is **unclamping-positive**, so the sign convention is the one in
King, Stein & Lin (1994):

\[
\Delta\mathrm{CFS} = \Delta\tau + \mu'\,\Delta\sigma_n
\]

\(\Delta\tau > 0\) promotes the fault's geologic slip sense. \(\Delta\sigma_n > 0\)
unclamps the fault. Failure on a sample is \(\mathrm{CFS} \ge 0\), with

\[
\mathrm{CFS} = \tau - \big(C + \mu\,\sigma_n'\big) + \Delta\mathrm{CFS}.
\]

\(\mu = \tan\phi\), and \(\phi\) and \(C\) come from the parameter sheet.
The default cohesion is the fractured rock-mass value \(C_{0,\mathrm{rm}}\),
because the question is reactivation of an existing fault (Schultz 1993).
Intact cohesion is on the panel for comparison.

Code: `src/model/physics.js` and `src/model/scenario.js`. The tests in
`test/physics.test.js` lock the sign convention, the crater expression, and
the magnitude scaling.

## Constants

| Symbol | Value | Role |
| --- | --- | --- |
| \(g\) | 3.71 m s\(^{-2}\) | Mars gravity |
| \(R\) | 3,396,190 m | Sphere used for distances (SIM 3292 / Mars 2000) |
| \(D_\mathrm{sc}\) | 7 km | Simple-to-complex transition diameter |
| \(k\) | slider, default \(10^{-4}\) | Seismic efficiency |
| \(\chi\) | slider, default 0.85 | Fraction of the frictional differential stress |
| \(\lambda\) | slider, default 0 (present) or 0.4 (early) | Pore-pressure ratio \(P/\sigma_v\) |
| local radius | 250 km | Window for the "nearby" area fraction |

Conductivity \(k_T = 2.5\) W m\(^{-1}\) K\(^{-1}\) (range 1.5–4) is **not**
in the spreadsheet. It only converts heat flux into a geotherm.

## Impact energy and magnitude

Impactor mass and kinetic energy, with diameter \(D\), density \(\rho_i\),
speed \(v\):

\[
m = \tfrac{4}{3}\pi (D/2)^3 \rho_i, \qquad E_k = \tfrac12 m v^2.
\]

The impact angle \(\theta\) is measured from horizontal, so \(\theta = 90^\circ\)
is vertical. Coupled energy is

\[
E_\mathrm{coupled} = E_k \sin\theta.
\]

This is a simple obliquity factor, not a unique standard. Seismic energy is

\[
E_s = k\, E_\mathrm{coupled}.
\]

\(k\) is the seismic efficiency. Schultz & Gault (1975) discussed efficiencies
of this order for basin-scale impacts. Teanby & Wookey (2011) is the Mars
seismic-detection paper the slider citation points at. The default
\(k = 10^{-4}\) sits inside the \(10^{-6}\)–\(10^{-2}\) range on the slider.
It is not a fitted Mars value.

Moment magnitude follows Kanamori (1977), with \(E_s\) in joules:

\[
\log_{10} E_s = 1.5\, M_w + 4.8.
\]

Seismic moment, used only as a reported source parameter, assumes a stress
drop \(\Delta\sigma\) (default 3 MPa, a typical earthquake value):

\[
M_0 = \frac{2\mu E_s}{\Delta\sigma}, \qquad \mu = \frac{E}{2(1+\nu)}.
\]

The default Young's modulus is the rock-mass value \(E_\mathrm{rm}\).

## Crater size

Transient crater diameter in the gravity regime, from Collins, Melosh &
Marcus (2005), following Holsapple pi-group scaling. Inputs are SI
(meters, m/s, m/s²):

\[
D_{tc} = 1.161 \left(\frac{\rho_i}{\rho_t}\right)^{1/3} D^{0.78} v^{0.44} g^{-0.22} \sin(\theta)^{1/3}.
\]

Target density \(\rho_t\) is the sheet crustal density. The final rim
diameter is the simple-crater factor until the simple-complex transition,
then the Croft enlargement used by Collins et al.:

\[
D_\mathrm{fr} =
\begin{cases}
1.25\, D_{tc} & \text{if } 1.25 D_{tc} < D_{sc}, \\
1.17\, D_{tc}^{1.13} / D_{sc}^{0.13} & \text{otherwise.}
\end{cases}
\]

\(D_{sc} = 7\) km is a Mars-scale placeholder (gravity-scaled from the usual
lunar and terrestrial transitions). It changes the final-crater branch only.

The transient cavity is treated as a paraboloid of depth \(D_{tc}/3\):

\[
V = \pi D_{tc}^2 (D_{tc}/3) / 8.
\]

Only a fraction \(f_\mathrm{ex}\) of that volume (default 0.25, slider
0.05–1) is treated as permanently missing. Complex-crater collapse puts
most of the cavity back; \(f_\mathrm{ex}\) is that uncertain remainder.

## Background stress

Depth \(z\) is overburden depth below the local surface. The half-space
used for the impact stress does **not** see the topography. Lithostatic
vertical stress and pore pressure:

\[
\sigma_v = \rho g z, \qquad P = \lambda \sigma_v, \qquad \sigma_v' = \sigma_v - P.
\]

The frictional limit for cohesion \(C\) and friction angle \(\phi\) is

\[
k = \frac{1+\sin\phi}{1-\sin\phi}, \qquad
\sigma_1' = k\,\sigma_3' + 2 C \sqrt{k}.
\]

- Normal regime: \(\sigma_v'\) is \(\sigma_1'\). The critical \(\sigma_3'\)
  comes from the relation above. Criticality \(\chi\) interpolates from
  lithostatic (\(\chi = 0\), no shear) to that limit (\(\chi = 1\)).
- Thrust regime: \(\sigma_v'\) is \(\sigma_3'\), and \(\sigma_1'\) is the
  horizontal stress, scaled by the same \(\chi\).

On a fault of dip \(\delta\),

\[
\sigma_n = \sigma_h \sin^2\delta + \sigma_v \cos^2\delta,
\]
\[
\tau_\mathrm{normal} = (\sigma_v - \sigma_h)\sin\delta\cos\delta.
\]

Thrust rake uses \(-\tau_\mathrm{normal}\). Resolved shear that opposes the
rake makes CFS more negative. At \(\chi = 1\), \(C\) and \(\phi\) consistent,
and the Andersonian optimal dip (\(45^\circ + \phi/2\) for normal faults,
\(45^\circ - \phi/2\) for thrusts), CFS is zero to numerical precision.
That check is a unit test. The sheet dips (60° and 30°) are the optimal
angles for \(\phi \approx 30^\circ\). The explorer's default dips are the
measured slopes in [Fault dip](#fault-dip). 60° and 30° remain available
as the literature source.

## Static stress from the missing mass

The permanent load is a vertical point force on an elastic half-space
(Boussinesq 1885), positive downward:

\[
P_\mathrm{down} = - f_\mathrm{ex}\, \rho_t V g.
\]

The minus sign is the removal of weight. With \(R = \sqrt{r^2+z^2}\),
compression positive, and \(z\) downward:

\[
\begin{aligned}
\sigma_z &= \frac{3 P z^3}{2\pi R^5}, \\
\sigma_r &= \frac{P}{2\pi}\left[\frac{3 z r^2}{R^5} - \frac{1-2\nu}{R(R+z)}\right], \\
\sigma_\theta &= \frac{P}{2\pi}(1-2\nu)\left[\frac{1}{R(R+z)} - \frac{z}{R^3}\right], \\
\tau_{rz} &= \frac{3 P r z^2}{2\pi R^5}.
\end{aligned}
\]

The tensor is rotated into a local east-north-up frame and resolved onto
the fault plane with the formula above. In the annulus beyond about two
depths, unloading produces radial extension: \(\Delta\mathrm{CFS} > 0\) on
a normal fault that dips radially, and \(\Delta\mathrm{CFS} < 0\) on a
thrust. Directly under the load the point-source Poisson term flips the
horizontal sign. That near field is not used for the verdict: a sample
inside the excavation cavity (a paraboloid of depth \(D_{tc}/3\) and
surface radius \(D_\mathrm{fr}/2\)) is marked **excavated** rather than
given a Coulomb result. Stresses that are still reported for context are
evaluated at \(r = \max(r_\mathrm{horizontal}, D_\mathrm{fr}/2, 1\,\mathrm{km})\).

This point load is not an Okada dislocation and it is not a flexural
solution. It is the piece a later FEM should replace.

## Dynamic stress

Seismic energy is spread over a hemisphere in a pulse of duration

\[
\tau = \sqrt{D_{tc}/g},
\]

the usual crater-growth time. The RMS velocity at distance \(r\) is

\[
v_\mathrm{rms} = \sqrt{\frac{E_s}{2\pi r^2 \rho v_s \tau}},
\]

with a peak \(\sqrt{2}\, v_\mathrm{rms}\) for a sinusoidal pulse and
anelastic attenuation \(\exp(-\pi f r / Q v_s)\), \(f = 1/\tau\).
\(Q\) defaults to 500 (slider 50–2000). It is an assumption, not an
InSight inversion. Peak ground velocity is capped at \(0.05\, v_s\) so the
far-field formula cannot go super-shear next to the source.

Dynamic stress is the impedance relation

\[
\sigma_\mathrm{dyn} = \rho v_s\, \mathrm{PGV} = \mu\, \mathrm{PGV}/v_s.
\]

The wave reverses, so the peak that promotes slip is taken as
\(+\sigma_\mathrm{dyn}\) on every fault and is **not** accumulated. The
static Coulomb change keeps its signed value. The results panel and the
sweep both report the immediate fraction (static + dynamic) and the
static-only fraction.

## Failure with depth

Samples run from the surface to a depth limit in eight steps, and the
deepest sample sits on that limit. With **Cap faults at Moho** on (the
default), the limit is the shallower of the BDT and the crustal thickness:
the regional value in local mode (Valles Marineris 45 km, Cerberus Fossae
35 km, Isidis 15 km) and, in Basin & Global, that same regional value
inside those windows and `d_crust_global` elsewhere. Turning the cap off
tests faults down to the BDT even where that is below the Moho. Nothing
below the BDT is called reactivated. The active BDT,
surface temperature, mantle heat flux, and crustal heat production are the
present-day or early-Mars column from the sheet, chosen by the epoch
toggle.

Area of a segment of length \(L\) over a depth bin \(\Delta z\) is
\(L\,\Delta z / \sin\delta\). The headline fraction is that area, summed
over faults of the selected Andersonian regime whose sample lies within
250 km of the impact. The whole-region fraction is also reported. A sample
is **near failure** when CFS is negative but within 5% of the local
strength \(C + \mu\sigma_n'\).

Status colors on the fault planes: stable, near failure, reactivated,
excavated.

## Temperature, creep, and repeated impacts

The geotherm has uniform crustal heat production \(H\) down to the Moho
and the sheet mantle flux \(q_m\) below it:

\[
T(z) = T_s + \frac{q_m z}{k_T} + \frac{H}{2k_T} z (2 d_c - z)
\quad (z \le d_c),
\]

and \(q_m/k_T\) under the Moho. The Moho drawn in the view is the regional
crustal thickness below the local surface. It is a cartoon of one number
from the sheet (Valles Marineris 45 km, Cerberus Fossae 35 km, Isidis 15 km),
not a gravity inversion. Isidis's thin crust is only that smaller number.

Dislocation creep, with \(\sigma\) in MPa and \(A\) in MPa\(^{-n}\) s\(^{-1}\):

\[
\dot\varepsilon = A \sigma^n \exp(-Q/RT), \qquad
\eta = \sigma / (2\dot\varepsilon).
\]

The present-day preset uses dry Columbia diabase (Mackwell et al. 1998).
The early-Mars preset uses wet Maryland diabase (Caristan 1982). Wet
anorthite (Rybacki & Dresen 2000, \(n = 3\), \(A = 398\), \(Q\) from the
sheet slider) is a third option. The sheet quotes those \(n\) and \(A\)
values in the note on \(Q_\mathrm{andesite}\); it does not give them a
range, so they are fixed. A fourth option pins \(\eta\) to the mantle
reference viscosity \(\eta_0\) at every depth.

The Maxwell time is \(t_M = \eta / \mu\). At present-day shallow
temperatures the dry-diabase rate underflows for any practical purpose:
the reported relaxation time is longer than the age of Mars, and the
series does not decay. Each impact adds the static \(\Delta\mathrm{CFS}\)
and the stress then multiplies by \(\exp(-\Delta t / t_M)\). Dynamic
stress is reapplied at the impact instant only. Excavated area stays
failed. The time-series threshold is the first impact after which CFS
crosses zero, drawn on the plot.

## Fault dip

The dip angle on a segment is the regional slider for that fault's
kinematics. The **dip source** chooses the default and the slider range.
Reset on a dip row restores the active source for the current region.
Changing region or source loads that combination's default.

**Wheeler measured** is the default.

- Valles Marineris normal faults use the mean of Wheeler Feer's four
  three-point HiRISE dips: 36.9°, 57.9°, 45.9°, and 66.4°. The mean is
  51.79°. The slider runs from the smallest of those measurements to the
  largest.
- Cerberus Fossae normal faults use his five three-point dips. Cerberus3
  was delivered as 90°. That value is an error. The same triplet
  recomputes to 61.3° (`dip_3pt`), and a HiRISE plane through the triangle
  is about 61.5°. The mean uses 61.3° and is 54.57°.

**HiRISE programmatic** replaces the slider with an n-weighted mean of
Fisher means of 60 m wall planes.

- Cerberus Fossae uses the opposed polygon walls 195/56 (n = 56,
  \(\kappa = 9.75\), \(\alpha_{95} = 6.4^\circ\)) and 021/54 (n = 76,
  \(\kappa = 9.71\), \(\alpha_{95} = 5.5^\circ\)). The mean is 54.72°.
  The slider spans each mean ± its \(\alpha_{95}\).
- Valles Marineris uses the outline walls 232/27 (n = 34) and 336/26
  (n = 20). The mean is 26.67°. Those outline slopes are gentler than
  Wheeler's mid-wall sites.
- The SIM 3292 graben-axis means (Cerberus 198/50 and 022/51; Valles
  Marineris 194/21 and 016/22) and the Valles Marineris contact means
  (205/29 and 020/28) stay in the catalog. A segment can take their dip
  direction when its strike matches. They do not set the slider. The SIM
  corridor also picks lower adjacent walls, about 4° gentler at Cerberus,
  and the contact lines are unit boundaries.

**Literature default** is the parameter sheet: 60° for normal faults
(range 50–70°) and 30° for thrusts (range 20–40°). This is the only
source that still uses those two numbers as the dip.

Isidis has no three-point measurement. The Wheeler source and the HiRISE
source both use the Feature 11 wrinkle-ridge Fisher mean, 327/16
(15.61°, n = 5, \(\kappa = 343\), \(\alpha_{95} = 4.1^\circ\)). The
polygon-wall fit at Feature 11 is three class-B points and is not used.
The page flags this default as low confidence. Five flank slopes on one
ridge are a thin sample, and a wrinkle-ridge flank understates the fault
dip. The literature source puts Isidis thrusts back at 30°.

A fault type with no local measurement keeps the literature value.
Valles Marineris and Cerberus Fossae thrusts have no local wrinkle-ridge
mean. Feature 11 belongs to Isidis and is not reused there. Isidis normal
faults have no local measurement. Feature 11's contact means, 217/28
(n = 17) and 030/21 (n = 10), are unit-boundary slopes and are not
applied to the faults drawn here.

### Dip direction

SIM 3292 traces are graben axes and ridge crests, not planes. Dip
direction is chosen per segment.

- If the segment's strike is within 30° of a measured wall set's axial
  strike, and the segment's right-hand normal (strike + 90°) is within
  45° of that wall's dip direction, the segment takes the measured dip
  direction. The 45° cut is the facing limit used when those walls were
  detected.
- When several wall sets fit, the direction closest to the right-hand
  normal wins. A trace is not flipped onto the opposite wall of a graben.
  At Cerberus, a segment striking about 110° takes the south-dipping wall
  (about 198°), and the opposite digitization takes the north-dipping
  wall (about 021°).
- A segment that is not subparallel to a measured wall keeps the
  right-hand normal of its own trace. A north-south graben in an
  east-west system is the example.
- The literature source does not substitute a measured direction.
- `dip_azimuth_deg` on the GeoJSON feature still overrides the fit, and
  `dip_deg` still overrides the slider.

Wheeler's nine triangles are not copied onto individual SIM traces. In
Valles Marineris the nearest SIM tectonic line is tens to more than a
hundred kilometres from each site, and one wall triangle should not set
the dip of a fault that is hundreds of kilometres long. The regional mean
is the slider. Adopting a wall direction changes the azimuth only. The
dip angle stays the slider for that fault type.

### What the numbers are

These are slopes of the topographic surface, measured on HiRISE DTMs.
They proxy the fault dip near the surface. A degraded wall, a talus
apron, or a wrinkle-ridge flank can be much shallower than the fault
that made it. That limit is most serious at Isidis, where the only
measurement is a 16° ridge flank.

Cerberus Fossae's HiRISE statistics come from the four DTMs that cover
Wheeler's polygons, all near 157–163°E, rather than from the whole fossa
system. The Valles Marineris outline means are wherever that generalized
polygon crosses a DTM, not a systematic sample of the chasma walls.
MDEM200M dips are not used. At his sites the 200 m grid underestimates
the HiRISE wall slopes by tens of degrees.

Counts, \(\kappa\), \(\alpha_{95}\), and the source file for every value
are in `data/measured_dips.json`. `scripts/convert_measured_dips.py`
rebuilds that file from the CSVs in `data/source/measured/`. Those tables
were computed in the private research repository
`Andrew-MSU/mars-tectonic-reactivation` and are committed here so this
public explorer can default to them.

## What this will not do

- No self-consistent thermal evolution. The epoch toggle switches four
  sheet columns and the creep law. It does not integrate radionuclides.
- No pore-pressure diffusion, no undrained \(\Delta P\), no melting, and
  no isostatic rebound beyond the elastic point load and the Maxwell decay.
- Fault traces are still SIM 3292 graben axes and wrinkle-ridge crests.
  The dip angle is a regional measured slope, not a plane fitted to each
  trace. The dip direction is a measured wall azimuth when the segment is
  subparallel to that wall, and the right-hand normal of the trace otherwise.
- Regional stress is one Andersonian regime. A wrinkle ridge inside a
  normal-faulting Valles Marineris stays hard to reactivate, which is
  the point of resolving the rake.
- VPLanet bulk inputs (core radius and mass, radionuclide concentrations)
  are on the panel and in the export. The local reactivation model does not
  read them. Basin & Global does, as a parameterized estimate only.

## References

- Boussinesq, J. (1885). Application des potentiels à l'étude de l'équilibre et du mouvement des solides élastiques.
- Collins, G. S., Melosh, H. J., & Marcus, R. A. (2005). Earth Impact Effects Program. *Meteoritics & Planetary Science*, 40, 817–840.
- Holsapple, K. A. (1993). The scaling of impact processes in planetary sciences. *Annual Review of Earth and Planetary Sciences*, 21, 333–373.
- Kanamori, H. (1977). The energy release in great earthquakes. *Journal of Geophysical Research*, 82, 2981–2987.
- King, G. C. P., Stein, R. S., & Lin, J. (1994). Static stress changes and the triggering of earthquakes. *Bulletin of the Seismological Society of America*, 84, 935–953.
- Schultz, P. H., & Gault, D. E. (1975). Seismic effects from major basin formations on the Moon and Mercury. *The Moon*, 12, 159–177. doi:10.1007/BF00577875. Their basin calculations use seismic efficiencies of \(10^{-5}\) to \(10^{-3}\); the slider default \(10^{-4}\) is the middle of that set.
- Teanby, N. A., & Wookey, J. (2011). Seismic detection of meteorite impacts on Mars. *Physics of the Earth and Planetary Interiors*, 186, 70–80.
- Croft, S. K. (1985). The scaling of complex craters. *Proceedings of the 15th Lunar and Planetary Science Conference*, *JGR* 90, C828–C842.
- Parameter-sheet sources (Schultz 1993, Byerlee 1978, Mackwell et al. 1998, Caristan 1982, Rybacki & Dresen 2000, and the thermal and crustal papers) are stored with DOIs in `data/parameters.json` and `data/references.json`.

## Basin & Global

The question is what kind of impact it takes to start a protective Martian
geodynamo, on the timescale the physics actually produces. One impact has
two pathways.

1. **Slow, structural.** A fault cascade links reactivated faults into a weak
   zone. If that zone fails the lithosphere, a force balance asks whether
   subduction can start. Cold lithosphere delivered to the core-mantle
   boundary raises the core heat flow, which can turn a dynamo on.
2. **Fast, core-direct.** Mechanical stirring of the liquid core from an
   impact-driven spin change, the mechanism Le Bars et al. (2011) argued for
   the Moon. Direct heating of the core top can instead suppress a thermal
   dynamo (Roberts, Lillis & Manga 2009).

The engineered comparison is an artificial dipole at Mars–Sun L1 (Green et al.
2017). Their concept stands the solar wind off upstream of the planet. They
discuss a source of order 1–2 T. This page does not convert that into a
planetary dipole moment. It is a different geometry, described in the About
panel and not given a fake equivalent moment.

Code: `src/model/globalPhysics.js`, `src/model/globalScenario.js`. Tests are
in `test/global.test.js`.

### Core the estimate starts from

There is no settled consensus. The baseline used here is a fully liquid,
well-mixed metallic core of about 1650 km radius beneath a ~150 km basal
molten silicate layer (Samuel et al. 2023, doi:10.1038/s41586-023-06601-8;
Khan et al. 2023, doi:10.1038/s41586-023-06586-4). Khan's density for that
layer rules out a stably stratified iron layer at the top of the core, so
the molten-layer heat-transfer fraction defaults to 1.

Two presets sit next to that baseline:

- Wheeler's homogeneous core, 1830 km (Stähler et al. 2021), which is the
  value the spreadsheet flags as the VPLanet baseline (`R_core_std`). This
  page's default is 1650 km, not 1830.
- A solid inner core of 613 km (Bi et al. 2025,
  doi:10.1038/s41586-025-09361-9, ±67 km). The preset sets the radius only.
  It does not invent compositional buoyancy. That is the compositional-flux
  slider, default 0.

The sheet's `M_core` value is the homogeneous-core mass. The page loads on
the 1650 km baseline, so the core mass starts at the bottom of that range,
1.17×10²³ kg, which the sheet note gives for the basal-melt case. That is
the same state as the "1650 km + 150 km melt" preset, including
\(q_\mathrm{adiabatic}\). Resetting the core-mass row alone restores the
homogeneous mass and the panel says the density no longer matches 1650 km.

### Network stress

Every tectonic graben, pit-crater chain, and wrinkle ridge in
`public/faults/sim3292_global.geojson` gets a Coulomb stress. Dip angle and
dip direction come from the same dip-source selector as local mode
(Wheeler measured, HiRISE programmatic, or the literature 60°/30°). A fault
inside one of the three focus windows uses that window's value. A fault
outside them uses the literature dips. A feature `dip_deg` or
`dip_azimuth_deg` still wins. The file is
USGS SIM 3292, simplified, with lines shorter than 50 km removed. Static
stress is the same Boussinesq point load as local mode, cut off beyond the
static-cutoff slider because a half-space point load is not a global
solution. Dynamic stress uses the great-circle distance and is multiplied
by an antipodal Gaussian gain. The gain is an assumption. It is not a wave
simulation.

Background stress is the local-mode Andersonian field, scaled by criticality,
plus a thin-shell cap load:

- Tharsis, centered on a movable longitude and latitude.
- Hellas, Isidis, Argyre, and Utopia. Centers and diameters are the
  footprints in `data/basins.json`. Unloading is a negative cap. A mascon
  is a positive cap. Isidis and Utopia carry the mascon flag after the
  qualitative pattern in Neumann et al. (2004); the magnitudes are sliders.
- Isostatic support is tension under a positive load and radial compression
  in the surrounding annulus. Flexural support flips both signs. This shape
  is a smooth stand-in so the magnitude can be explored. It is not Banerdt's
  spherical-harmonic solution.
- A relaxation slider multiplies every load by `(1 − rebound)`.

### Cascade, weak zone, water

A failed fault adds

\[
\Delta\mathrm{CFS} = f\,\Delta\sigma\,\left(\frac{L}{L+d}\right)^{p} \lvert\cos\Delta\mathrm{strike}\rvert
\]

to neighbors inside the transfer range, for a set number of passes. Failed
faults closer than the link distance form a weak zone. The reported length
is the along-strike great-circle extent of that connected set: fault
endpoints are projected onto the mean strike through the spherical
(vector) centroid, and the span is capped at one circumference. It is not
the sum of the member traces. Parallel faults in one zone used to add up
past a Mars circumference (the full catalog is about 360,000 km of trace).
The sum is still shown beside the extent, and the damage fraction still
uses failed-trace length over total-trace length. Depth is the deepest
brittle sample that failed, and that sample cannot lie below the Moho
while the cap is on. The zone cuts the elastic lithosphere when the
effective depth reaches \(T_e\) and the along-strike extent is at least
`lid_length_factor` × \(T_e\).

Ductile continuation adds `ductile_fraction` × \((T_e - \mathrm{BDT})\)
only when brittle failure reaches the BDT. The depth grid includes the
brittle limit, so that test can succeed. If the Moho cap stops the fault
above the BDT, the slider adds nothing and the panel says so. Present-day
crust (about 50 km, thinner in the basins) is above the 100 km BDT, so
the slider is idle on the present-day cap. Early Mars has a 30 km BDT
inside the global crust, so a fault that fails to the BDT can use it,
and the added depth is still not allowed below the Moho.

\(T_e\) follows the epoch. Present day stays 100 km. Early Mars sets 15 km,
from the 14.5 km southern-hemisphere fit in McKenzie, Barnett & Yuan
(2002, doi:10.1016/S0012-821X(01)00555-6). McGovern et al. (2002,
doi:10.1029/2002JE001854) find elastic thickness declining toward older
loads. 15 km is that flexure thickness, not the sheet's 30 km early BDT,
and it is not chosen to produce a dynamo. The force-balance lithosphere
thickness \(h\) is a separate slider and stays at its own value.

The seed selector is either those mapped faults (default) or every SIM 3292
trace whose midpoint lies in the Valles Marineris window of `regions.json`,
treated as one candidate plate boundary (Yin 2012, doi:10.1130/L192.1) and
then linked to nearby failures.

Damage is \(1-\exp(-\mathrm{rate}\times L_\mathrm{failed}/L_\mathrm{zone})\),
multiplied by \(\exp(-\mathrm{age}/t_\mathrm{heal})\).

The water slider \(w\) blends the sheet's dry and wet diabase. \(A\) is
interpolated in log space. \(n\) and \(Q\) are linear. Pore pressure is
\(\lambda_\mathrm{dry} + w(\lambda_\mathrm{wet}-\lambda_\mathrm{dry})\).
Fault friction is \(\tan\phi\,(1 - w \times \mathrm{clay})\). The clay
factor multiplies only the Coulomb \(\mu\), not the Andersonian stress ratio.
Dry and Wet buttons set \(w = 0\) and \(w = 1\). The panel runs both ends
side by side.

### Subduction index

Force per unit length. Driving: the compressive part of the Tharsis shell
stress, the compressive part of the basin shell stress, a plume pressure
equal to `plume_fraction` × coupled energy divided by the planetary volume,
and buoyancy when the lithosphere is denser than the mantle. Resistance:
the frictional strength of the damaged lithosphere, and buoyancy when the
lithosphere is lighter. Subduction initiates when the ratio is at least 1.

Lithosphere density mixes sheet crustal density, an eclogite fraction, and
a mantle-lithosphere density equal to the mantle density minus a depletion.
Depleted, fertile, and eclogitized buttons set those sliders. They are
starting points.

If subduction initiates, a slab of thickness \(h\), width equal to the
along-strike extent (not the summed trace length), and speed \(v\) carries a temperature contrast between the CMB
temperature and the geotherm at the base of the lithosphere. The extra CMB
flux is that power spread over the core surface. Onset is the mantle-column
thickness divided by \(v\). Duration is the zone length divided by \(v\).

### Dynamo

Present-day elemental heating rates used for the U/Th/K sliders, natural
isotopic composition, are \(9.7\times 10^{-5}\) W/kg for U,
\(2.6\times 10^{-5}\) W/kg for Th, and \(3.4\times 10^{-9}\) W/kg for K.
The early-Mars epoch multiplies by \(H_\mathrm{early}/H_\mathrm{present}\)
from the sheet. That ratio is a crustal proxy for the whole silicate shell,
and the panel's radio scale multiplies it again.

In steady state the CMB power is the heat flow at the base of the crust
minus radiogenic heating below the crust, minus a secular fraction of the
base-of-crust power. The area on \(q_m\) is the sphere at
\(R - d_\mathrm{crust}\) (about 3346 km for a 50 km crust), not the
core-plus-molten-layer radius. Positive secular fraction means the mantle
is cooling and supplying part of \(q_m\) itself. The molten-layer fraction
then passes that power into the metal, and \(q_\mathrm{cmb}\) is that
power divided by the metallic-core surface area. The adiabatic threshold is

\[
q_\mathrm{ad} = k_c \alpha g_c T_\mathrm{cmb} / c_p, \qquad g_c = GM_c/R_c^2.
\]

\(k_c\), \(\alpha\), and \(c_p\) are not in the spreadsheet. Conductivity
defaults to 40 W/m/K and is labeled as an assumption. A thermal moment is
estimated only from the super-adiabatic flux:

\[
B = \beta \sqrt{\rho\mu_0}\,(F d)^{1/3}, \qquad F = \alpha g q_\mathrm{conv}/(\rho c_p).
\]

\(\beta\) is a slider. The form follows buoyancy-flux scalings (Christensen,
Holzwarth & Reiners 2009). \(\beta\) is not their fitted number. \(d\) is the
convecting shell thickness, outer radius minus inner radius.

Spin stirring uses a fraction of \(m v_\mathrm{tangential} R\). The core is
left with \(\Delta\Omega = L / I_\mathrm{mantle}\). It turns on when
\(\Delta\Omega/\Omega\) exceeds the threshold slider. The default 0.02 is
an assumption, not a threshold from Le Bars et al. (2011); their criterion
is an elliptical instability, not a 2% spin change. Inside an 80 km
diameter cap the ratio stays near \(10^{-3}\) and cannot reach 0.02. Only
impactors near the 400 km end of the slider, at high speed and a shallow
angle, can cross it, and those impacts are flagged as outside the
point-load model's validity. A fraction of the
differential-rotation energy is put in the magnetic field. Core heating
deposits a fraction of the coupled energy in a layer at the top of the core
and subtracts \(E/(A t_\mathrm{diff})\) from the CMB flux for the diffusion
time of that layer. The panel says when this suppression is what turns a
thermal dynamo off.

### What counts as protective

Magnetopause radius from pressure balance:

\[
R_\mathrm{mp} = \left(\frac{\mu_0 M^2}{8\pi^2 P_\mathrm{sw}}\right)^{1/6}.
\]

The nominal pressure defaults to the dynamic pressure implied by Gunell et
al. (2018) Table A.1 for Mars (\(n = 2.6\times 10^6\,\mathrm{m}^{-3}\),
\(v = 400\,\mathrm{km\,s}^{-1}\), about 0.7 nPa). Storm pressure is that
value times a factor, default 5, which is an assumption. The upper atmosphere
defaults to their exobase altitude, \(r_\mathrm{exo}-r_\mathrm{Mars} = 220\,\mathrm{km}\).

A case is protective only when the standoff altitude clears that height at
both pressures and the moment is past the Gunell cusp-escape peak. A moment
of zero has no magnetopause: the panel shows "n/a (no field)" rather than
an altitude of minus the planetary radius. The fast pathway is protective
only when the impact itself supplies protection the background does not
already have (stirring, or a fast thermal moment that the background lacks).
Core-top heating can remove a background dynamo; that is reported separately
and does not set the fast-protective flag. The paper's
text places that peak near \(2.5\times 10^{24}\,\mathrm{A\,m}^2\), about 30
times Earth's moment of \(7.77\times 10^{22}\,\mathrm{A\,m}^2\). Their
Mars-like curves are in the same figure; the slider is there so a different
reading of Fig. 3 can be tried. Past the peak, their escape rate declines
toward the unmagnetized rate. It does not fall to zero, and the page says
that. Earth's moment is shown only as a comparison. An Earth-strength field
does not pass this peak test.

The regime map paints impactor diameter against impact speed:

- faults slip, if any fault fails or is excavated
- the lid breaks, if the weak zone cuts \(T_e\) at the required length, or the subduction index reaches 1
- the dynamo turns on, only when the retention tests pass

Dynamo wins over a broken lid, which wins over slip. The smallest protective
impact is the smallest diameter on a coarse grid of speed, angle, and a few
published sites (the clicked point, Hellas, Isidis, Argyre, Valles Marineris,
and the Tharsis center). It is not a continuous optimum. Core heating can
make a larger impact less favorable than a smaller one, so the search does
not assume the outcome improves with size.

### Offline runs

Drop precomputed sweeps in `data/offline_runs/*.json`. The page lists them
in the Offline model selector and interpolates. The browser estimate is
always shown as well. `EXAMPLE.json` is a hand-written grid so the loader
can be tested. It is not a VPLanet result and must not be cited.

```json
{
  "schema": "mars-explorer-offline-run/v1",
  "example": false,
  "label": "Short description and the model that produced the grid",
  "axes": ["impactor_diameter_m", "water_fraction"],
  "outputs": ["dynamo_on", "regime", "time_to_onset_yr", "duration_yr", "magnetic_moment_Am2", "standoff_over_rp"],
  "runs": [
    {
      "impactor_diameter_m": 10000,
      "water_fraction": 0,
      "dynamo_on": false,
      "regime": "slip",
      "time_to_onset_yr": null,
      "duration_yr": null,
      "magnetic_moment_Am2": 0,
      "standoff_over_rp": 1
    }
  ]
}
```

Axes the page currently queries are `impactor_diameter_m` and
`water_fraction`. Extra axes in a file are bracketed if the query supplies
them; otherwise the first grid edge is used. Numeric outputs are multilinear.
`dynamo_on` and `regime` are returned only when every corner of the cell
agrees. A disagreement sets the threshold warning and leaves those fields
blank. Do not smooth across a dynamo threshold.

### Not interactive, and why

- **SIM 3292 geometry, the 50 km length cut, and the kinematic assignment.**
  Graben axes and pit chains are normal faults. Wrinkle ridges are thrusts.
  Changing that means rebuilding `public/faults/sim3292_global.geojson`
  with `scripts/build_global_faults.py`. Dip *angle* is the sheet slider
  (`theta_normal`, `theta_thrust`) unless a feature has `dip_deg`. Dip
  azimuth is the right-hand normal of the trace unless `dip_azimuth_deg`
  is set. Basin & Global uses the same dip-source selector as local mode
  (`resolveDip` / `resolveDipAzimuth` in `src/model/dips.js`). Inside
  Valles Marineris, Cerberus Fossae, and Isidis the selected source supplies
  the dip. Elsewhere the literature dips are used. There is no second selector.
- **Collins–Holsapple exponents and the 7 km simple-complex diameter.**
  They are the published crater formula already fixed in local mode.
  Impactor diameter, speed, angle, and density are sliders.
- **Mars radius (3,396,190 m) and gravity (3.71 m s⁻²).** Distances and
  the stress calculation share these with the MOLA and SIM 3292 geometry.
- **Elemental heating rates** listed above. `radio_scale` multiplies them.
  Abundances are the sheet sliders.
- **Basin centers and diameters** in `data/basins.json`. They are footprints.
  Every basin magnitude is a slider.
- **Earth's magnetic moment**, \(7.77\times 10^{22}\,\mathrm{A\,m}^2\),
  from Gunell et al. (2018). Comparison only.
- **The pressure-balance constants** in the standoff formula.
- **No global MOLA texture.** The global grid is not in the repository.
  Local mode still uses the regional MOLA tiles.
- **The L1 shield** is described and not turned into a number.
- **The offline model is not executed here.** Only interpolation of a file
  you provide.

### Assumptions Wheeler should review

Each of these is a slider. The default is a starting value, not a measurement.

| Quantity | Default | Range | Why it is an assumption |
| --- | --- | --- | --- |
| Tharsis magnitude | 10 MPa | 0–200 | Shape-function amplitude. Published membrane stresses are often tens of MPa. 10 keeps the default map from being pre-failed at criticality 0.85. |
| Tharsis center | −100°, 0° | full globe | A round point under the rise. |
| Tharsis radius | 50° | 10–90° | Cap size. |
| Basin unloading | 5 MPa | 0–150 | Same shape function. |
| Isidis and Utopia mascons | 10 MPa | 0–80 | Neumann et al. (2004) supply the flag, not the stress. Hellas and Argyre default to 0. |
| Load relaxation | 0 | 0–1 | Not a viscous integration. |
| Antipodal gain and width | 5, 12° | 1–30, 2–45° | Geometric envelope. |
| Static cutoff | 2000 km | 200–8000 | Half-space limit. |
| Cascade fraction, exponent, stress drop, range | 0.15, 3, 3 MPa, 400 km | see sliders | Not an Okada cascade. |
| Link distance | 150 km | 10–1500 | What "connected" means. |
| Damage rate and healing time | 1, 100 Myr | see sliders | One-parameter damage. |
| Elastic thickness | 100 km present, 15 km early | 10–300 | Present day matches the sheet BDT. Early Mars is the McKenzie et al. (2002) southern-hemisphere flexure thickness (14.5 km, used as 15 km). |
| Lid-break length | 3 × along-strike extent / Te | 1–20 | The length is the along-strike extent, capped at one circumference. |
| Ductile continuation | 0 | 0–1 | Adds depth only when failure reaches the BDT. Idle when the Moho cap stops the fault above the BDT. |
| Mantle density | 3500 kg/m³ | 3300–3700 | Not in the sheet. |
| Depletion | 50 kg/m³ | 0–150 | Order of a depleted residue. |
| Eclogite density | 3500 kg/m³ | 3200–3800 | |
| Plume energy fraction | 0.01 | 10⁻⁴–0.5 | |
| Slab speed | 1 cm/yr | 0.01–20 | |
| Rock specific heat | 1200 J/kg/K | 800–1600 | Slab heat only. |
| Core conductivity | 40 W/m/K | 5–150 | Missing from the sheet. Sets \(q_\mathrm{ad}\). |
| Core expansivity and specific heat | 10⁻⁵ K⁻¹, 850 J/kg/K | see sliders | Liquid-iron order of magnitude. |
| Dynamo prefactor β | 0.05 | 0.001–1 | Not a published fit. |
| Dipole fraction | 0.2 | 0.01–1 | |
| Molten-layer transfer | 1 | 0–1 | Default follows Khan's argument against a stable iron blanket. |
| Secular fraction | 0 | −1–1 | Steady state. |
| Compositional flux | 0 | 0–30 mW/m² | The 613 km preset does not set this. |
| Spin coupling and ΔΩ/Ω threshold | 0.1, 0.02 | see sliders | Le Bars et al. (2011) is the mechanism, not these numbers. 0.02 is not reached except at the extreme end of the 400 km diameter slider, which is outside model validity. |
| Ohmic fraction and stirring duration | 0.01, 10⁴ yr | see sliders | |
| Core-heat fraction and lid thickness | 0.01, 100 km | see sliders | Roberts et al. (2009) is the mechanism. |
| Storm pressure factor | 5 | 1–40 | Gunell's table is a nominal wind. |
| Gunell peak moment | 2.5×10²⁴ A m² | 10²⁰–10²⁷ | The text's cusp peak. Move it if Fig. 3 is read differently for Mars. |
| Clay friction cut | 0.3 | 0–0.8 | Wet-end reduction of tan φ. |
| Moment factor | 0.364 | 0.3–0.4 | Order of Mars' polar moment factor. |
| Pore pressure at the wet end | 0.4 | 0–0.9 | Matches the early-Mars local preset. |

### Further reading for this section

- Bi, H., et al. (2025). Seismic detection of a 600-km solid inner core in Mars. *Nature*. doi:10.1038/s41586-025-09361-9
- McGovern, P. J., Solomon, S. C., Smith, D. E., Zuber, M. T., Simons, M., Wieczorek, M. A., Phillips, R. J., Neumann, G. A., Aharonson, O., & Head, J. W. (2002). Localized gravity/topography admittance and correlation spectra on Mars: Implications for regional and global evolution. *Journal of Geophysical Research*, 107(E12), 5136. doi:10.1029/2002JE001854
- McKenzie, D., Barnett, D. N., & Yuan, D.-N. (2002). The relationship between Martian gravity and topography. *Earth and Planetary Science Letters*, 195, 1–16. doi:10.1016/S0012-821X(01)00555-6
- Christensen, U. R., Holzwarth, V., & Reiners, A. (2009). Energy flux determines magnetic field strength of planets and stars. *Nature*, 457, 167–169.
- Green, J. L., et al. (2017). A future Mars environment for science and exploration. Planetary Science Vision 2050 Workshop, abstract 8250.
- Gunell, H., et al. (2018). Why an intrinsic magnetic field does not protect a planet against atmospheric escape. *Astronomy & Astrophysics*, 614, L3. doi:10.1051/0004-6361/201832934
- Khan, A., et al. (2023). Evidence for a liquid silicate layer atop the Martian core. *Nature*. doi:10.1038/s41586-023-06586-4
- Le Bars, M., Wieczorek, M. A., Karatekin, Ö., Cébron, D., & Laneuville, M. (2011). An impact-driven dynamo for the early Moon. *Nature*, 479, 215–218.
- Neumann, G. A., Zuber, M. T., Wieczorek, M. A., McGovern, P. J., Lemoine, F. G., Smith, D. E., & Solomon, S. C. (2004). Crustal structure of Mars from gravity and topography. *Science*, 304, 842–845. doi:10.1126/science.1099208
- Roberts, J. H., Lillis, R. J., & Manga, M. (2009). Giant impacts on early Mars and the cessation of the Martian dynamo. *Journal of Geophysical Research*, 114, E04009.
- Samuel, H., et al. (2023). Geophysical evidence for an enriched molten silicate layer above Mars's core. *Nature*. doi:10.1038/s41586-023-06601-8
- Stähler, S. C., et al. (2021). Seismic detection of the Martian core. *Science*, 373, 443–448. doi:10.1126/science.abi7730
- Yin, A. (2012). Structural analysis of the Valles Marineris fault zone. *Lithosphere*, 4, 286–330. doi:10.1130/L192.1

