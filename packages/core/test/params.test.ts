import assert from "node:assert/strict";
import { test } from "node:test";
import { directionMatches, isIsoDate, isStopUuid } from "@metro/core";

const forward = { id: "dir-a", start_location: "Makumbura", end_location: "Fort", status: "active", geojson_url: "" };
const reverse = { id: "dir-b", start_location: "Fort", end_location: "Makumbura", status: "active", geojson_url: "" };

test("directions match by id, index, forward/reverse and start location", () => {
  assert.ok(directionMatches("dir-a", forward, 0));
  assert.ok(directionMatches("0", forward, 0));
  assert.ok(directionMatches("Forward", forward, 0));
  assert.ok(directionMatches("reverse", reverse, 1));
  assert.ok(directionMatches("fort", reverse, 1));
  assert.ok(!directionMatches("reverse", forward, 0));
  assert.ok(!directionMatches("1", forward, 0));
});

test("dates must be real calendar days in YYYY-MM-DD form", () => {
  assert.ok(isIsoDate("2026-10-08"));
  assert.ok(isIsoDate("2028-02-29"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("2026-99-99"));
  assert.ok(!isIsoDate("2026-10-8"));
  assert.ok(!isIsoDate("tomorrow"));
});

test("stop references are UUIDs or stop codes", () => {
  assert.ok(isStopUuid("4351f529-c5ea-4950-ac8f-0478b88beca6"));
  assert.ok(!isStopUuid("MMC-1"));
  assert.ok(!isStopUuid("4351f529-c5ea-4950-ac8f-0478b88beca6&x=1"));
});
