import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ARCHIVE_COLUMNS, toArchiveRow } from "@metro/core";

const pythonColumns = () => {
  const source = readFileSync(new URL("../ops/archive/compact.py", import.meta.url), "utf8");
  const block = source.match(/^COLUMNS = \{([\s\S]*?)^\}/m);
  assert.ok(block, "COLUMNS dict not found in compact.py");
  return [...block[1].matchAll(/"(\w+)":\s*"([A-Z]+)"/g)].map(([, name, type]) => [name, type]);
};

test("the archive columns match the Python compactor's, in order", () => {
  assert.deepEqual(
    ARCHIVE_COLUMNS.map(([name, type]) => [name, type]),
    pythonColumns(),
  );
});

test("every field an archive row can carry is a declared column", () => {
  const row = toArchiveRow({
    id: "b",
    lat: 1,
    lng: 2,
    receivedAt: 3,
    registration_number: "R",
    route_id: "r",
    route_code: "C",
    direction_id: "d",
    heading: 4,
    current_capacity: 5,
    total_capacity: 6,
    timestamp: 7,
  });
  const declared = new Set(ARCHIVE_COLUMNS.map(([name]) => name));
  for (const key of Object.keys(row)) assert.ok(declared.has(key), `${key} is not a declared column`);
});
