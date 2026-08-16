#!/usr/bin/env python3
"""Refresh the browser-friendly NYC scaffold permit snapshot.

Uses only Python's standard library so it can run in GitHub Actions or locally.
"""
import csv
import io
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "scaffolds.json"
ACTIVE_SHEDS_URL = "https://nycdob.github.io/ActiveShedPermits/data/Active_Sheds2.csv"

def fetch_active_sheds():
    request = urllib.request.Request(ACTIVE_SHEDS_URL, headers={"User-Agent": "CanopyWalkDataRefresh/0.1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return list(csv.DictReader(io.TextIOWrapper(response, encoding="utf-8")))

def main():
    source_rows = fetch_active_sheds()
    filtered = []
    seen = set()
    for row in source_rows:
        if str(row.get("Borough Digit", "")).strip() != "1":
            continue
        if not row.get("Latitude Point") or not row.get("Longitude Point"):
            continue
        key = row.get("Job Number") or (row.get("BIN Number"), row.get("House Number"), row.get("Street Name"))
        if key in seen:
            continue
        seen.add(key)
        filtered.append({
            "borough": row.get("Borough Name"),
            "bin__": row.get("BIN Number"),
            "house__": row.get("House Number"),
            "street_name": row.get("Street Name"),
            "zip_code": "",
            "permit_status": row.get("Current Job Status"),
            "filing_status": "ACTIVE",
            "permit_subtype": "SH",
            "job_doc___": row.get("Job Number"),
            "latitude": row.get("Latitude Point"),
            "longitude": row.get("Longitude Point"),
            "linear_feet": row.get("Sidewalk Shed/Linear Feet"),
            "first_permit_date": row.get("First Permit Date"),
            "permit_expiration_date": row.get("Permit Expiration Date"),
            "source": "NYC DOB Active Sidewalk Shed map"
        })

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "NYC DOB Active Sidewalk Shed map CSV",
        "rows": filtered,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(filtered)} scaffold records to {OUTPUT}")

if __name__ == "__main__":
    main()

