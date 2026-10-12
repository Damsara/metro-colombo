import assert from "node:assert/strict";
import { test } from "node:test";
import { fromParquetRow, hoursFromParquet, replaySources } from "../src/replay-source.ts";
import { REPLAY_DAY_PARQUET_BASE64 } from "./fixtures/replay-day.ts";

const at = (time: string) => Date.parse(`2026-10-11T${time}+05:30`);
const fixture = () => {
  const bytes = Buffer.from(REPLAY_DAY_PARQUET_BASE64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

test("a day is looked for in the compacted file first, then the newest partial file", () => {
  const sources = replaySources("2026-10-11");
  assert.equal(sources.length, 24);
  assert.equal(sources[0], "fixes/date=2026-10-11/fixes.parquet");
  assert.equal(sources[1], "today/date=2026-10-11/through=23.parquet");
  assert.equal(sources[23], "today/date=2026-10-11/through=01.parquet");
});

test("a zstd Parquet day splits into time-ordered hours of archive rows", async () => {
  const hours = await hoursFromParquet(fixture(), "2026-10-11");
  assert.deepEqual([...hours.keys()].sort((a, b) => a - b), [7, 8, 9]);
  assert.deepEqual(hours.get(8)?.map((row) => [row.bus_id, row.received_at]), [
    ["bus-a", at("08:00:00.100")],
    ["bus-b", at("08:00:02.100")],
    ["bus-a", at("08:00:05.100")],
    ["bus-b", at("08:00:07.100")],
    ["bus-a", at("08:00:10.100")],
  ]);
  assert.deepEqual(hours.get(8)?.[0], {
    bus_id: "bus-a",
    registration: "WP-NA-1001",
    route_id: "route-1",
    direction_id: "dir-1",
    lat: 6.9001,
    lng: 79.8601,
    heading: 90,
    passengers: 10,
    capacity: 70,
    reported_at: at("08:00:00"),
    received_at: at("08:00:00.100"),
  });
  assert.equal(hours.get(8)?.[4].heading, undefined);
  assert.equal(hours.get(8)?.[1].route_code, "177");
  assert.deepEqual(hours.get(7)?.map((row) => row.bus_id), ["bus-b"]);
});

test("rows without an id, position or receive time are dropped", () => {
  assert.equal(fromParquetRow({ bus_id: "a", lat: 6.9, lng: null, received_at: 1n }), undefined);
  assert.equal(fromParquetRow({ bus_id: "", lat: 6.9, lng: 79.8, received_at: 1n }), undefined);
  assert.deepEqual(fromParquetRow({ bus_id: "a", lat: 6.9, lng: 79.8, received_at: 5n, passengers: null }), {
    bus_id: "a",
    lat: 6.9,
    lng: 79.8,
    received_at: 5,
  });
});
