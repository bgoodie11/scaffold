#!/usr/bin/env python3
"""Regression checks for the dependency-free active-shed refresh."""
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("refresh", Path(__file__).with_name("refresh-scaffolds.py"))
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)

class RefreshCoordinatesTest(unittest.TestCase):
    def test_filters_invalid_coordinates_before_deduplication(self):
        coordinates = [("0.0", "0.0"), ("bad", "-74.0"), ("40.7", "bad"),
                       ("nan", "-74.0"), ("40.7", "inf"), (None, "-74.0"),
                       ("40.45", "-74.0"), ("40.95", "-74.0"),
                       ("40.7", "-74.3"), ("40.7", "-73.6"),
                       ("40.7", "-74.0")]
        rows = [{"Borough Digit": "1", "Job Number": "same-job",
                 "Latitude Point": lat, "Longitude Point": lon}
                for lat, lon in coordinates]
        log = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "scaffolds.json"
            with patch.object(refresh, "fetch_active_sheds", return_value=rows), \
                    patch.object(refresh, "OUTPUT", output), contextlib.redirect_stdout(log):
                refresh.main()
            result = json.loads(output.read_text())["rows"]
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["latitude"], "40.7")
        self.assertEqual(result[0]["longitude"], "-74.0")
        self.assertIn("Excluded 10 Manhattan records", log.getvalue())
        self.assertIn("Excluded job 'same-job'", log.getvalue())
        self.assertIn("latitude='0.0', longitude='0.0'", log.getvalue())

if __name__ == "__main__":
    unittest.main()
