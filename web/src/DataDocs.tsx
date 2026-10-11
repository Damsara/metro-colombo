import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DOCS_MAIN, DOCS_TITLE, HEADER_LINK } from "./classNames";
import { AppHeader } from "./components/AppHeader";
import { Eyebrow } from "./components/ui/Eyebrow";
import { duckdbShellLink } from "./lib/duckdbShell";

const DATA_HOST = "https://data.metro.manasa.ai";
const BROWSER_CATALOG = `${DATA_HOST}/catalog/metro.duckdb`;

const SHELL_SETUP = [`ATTACH '${BROWSER_CATALOG}' AS metro;`, "USE metro;"];

type Example = { title: string; about?: string; sql: string };

function Query({ title, about, sql }: Example) {
  return (
    <div className="mt-6">
      <h3 className="mb-1.5 text-md font-semibold">{title}</h3>
      {about && <p>{about}</p>}
      <pre tabIndex={0}>{sql}</pre>
      <p>
        <a
          className={HEADER_LINK}
          href={duckdbShellLink([...SHELL_SETUP, sql])}
          target="_blank"
          rel="noreferrer"
        >
          Run in the DuckDB shell
        </a>
      </p>
    </div>
  );
}

const BASICS: Example[] = [
  {
    title: "Where every bus is right now",
    sql: `SELECT registration, route_code, lat, lng, ts, load
FROM fixes_today
QUALIFY row_number() OVER (PARTITION BY bus_id ORDER BY ts DESC) = 1;`,
  },
  {
    title: "The most crowded routes and hours",
    sql: `SELECT route_code, hour, round(avg_load, 2) AS avg_load
FROM load_by_route_hour
ORDER BY avg_load DESC
LIMIT 10;`,
  },
  {
    title: "Buses that went quiet the longest",
    sql: `SELECT registration, route_code, silent_from, silent_for
FROM silences
ORDER BY silent_for DESC
LIMIT 10;`,
  },
];

