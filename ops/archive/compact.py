"""Compacts the fleet archive's raw chunks into daily Parquet and rebuilds the DuckDB catalog.

Runs hourly. ARCHIVE_ROOT is `r2://<bucket>` in production or a local folder in tests.
"""

import datetime
import os
import re
import shutil
import sys
import tempfile
import urllib.request
from zoneinfo import ZoneInfo

import duckdb

from sigv4 import sign_put

COLOMBO = ZoneInfo("Asia/Colombo")

COLUMNS = {
    "bus_id": "VARCHAR",
    "registration": "VARCHAR",
    "route_id": "VARCHAR",
    "route_code": "VARCHAR",
    "direction_id": "VARCHAR",
    "lat": "DOUBLE",
    "lng": "DOUBLE",
    "heading": "DOUBLE",
    "passengers": "INTEGER",
    "capacity": "INTEGER",
    "reported_at": "BIGINT",
    "received_at": "BIGINT",
}
COLUMNS_SQL = "{" + ", ".join(f"'{k}': '{v}'" for k, v in COLUMNS.items()) + "}"
DERIVED = (
    "make_timestamp(coalesce(reported_at, received_at) * 1000) "
    "AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo' AS ts, "
    "CASE WHEN capacity > 0 THEN passengers / capacity END AS load"
)


def quote(text):
    return "'" + text.replace("'", "''") + "'"


def connect(root):
    con = duckdb.connect()
    if root.startswith("r2://"):
        con.execute("INSTALL httpfs; LOAD httpfs;")
        con.execute(
            "CREATE SECRET archive (TYPE R2, KEY_ID ?, SECRET ?, ACCOUNT_ID ?)",
            [
                os.environ["ARCHIVE_R2_ACCESS_KEY_ID"],
                os.environ["ARCHIVE_R2_SECRET_ACCESS_KEY"],
                os.environ["ARCHIVE_R2_ACCOUNT_ID"],
            ],
        )
    return con


def files(con, pattern):
    return [row[0] for row in con.execute(f"SELECT file FROM glob({quote(pattern)})").fetchall()]


def raw_days(con, root):
    days = set()
    for path in files(con, f"{root}/raw/*/*.ndjson.gz"):
        match = re.search(r"/raw/(\d{4}-\d{2}-\d{2})/", path)
        if match:
            days.add(match.group(1))
    return days


def parquet_days(con, root):
    days = set()
    for path in files(con, f"{root}/fixes/date=*/fixes.parquet"):
        match = re.search(r"date=(\d{4}-\d{2}-\d{2})", path)
        if match:
            days.add(match.group(1))
    return days


def compact_day(con, root, day):
    target = f"{root}/fixes/date={day}/fixes.parquet"
    if not root.startswith("r2://"):
        os.makedirs(os.path.dirname(target), exist_ok=True)
    con.execute(
        f"""
        COPY (
          SELECT * FROM read_json({quote(f"{root}/raw/{day}/*.ndjson.gz")},
                                  format = 'newline_delimited', columns = {COLUMNS_SQL})
          QUALIFY row_number() OVER (
            PARTITION BY bus_id, coalesce(reported_at, -received_at)
            ORDER BY received_at) = 1
          ORDER BY bus_id, coalesce(reported_at, received_at)
        ) TO {quote(target)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)
        """
    )
    written = con.execute(f"SELECT count(*) FROM read_parquet({quote(target)})").fetchone()[0]
    print(f"compacted {day}: {written} rows", flush=True)


def write_reference(con, root):
    routes = f"{root}/raw/reference/routes.json"
    stops = f"{root}/raw/reference/stops.json"
    if not files(con, routes) or not files(con, stops):
        return False
    if not root.startswith("r2://"):
        os.makedirs(f"{root}/reference", exist_ok=True)
    con.execute(
        f"""COPY (
          SELECT r.id AS route_id, r.code AS route_code, r.name, r.color_hex,
                 d.id AS direction_id, d.start_location, d.end_location
          FROM (SELECT unnest(json_transform(json, '[{{"id":"VARCHAR","code":"VARCHAR","name":"VARCHAR","color_hex":"VARCHAR","directions":[{{"id":"VARCHAR","start_location":"VARCHAR","end_location":"VARCHAR"}}]}}]')) AS r
                FROM read_json_objects({quote(routes)}, format = 'unstructured')),
               unnest(r.directions) AS t(d)
        ) TO {quote(f"{root}/reference/routes.parquet")} (FORMAT parquet, COMPRESSION zstd)"""
    )
    con.execute(
        f"""COPY (
          SELECT g.route_code, g.direction_id, s.ordinality AS stop_order,
                 s.stop.id AS stop_id, s.stop.stop_code AS stop_code,
                 s.stop.stop_name_en AS name, s.stop.latitude AS lat, s.stop.longitude AS lng
          FROM (SELECT unnest(json_transform(json, '[{{"route_code":"VARCHAR","direction_id":"VARCHAR","stops":[{{"id":"VARCHAR","stop_code":"VARCHAR","stop_name_en":"VARCHAR","latitude":"DOUBLE","longitude":"DOUBLE"}}]}}]')) AS g
                FROM read_json_objects({quote(stops)}, format = 'unstructured')),
               unnest(g.stops) WITH ORDINALITY AS s(stop, ordinality)
        ) TO {quote(f"{root}/reference/stops.parquet")} (FORMAT parquet, COMPRESSION zstd)"""
    )
    return True


