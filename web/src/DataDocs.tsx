import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DOCS_MAIN, DOCS_TITLE, HEADER_LINK } from "./classNames";
import { AppHeader } from "./components/AppHeader";
import { Eyebrow } from "./components/ui/Eyebrow";
import { duckdbShellLink } from "./lib/duckdbShell";
import type { ChartKind } from "./components/archive/ExampleChart";

// DuckDB in the browser is several megabytes, so it loads only with this page.
const OverviewCharts = lazy(
  () => import("./components/archive/OverviewCharts"),
);
const ExampleChart = lazy(() => import("./components/archive/ExampleChart"));

const DATA_HOST = "https://data.metro.manasa.ai";
const BROWSER_CATALOG = `${DATA_HOST}/catalog/metro.duckdb`;

const SHELL_SETUP = [`ATTACH '${BROWSER_CATALOG}' AS metro;`, "USE metro;"];

type Example = {
  title: string;
  about?: string;
  sql: string;
  chart?: ChartKind;
};

const SUBHEADING = "mt-7 mb-2 text-lg leading-snug font-semibold";
const CARD_TITLE = "mb-1 text-lg leading-snug font-semibold";

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 rounded-xl border border-line bg-card p-4 shadow-card max-md:p-3.5 [&_p:last-child]:mb-0 [&_pre:last-child]:mb-0">
      {children}
    </div>
  );
}

function Query({ title, about, sql, chart }: Example) {
  return (
    <Card>
      <h3 className={CARD_TITLE}>{title}</h3>
      {about && <p className="text-muted">{about}</p>}
      <Suspense fallback={null}>
        <ExampleChart
          kind={chart ?? "table"}
          catalogUrl={BROWSER_CATALOG}
          sql={sql}
        />
      </Suspense>
      <details className="group mt-2">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
            ›
          </span>
          Show the query
          <a
            className={`${HEADER_LINK} ml-auto text-sm`}
            href={duckdbShellLink([...SHELL_SETUP, sql])}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            Run in the DuckDB shell ↗
          </a>
        </summary>
        <pre tabIndex={0} className="mt-2">
          {sql}
        </pre>
      </details>
    </Card>
  );
}

function Glossary({ entries }: { entries: [string, string][] }) {
  return (
    <dl className="mb-3 grid grid-cols-[minmax(0,auto)_1fr] gap-x-5 gap-y-2.5 max-md:grid-cols-1 max-md:gap-y-0.5">
      {entries.map(([name, about]) => (
        <div key={name} className="contents">
          <dt className="max-md:mt-2.5">
            <code>{name}</code>
          </dt>
          <dd className="text-ink">{about}</dd>
        </div>
      ))}
    </dl>
  );
}

const BASICS: Example[] = [
  {
    title: "Where every bus is right now",
    about:
      "Every bus heard from in the last ten minutes, at its latest position.",
    sql: `SELECT registration, route_code, lat, lng, ts, load
FROM fixes_today
WHERE ts > (SELECT max(ts) FROM fixes_today) - INTERVAL 10 MINUTE
QUALIFY row_number() OVER (PARTITION BY bus_id ORDER BY ts DESC) = 1;`,
  },
  {
    title: "The most crowded routes and hours",
    about:
      "The route and hour of day when buses are fullest on average, across the whole archive.",
    sql: `SELECT route_code, hour, round(avg_load, 2) AS avg_load
FROM load_by_route_hour
ORDER BY avg_load DESC
LIMIT 10;`,
  },
  {
    title: "Buses actually running each hour",
    about:
      "Buses sit at depots and terminals with their trackers on, so count only those that got around. Change 1000 to whatever counts as running for you.",
    sql: `SELECT hour, route_code, count(*) AS reporting,
       count(*) FILTER (WHERE spread_m > 1000) AS running
FROM bus_hours
GROUP BY ALL
ORDER BY hour DESC, route_code;`,
  },
  {
    title: "Buses that went quiet the longest",
    chart: "silences",
    about:
      "Gaps in the daytime, leaving out the nights when buses are switched off.",
    sql: `SELECT registration, route_code, silent_from, silent_for
FROM silences
WHERE hour(silent_from) BETWEEN 5 AND 21
  AND heard_again::DATE = silent_from::DATE
ORDER BY silent_for DESC
LIMIT 10;`,
  },
];

