"""Compacts the fleet archive's raw chunks into daily Parquet and rebuilds the DuckDB catalog.

Runs hourly. ARCHIVE_ROOT is `r2://<bucket>` in production or a local folder in tests.
"""

import datetime
import os
import re
import shutil
import sys
import tempfile
import time
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
# Colombo wall-clock time without time-zone functions, which DuckDB in the browser lacks; Sri Lanka has no daylight saving.
COLOMBO_OFFSET_MS = 19_800_000
DERIVED = (
    f"make_timestamp((coalesce(reported_at, received_at) + {COLOMBO_OFFSET_MS}) * 1000) AS ts, "
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
    if any(c in pattern for c in "*?["):
        return [row[0] for row in con.execute(f"SELECT file FROM glob({quote(pattern)})").fetchall()]
    # On object storage glob() echoes a plain path back whether or not it exists, so a single file is found by listing its folder.
    folder = pattern.rsplit("/", 1)[0]
    return [path for path in files(con, f"{folder}/*") if path == pattern]


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


def compact_today(con, root, day, hour):
    """Writes today's chunks from before this hour to an immutable `through=HH` file, so the live file only needs the last hour or two."""
    if hour == 0:
        return None
    target = f"{root}/today/date={day}/through={hour:02d}.parquet"
    if files(con, target):
        return target
    cutoff = f"{hour:02d}0000"
    chunks = [
        path
        for path in files(con, f"{root}/raw/{day}/*.ndjson.gz")
        if os.path.basename(path)[:6] < cutoff
    ]
    if not chunks:
        return None
    if not root.startswith("r2://"):
        os.makedirs(os.path.dirname(target), exist_ok=True)
    con.execute(
        f"""
        COPY (
          SELECT * FROM read_json([{", ".join(quote(path) for path in chunks)}],
                                  format = 'newline_delimited', columns = {COLUMNS_SQL})
          ORDER BY bus_id, coalesce(reported_at, received_at)
        ) TO {quote(target)} (FORMAT parquet, COMPRESSION zstd)
        """
    )
    print(f"today through {hour:02d}:00: {len(chunks)} chunks", flush=True)
    return target


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


def cache_key(url, version):
    """The edge keeps .parquet responses, 404s included, so each URL gets a version that hasn't been asked for before it existed."""
    return f"{url}?v={version}" if url.startswith(("http://", "https://")) else url


def build_catalog(path, public_url, live_url, today_file, today_start_ms, days, has_reference):
    built = int(time.time() * 1000)
    if os.path.exists(path):
        os.remove(path)
    con = duckdb.connect(path)
    if has_reference:
        con.execute(f"CREATE VIEW routes AS SELECT * FROM read_parquet({quote(cache_key(public_url + '/reference/routes.parquet', built))})")
        con.execute(f"CREATE VIEW stops AS SELECT * FROM read_parquet({quote(cache_key(public_url + '/reference/stops.parquet', built))})")

    # Live fixes name the route by id only, so the code is filled in from the route list.
    def with_route_codes(select):
        if not has_reference:
            return select
        return (
            "SELECT f.* REPLACE (coalesce(f.route_code, codes.route_code) AS route_code) "
            f"FROM ({select}) f LEFT JOIN (SELECT DISTINCT route_id, route_code FROM routes) codes "
            "ON f.route_id = codes.route_id"
        )

    urls = [cache_key(f"{public_url}/fixes/date={day}/fixes.parquet", 1) for day in sorted(days)]
    empty = "SELECT " + ", ".join(f"NULL::{t} AS {k}" for k, t in COLUMNS.items()) + " WHERE false"
    source = (
        f"read_parquet([{', '.join(quote(u) for u in urls)}], hive_partitioning = false)"
        if urls
        else f"({empty})"
    )
    con.execute(f"CREATE VIEW fixes AS {with_route_codes(f'SELECT *, {DERIVED} FROM {source}')}")
    live = f"SELECT * FROM read_json({quote(live_url)}, format = 'newline_delimited', columns = {COLUMNS_SQL})"
    sources = (
        f"SELECT * FROM read_parquet({quote(cache_key(today_file, built))}, hive_partitioning = false) UNION ALL BY NAME {live}"
        if today_file
        else live
    )
    # The live file overlaps the hourly file by up to an hour, so repeats are dropped here.
    con.execute(
        "CREATE VIEW fixes_today AS "
        + with_route_codes(
            f"""SELECT *, {DERIVED}
            FROM ({sources})
            WHERE received_at >= {today_start_ms}
            QUALIFY row_number() OVER (
              PARTITION BY bus_id, coalesce(reported_at, -received_at) ORDER BY received_at) = 1"""
        )
    )
    con.execute("CREATE VIEW all_fixes AS SELECT * FROM fixes UNION ALL BY NAME SELECT * FROM fixes_today")
    con.execute(
        """CREATE VIEW load_by_route_hour AS
           SELECT route_code, hour(ts) AS hour, count(*) AS fixes,
                  avg(load) AS avg_load, max(load) AS max_load
           FROM all_fixes WHERE load IS NOT NULL GROUP BY ALL"""
    )
    con.execute(
        """CREATE VIEW bus_hours AS
           SELECT route_code, date_trunc('hour', ts) AS hour, bus_id, registration, count(*) AS fixes,
                  round(111320 * sqrt(pow(max(lat) - min(lat), 2)
                    + pow((max(lng) - min(lng)) * cos(radians(avg(lat))), 2))) AS spread_m,
                  avg(load) AS avg_load, max(load) AS max_load
           FROM all_fixes GROUP BY ALL"""
    )
    # Parked buses keep reporting all night; anyone who wants a different cutoff can count bus_hours themselves.
    con.execute(
        """CREATE VIEW buses_per_hour AS
           SELECT route_code, hour, count(*) AS buses, count(*) FILTER (WHERE spread_m > 200) AS moving_buses
           FROM bus_hours GROUP BY ALL"""
    )
    con.execute(
        """CREATE VIEW silences AS
           SELECT bus_id, registration, route_code, previous_ts AS silent_from, ts AS heard_again,
                  ts - previous_ts AS silent_for
           FROM (SELECT *, lag(ts) OVER (PARTITION BY bus_id ORDER BY ts) AS previous_ts FROM all_fixes)
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
    live_url = os.environ.get("ARCHIVE_LIVE_URL", f"{public_url}/today/live.ndjson.gz")
    now = datetime.datetime.now(COLOMBO)
    today = os.environ.get("ARCHIVE_TODAY") or now.date().isoformat()
    hour = int(os.environ.get("ARCHIVE_HOUR", now.hour))
    today_start_ms = int(
        datetime.datetime.fromisoformat(today).replace(tzinfo=COLOMBO).timestamp() * 1000
    )
    con = connect(root)
    done = parquet_days(con, root)
    for day in sorted(raw_days(con, root) - done):
        if day < today:
            compact_day(con, root, day)
            done.add(day)
    today_target = compact_today(con, root, today, hour)
    today_file = today_target and today_target.replace(root, public_url, 1)
    has_reference = write_reference(con, root)
    with tempfile.TemporaryDirectory() as folder:
        catalog = os.path.join(folder, "metro.duckdb")
        build_catalog(catalog, public_url, live_url, today_file, today_start_ms, done, has_reference)
        upload_catalog(root, catalog)
    print(f"catalog: {len(done)} days, reference={has_reference}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
