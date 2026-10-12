import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRoutes } from "../../api";
import {
  chartView,
  forStop,
  routeScale,
  withoutLimit,
} from "../../lib/archiveCharts";
import { palette } from "../../theme";
import { cellKind, formatCell } from "../../lib/resultCells";
import {
  openArchive,
  resultTable,
  rows,
  type ArchiveDb,
  type ResultTable,
} from "./archiveDb";
import { PointsMap, type MapPoint } from "./PointsMap";
import { WhenVisible } from "./WhenVisible";

export type ChartKind =
  | "silences"
  | "bunching"
  | "gaps"
  | "sleep"
  | "slow"
  | "spans"
  | "swaps"
  | "lag"
  | "table";

type Api = ArchiveDb["api"];
type ViewState = "loading" | "empty" | "ready" | "failed";

const NOTE = "text-sm text-muted";

// DuckDB hands lists back as arrays, typed arrays or Arrow vectors depending on their type.
const listOf = <T,>(value: unknown): T[] => Array.from(value as ArrayLike<T>);

function useView(catalogUrl: string, name: string, statement: string) {
  const [db, setDb] = useState<ArchiveDb | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    openArchive(catalogUrl)
      .then(async (opened) => {
        await opened.coordinator.exec(statement);
        const [{ n }] = await rows<{ n: number }>(
          opened,
          `SELECT count(*)::INT AS n FROM ${name}`,
        );
        if (cancelled) return;
        setDb(opened);
        setState(n > 0 ? "ready" : "empty");
        setVersion((value) => value + 1);
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [catalogUrl, name, statement]);
  return { db, state, version };
}

function useRouteColors() {
  const routes = useRoutes();
  return useMemo(() => routeScale(routes.data ?? []), [routes.data]);
}

function Status({
  state,
  empty,
  children,
}: {
  state: ViewState;
  empty: string;
  children: ReactNode;
}) {
  if (state === "loading")
    return (
      <p className={NOTE} role="status">
        Running the query in your browser…
      </p>
    );
  if (state === "failed")
    return (
      <p className={NOTE} role="status">
        This chart couldn't load here. The query still works in the DuckDB
        shell.
      </p>
    );
  if (state === "empty")
    return (
      <p className={NOTE} role="status">
        {empty}
      </p>
    );
  return <>{children}</>;
}

function Plot({
  db,
  version,
  label,
  build,
}: {
  db: ArchiveDb;
  version: number;
  label: string;
  build: (api: Api, width: number) => Element;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(build);
  latest.current = build;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    element.replaceChildren(
      latest.current(db.api, Math.max(280, element.clientWidth - 8)),
    );
    return () => element.replaceChildren();
  }, [db, version]);
  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      className="mb-3 overflow-x-auto"
    />
  );
}

const NOT_YET =
  "Nothing yet. This needs a finished day, which the archive compacts after midnight Colombo time.";

