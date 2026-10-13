import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  assertReadOnly,
  type Captured,
  type Difference,
  EXCEPTIONS,
  type Probe,
} from "./compat/compare.js";
import { DUCKDB_AGENT, probes, type RouteInfo } from "./compat/requests.js";
import { captureWithRetry, exitCode, runProbes } from "./compat/run.js";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    candidate: { type: "string" },
    out: { type: "string" },
  },
});
const { base, candidate } = values;
if (!base || !candidate) {
  console.error(
    "usage: compat:diff -- --base <url> --candidate <url> [--out <file>]",
  );
  process.exit(2);
}

const capture = async (origin: string, probe: Probe): Promise<Captured> => {
  assertReadOnly(probe);
  const response = await fetch(new URL(probe.path, origin), {
    method: probe.method,
    headers: probe.headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return {
    status: response.status,
    headers,
    body: new Uint8Array(await response.arrayBuffer()),
  };
};

const fetchBase = (probe: Probe) =>
  captureWithRetry((each) => capture(base, each), probe);

const json = async (path: string) =>
  JSON.parse(
    new TextDecoder().decode(
      (await fetchBase({ name: path, method: "GET", path, body: "none" })).body,
    ),
  );

const report = async (
  probeCount: number,
  differences: Difference[],
  rules: ReadonlyArray<string>,
) => {
  console.log(`${probeCount} probes, ${differences.length} differences`);
  for (const rule of rules)
    if (rule !== "bytes")
      console.log(
        `exception ${rule}: ${EXCEPTIONS[rule as keyof typeof EXCEPTIONS]}`,
      );
  for (const difference of differences)
    console.log(
      `- ${difference.probe}: ${difference.what}\n    production: ${difference.base}\n    candidate:  ${difference.candidate}`,
    );
  if (values.out)
    await writeFile(
      values.out,
      JSON.stringify({ probes: probeCount, differences }, null, 2),
    );
};

let list: Probe[];
try {
  const { routes } = (await json("/api/routes")) as { routes: RouteInfo[] };
  const first = (await json(
    `/api/routes/${encodeURIComponent(routes[0].code)}/stops?direction=0`,
  )) as { stops: Array<{ id: string; stop_code: string }> };
  const [from, to] = [first.stops[0], first.stops[first.stops.length - 1]];
  const head = await fetchBase({
    name: "etag",
    method: "HEAD",
    path: "/",
    headers: { "user-agent": DUCKDB_AGENT },
    body: "none",
  });
  list = probes(
    routes,
    {
      fromCode: from.stop_code,
      toCode: to.stop_code,
      fromId: from.id,
      toId: to.id,
    },
    head.headers["etag"],
  );
} catch (error) {
  await report(
    0,
    [
      {
        probe: "discovery",
        what: "fetch failed",
        base: error instanceof Error ? error.name : "unknown error",
        candidate: "not attempted",
      },
    ],
    [],
  );
  process.exit(2);
}

const result = await runProbes(
  list,
  (probe) => capture(base, probe),
  (probe) => capture(candidate, probe),
);
await report(list.length, result.differences, [
  ...new Set(list.map((probe) => probe.body)),
]);
process.exit(exitCode(result));