def build_catalog(path, public_url, today_url, days, has_reference):
    if os.path.exists(path):
        os.remove(path)
    con = duckdb.connect(path)
    urls = [f"{public_url}/fixes/date={day}/fixes.parquet" for day in sorted(days)]
    empty = "SELECT " + ", ".join(f"NULL::{t} AS {k}" for k, t in COLUMNS.items()) + " WHERE false"
    source = (
        f"read_parquet([{', '.join(quote(u) for u in urls)}], hive_partitioning = false)"
        if urls
        else f"({empty})"
    )
    con.execute(f"CREATE VIEW fixes AS SELECT *, {DERIVED} FROM {source}")
    con.execute(
        f"""CREATE VIEW fixes_today AS SELECT *, {DERIVED}
            FROM read_json({quote(today_url)}, format = 'newline_delimited', columns = {COLUMNS_SQL})"""
    )
    con.execute("CREATE VIEW all_fixes AS SELECT * FROM fixes UNION ALL BY NAME SELECT * FROM fixes_today")
    if has_reference:
        con.execute(f"CREATE VIEW routes AS SELECT * FROM read_parquet({quote(public_url + '/reference/routes.parquet')})")
        con.execute(f"CREATE VIEW stops AS SELECT * FROM read_parquet({quote(public_url + '/reference/stops.parquet')})")
    con.execute(
        """CREATE VIEW load_by_route_hour AS
           SELECT route_code, hour(ts) AS hour, count(*) AS fixes,
                  avg(load) AS avg_load, max(load) AS max_load
           FROM fixes WHERE load IS NOT NULL GROUP BY ALL"""
    )
    con.execute(
        """CREATE VIEW buses_per_hour AS
           SELECT route_code, date_trunc('hour', ts) AS hour, count(DISTINCT bus_id) AS buses
           FROM fixes GROUP BY ALL"""
    )
    con.execute(
        """CREATE VIEW silences AS
           SELECT bus_id, registration, route_code, previous_ts AS silent_from, ts AS heard_again,
                  ts - previous_ts AS silent_for
           FROM (SELECT *, lag(ts) OVER (PARTITION BY bus_id ORDER BY ts) AS previous_ts FROM fixes)
           WHERE ts - previous_ts > INTERVAL 2 MINUTE"""
    )
    con.execute("CHECKPOINT")
    con.close()


def upload_catalog(root, path):
    if not root.startswith("r2://"):
        os.makedirs(f"{root}/catalog", exist_ok=True)
        shutil.copyfile(path, f"{root}/catalog/metro.duckdb")
        return
    bucket = root.removeprefix("r2://")
    url = f"https://{os.environ['ARCHIVE_R2_ACCOUNT_ID']}.r2.cloudflarestorage.com/{bucket}/catalog/metro.duckdb"
    with open(path, "rb") as handle:
        body = handle.read()
    headers = sign_put(
        url,
        body,
        "application/octet-stream",
        "public, max-age=300",
        os.environ["ARCHIVE_R2_ACCESS_KEY_ID"],
        os.environ["ARCHIVE_R2_SECRET_ACCESS_KEY"],
        datetime.datetime.now(datetime.timezone.utc),
    )
    request = urllib.request.Request(url, data=body, method="PUT", headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status >= 300:
            raise RuntimeError(f"catalog upload failed: HTTP {response.status}")


def main():
    root = os.environ.get("ARCHIVE_ROOT", "r2://metro-data").rstrip("/")
    public_url = os.environ.get("ARCHIVE_PUBLIC_URL", "https://data.metro.manasa.ai").rstrip("/")
    today_url = os.environ.get("ARCHIVE_TODAY_URL", "https://metro.manasa.ai/data/today.ndjson.gz")
    today = os.environ.get("ARCHIVE_TODAY") or datetime.datetime.now(COLOMBO).date().isoformat()
    con = connect(root)
    done = parquet_days(con, root)
    for day in sorted(raw_days(con, root) - done):
        if day < today:
            compact_day(con, root, day)
            done.add(day)
    has_reference = write_reference(con, root)
    with tempfile.TemporaryDirectory() as folder:
        catalog = os.path.join(folder, "metro.duckdb")
        build_catalog(catalog, public_url, today_url, done, has_reference)
        upload_catalog(root, catalog)
    print(f"catalog: {len(done)} days, reference={has_reference}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
