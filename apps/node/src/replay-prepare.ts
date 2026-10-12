import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { encodeArchiveChunk, isIsoDate } from "@metro/core";
import { replayHourKey, replayRoutesKey } from "@metro/upstream";
import { hoursFromParquet, replaySources } from "./replay-source.js";

const { values } = parseArgs({
  options: {
    date: { type: "string" },
    source: { type: "string", default: "https://data.metro.manasa.ai" },
    out: { type: "string", default: ".replay" },
  },
});
const day = values.date;
if (!day || !isIsoDate(day))
  throw new Error(
    "usage: replay:prepare -- --date YYYY-MM-DD [--source URL] [--out DIR]",
  );
const source = values.source.replace(/\/$/, "");

let parquet: ArrayBuffer | undefined;
let used = "";
for (const path of replaySources(day)) {
  const response = await fetch(`${source}/${path}`);
  if (!response.ok) continue;
  parquet = await response.arrayBuffer();
  used = path;
  break;
}
if (!parquet) throw new Error(`no archived day ${day} under ${source}`);

const write = (key: string, bytes: Uint8Array) => {
  const target = join(values.out, ...key.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
};

const routesResponse = await fetch(`${source}/raw/reference/routes.json`);
if (!routesResponse.ok) {
  throw new Error(
    `no route list at ${source}/raw/reference/routes.json (HTTP ${routesResponse.status}); replayed buses would have no route codes`,
  );
}
const routes = new Uint8Array(await routesResponse.arrayBuffer());
const routeCount = (JSON.parse(new TextDecoder().decode(routes)) as unknown[])
  .length;

const hours = await hoursFromParquet(parquet, day);
for (const [hour, rows] of hours)
  write(replayHourKey(day, hour), await encodeArchiveChunk(rows));
write(replayRoutesKey(day), routes);
const total = [...hours.values()].reduce((sum, rows) => sum + rows.length, 0);
console.log(
  `${used}: ${total} rows in ${hours.size} hour files and ${routeCount} routes under ${join(values.out, "replay", day)}`,
);
