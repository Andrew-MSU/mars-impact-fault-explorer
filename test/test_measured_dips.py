"""The committed dip catalog matches the converter and Wheeler's tables."""

from __future__ import annotations

import csv
import json
import statistics
import unittest
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from convert_measured_dips import build_catalog  # noqa: E402

CATALOG_PATH = ROOT / "data" / "measured_dips.json"
PARAMETERS_PATH = ROOT / "data" / "parameters.json"
WHEELER_CSV = ROOT / "data" / "source" / "measured" / "sd_measurements_qa.csv"
FISHER_CSV = ROOT / "data" / "source" / "measured" / "hirise_sim_fisher_means.csv"


def load_catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


class MeasuredDipCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog()

    def test_committed_file_matches_the_converter(self):
        fresh = json.loads(json.dumps(build_catalog()))
        self.assertEqual(
            fresh,
            self.catalog,
            "measured_dips.json is stale. Run python3 scripts/convert_measured_dips.py",
        )

    def test_wheeler_means_use_the_recomputed_three_point_dips(self):
        with WHEELER_CSV.open(newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        by_region: dict[str, list[float]] = {}
        cerberus3 = None
        for row in rows:
            dip = float(row["dip_3pt"])
            by_region.setdefault(row["region"], []).append(dip)
            if row["Ref_Layer"].startswith("Cerberus3"):
                cerberus3 = row
        self.assertEqual(len(by_region["Valles Marineris"]), 4)
        self.assertEqual(len(by_region["Cerberus Fossae"]), 5)
        vm = self.catalog["regions"]["valles_marineris"]["kinematics"]["normal"]["wheeler"]
        cf = self.catalog["regions"]["cerberus_fossae"]["kinematics"]["normal"]["wheeler"]
        self.assertAlmostEqual(vm["dip_deg"], round(statistics.fmean(by_region["Valles Marineris"]), 2))
        self.assertAlmostEqual(cf["dip_deg"], round(statistics.fmean(by_region["Cerberus Fossae"]), 2))
        self.assertAlmostEqual(vm["dip_deg"], 51.79, places=2)
        self.assertAlmostEqual(cf["dip_deg"], 54.57, places=2)
        self.assertEqual(cerberus3["Dip"], "90.0000")
        stored = next(item for item in self.catalog["measurements"] if item["id"] == "Cerberus3")
        self.assertEqual(stored["delivered_dip_deg"], 90.0)
        self.assertAlmostEqual(stored["dip_deg"], 61.3349, places=4)
        self.assertNotEqual(stored["dip_deg"], 90)
        self.assertIn("error", stored["correction"])
        self.assertEqual(stored["measurement_class"], "wheeler_manual")
        self.assertEqual(stored["source_file"], "sd_measurements_qa.csv")
        self.assertTrue(stored["method"])
        self.assertIn("61.3", cf["summary"])

    def test_isidis_default_is_the_low_confidence_wrinkle_ridge(self):
        with FISHER_CSV.open(newline="", encoding="utf-8") as handle:
            ridge = next(
                row
                for row in csv.DictReader(handle)
                if row["structure"] == "Wrinkle ridge" and row["wall"] == "dipping toward 332"
            )
        self.assertEqual(int(ridge["n"]), 5)
        thrust = self.catalog["regions"]["isidis_planitia"]["kinematics"]["thrust"]
        for source in ("wheeler", "hirise"):
            entry = thrust[source]
            self.assertAlmostEqual(entry["dip_deg"], round(float(ridge["mean_dip"]), 2))
            self.assertEqual(entry["n"], 5)
            self.assertTrue(entry["low_confidence"])
            self.assertEqual(entry["measurement_class"], "hirise_programmatic")
            self.assertIn("343.02", entry["summary"])
            self.assertIn("4.14", entry["summary"])
            self.assertEqual(entry["source_files"], ["hirise_sim_fisher_means.csv"])
            self.assertTrue(entry["method"])

    def test_every_used_value_keeps_provenance(self):
        for site in self.catalog["measurements"]:
            self.assertIn(site["measurement_class"], {"wheeler_manual"})
            self.assertTrue(site["source_file"])
            self.assertTrue(site["method"])
            self.assertEqual(site["n"], 1)
        for wall in self.catalog["azimuth_walls"]:
            self.assertEqual(wall["measurement_class"], "hirise_programmatic")
            self.assertTrue(wall["source_file"])
            self.assertTrue(wall["method"])
            self.assertGreater(wall["n"], 0)
            self.assertIsNotNone(wall["kappa"])
            self.assertIsNotNone(wall["alpha95_deg"])
        for region in self.catalog["regions"].values():
            for sources in region["kinematics"].values():
                for entry in sources.values():
                    self.assertTrue(entry["method"])
                    self.assertIn(entry["measurement_class"], {
                        "wheeler_manual",
                        "hirise_programmatic",
                        "literature_default",
                    })
                    self.assertLessEqual(entry["min"], entry["dip_deg"])
                    self.assertLessEqual(entry["dip_deg"], entry["max"])

    def test_literature_fallback_matches_the_parameter_sheet(self):
        parameters = json.loads(PARAMETERS_PATH.read_text(encoding="utf-8"))
        by_key = {item["key"]: item for item in parameters["parameters"]}
        literature = self.catalog["literature"]
        self.assertEqual(literature["normal"]["dip_deg"], by_key["theta_normal"]["value"])
        self.assertEqual(literature["normal"]["min"], by_key["theta_normal"]["min"])
        self.assertEqual(literature["normal"]["max"], by_key["theta_normal"]["max"])
        self.assertEqual(literature["thrust"]["dip_deg"], by_key["theta_thrust"]["value"])
        self.assertEqual(literature["thrust"]["min"], by_key["theta_thrust"]["min"])
        self.assertEqual(literature["thrust"]["max"], by_key["theta_thrust"]["max"])
        self.assertEqual(literature["normal"]["dip_deg"], 60)
        self.assertEqual(literature["thrust"]["dip_deg"], 30)
        self.assertEqual(self.catalog["default_source"], "wheeler")

    def test_caveat_is_stored_with_the_catalog(self):
        self.assertIn("talus", self.catalog["caveat"].lower())
        self.assertIn("Isidis", self.catalog["caveat"])
        self.assertIn("proxy", self.catalog["caveat"].lower())


if __name__ == "__main__":
    unittest.main()
