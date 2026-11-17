"""Checks for the spreadsheet converter and the committed JSON catalog."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from convert_parameters import parse_simple_range, split_parameter_row  # noqa: E402

CATALOG = ROOT / "data" / "parameters.json"
REFERENCES = ROOT / "data" / "references.json"


class RangeParserTests(unittest.TestCase):
    def test_plain_interval(self):
        low, high, note = parse_simple_range("60 - 100")
        self.assertEqual((low, high), (60.0, 100.0))
        self.assertIsNone(note)

    def test_parenthetical_aside_is_not_the_range(self):
        low, high, note = parse_simple_range("455 - 515 (±30)")
        self.assertEqual((low, high), (455.0, 515.0))
        self.assertIsNone(note)
        low, high, _ = parse_simple_range("5.5 - 18.0 (0.0055 - 0.018 W/m^2)")
        self.assertEqual((low, high), (5.5, 18.0))
        low, high, _ = parse_simple_range("1.2E-07 - 1.6E-07 (4.9E-11 W/kg)")
        self.assertAlmostEqual(low, 1.2e-7)
        self.assertAlmostEqual(high, 1.6e-7)

    def test_open_warm_bound_is_closed_at_300k(self):
        low, high, note = parse_simple_range("230 (cold/icy) - 273+ (warm/wet)")
        self.assertEqual((low, high), (230.0, 300.0))
        self.assertIn("300", note)

    def test_plus_minus_combined_with_a_second_estimate(self):
        low, high, note = parse_simple_range("16 ± 2 (Taylor) - 18 (Yoshizaki)")
        self.assertEqual((low, high), (14.0, 18.0))
        self.assertIn("Hand fix", note)
        low, high, _ = parse_simple_range("56 ± 6 (Taylor) - 68 (Yoshizaki)")
        self.assertEqual((low, high), (50.0, 68.0))
        low, high, _ = parse_simple_range("305 ± 30 (Taylor) - 360 (Yoshizaki)")
        self.assertEqual((low, high), (275.0, 360.0))

    def test_labeled_qualifiers(self):
        low, high, _ = parse_simple_range(
            "25 (trough floors) - 65 (surrounding Tharsis plateau)"
        )
        self.assertEqual((low, high), (25.0, 65.0))
        low, high, _ = parse_simple_range("1.0E+19 (wet) - 1.0E+22 (dry)")
        self.assertAlmostEqual(low, 1e19)
        self.assertAlmostEqual(high, 1e22)

    def test_compound_creep_row(self):
        records = split_parameter_row(
            {
                "name": "Creep Stress Exponent & Pre-Exponential Factor (Dry Diabase)",
                "key": "n_dry, A_dry",
                "value": "4.7, 8.0",
                "range": "n: 4.1-5.3; A: 4.0-12.0",
                "units": "Dim., MPa^-n s^-1",
                "material": "dry",
                "method": "lab",
                "doi": "10.1029/97JB02671",
                "note": "",
            }
        )
        by_key = {record["key"]: record for record in records}
        self.assertEqual(by_key["n_dry"]["value"], 4.7)
        self.assertEqual((by_key["n_dry"]["min"], by_key["n_dry"]["max"]), (4.1, 5.3))
        self.assertEqual(by_key["A_dry"]["value"], 8.0)
        self.assertEqual((by_key["A_dry"]["min"], by_key["A_dry"]["max"]), (4.0, 12.0))

    def test_wet_prefactor_hand_fix(self):
        records = split_parameter_row(
            {
                "name": "Creep Stress Exponent & Pre-Exponential Factor (Wet Diabase)",
                "key": "n_wet, A_wet",
                "value": "3.05, 6.12E-02",
                "range": "n: ±0.2",
                "units": "Dim., MPa^-n s^-1",
                "material": "wet",
                "method": "lab",
                "doi": "10.1029/JB087iB08p06781",
                "note": "",
            }
        )
        by_key = {record["key"]: record for record in records}
        self.assertAlmostEqual(by_key["n_wet"]["min"], 2.85)
        self.assertAlmostEqual(by_key["n_wet"]["max"], 3.25)
        self.assertAlmostEqual(by_key["A_wet"]["min"], 0.0612 / 3)
        self.assertAlmostEqual(by_key["A_wet"]["max"], 0.0612 * 3)
        self.assertIn("Hand fix", by_key["A_wet"]["parse_note"])


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        cls.references = json.loads(REFERENCES.read_text(encoding="utf-8"))

    def test_catalog_covers_the_sheet_and_stays_inside_its_ranges(self):
        parameters = self.catalog["parameters"]
        self.assertEqual(len(parameters), 40)
        keys = [item["key"] for item in parameters]
        self.assertEqual(len(keys), len(set(keys)))
        for item in parameters:
            self.assertLessEqual(item["min"], item["value"])
            self.assertLessEqual(item["value"], item["max"])
            self.assertTrue(item["doi"].startswith("10."))
            self.assertTrue(item["units"])
            self.assertIn(item["category"], {
                "Rheology",
                "Creep",
                "Thermal",
                "Fault geometry",
                "Crustal structure",
                "VPLanet / interior",
            })
            self.assertGreater(item["to_si"], 0)

    def test_documented_hand_fixes_survive_in_the_committed_file(self):
        by_key = {item["key"]: item for item in self.catalog["parameters"]}
        self.assertAlmostEqual(by_key["T_s_early"]["max"], 300)
        self.assertIn("273+", by_key["T_s_early"]["range_raw"])
        self.assertAlmostEqual(by_key["A_wet"]["min"], 0.0612 / 3)
        self.assertAlmostEqual(by_key["C_U_BSM"]["min"], 14)
        self.assertAlmostEqual(by_key["C_U_BSM"]["max"], 18)
        self.assertAlmostEqual(by_key["C_Th_BSM"]["min"], 50)
        self.assertAlmostEqual(by_key["C_K_BSM"]["max"], 360)
        self.assertEqual(by_key["n_wet"]["units"], "dimensionless")
        self.assertEqual(by_key["A_dry"]["units"], "MPa^-n s^-1")
        notes = {item["key"] for item in self.catalog["range_fix_log"]}
        self.assertIn("A_wet", notes)
        self.assertIn("T_s_early", notes)
        self.assertIn("n_dry", notes)

    def test_references_have_dois(self):
        references = self.references["references"]
        self.assertGreaterEqual(len(references), 20)
        for item in references:
            self.assertTrue(item["doi"])
            self.assertTrue(item["url"].startswith("https://doi.org/"))
            self.assertIsInstance(item["year"], int)


if __name__ == "__main__":
    unittest.main()
