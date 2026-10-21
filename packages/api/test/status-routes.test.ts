import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { STATUS_KEY, StoreError } from "@metro/core";
import { LIVE_FLEET_TIMEOUT_MS, StatusRoutes, UNAVAILABLE } from "@metro/api";
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
      stale: false,
    }),
  );
});

test("a stale snapshot is served with stale and its reason", async () => {
  const { get } = await site({
    [LIVE_KEY]: {
      ...LIVE,
      success: false,
      stale: true,
      reason: "login_needed",
    },
  });
  const served = JSON.parse(await body(await get("/api/live")));
  assert.equal(served.success, false);
  assert.equal(served.stale, true);
  assert.equal(served.reason, "login_needed");
});

test("a fresh snapshot is served with stale false and no reason", async () => {
  const { get } = await site({ [LIVE_KEY]: LIVE });
  const served = JSON.parse(await body(await get("/api/live")));
  assert.equal(served.stale, false);
  assert.equal("reason" in served, false);
});

test("health reports why the live feed is stale", async () => {
  const { get } = await site({
    [LIVE_KEY]: {
      ...LIVE,
      success: false,
      stale: true,
      reason: "login_needed",
    },
  });
  const health = JSON.parse(await body(await get("/api/health")));
  assert.deepEqual(health.live, {
    stale: true,
    age_ms: 2_000,
    reason: "login_needed",
  });
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

const fromFleet = (doc: () => unknown): HarnessOptions => ({
  client: { live: Effect.sync(doc) as never },
});

test("/api/live is the Fleet's in-memory snapshot, byte for byte, without reading the store", async () => {
  const h = await site(
    {},
    fromFleet(() => LIVE),
  );
  assert.equal(
    await body(await h.get("/api/live")),
    JSON.stringify({
      success: true,
      count: 1,
      timestamp: T0 - 2_000,
      age_ms: 2_000,
      buses: [BUS],
      stale: false,
    }),
  );
  assert.equal(h.objects.gets.includes(LIVE_KEY), false);
});

test("each poll sees the Fleet's latest batch, with no cache in between", async () => {
  let doc = LIVE;
  const h = await site(
    {},
    fromFleet(() => doc),
  );
  assert.equal(JSON.parse(await body(await h.get("/api/live"))).count, 1);
  doc = { ...LIVE, timestamp: T0 - 100, count: 2, buses: [BUS, BUS] };
  h.time.advance(100);
  const next = JSON.parse(await body(await h.get("/api/live")));
  assert.equal(next.count, 2);
  assert.equal(next.timestamp, T0 - 100);
  assert.equal(next.age_ms, 200);
});

test("health ages the live state from the Fleet's last batch", async () => {
  const { get } = await site(
    { [LIVE_KEY]: { ...LIVE, timestamp: T0 - 60_000 } },
    fromFleet(() => ({ ...LIVE, timestamp: T0 - 700 })),
  );
  assert.deepEqual(JSON.parse(await body(await get("/api/health"))).live, {
    stale: false,
    age_ms: 700,
  });
});

test("a Fleet that fails or answers garbage leaves /api/live on the published file", async () => {
  const stored = { ...LIVE, timestamp: T0 - 4_000 };
  for (const live of [
    Effect.die(new Error("rpc failed")),
    Effect.succeed({ nonsense: true }),
  ]) {
    const { get } = await site(
      { [LIVE_KEY]: stored },
      { client: { live: live as never } },
    );
    assert.equal(
      JSON.parse(await body(await get("/api/live"))).timestamp,
      T0 - 4_000,
    );
  }
});

test("a Fleet that doesn't answer within a second leaves /api/live on the published file", async () => {
  const h = await site(
    { [LIVE_KEY]: { ...LIVE, timestamp: T0 - 4_000 } },
    { client: { live: Effect.never as never } },
  );
  const pending = h.get("/api/live");
  await new Promise((resolve) => setTimeout(resolve, 20));
  h.time.advance(LIVE_FLEET_TIMEOUT_MS);
  const served = JSON.parse(await body(await pending));
  assert.equal(served.timestamp, T0 - 4_000);
  assert.equal(served.age_ms, 4_000 + LIVE_FLEET_TIMEOUT_MS);
});
