export type Method = "GET" | "HEAD" | "OPTIONS";
export type BodyRule = "bytes" | "none" | "live" | "health" | "journey";

export type Probe = {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: BodyRule;
  readonly skipHeaders?: ReadonlyArray<string>;
};

export type Captured = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
};

export type Difference = {
  readonly probe: string;
  readonly what: string;
  readonly base: string;
  readonly candidate: string;
};

export const COMPARED_HEADERS = [
  "content-type",
  "cache-control",
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "vary",
  "accept-ranges",
  "content-range",
  "etag",
  "last-modified",
] as const;

export const EXCEPTIONS: Readonly<Record<Exclude<BodyRule, "bytes">, string>> =
  {
    none: "Status and headers only: the body is empty or is the UI build.",
    live: "Staging replays an archived day, so the buses differ; the keys and their types must be production's.",
    health:
      "Adds live and reference_age_ms (spec change 6); ok, routes_count and upstream must match.",
    journey:
      "queried_at is the moment of the search; the rest must match byte for byte.",
  };

const READ_ONLY: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export const assertReadOnly = (probe: {
  readonly method: string;
  readonly path: string;
}) => {
  if (!READ_ONLY.has(probe.method))
    throw new Error(
      `refusing ${probe.method} ${probe.path}: the harness only reads`,
    );
};

type Found = Omit<Difference, "probe">;

const decoder = new TextDecoder();
const parse = (body: Uint8Array): unknown => {
  try {
    return JSON.parse(decoder.decode(body));
  } catch {
    return undefined;
  }
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
const firstDifference = (a: string, b: string) => {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return at;
};
const around = (text: string, at: number) =>
  JSON.stringify(text.slice(Math.max(0, at - 40), at + 40));
const textDifference = (what: string, a: string, b: string): Found[] => {
  if (a === b) return [];
  const at = firstDifference(a, b);
  return [
    {
      what: `${what} (first difference at character ${at})`,
      base: around(a, at),
      candidate: around(b, at),
    },
  ];
};

const LIVE_KEYS = ["success", "count", "timestamp", "age_ms", "buses"];
const LIVE_REQUIRED = ["success", "count", "timestamp", "buses"];
const BUS_KEYS = [
  "id",
  "lat",
  "lng",
  "route_code",
  "route_id",
  "direction_id",
  "registration_number",
  "heading",
  "current_capacity",
  "total_capacity",
  "timestamp",
];
const HEALTH_SHARED = ["ok", "routes_count", "upstream"];
const HEALTH_EXTRA = ["live", "reference_age_ms"];

const liveProblem = (value: unknown): string | undefined => {
  if (!isRecord(value)) return "not an object";
  const keys = Object.keys(value);
  const extra = keys.filter((key) => !LIVE_KEYS.includes(key));
  if (extra.length) return `unexpected keys ${extra.join(", ")}`;
  const missing = LIVE_REQUIRED.filter((key) => !keys.includes(key));
  if (missing.length) return `missing keys ${missing.join(", ")}`;
  if (
    typeof value.success !== "boolean" ||
    typeof value.count !== "number" ||
    typeof value.timestamp !== "number" ||
    !Array.isArray(value.buses)
  )
    return "wrong types";
  for (const bus of value.buses) {
    if (!isRecord(bus)) return "a bus is not an object";
    const odd = Object.keys(bus).filter((key) => !BUS_KEYS.includes(key));
    if (odd.length) return `unexpected bus keys ${odd.join(", ")}`;
  }
  return undefined;
};

const withoutQueriedAt = (body: Uint8Array) => {
  const value = parse(body);
  if (!isRecord(value)) return decoder.decode(body);
  const { queried_at: _, ...rest } = value;
  return JSON.stringify(rest);
};

const bodyDifferences = (
  probe: Probe,
  base: Captured,
  candidate: Captured,
): Found[] => {
  switch (probe.body) {
    case "none":
      return [];
    case "bytes":
      return sameBytes(base.body, candidate.body)
        ? []
        : textDifference(
            "body",
            decoder.decode(base.body),
            decoder.decode(candidate.body),
          );
    case "live": {
      const a = liveProblem(parse(base.body));
      const b = liveProblem(parse(candidate.body));
      return a === undefined && b === undefined
        ? []
        : [{ what: "live body shape", base: a ?? "ok", candidate: b ?? "ok" }];
    }
    case "health": {
      const a = parse(base.body);
      const b = parse(candidate.body);
      if (!isRecord(a) || !isRecord(b))
        return [
          {
            what: "health body",
            base: decoder.decode(base.body),
            candidate: decoder.decode(candidate.body),
          },
        ];
      const found: Found[] = HEALTH_SHARED.filter(
        (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
      ).map((key) => ({
        what: `health ${key}`,
        base: JSON.stringify(a[key]),
        candidate: JSON.stringify(b[key]),
      }));
      if (
        Object.keys(b).some(
          (key) => !HEALTH_SHARED.includes(key) && !HEALTH_EXTRA.includes(key),
        )
      )
        found.push({
          what: "health keys",
          base: Object.keys(a).join(", "),
          candidate: Object.keys(b).join(", "),
        });
      return found;
    }
    case "journey":
      return textDifference(
        "journey body without queried_at",
        withoutQueriedAt(base.body),
        withoutQueriedAt(candidate.body),
      );
  }
};

const presence = (captured: Captured) =>
  captured.headers["content-length"] === undefined ? "absent" : "present";

export const compare = (
  probe: Probe,
  base: Captured,
  candidate: Captured,
): Difference[] => {
  const found: Found[] = [];
  if (base.status !== candidate.status)
    found.push({
      what: "status",
      base: String(base.status),
      candidate: String(candidate.status),
    });
  for (const name of COMPARED_HEADERS) {
    if (probe.skipHeaders?.includes(name)) continue;
    const a = base.headers[name];
    const b = candidate.headers[name];
    if (a !== b)
      found.push({
        what: `header ${name}`,
        base: a ?? "(absent)",
        candidate: b ?? "(absent)",
      });
  }
  if (presence(base) !== presence(candidate))
    found.push({
      what: "content-length presence",
      base: presence(base),
      candidate: presence(candidate),
    });
  found.push(...bodyDifferences(probe, base, candidate));
  return found.map((difference) => ({ probe: probe.name, ...difference }));
};
