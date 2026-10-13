import type { BodyRule, Probe } from "./compare.js";

export const DUCKDB_AGENT = "duckdb/v1.5.6(osx_arm64)";
export const BROWSER_AGENT = "Mozilla/5.0 (metro compat-diff)";

export type RouteInfo = {
  readonly code: string;
  readonly directions: ReadonlyArray<{
    readonly id: string;
    readonly start_location: string;
  }>;
};

export type StopPair = {
  readonly fromCode: string;
  readonly toCode: string;
  readonly fromId: string;
  readonly toId: string;
};

const get = (
  name: string,
  path: string,
  body: BodyRule = "bytes",
  extra: Partial<Probe> = {},
): Probe => ({ name, method: "GET", path, body, ...extra });

const journey = (from: string, to: string, date?: string) =>
  `/api/journey?${new URLSearchParams({ from, to, ...(date ? { date } : {}) })}`;

export const probes = (
  routes: ReadonlyArray<RouteInfo>,
  stops: StopPair,
  catalogEtag: string | undefined,
): Probe[] => {
  const duckdb = { "user-agent": DUCKDB_AGENT };
  const list: Probe[] = [
    get("health", "/api/health", "health"),
    get("routes", "/api/routes"),
    get("places", "/api/places"),
    get("occasions", "/api/occasions"),
    get("live", "/api/live", "live"),
    get("unknown api path", "/api/nope"),
    get("unknown route", "/api/routes/NOPE1"),
    get("journey without stops", "/api/journey"),
    get(
      "journey with a bad date",
      journey(stops.fromCode, stops.toCode, "2026-13-01"),
    ),
    get("journey with an unknown stop", journey(stops.fromCode, "NOPE1")),
    get(
      "journey by stop code",
      journey(stops.fromCode, stops.toCode),
      "journey",
    ),
    get("journey by stop id", journey(stops.fromId, stops.toId), "journey"),
    {
      name: "preflight",
      method: "OPTIONS",
      path: "/api/routes",
      headers: {
        origin: "https://example.org",
        "access-control-request-method": "GET",
      },
      body: "bytes",
    },
    get("catalog range", "/", "bytes", {
      headers: { ...duckdb, range: "bytes=0-15" },
    }),
    {
      name: "catalog head",
      method: "HEAD",
      path: "/",
      headers: duckdb,
      body: "none",
    },
    ...(catalogEtag
      ? [
          get("catalog not modified", "/", "bytes", {
            headers: { ...duckdb, "if-none-match": catalogEtag },
          }),
        ]
      : []),
    get("site root for a browser", "/", "none", {
      headers: { "user-agent": BROWSER_AGENT },
      skipHeaders: ["etag", "last-modified", "content-length"],
    }),
    get("duckdb write-ahead log", "/.wal"),
    {
      name: "duckdb write-ahead log head",
      method: "HEAD",
      path: "/.wal",
      body: "none",
    },
  ];
  for (const route of routes) {
    const code = encodeURIComponent(route.code);
    list.push(
      get(`route ${route.code}`, `/api/routes/${code}`),
      get(
        `route ${route.code} lower case`,
        `/api/routes/${code.toLowerCase()}`,
      ),
      get(`geometry ${route.code}`, `/api/routes/${code}/geometry`),
      get(`stops ${route.code}`, `/api/routes/${code}/stops`),
      get(
        `geometry ${route.code} invalid direction`,
        `/api/routes/${code}/geometry?direction=9`,
      ),
      get(
        `stops ${route.code} invalid direction`,
        `/api/routes/${code}/stops?direction=9`,
      ),
    );
    route.directions.forEach((direction, index) => {
      const selectors = [
        String(index),
        index === 0 ? "forward" : "reverse",
        direction.id,
        direction.start_location,
      ];
      for (const selector of selectors) {
        const query = `?direction=${encodeURIComponent(selector)}`;
        list.push(
          get(
            `geometry ${route.code} ${selector}`,
            `/api/routes/${code}/geometry${query}`,
          ),
          get(
            `stops ${route.code} ${selector}`,
            `/api/routes/${code}/stops${query}`,
          ),
        );
      }
    });
  }
  return list;
};
