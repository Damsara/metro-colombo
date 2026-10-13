import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  assertReadOnly,
  type Captured,
  compare,
  type Difference,
  EXCEPTIONS,
  type Probe,
} from "./compat/compare.js";
import { DUCKDB_AGENT, probes, type RouteInfo } from "./compat/requests.js";

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

const json = async (origin: string, path: string) =>
  JSON.parse(
    new TextDecoder().decode(
      (await capture(origin, { name: path, method: "GET", path, body: "none" }))
        .body,
    ),
  );

const { routes } = (await json(base, "/api/routes")) as { routes: RouteInfo[] };
const first = (await json(
  base,
  `/api/routes/${encodeURIComponent(routes[0].code)}/stops?direction=0`,
)) as { stops: Array<{ id: string; stop_code: string }> };
const [from, to] = [first.stops[0], first.stops[first.stops.length - 1]];
const head = await capture(base, {
  name: "etag",
  method: "HEAD",
  path: "/",
  headers: { "user-agent": DUCKDB_AGENT },
  body: "none",
});
const list = probes(
  routes,
  {
    fromCode: from.stop_code,
    toCode: to.stop_code,
    fromId: from.id,
    toId: to.id,
  },
  head.headers["etag"],
);

const differences: Difference[] = [];
for (const probe of list) {
  let found = compare(
    probe,
    await capture(base, probe),
    await capture(candidate, probe),
  );
  if (found.length > 0 && probe.body === "journey")
    found = compare(
      probe,
      await capture(base, probe),
      await capture(candidate, probe),
    );
  differences.push(...found);
}

console.log(`${list.length} probes, ${differences.length} differences`);
for (const rule of new Set(list.map((probe) => probe.body)))
  if (rule !== "bytes") console.log(`exception ${rule}: ${EXCEPTIONS[rule]}`);
for (const difference of differences)
  console.log(
    `- ${difference.probe}: ${difference.what}\n    production: ${difference.base}\n    candidate:  ${difference.candidate}`,
  );
if (values.out)
  await writeFile(
    values.out,
    JSON.stringify({ probes: list.length, differences }, null, 2),
  );
process.exit(differences.length === 0 ? 0 : 1);
