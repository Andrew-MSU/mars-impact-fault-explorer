# First-order impact and fault model

This note is the calculation behind the Mars Impact Fault Explorer. It is a
sandbox for Wheeler Feer, for the Research Catalyst project *Preliminary
Modeling of Induced Tectonic Activity to Restart a Martian Magnetic Dynamo
for Terraforming Applications* (PI: Andrew Laskowski). It is not a finite-element
model and it does not run VPLanet. Both of those are meant to replace pieces
of this calculation later, through the same inputs.

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

Samples run from the surface to the brittle-ductile transition in eight
depth steps. Nothing below the BDT is called reactivated. The active BDT,
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
  are on the panel and in the export. This model does not read them.

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
