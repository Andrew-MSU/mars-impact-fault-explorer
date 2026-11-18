export const GLOSSARY = [
  { id: "cfs", term: "CFS", title: "Coulomb failure stress", text: "τ − (C + μ σ′n) + ΔCFS. Failure is CFS ≥ 0. A negative value means the fault is still stable, including its background deficit." },
  { id: "dcfs", term: "ΔCFS", title: "Coulomb stress change", text: "Δτ + μ′ Δσn, with Δσn positive when the fault is unclamped (King, Stein & Lin 1994). Positive ΔCFS promotes the fault's geologic slip sense." },
  { id: "mw", term: "Mw", title: "Moment magnitude", text: "From Kanamori (1977) using the seismic energy, which is k times the coupled kinetic energy. It is not a measured earthquake magnitude. Above about Mw 11 the scaling is outside the model's validity." },
  { id: "chi", term: "χ", title: "Stress criticality", text: "Fraction of the way from lithostatic stress (no shear) to the frictional failure envelope. χ = 1 puts an optimally oriented fault at failure before the impact." },
  { id: "lambda", term: "λ", title: "Pore-pressure ratio", text: "Pore pressure divided by the vertical stress. 0 is dry. The early-Mars preset uses 0.4." },
  { id: "te", term: "Te", title: "Elastic lithosphere thickness", text: "Flexure thickness the weak zone must reach, and be long enough relative to, before the lid counts as broken. Present day is 100 km. Early Mars uses 15 km from the southern-hemisphere fit of McKenzie, Barnett & Yuan (2002)." },
  { id: "bdt", term: "BDT", title: "Brittle-ductile transition", text: "Depth below which the sheet does not call rock brittle. Present day 100 km, early Mars 30 km. With the Moho cap on, faults are not tested below the crust even if the BDT is deeper." },
  { id: "qcmb", term: "q_cmb", title: "CMB heat flux", text: "Heat flow at the base of the crust, minus mantle radiogenic heating and the secular term, then spread over the metallic-core surface. Positive means the core is losing heat." },
  { id: "qad", term: "q_adiabatic", title: "Adiabatic core heat flux", text: "k α g T / cp down the core adiabat. A thermal dynamo is estimated only from the part of q_cmb above this threshold." },
  { id: "spin", term: "ΔΩ/Ω", title: "Fractional spin change", text: "Angular-velocity change of the mantle divided by the spin rate, from the impact's tangential angular momentum. Stirring turns on only when this reaches the threshold slider. The default 0.02 is an assumption, not a Le Bars et al. (2011) constant." },
  { id: "gunell", term: "Gunell peak", title: "Cusp-escape peak moment", text: "Gunell et al. (2018) place a peak in atmospheric escape near 2.5×10²⁴ A m². A case counts as protective only past that peak, and their escape rate then falls back toward the unmagnetized rate rather than to zero." },
  { id: "standoff", term: "Standoff", title: "Magnetopause altitude", text: "Magnetopause radius from pressure balance, minus the planetary radius. It must clear the exobase (220 km by default) at both nominal and storm solar-wind pressure. With no magnetic moment the standoff is n/a, not a negative altitude." },
];

export function glossaryById(id) {
  return GLOSSARY.find((item) => item.id === id);
}