const UNDERRATED: Example[] = [
  {
    title: "Bus bunching",
    chart: "bunching",
    about:
      "Two buses on the same route and direction within 300 m of each other: the reason you wait 20 minutes and then two arrive at once. Buses waiting together at the end of a route show up too.",
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
    chart: "gaps",
    about:
      "When buses on every route that serves a stop actually passed it, and how long people waited between them. Pick a stop here, or change MCC5 in the query to any stop_code.",
    sql: `WITH stop AS (
  SELECT direction_id, lat, lng FROM stops WHERE stop_code = 'MCC5'
), near AS (
  SELECT f.bus_id, f.registration, f.route_code, f.ts
  FROM all_fixes f JOIN stop s USING (direction_id)
  WHERE 111320 * sqrt(pow(f.lat - s.lat, 2)
    + pow((f.lng - s.lng) * cos(radians(s.lat)), 2)) < 80
), passes AS (
  SELECT registration, route_code, ts AS passed_at
  FROM near
  QUALIFY coalesce(ts - lag(ts) OVER (PARTITION BY bus_id ORDER BY ts)
    > INTERVAL 10 MINUTE, true)
)
SELECT passed_at, registration, route_code,
       passed_at - lag(passed_at)
         OVER (PARTITION BY passed_at::DATE ORDER BY passed_at) AS waited
FROM passes
ORDER BY passed_at DESC;`,
  },
  {
    title: "Where the buses sleep",
    chart: "sleep",
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
    chart: "slow",
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
    chart: "spans",
    about:
      "The first and last time a bus was seen moving on each route, on the latest finished day. Buses parked overnight keep reporting, so standing still doesn't count.",
    sql: `WITH steps AS (
  SELECT route_code, bus_id, ts,
         111320 * sqrt(pow(lat - lag(lat) OVER w, 2)
           + pow((lng - lag(lng) OVER w) * cos(radians(lat)), 2)) AS metres
  FROM fixes
  WHERE ts::DATE = (SELECT max(ts)::DATE FROM fixes)
  WINDOW w AS (PARTITION BY bus_id ORDER BY ts)
)
SELECT route_code,
       strftime(min(ts), '%H:%M') AS first_bus,
       strftime(max(ts), '%H:%M') AS last_bus,
       count(DISTINCT bus_id) AS buses
FROM steps
WHERE metres > 20
GROUP BY ALL
ORDER BY route_code;`,
  },
  {
    title: "Buses that change routes",
    chart: "swaps",
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
    chart: "lag",
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
      className="mt-12 scroll-mt-6 border-t border-line pt-3"
      id={title
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .replace(/^-|-$/g, "")}
    >
      <h2 className="mt-5 mb-3 text-2xl leading-tight font-semibold tracking-tight max-md:text-xl">
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
  [
    "bus_hours",
    "One row per bus per hour: how many reports it sent, how far apart its positions were in metres (spread_m) and its load. Parked buses keep reporting, so spread_m is how to tell them apart.",
  ],
  [
    "buses_per_hour",
    "How many buses reported on each route in each hour, and how many moved more than 200 m. Count bus_hours yourself for a different cutoff.",
  ],
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
  [
    "load",
    "passengers ÷ capacity. Above 1 when a bus reports more riders than its capacity.",
  ],
  ["reported_at", "When the bus sent the position (milliseconds since 1970)."],
  ["received_at", "When this server received it (milliseconds since 1970)."],
  ["ts", "reported_at as a Colombo date and time."],
];

export default function DataDocs() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Metro data: every bus position for DuckDB";
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
          Every position Lanka Metro buses report, about every five seconds,
          kept since 12 October 2026. Query it with DuckDB on your computer or
          in your browser: no account, no key, nothing to download first.
        </p>
        <p className="text-muted">
          It holds bus positions and the load counts buses report, nothing about
          passengers. Prefer plain HTTP calls? See the{" "}
          <Link className={HEADER_LINK} to="/docs">
            API
          </Link>
          .
        </p>
        <nav
          aria-label="On this page"
          className="mt-5 flex flex-wrap gap-2 text-sm"
        >
          {[
            ["at-a-glance", "At a glance"],
            ["get-started", "Get started"],
            ["things-to-try", "Things to try"],
            ["underrated-things-to-do-with-it", "Underrated uses"],
            ["reference", "Tables and columns"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border border-line bg-card px-3 py-1.5 font-semibold text-ink hover-fine:bg-tint-50"
            >
              {label}
            </a>
          ))}
        </nav>

        <Section title="At a glance">
          <p className="text-muted">
            Live from the archive: DuckDB runs these in your browser, so they're
            as fresh as the data.
          </p>
          <Card>
            <Suspense fallback={<p role="status">Loading the charts…</p>}>
              <OverviewCharts
                catalogUrl={BROWSER_CATALOG}
                shellSetup={SHELL_SETUP}
              />
            </Suspense>
          </Card>
        </Section>

        <Section title="Get started">
          <h3 className={SUBHEADING}>In your browser</h3>
          <p>
            Nothing to install.{" "}
            <a
              className={HEADER_LINK}
              href={duckdbShellLink([...SHELL_SETUP, "SHOW TABLES;"])}
              target="_blank"
              rel="noreferrer"
            >
              Open the DuckDB web shell with the archive attached
            </a>
            , or paste this into{" "}
            <a
              className={HEADER_LINK}
              href="https://shell.duckdb.org"
              target="_blank"
              rel="noreferrer"
            >
              shell.duckdb.org
            </a>
            :
          </p>
          <pre tabIndex={0}>{SHELL_SETUP.join("\n")}</pre>
          <p className="text-sm text-muted">
            Browsers attach the catalog by its own address, because a browser
            can't tell this site it is DuckDB. Everything runs on your machine.
          </p>

          <h3 className={SUBHEADING}>On your computer</h3>
          <p>Install the DuckDB command line once:</p>
          <pre tabIndex={0}>{`brew install duckdb                    # macOS
curl https://install.duckdb.org | sh   # macOS or Linux
winget install DuckDB.cli              # Windows`}</pre>
          <p>Then attach this site, keeping the trailing slash:</p>
          <pre tabIndex={0}>{`duckdb
ATTACH '${site}' AS metro;
USE metro;
SHOW TABLES;`}</pre>
          <p className="text-sm text-muted">
            Attaching reads a small catalog. Queries then fetch only the columns
            and parts of the Parquet files they need, never the whole archive.
          </p>

          <h3 className={SUBHEADING}>Python, R and notebooks</h3>
          <pre tabIndex={0}>{`import duckdb  # pip install duckdb
con = duckdb.connect()
con.sql("ATTACH '${site}' AS metro")
df = con.sql("SELECT * FROM metro.fixes_today").df()`}</pre>
          <p>
            Each finished day is also a plain Parquet file that Polars, pandas,
            Spark or R can read directly:
          </p>
          <pre tabIndex={0}>{`import polars as pl
pl.read_parquet("${DATA_HOST}/fixes/date=2026-10-12/fixes.parquet")`}</pre>
        </Section>

        <Section title="Things to try">
          <p className="text-muted">
            Each query assumes <code>USE metro;</code> after attaching. Open any
            of them in the shell to change it.
          </p>
          {BASICS.map((query) => (
            <Query key={query.title} {...query} />
          ))}
          <Card>
            <h3 className={CARD_TITLE}>Take a route's history with you</h3>
            <p className="text-muted">
              Save everything about one route to a Parquet file on your
              computer.
            </p>
            <pre
              tabIndex={0}
            >{`COPY (SELECT * FROM all_fixes WHERE route_code = 'CM01')
TO 'cm01.parquet';`}</pre>
          </Card>
        </Section>

        <Section title="Underrated things to do with it">
          <p className="text-muted">
            A position every few seconds from every bus answers questions a
            timetable can't. Distances use a flat-earth approximation that's
            accurate to a few metres across Colombo.
          </p>
          {UNDERRATED.map((query) => (
            <Query key={query.title} {...query} />
          ))}
          <h3 className={SUBHEADING}>More ideas</h3>
          <ul className="list-disc">
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
              Trace the roads the buses really use, including detours from the
              drawn route line.
            </li>
          </ul>
        </Section>

        <Section title="Reference">
          <h3 className={SUBHEADING}>Tables</h3>
          <Glossary entries={TABLES} />
          <h3 className={SUBHEADING}>Columns</h3>
          <p>
            <code>fixes</code>, <code>fixes_today</code> and{" "}
            <code>all_fixes</code> share these:
          </p>
          <Glossary entries={COLUMNS} />
        </Section>

        <Section title="How fresh, and where it lives">
          <ul className="list-disc">
            <li>
              Positions are written out every five minutes, so{" "}
              <code>fixes_today</code> is at most about five minutes behind.
            </li>
            <li>
              Finished days become one zstd-compressed Parquet file each, sorted
              by bus and time, and never change afterwards.
            </li>
            <li>
              Everything is served from Cloudflare's edge at{" "}
              <code>{DATA_HOST}</code>, readable from any site.
            </li>
            <li>
              Positions are corrected for a known upstream fault that puts some
              fixes a degree north and east of Colombo. Times are Colombo time.
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
