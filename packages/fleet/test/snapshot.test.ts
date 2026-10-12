import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fix } from "@metro/core";
import { liveDocument, staleReason } from "@metro/fleet";

const T0 = Date.parse("2026-10-12T08:00:00+05:30");
const fix = (
  id: string,
  receivedAt: number,
  extra: Partial<Fix> = {},
): Fix => ({ id, lat: 6.9, lng: 79.86, receivedAt, ...extra });
const routes = [{ id: "route-1", code: "138" }];

test("a fresh snapshot keeps the last minute of fixes and fills route codes", () => {
  const doc = liveDocument({
    now: T0,
    fixes: [
      fix("a", T0 - 1_000, { route_id: "route-1" }),
      fix("b", T0 - 61_000),
      fix("c", T0, { route_code: "177", route_id: "route-1" }),
    ],
    routes,
    lastBatchAt: T0 - 1_000,
    frozen: [],
    reason: undefined,
  });
  assert.deepEqual(doc, {
    success: true,
    count: 2,
    timestamp: T0 - 1_000,
    age_ms: 1_000,
    buses: [
      { id: "a", lat: 6.9, lng: 79.86, route_id: "route-1", route_code: "138" },
      { id: "c", lat: 6.9, lng: 79.86, route_code: "177", route_id: "route-1" },
    ],
    stale: false,
  });
});

test("a stale snapshot republishes the frozen buses with its reason", () => {
  const frozen = [{ id: "x", lat: 6.9, lng: 79.86 }];
  const doc = liveDocument({
    now: T0,
    fixes: [fix("a", T0)],
    routes,
    lastBatchAt: T0 - 300_000,
    frozen,
    reason: "login_needed",
  });
  assert.equal(doc.success, false);
  assert.equal(doc.stale, true);
  assert.equal(doc.reason, "login_needed");
  assert.deepEqual(doc.buses, frozen);
  assert.equal(doc.age_ms, 300_000);
});

test("a snapshot is stale only after 2 minutes without positions, whatever the login says", () => {
  assert.equal(
    staleReason({ now: T0, lastBatchAt: T0 - 119_000, loginNeeded: true }),
    undefined,
  );
  assert.equal(
    staleReason({ now: T0, lastBatchAt: T0 - 121_000, loginNeeded: true }),
    "login_needed",
  );
  assert.equal(
    staleReason({ now: T0, lastBatchAt: T0 - 121_000, loginNeeded: false }),
    "feed_down",
  );
  assert.equal(
    staleReason({ now: T0, lastBatchAt: 0, loginNeeded: false }),
    "feed_down",
  );
});

test("a snapshot with no positions yet has no age", () => {
  const doc = liveDocument({
    now: T0,
    fixes: [],
    routes,
    lastBatchAt: 0,
    frozen: [],
    reason: "feed_down",
  });
  assert.equal(doc.age_ms, undefined);
  assert.equal(doc.timestamp, 0);
});
