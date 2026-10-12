"""Runs the compactor against a local folder standing in for R2. Run: python test_compact.py"""

import datetime
import gzip
import json
import os
import subprocess
import sys
import tempfile

import duckdb

import compact
from sigv4 import sign_put

HERE = os.path.dirname(os.path.abspath(__file__))
# Midnight on 2026-10-12 in Colombo.
TODAY_MS = int(datetime.datetime(2026, 10, 12, tzinfo=datetime.timezone(datetime.timedelta(hours=5, minutes=30))).timestamp() * 1000)


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


def run(root, live_file, hour=0):
    env = {
        **os.environ,
        "ARCHIVE_ROOT": root,
        "ARCHIVE_PUBLIC_URL": root,
        "ARCHIVE_LIVE_URL": live_file,
        "ARCHIVE_TODAY": "2026-10-12",
        "ARCHIVE_HOUR": str(hour),
    }
    result = subprocess.run([sys.executable, os.path.join(HERE, "compact.py")], env=env,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_compacts_finished_days_and_builds_a_working_catalog():
    with tempfile.TemporaryDirectory() as root:
        write_chunk(root, "2026-10-11", "120000-a.ndjson.gz",
                    [row("b2", 2000, passengers=10, capacity=40, route_id="r1"), row("b1", 3000), row("b1", 1000)])
        write_chunk(root, "2026-10-11", "120500-a.ndjson.gz",
                    [row("b1", 1000, received=9999), row("b1", 600_000)])
        write_chunk(root, "2026-10-12", "000500-a.ndjson.gz", [row("today", TODAY_MS + 5000)])
        today_file = os.path.join(root, "today.ndjson.gz")
        with gzip.open(today_file, "wt") as handle:
            handle.write(json.dumps(row("today", TODAY_MS + 5000)) + "\n")
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
        assert con.execute("SELECT route_code FROM metro.fixes WHERE bus_id = 'b2'").fetchone()[0] == "CM01"
        con.close()

        rerun = run(root, today_file)
        assert "compacted" not in rerun, rerun


def test_today_combines_the_hourly_file_and_the_live_file_without_repeats():
    with tempfile.TemporaryDirectory() as root:
        hour = 3_600_000
        x = row("x", TODAY_MS + 8 * hour)
        y = row("y", TODAY_MS + 9 * hour + 30 * 60_000)
        z = row("z", TODAY_MS + 10 * hour + 5 * 60_000)
        stale = row("yesterday", TODAY_MS - hour)
        write_chunk(root, "2026-10-12", "080500-a.ndjson.gz", [x])
        write_chunk(root, "2026-10-12", "093000-a.ndjson.gz", [y])
        write_chunk(root, "2026-10-12", "100500-a.ndjson.gz", [z])
        live_file = os.path.join(root, "live.ndjson.gz")
        with gzip.open(live_file, "wt") as handle:
            for item in (stale, y, z):
                handle.write(json.dumps(item) + "\n")

        output = run(root, live_file, hour=10)
        assert "today through 10:00: 2 chunks" in output, output

        con = duckdb.connect()
        con.execute(f"ATTACH '{root}/catalog/metro.duckdb' AS metro (READ_ONLY)")
        today = con.execute("SELECT bus_id FROM metro.fixes_today ORDER BY ALL").fetchall()
        assert today == [("x",), ("y",), ("z",)], today
        con.close()

        assert "today through" not in run(root, live_file, hour=10)


def test_an_empty_archive_still_gets_a_catalog():
    with tempfile.TemporaryDirectory() as root:
        today_file = os.path.join(root, "today.ndjson.gz")
        with gzip.open(today_file, "wt") as handle:
            handle.write("")
        run(root, today_file)
        con = duckdb.connect()
        con.execute(f"ATTACH '{root}/catalog/metro.duckdb' AS metro (READ_ONLY)")
        assert con.execute("SELECT count(*) FROM metro.fixes").fetchone()[0] == 0



def test_a_plain_path_is_found_only_when_the_file_exists():
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(f"{root}/a")
        open(f"{root}/a/b.parquet", "w").close()
        con = duckdb.connect()
        assert compact.files(con, f"{root}/a/b.parquet") == [f"{root}/a/b.parquet"]
        assert compact.files(con, f"{root}/a/missing.parquet") == []
        assert compact.files(con, f"{root}/missing/c.parquet") == []


def test_public_urls_get_a_version_and_local_paths_do_not():
    assert compact.cache_key("https://x/a.parquet", 5) == "https://x/a.parquet?v=5"
    assert compact.cache_key("/data/a.parquet", 5) == "/data/a.parquet"

if __name__ == "__main__":
    for name, test in list(globals().items()):
        if name.startswith("test_"):
            test()
            print("ok", name)
