"""The student challenge kit: validator, VPLanet converter, and the shipped example."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable
EXAMPLE = ROOT / "challenge" / "example" / "baseline_offline_run.json"
VPLANET_JSON = ROOT / "challenge" / "example" / "vplanet_offline_run.json"
VPLANET_CASE = ROOT / "challenge" / "example" / "vplanet_case"
TEMPLATE = ROOT / "challenge" / "vplanet" / "template"


def run_py(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([PY, *args], cwd=ROOT, capture_output=True, text=True)


class ChallengeKitTests(unittest.TestCase):
    def test_shipped_explorer_example_validates(self):
        result = run_py("challenge/validate_offline_run.py", str(EXAMPLE))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Valid.", result.stdout)
        data = json.loads(EXAMPLE.read_text(encoding="utf-8"))
        self.assertEqual(data["schema"], "mars-explorer-offline-run/v1")
        self.assertFalse(data["example"])
        self.assertEqual(len(data["runs"]), 10)
        self.assertTrue(all(run["dynamo_on"] is False for run in data["runs"]))

    def test_shipped_vplanet_example_validates_and_reconverts(self):
        result = run_py("challenge/validate_offline_run.py", str(VPLANET_JSON))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            converted = run_py(
                "challenge/vplanet_to_explorer.py",
                str(VPLANET_CASE),
                "-o",
                str(out),
            )
            self.assertEqual(converted.returncode, 0, converted.stdout + converted.stderr)
            self.assertEqual(json.loads(out.read_text(encoding="utf-8")), json.loads(VPLANET_JSON.read_text(encoding="utf-8")))
        run = json.loads(VPLANET_JSON.read_text(encoding="utf-8"))["runs"][0]
        self.assertFalse(run["dynamo_on"])
        self.assertTrue(run["vplanet_moment_was_positive"])
        self.assertAlmostEqual(run["magnetic_moment_Am2"], 0.831838 * 80e21, delta=1e18)
        self.assertEqual(run["vplanet_moment_positive_until_Gyr"], 0.5)

    def test_template_inputs_match_the_finished_example(self):
        for name in ("mars.in", "case.json"):
            self.assertEqual((TEMPLATE / name).read_text(encoding="utf-8"), (VPLANET_CASE / name).read_text(encoding="utf-8"))

    def test_validator_rejects_a_fake_example_flag_and_a_hole(self):
        fake = json.loads((ROOT / "data" / "offline_runs" / "EXAMPLE.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fake.json"
            path.write_text(json.dumps(fake), encoding="utf-8")
            rejected = run_py("challenge/validate_offline_run.py", str(path))
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("example must be false", rejected.stdout)

            fake["example"] = False
            fake["runs"] = [
                run
                for run in fake["runs"]
                if not (run["impactor_diameter_m"] == 10000 and run["water_fraction"] == 0.5)
            ]
            path.write_text(json.dumps(fake), encoding="utf-8")
            hole = run_py("challenge/validate_offline_run.py", str(path))
            self.assertNotEqual(hole.returncode, 0)
            self.assertIn("hole", hole.stdout)


if __name__ == "__main__":
    unittest.main()
