import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { toArchiveRow } from "@metro/core";
import { encodeChunk } from "../src/archive/rows.js";

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
