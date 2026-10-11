"""Runs the compactor against a local folder standing in for R2. Run: python test_compact.py"""

import datetime
import gzip
import json
import os
import subprocess
import sys
import tempfile

import duckdb

from sigv4 import sign_put

HERE = os.path.dirname(os.path.abspath(__file__))


def test_signature_matches_aws4fetch():
    headers = sign_put(
        "https://acct.r2.cloudflarestorage.com/metro-data/catalog/metro.duckdb",
        b"hello catalog",
        "application/octet-stream",
        "public, max-age=300",
        "AKID",
        "SECRET",
        datetime.datetime(2026, 10, 12, 0, 15, 7),
    )
    # The same request signed by aws4fetch 1.0.20 with this payload hash.
    assert headers["authorization"].endswith(
        "Signature=e15004e724af73c19c3dc2a9e3076d74763bbe8655024101c7f145c51355af4c"
    ), headers["authorization"]


def write_chunk(root, day, name, rows):
    folder = os.path.join(root, "raw", day)
    os.makedirs(folder, exist_ok=True)
    with gzip.open(os.path.join(folder, name), "wt") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")


def row(bus, reported, received=None, **extra):
    return {"bus_id": bus, "lat": 6.9, "lng": 79.9, "reported_at": reported,
            "received_at": received or reported + 500, **extra}


def run(root, today_file):
    env = {
        **os.environ,
        "ARCHIVE_ROOT": root,
        "ARCHIVE_PUBLIC_URL": root,
        "ARCHIVE_TODAY_URL": today_file,
        "ARCHIVE_TODAY": "2026-10-12",
    }
    result = subprocess.run([sys.executable, os.path.join(HERE, "compact.py")], env=env,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_compacts_finished_days_and_builds_a_working_catalog():
    with tempfile.TemporaryDirectory() as root:
        write_chunk(root, "2026-10-11", "120000-a.ndjson.gz",
                    [row("b2", 2000, passengers=10, capacity=40), row("b1", 3000), row("b1", 1000)])
        write_chunk(root, "2026-10-11", "120500-a.ndjson.gz",
                    [row("b1", 1000, received=9999), row("b1", 600_000)])
        write_chunk(root, "2026-10-12", "000500-a.ndjson.gz", [row("today", 5000)])
        today_file = os.path.join(root, "today.ndjson.gz")
        with gzip.open(today_file, "wt") as handle:
            handle.write(json.dumps(row("today", 5000)) + "\n")
        os.makedirs(os.path.join(root, "raw", "reference"))
        with open(os.path.join(root, "raw", "reference", "routes.json"), "w") as handle:
            json.dump([{"id": "r1", "code": "CM01", "name": "Makumbura - Fort", "color_hex": "#1A5A96",
                        "directions": [{"id": "d1", "start_location": "Makumbura", "end_location": "Fort"}]}], handle)
        with open(os.path.join(root, "raw", "reference", "stops.json"), "w") as handle:
            json.dump([{"route_code": "CM01", "direction_id": "d1", "stops": [
                {"id": "s1", "stop_code": "KOT", "stop_name_en": "Kottawa", "latitude": 6.84, "longitude": 79.96}]}], handle)

        output = run(root, today_file)
        assert "compacted 2026-10-11: 4 rows" in output, output
        assert not os.path.exists(os.path.join(root, "fixes", "date=2026-10-12"))

        con = duckdb.connect()
        con.execute(f"ATTACH '{root}/catalog/metro.duckdb' AS metro (READ_ONLY)")
        fixes = con.execute("SELECT bus_id, reported_at FROM metro.fixes ORDER BY ALL").fetchall()
        assert fixes == [("b1", 1000), ("b1", 3000), ("b1", 600_000), ("b2", 2000)], fixes
        stored = con.execute(
            f"SELECT bus_id, reported_at FROM read_parquet('{root}/fixes/date=2026-10-11/fixes.parquet')"
        ).fetchall()
        assert stored == sorted(stored), "rows are sorted by bus then time"
        assert con.execute("SELECT count(*) FROM metro.fixes_today").fetchone()[0] == 1
        assert con.execute("SELECT count(*) FROM metro.all_fixes").fetchone()[0] == 5
        assert con.execute("SELECT load FROM metro.fixes WHERE bus_id = 'b2'").fetchone()[0] == 0.25
        assert con.execute("SELECT count(*) FROM metro.silences").fetchone()[0] == 1
        assert con.execute("SELECT name FROM metro.stops").fetchone()[0] == "Kottawa"
        assert con.execute("SELECT route_code, end_location FROM metro.routes").fetchone() == ("CM01", "Fort")
        con.close()

        rerun = run(root, today_file)
        assert "compacted" not in rerun, rerun


def test_an_empty_archive_still_gets_a_catalog():
    with tempfile.TemporaryDirectory() as root:
        today_file = os.path.join(root, "today.ndjson.gz")
        with gzip.open(today_file, "wt") as handle:
            handle.write("")
        run(root, today_file)
        con = duckdb.connect()
        con.execute(f"ATTACH '{root}/catalog/metro.duckdb' AS metro (READ_ONLY)")
        assert con.execute("SELECT count(*) FROM metro.fixes").fetchone()[0] == 0


if __name__ == "__main__":
    for name, test in list(globals().items()):
        if name.startswith("test_"):
            test()
            print("ok", name)
