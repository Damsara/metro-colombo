import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  chunkKey,
  colomboDay,
  dedupe,
  encodeChunk,
  RecordBuffer,
  toArchiveRow,
  todayPrefix,
} from "../src/archive/rows.js";

const fix = {
  id: "bus-1",
  lat: 6.9,
  lng: 79.9,
  receivedAt: 1_791_000_000_000,
  registration_number: "WP-NE-6566",
  route_code: "CM06",
  current_capacity: 30,
  total_capacity: 70,
  timestamp: 1_790_999_990_000,
};

test("a fix becomes an archive row with plain column names", () => {
  assert.deepEqual(toArchiveRow(fix), {
    bus_id: "bus-1",
    registration: "WP-NE-6566",
    route_code: "CM06",
    lat: 6.9,
    lng: 79.9,
    passengers: 30,
    capacity: 70,
    reported_at: 1_790_999_990_000,
    received_at: 1_791_000_000_000,
  });
});

test("the same report from the same bus is kept once", () => {
  const row = toArchiveRow(fix);
  const later = { ...row, received_at: row.received_at + 5000 };
  const moved = { ...row, reported_at: row.reported_at! + 5000, lat: 6.91 };
  assert.deepEqual(dedupe([row, later, moved]), [row, moved]);
});

test("rows without a reported time are keyed by when they arrived", () => {
  const { reported_at: _, ...row } = toArchiveRow(fix);
  assert.equal(
    dedupe([row, { ...row, received_at: row.received_at + 1 }]).length,
    2,
  );
});

test("chunks are filed by the Colombo date and time", () => {
  const evening = Date.UTC(2026, 9, 11, 18, 45, 7);
  assert.equal(colomboDay(evening), "2026-10-12");
  assert.equal(
    chunkKey(evening, "pod-a"),
    "raw/2026-10-12/001507-pod-a.ndjson.gz",
  );
  assert.equal(todayPrefix(evening), "raw/2026-10-12/");
});

test("a chunk is gzipped newline-delimited JSON", () => {
  const rows = [toArchiveRow(fix), { ...toArchiveRow(fix), bus_id: "bus-2" }];
  const lines = gunzipSync(encodeChunk(rows))
    .toString("utf8")
    .trim()
    .split("\n");
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).bus_id),
    ["bus-1", "bus-2"],
  );
});

test("the buffer only records once asked, and drops the oldest past its cap", () => {
  const buffer = new RecordBuffer<number>(3);
  buffer.push(0);
  assert.deepEqual(buffer.take(), []);
  for (const n of [1, 2, 3, 4]) buffer.push(n);
  assert.deepEqual(buffer.take(), [2, 3, 4]);
  assert.equal(buffer.dropped, 1);
  assert.deepEqual(buffer.take(), []);
});
