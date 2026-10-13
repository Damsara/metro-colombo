import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { STATUS_KEY, StoreError } from "@metro/core";
import { StatusRoutes, UNAVAILABLE } from "@metro/api";
import { LIVE_JSON_KEY as LIVE_KEY } from "@metro/fleet";
import { T0 } from "./support/fixtures.ts";
import { harness, type HarnessOptions } from "./support/harness.ts";

const MINUTE = 60_000;
const BUS = {
  id: "bus-1",
  lat: 6.82537367,
  lng: 79.868233,
  route_id: "route-6",
  direction_id: "d1",
  registration_number: "WP-NE-6536",
  current_capacity: 0,
  total_capacity: 70,
  timestamp: T0 - 2_100,
  route_code: "CM06",
};
const LIVE = {
  success: true,
  count: 1,
  timestamp: T0 - 2_000,
  age_ms: 150,
  buses: [BUS],
  stale: false,
};
const status = (checkedAt: number, ok: boolean) => ({
  checked_at: checkedAt,
  ok,
  failed: ok ? [] : ["places"],
  consecutive_failures: ok ? 0 : 1,
  last_success_at: T0 - 10 * MINUTE,
});

const site = async (
  files: Record<string, unknown> = {},
  options: HarnessOptions = {},
) => {
  const h = await harness(StatusRoutes, options);
  for (const [key, value] of Object.entries(files))
    await Effect.runPromise(
      h.objects.store.put(
        key,
        new TextEncoder().encode(JSON.stringify(value)),
        { contentType: "application/json" },
      ),
    );
  return h;
};

const body = async (response: Response) => {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json");
  return response.text();
};

test("/api/live has production's keys in production's order, aged when served", async () => {
  const { get } = await site({ [LIVE_KEY]: LIVE });
  assert.equal(
    await body(await get("/api/live")),
    JSON.stringify({
      success: true,
      count: 1,
      timestamp: T0 - 2_000,
      age_ms: 2_000,
      buses: [BUS],
    }),
  );
});

test("a stale snapshot is served without stale or reason", async () => {
  const { get } = await site({
    [LIVE_KEY]: { ...LIVE, success: false, stale: true, reason: "feed_down" },
  });
  const text = await body(await get("/api/live"));
  assert.equal(text.includes("stale"), false);
  assert.equal(text.includes("reason"), false);
  assert.equal(JSON.parse(text).success, false);
});

test("with no snapshot yet, /api/live is production's not-yet-connected body", async () => {
  const { get } = await site();
  assert.equal(
    await body(await get("/api/live")),
    '{"success":false,"count":0,"timestamp":0,"buses":[]}',
  );
});

test("the snapshot is read from the store at most every 5 seconds", async () => {
  const h = await site({ [LIVE_KEY]: LIVE });
  await h.get("/api/live");
  await h.get("/api/live");
  assert.equal(h.objects.gets.filter((key) => key === LIVE_KEY).length, 1);
  h.time.advance(4_999);
  await h.get("/api/live");
  assert.equal(h.objects.gets.filter((key) => key === LIVE_KEY).length, 1);
  h.time.advance(1);
  await h.get("/api/live");
  assert.equal(h.objects.gets.filter((key) => key === LIVE_KEY).length, 2);
});

test("a store that can't be read makes /api/live 502", async () => {
  const { get } = await site(
    {},
    {
      wrapStore: (inner) => ({
        ...inner,
        get: (key) =>
          key === LIVE_KEY
            ? Effect.fail(new StoreError({ message: "read failed" }))
            : inner.get(key),
      }),
    },
  );
  const response = await get("/api/live");
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  assert.equal(text, JSON.stringify({ error: UNAVAILABLE }));
  assert.doesNotMatch(text, /read failed/);
});

test("health keeps production's keys and adds the live state and the reference age", async () => {
  const { get } = await site({
    [LIVE_KEY]: LIVE,
    [STATUS_KEY]: status(T0 - 10 * MINUTE, true),
  });
  assert.equal(
    await body(await get("/api/health")),
    JSON.stringify({
      ok: true,
      routes_count: 2,
      upstream: "reachable",
      live: { stale: false, age_ms: 2_000 },
      reference_age_ms: 10 * MINUTE,
    }),
  );
});

test("a failed or old check reads as unreachable, and health is still 200", async () => {
  const failed = await site({ [STATUS_KEY]: status(T0 - MINUTE, false) });
  assert.equal(
    JSON.parse(await body(await failed.get("/api/health"))).upstream,
    "unreachable",
  );
  const old = await site({ [STATUS_KEY]: status(T0 - 121 * MINUTE, true) });
  assert.equal(
    JSON.parse(await body(await old.get("/api/health"))).upstream,
    "unreachable",
  );
  const recent = await site({ [STATUS_KEY]: status(T0 - 119 * MINUTE, true) });
  assert.equal(
    JSON.parse(await body(await recent.get("/api/health"))).upstream,
    "reachable",
  );
});

test("with nothing published, health says so and still answers 200", async () => {
  const { get } = await site({}, { reference: null });
  assert.equal(
    await body(await get("/api/health")),
    '{"ok":false,"routes_count":null,"upstream":"unreachable","live":null,"reference_age_ms":null}',
  );
});
