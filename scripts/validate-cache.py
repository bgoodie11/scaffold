#!/usr/bin/env python3
"""Validate the generated active-shed snapshot without third-party packages."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
cache = root / "data" / "scaffolds.json"
payload = json.loads(cache.read_text(encoding="utf-8"))
rows = payload.get("rows")
assert isinstance(rows, list) and rows, "cache has no rows"
assert "Active Sidewalk Shed" in payload.get("source", ""), "cache is not from active-shed source"
jobs = set()
for row in rows:
    assert row.get("permit_subtype") == "SH", "non-sidewalk-shed row found"
    assert str(row.get("borough", "")).lower() == "manhattan", "non-Manhattan row found"
    lat, lon = float(row["latitude"]), float(row["longitude"])
    assert 40.45 < lat < 40.95 and -74.3 < lon < -73.6, "coordinate outside NYC"
    assert float(row["linear_feet"]) >= 0, "invalid linear footage"
    job = row.get("job_doc___")
    assert job and job not in jobs, "duplicate job number"
    jobs.add(job)

assert any(row.get("bin__") == "1013043" and float(row["linear_feet"]) == 2040 for row in rows), "known BIN 1013043 fixture missing"
print(f"OK: {len(rows)} active Manhattan shed records, {sum(float(r['linear_feet']) for r in rows):,.0f} linear feet")

