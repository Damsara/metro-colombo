import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DOCS_MAIN, DOCS_TITLE, HEADER_LINK } from "./classNames";
import { AppHeader } from "./components/AppHeader";
import { Eyebrow } from "./components/ui/Eyebrow";

const DATA_HOST = "https://data.metro.manasa.ai";
const BROWSER_CATALOG = `${DATA_HOST}/catalog/metro.duckdb`;

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
            Open the{" "}
            <a
              className={HEADER_LINK}
              href="https://shell.duckdb.org"
              target="_blank"
              rel="noreferrer"
            >
              DuckDB web shell
            </a>{" "}
            and paste:
          </p>
          <pre tabIndex={0}>{`ATTACH '${BROWSER_CATALOG}' AS metro;
USE metro;
SELECT count(*) AS positions, count(DISTINCT bus_id) AS buses
FROM fixes_today;`}</pre>
          <p>
            Browsers attach the catalog by its own address rather than this
            site's, because a browser can't tell the site it is DuckDB. It runs
            entirely on your machine, with the same tables.
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
          <p>Where every bus is right now:</p>
          <pre
            tabIndex={0}
          >{`SELECT registration, route_code, lat, lng, ts, load
FROM metro.fixes_today
QUALIFY row_number() OVER (PARTITION BY bus_id ORDER BY ts DESC) = 1;`}</pre>
          <p>The most crowded routes and hours:</p>
          <pre
            tabIndex={0}
          >{`SELECT route_code, hour, round(avg_load, 2) AS avg_load
FROM metro.load_by_route_hour
ORDER BY avg_load DESC
LIMIT 10;`}</pre>
          <p>Buses that went quiet the longest:</p>
          <pre
            tabIndex={0}
          >{`SELECT registration, route_code, silent_from, silent_for
FROM metro.silences
ORDER BY silent_for DESC
LIMIT 10;`}</pre>
          <p>Take a route's history with you:</p>
          <pre
            tabIndex={0}
          >{`COPY (SELECT * FROM metro.all_fixes WHERE route_code = 'CM01')
TO 'cm01.parquet';`}</pre>
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