const UNDERRATED: Example[] = [
  {
    title: "Bus bunching",
    about:
      "Two buses on the same route and direction within 300 m of each other: the reason you wait 20 minutes and then two arrive at once.",
    sql: `WITH f AS (
  SELECT bus_id, registration, route_code, direction_id, lat, lng,
         time_bucket(INTERVAL 1 MINUTE, ts) AS minute
  FROM all_fixes
  WHERE hour(ts) BETWEEN 5 AND 22
  QUALIFY row_number() OVER (PARTITION BY bus_id, minute ORDER BY ts) = 1
)
SELECT a.minute, a.route_code, a.registration AS bus, b.registration AS other_bus,
       round(111320 * sqrt(pow(a.lat - b.lat, 2)
         + pow((a.lng - b.lng) * cos(radians(a.lat)), 2))) AS metres
FROM f a JOIN f b
  ON a.route_code = b.route_code AND a.direction_id = b.direction_id
 AND a.minute = b.minute AND a.bus_id < b.bus_id
WHERE metres < 300
ORDER BY a.minute DESC
LIMIT 20;`,
  },
  {
    title: "Real gaps between buses at your stop",
    about:
      "When buses actually passed a stop and how long people waited between them. Change MCC5 to any stop_code from the stops table.",
    sql: `WITH stop AS (
  SELECT lat, lng, direction_id FROM stops WHERE stop_code = 'MCC5' LIMIT 1
), passes AS (
  SELECT f.registration, min(f.ts) AS passed_at
  FROM all_fixes f, stop s
  WHERE f.direction_id = s.direction_id
    AND 111320 * sqrt(pow(f.lat - s.lat, 2)
      + pow((f.lng - s.lng) * cos(radians(s.lat)), 2)) < 80
  GROUP BY f.registration, time_bucket(INTERVAL 10 MINUTE, f.ts)
)
SELECT passed_at, registration,
       passed_at - lag(passed_at) OVER (ORDER BY passed_at) AS waited
FROM passes
ORDER BY passed_at DESC;`,
  },
  {
    title: "Where the buses sleep",
    about:
      "Positions between midnight and 5 am reveal the depots, without anyone publishing where they are.",
    sql: `SELECT round(lat, 3) AS lat, round(lng, 3) AS lng,
       count(DISTINCT bus_id) AS buses
FROM all_fixes
WHERE hour(ts) < 5
GROUP BY ALL
ORDER BY buses DESC
LIMIT 10;`,
  },
  {
    title: "The slowest streets, by hour",
    about:
      "Speed between consecutive reports, grouped into blocks about 100 m across. The slowest blocks are congestion, junctions and bus stands.",
    sql: `WITH steps AS (
  SELECT lat, lng, hour(ts) AS hour,
         111320 * sqrt(pow(lat - lag(lat) OVER w, 2)
           + pow((lng - lag(lng) OVER w) * cos(radians(lat)), 2))
           / nullif(epoch(ts - lag(ts) OVER w), 0) * 3.6 AS kmh
  FROM all_fixes
  WINDOW w AS (PARTITION BY bus_id ORDER BY ts)
)
SELECT round(lat, 3) AS lat, round(lng, 3) AS lng, hour,
       round(median(kmh), 1) AS median_kmh, count(*) AS samples
FROM steps
WHERE kmh BETWEEN 0 AND 90 AND hour BETWEEN 5 AND 22
GROUP BY ALL
HAVING samples > 20
ORDER BY median_kmh
LIMIT 20;`,
  },
  {
    title: "When each route really starts and stops",
    about: "The first and last bus seen on each route on the latest day.",
    sql: `SELECT route_code,
       strftime(min(ts), '%H:%M') AS first_bus,
       strftime(max(ts), '%H:%M') AS last_bus,
       count(DISTINCT bus_id) AS buses
FROM all_fixes
WHERE ts::DATE = (SELECT max(ts)::DATE FROM all_fixes)
GROUP BY ALL
ORDER BY route_code;`,
  },
  {
    title: "Buses that change routes",
    about:
      "Which vehicles worked more than one route in a day, showing how the fleet is shared across the network.",
    sql: `SELECT ts::DATE AS day, registration, list(DISTINCT route_code) AS routes
FROM all_fixes
WHERE route_code IS NOT NULL
GROUP BY ALL
HAVING count(DISTINCT route_code) > 1
ORDER BY day DESC;`,
  },
  {
    title: "How live is live?",
    about:
      "The delay between a bus sending its position and this site receiving it.",
    sql: `SELECT quantile_cont((received_at - reported_at) / 1000, [0.5, 0.9, 0.99])
         AS lag_seconds
FROM fixes_today
WHERE reported_at IS NOT NULL;`,
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="mt-9 border-t border-line pt-2"
      id={title
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .replace(/^-|-$/g, "")}
    >
      <h2 className="mt-4.5 mb-3 text-lg leading-snug font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const TABLES: [string, string][] = [
  ["fixes", "Every position from finished days, one Parquet file per day."],
  ["fixes_today", "Today so far, at most about five minutes old."],
  ["all_fixes", "Both together: the whole history up to a few minutes ago."],
  ["routes", "Route codes, names, colours and directions."],
  ["stops", "Every stop on every route and direction, in order."],
  ["load_by_route_hour", "Average and peak load by route and hour of day."],
  ["buses_per_hour", "How many buses each route ran in each hour."],
  ["silences", "Gaps of more than two minutes in a bus's reports."],
];

const COLUMNS: [string, string][] = [
  ["bus_id", "Lanka Metro's id for the vehicle."],
  ["registration", "Number plate, for example WP-NE-6566."],
  ["route_id, route_code", "The route the bus is running, for example CM06."],
  ["direction_id", "Which direction of that route; see routes."],
  ["lat, lng", "Position in degrees."],
  ["heading", "Degrees clockwise from north, when the bus reports it."],
  ["passengers, capacity", "Load the bus reports, and its total capacity."],
  ["load", "passengers ÷ capacity, from 0 to 1."],
  ["reported_at", "When the bus sent the position (milliseconds since 1970)."],
  ["received_at", "When this server received it (milliseconds since 1970)."],
  ["ts", "reported_at as a Colombo date and time."],
];

export default function DataDocs() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Metro data — every bus position for DuckDB";
    return () => {
      document.title = previous;
    };
  }, []);

  const site = `${window.location.origin}/`;

  return (
    <div className="min-h-dvh bg-paper">
      <AppHeader homeLabel="Metro home" suffix="Data">
        <Link className={HEADER_LINK} to="/">
          Back to the map
        </Link>
      </AppHeader>
      <main className={DOCS_MAIN}>
        <Eyebrow>FLEET ARCHIVE</Eyebrow>
        <h1 className={DOCS_TITLE}>Every bus position, as a database</h1>
        <p className="text-xl max-md:text-lg">
          Each position Lanka Metro buses report, about every five seconds per
          bus, recorded since 12 October 2026. Query it with DuckDB from your
          computer or your browser. No account, no key, no download first.
        </p>
        <p>
          The data is bus positions and the load counts buses report. It holds
          nothing about passengers. Prefer plain HTTP calls? See the{" "}
          <Link className={HEADER_LINK} to="/docs">
            API
          </Link>
          .
        </p>

        <Section title="On your computer">
          <p>Install the DuckDB command line once (macOS, Linux or Windows):</p>
          <pre tabIndex={0}>{`# macOS
brew install duckdb

# macOS or Linux
curl https://install.duckdb.org | sh

# Windows
winget install DuckDB.cli`}</pre>
          <p>Then start it and attach this site:</p>
          <pre tabIndex={0}>{`duckdb
ATTACH '${site}' AS metro;
USE metro;
SHOW TABLES;`}</pre>
          <p>
            Keep the trailing <code>/</code>. Attaching reads a small catalog of
            views; queries then fetch only the parts of the Parquet files they
            need, so a question about one day downloads kilobytes, not the
            archive.
          </p>
        </Section>

        <Section title="In your browser">
          <p>
            Nothing to install:{" "}
            <a
              className={HEADER_LINK}
              href={duckdbShellLink([...SHELL_SETUP, "SHOW TABLES;"])}
              target="_blank"
              rel="noreferrer"
            >
              open the DuckDB web shell with the archive attached
            </a>
            . Or open{" "}
            <a
              className={HEADER_LINK}
              href="https://shell.duckdb.org"
              target="_blank"
              rel="noreferrer"
            >
              shell.duckdb.org
            </a>{" "}
            and paste:
          </p>
          <pre tabIndex={0}>{SHELL_SETUP.join("\n")}</pre>
          <p>
            Browsers attach the catalog by its own address rather than this
            site's, because a browser can't tell the site it is DuckDB. It runs
            entirely on your machine, with the same tables. Every query below
            has a link that opens it in the shell, ready to run.
          </p>
        </Section>

        <Section title="Python, R and notebooks">
          <pre tabIndex={0}>{`pip install duckdb

import duckdb
con = duckdb.connect()
con.sql("ATTACH '${site}' AS metro")
df = con.sql("SELECT * FROM metro.fixes_today").df()`}</pre>
          <p>
            Each finished day is also a plain Parquet file that Polars, pandas,
            Spark or R read directly:
          </p>
          <pre tabIndex={0}>{`import polars as pl
pl.read_parquet("${DATA_HOST}/fixes/date=2026-10-13/fixes.parquet")`}</pre>
        </Section>

        <Section title="Tables">
          <ul>
            {TABLES.map(([name, about]) => (
              <li key={name}>
                <code>{name}</code>: {about}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Columns">
          <p>
            <code>fixes</code>, <code>fixes_today</code> and{" "}
            <code>all_fixes</code> share these columns:
          </p>
          <ul>
            {COLUMNS.map(([name, about]) => (
              <li key={name}>
                <code>{name}</code>: {about}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Things to try">
          <p>
            These assume <code>USE metro;</code> after attaching.
          </p>
          {BASICS.map((query) => (
            <Query key={query.title} {...query} />
          ))}
          <p>Take a route's history with you, on your computer:</p>
          <pre
            tabIndex={0}
          >{`COPY (SELECT * FROM all_fixes WHERE route_code = 'CM01')
TO 'cm01.parquet';`}</pre>
        </Section>

        <Section title="Underrated things to do with it">
          <p>
            A position every few seconds from every bus answers questions a
            timetable can't. Distances use a flat-earth approximation that is
            accurate to a few metres across Colombo.
          </p>
          {UNDERRATED.map((query) => (
            <Query key={query.title} {...query} />
          ))}
          <p>A few more ideas:</p>
          <ul>
            <li>
              Compare the timetable from the{" "}
              <Link className={HEADER_LINK} to="/docs">
                journey API
              </Link>{" "}
              with when buses actually reach a stop, and find the trips that run
              late every day.
            </li>
            <li>
              Find where buses stand still mid-route at the same place every
              day: unofficial stops, long signals or a hidden bottleneck.
            </li>
            <li>
              Watch how crowding on a route changes on poya days, school
              holidays and rainy afternoons.
            </li>
            <li>
              Trace the road network the buses really use, including detours
              that differ from the drawn route line.
            </li>
          </ul>
        </Section>

        <Section title="How fresh, and where it lives">
          <ul>
            <li>
              Positions are recorded as they arrive and written out every five
              minutes, so <code>fixes_today</code> is at most about five minutes
              behind.
            </li>
            <li>
              Finished days are compacted into one zstd-compressed Parquet file
              each, sorted by bus and time, and never change afterwards.
            </li>
            <li>
              Everything is served from Cloudflare's edge at{" "}
              <code>{DATA_HOST}</code>, which allows browser access from any
              site.
            </li>
            <li>
              Positions are already corrected for a known upstream fault that
              puts some fixes a degree north and east of Colombo. Times are
              Colombo time.
            </li>
            <li>
              This is an unofficial archive of Lanka Metro's live feed, not
              affiliated with Lanka Metro Transit.
            </li>
          </ul>
        </Section>
      </main>
    </div>
  );
}