function Silences({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const scale = useRouteColors();
  const statement = chartView(
    "ex_silences",
    sql,
    "epoch(silent_for) / 60 AS minutes, registration || ' · ' || route_code AS bus",
  );
  const view = useView(catalogUrl, "ex_silences", statement);
  return (
    <Status state={view.state} empty="No daytime silences yet.">
      {view.db && (
        <Plot
          db={view.db}
          version={view.version}
          label="Bar chart of the longest daytime silences"
          build={(api, width) =>
            api.plot(
              api.barX(api.from("ex_silences"), {
                x: "minutes",
                y: "bus",
                fill: "route_code",
                sort: { y: "-x" },
              }),
              api.colorDomain(scale.domain),
              api.colorRange(scale.range),
              api.width(width),
              api.height(50 + 10 * 24),
              api.marginLeft(130),
              api.xLabel("Minutes without a report"),
              api.yLabel(null),
            )
          }
        />
      )}
    </Status>
  );
}

function Bunching({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const scale = useRouteColors();
  const statement = chartView("ex_bunching", withoutLimit(sql));
  const view = useView(catalogUrl, "ex_bunching", statement);
  return (
    <Status state={view.state} empty="No bunching found yet.">
      {view.db && (
        <>
          <p className={NOTE}>
            Every case so far; the query below keeps the latest 20.
          </p>
          <Plot
            db={view.db}
            version={view.version}
            label="Each minute two buses on a route ran within 300 m"
            build={(api, width) =>
              api.plot(
                api.dot(api.from("ex_bunching"), {
                  x: "minute",
                  y: "route_code",
                  fill: "route_code",
                  r: 3,
                  fillOpacity: 0.6,
                }),
                api.xScale("utc"),
                api.colorDomain(scale.domain),
                api.colorRange(scale.range),
                api.width(width),
                api.height(60 + scale.domain.length * 28),
                api.xLabel(null),
                api.yLabel(null),
              )
            }
          />
        </>
      )}
    </Status>
  );
}

function StopGaps({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const scale = useRouteColors();
  const [stop, setStop] = useState("MCC5");
  const [stops, setStops] = useState<{ stop_code: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    openArchive(catalogUrl)
      .then((db) =>
        rows<{ stop_code: string; name: string }>(
          db,
          "SELECT stop_code, any_value(name) AS name FROM stops GROUP BY stop_code ORDER BY name, stop_code",
        ),
      )
      .then((found) => {
        if (!cancelled) setStops(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [catalogUrl]);
  // A view per stop, because Mosaic caches results by query text and the name is all that would change.
  const name = `ex_gaps_${stop.replace(/\W/g, "_")}`;
  const statement = chartView(
    name,
    forStop(sql, stop),
    "epoch(waited) / 60 AS minutes",
  );
  const view = useView(catalogUrl, name, statement);
  return (
    <>
      <label className="mb-3 flex items-center gap-2 text-sm">
        Stop
        <select
          className="max-w-full rounded-md border border-line bg-card px-2 py-1"
          value={stop}
          onChange={(event) => setStop(event.target.value)}
        >
          {(stops.length ? stops : [{ stop_code: stop, name: stop }]).map(
            (item) => (
              <option key={item.stop_code} value={item.stop_code}>
                {item.name} ({item.stop_code})
              </option>
            ),
          )}
        </select>
      </label>
      <Status state={view.state} empty="No buses have passed this stop yet.">
        {view.db && (
          <Plot
            db={view.db}
            version={view.version}
            label="Minutes between buses passing the chosen stop"
            build={(api, width) =>
              api.plot(
                api.ruleY([0]),
                api.dot(api.from(name), {
                  x: "passed_at",
                  y: "minutes",
                  fill: "route_code",
                  r: 3.5,
                }),
                api.xScale("utc"),
                api.colorDomain(scale.domain),
                api.colorRange(scale.range),
                api.width(width),
                api.height(240),
                api.xLabel(null),
                api.yLabel("Minutes since the bus before"),
                api.yGrid(true),
              )
            }
          />
        )}
      </Status>
    </>
  );
}

function usePoints<T>(catalogUrl: string, name: string, statement: string) {
  const view = useView(catalogUrl, name, statement);
  const [found, setFound] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!view.db || view.state !== "ready") return;
    let cancelled = false;
    rows<T>(view.db, `SELECT * FROM ${name}`)
      .then((result) => {
        if (!cancelled) setFound(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [view.db, view.state, view.version, name]);
  const state: ViewState = failed
    ? "failed"
    : view.state === "ready" && found === null
      ? "loading"
      : view.state;
  return { state, found: found ?? [] };
}

function Sleep({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const { state, found } = usePoints<{
    lat: number;
    lng: number;
    buses: number;
  }>(catalogUrl, "ex_sleep", chartView("ex_sleep", sql));
  const points = useMemo<MapPoint[]>(
    () =>
      found.map((spot) => ({
        lng: spot.lng,
        lat: spot.lat,
        size: 5 + 4 * Math.sqrt(spot.buses),
        color: palette.ink,
        label: `${spot.buses} buses overnight`,
      })),
    [found],
  );
  return (
    <Status state={state} empty="No overnight positions yet.">
      <PointsMap points={points} label="Map of where buses spend the night" />
    </Status>
  );
}

function speedColor(kmh: number): string {
  if (kmh < 5) return palette.brand;
  if (kmh < 15) return palette.warning;
  return palette.muted;
}

function SlowStreets({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const { state, found } = usePoints<{
    lat: number;
    lng: number;
    hour: number;
    median_kmh: number;
    samples: number;
  }>(catalogUrl, "ex_slow", chartView("ex_slow", withoutLimit(sql)));
  const hours = useMemo(
    () =>
      [...new Set(found.map((spot) => Number(spot.hour)))].sort(
        (a, b) => a - b,
      ),
    [found],
  );
  const [hour, setHour] = useState(8);
  const shown = hours.includes(hour) ? hour : (hours[0] ?? hour);
  const points = useMemo<MapPoint[]>(
    () =>
      found
        .filter((spot) => Number(spot.hour) === shown)
        .sort((a, b) => a.median_kmh - b.median_kmh)
        .slice(0, 40)
        .map((spot) => ({
          lng: spot.lng,
          lat: spot.lat,
          size: 3 + Math.min(4, Math.log2(Number(spot.samples)) / 2),
          color: speedColor(spot.median_kmh),
          label: `${spot.median_kmh} km/h at ${String(shown).padStart(2, "0")}:00`,
        })),
    [found, shown],
  );
  return (
    <Status state={state} empty="Not enough moving buses yet.">
      <label className="mb-3 flex items-center gap-3 text-sm">
        Hour
        <input
          type="range"
          min={hours[0] ?? 5}
          max={hours[hours.length - 1] ?? 22}
          value={shown}
          onChange={(event) => setHour(Number(event.target.value))}
          className="w-48 accent-ink"
        />
        <span className="tabular-nums">
          {String(shown).padStart(2, "0")}:00
        </span>
      </label>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {[
          ["under 5 km/h", palette.brand],
          ["5–15 km/h", palette.warning],
          ["faster", palette.muted],
        ].map(([text, color]) => (
          <span key={text} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            {text}
          </span>
        ))}
      </div>
      <PointsMap
        points={points}
        label={`Map of the slowest stretches of road at ${shown}:00`}
      />
    </Status>
  );
}

function Spans({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const scale = useRouteColors();
  const hours = (column: string) =>
    `(split_part(${column}, ':', 1)::INT * 60 + split_part(${column}, ':', 2)::INT) / 60.0`;
  const statement = chartView(
    "ex_spans",
    sql,
    `${hours("first_bus")} AS first_h, ${hours("last_bus")} AS last_h`,
  );
  const view = useView(catalogUrl, "ex_spans", statement);
  return (
    <Status state={view.state} empty={NOT_YET}>
      {view.db && (
        <Plot
          db={view.db}
          version={view.version}
          label="When each route's first and last bus ran"
          build={(api, width) =>
            api.plot(
              api.barX(api.from("ex_spans"), {
                x1: "first_h",
                x2: "last_h",
                y: "route_code",
                fill: "route_code",
              }),
              api.xDomain([0, 24]),
              api.colorDomain(scale.domain),
              api.colorRange(scale.range),
              api.width(width),
              api.height(60 + scale.domain.length * 28),
              api.xLabel("Hour of day"),
              api.yLabel(null),
            )
          }
        />
      )}
    </Status>
  );
}

function Swaps({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const { state, found } = usePoints<{
    day: Date | number | string;
    registration: string;
    routes: unknown;
  }>(catalogUrl, "ex_swaps", chartView("ex_swaps", sql));
  return (
    <Status state={state} empty="No bus has worked two routes in a day yet.">
      <table className="mb-3 w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-1 pr-4 font-semibold">Day</th>
            <th className="py-1 pr-4 font-semibold">Bus</th>
            <th className="py-1 font-semibold">Routes</th>
          </tr>
        </thead>
        <tbody>
          {found.slice(0, 20).map((swap) => {
            const routes = listOf<string>(swap.routes);
            const day = new Date(swap.day as number).toISOString().slice(0, 10);
            return (
              <tr
                key={`${day}-${swap.registration}`}
                className="border-t border-line"
              >
                <td className="py-1 pr-4 tabular-nums">{day}</td>
                <td className="py-1 pr-4">{swap.registration}</td>
                <td className="py-1">{routes.join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Status>
  );
}

function FeedLag({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const { state, found } = usePoints<{
    lag_seconds: unknown;
  }>(catalogUrl, "ex_lag", chartView("ex_lag", sql));
  const raw = found[0]?.lag_seconds;
  const values = raw ? listOf<number>(raw) : [];
  return (
    <Status state={state} empty="No reports with a timestamp yet.">
      <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
        {["Typical", "9 in 10", "99 in 100"].map((name, index) => (
          <div key={name}>
            <dt className="text-sm text-muted">{name}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {values[index] === undefined
                ? "–"
                : `${Number(values[index]).toFixed(2)} s`}
            </dd>
          </div>
        ))}
      </dl>
    </Status>
  );
}

const PREVIEW_ROWS = 8;

// Views need a name, and one built from the query keeps each example's view apart.
function viewName(sql: string): string {
  let hash = 5381;
  for (const char of sql) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return `ex_table_${hash.toString(36)}`;
}

function Results({ catalogUrl, sql }: { catalogUrl: string; sql: string }) {
  const name = viewName(sql);
  const view = useView(catalogUrl, name, chartView(name, sql));
  const [result, setResult] = useState<ResultTable | null>(null);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!view.db || view.state !== "ready") return;
    let cancelled = false;
    Promise.all([
      resultTable(view.db, `SELECT * FROM ${name} LIMIT ${PREVIEW_ROWS}`),
      rows<{ n: number }>(view.db, `SELECT count(*)::INT AS n FROM ${name}`),
    ])
      .then(([found, [{ n }]]) => {
        if (cancelled) return;
        setResult(found);
        setTotal(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view.db, view.state, view.version, name]);
  const state: ViewState =
    view.state === "ready" && !result ? "loading" : view.state;
  return (
    <Status state={state} empty="No rows yet.">
      {result && (
        <>
          <div className="mb-2 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="bg-tint-50 text-muted">
                <tr>
                  {result.fields.map((field) => (
                    <th
                      key={field.name}
                      scope="col"
                      className="px-3 py-2 font-semibold whitespace-nowrap"
                    >
                      {field.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index} className="border-t border-line">
                    {result.fields.map((field) => (
                      <td
                        key={field.name}
                        className="px-3 py-1.5 whitespace-nowrap"
                      >
                        {formatCell(row[field.name], cellKind(field.typeId))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={NOTE}>
            {total > result.rows.length
              ? `The first ${result.rows.length} of ${total} rows.`
              : `${total} ${total === 1 ? "row" : "rows"}.`}
          </p>
        </>
      )}
    </Status>
  );
}

const CHARTS: Record<
  ChartKind,
  (props: { catalogUrl: string; sql: string }) => ReactNode
> = {
  silences: Silences,
  bunching: Bunching,
  gaps: StopGaps,
  sleep: Sleep,
  slow: SlowStreets,
  spans: Spans,
  swaps: Swaps,
  lag: FeedLag,
  table: Results,
};

class ChartBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className={NOTE} role="status">
        This chart couldn't load here. The query still works in the DuckDB
        shell.
      </p>
    ) : (
      this.props.children
    );
  }
}

export default function ExampleChart({
  kind,
  catalogUrl,
  sql,
}: {
  kind: ChartKind;
  catalogUrl: string;
  sql: string;
}) {
  const Chart = CHARTS[kind];
  return (
    <WhenVisible>
      <ChartBoundary>
        <Chart catalogUrl={catalogUrl} sql={sql} />
      </ChartBoundary>
    </WhenVisible>
  );
}
