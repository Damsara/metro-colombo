import { Effect } from "effect";
import { beforeEach, expect, test } from "vitest";
import {
  REFERENCE,
  ROUTES,
} from "../../../packages/api/test/support/fixtures.ts";
import { seedReference } from "../../../packages/api/test/support/seed.ts";
import { r2ObjectStore } from "../src/ports.ts";
import { makeSite } from "../src/worker.ts";
import { emptyArchive, testEnv } from "./env.ts";

const assets = {
  fetch: async () =>
    new Response("<!doctype html><title>Metro</title>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
};
const site = () => makeSite({ ...testEnv, ASSETS: assets } as never).handler;
const get = (path: string, init?: RequestInit) =>
  site()(new Request(`https://metro-staging.test${path}`, init));

beforeEach(emptyArchive);

test("the Worker answers /api/routes from R2, byte for byte", async () => {
  await Effect.runPromise(
    seedReference(r2ObjectStore(testEnv.ARCHIVE), REFERENCE),
  );
  const response = await get("/api/routes");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=3600, stale-while-revalidate=86400",
  );
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(await response.text()).toBe(JSON.stringify({ routes: ROUTES }));
});

const publishedLive = () =>
  testEnv.ARCHIVE.put(
    "live/live.json",
    JSON.stringify({
      success: true,
      count: 0,
      timestamp: 0,
      buses: [],
      stale: true,
      reason: "feed_down",
    }),
  );

test("/api/live is the Fleet's in-memory snapshot over RPC, in production's shape", async () => {
  await publishedLive();
  const response = await get("/api/live");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe(
    '{"success":false,"count":0,"timestamp":0,"buses":[],"stale":true,"reason":"feed_down"}',
  );
});

test("/api/live falls back to the published file when the Fleet can't answer", async () => {
  await publishedLive();
  const broken = {
    idFromName: () => ({}),
    get: () => ({ live: () => Promise.reject(new Error("rpc failed")) }),
  };
  const response = await makeSite({
    ...testEnv,
    FLEET: broken,
    ASSETS: assets,
  } as never).handler(new Request("https://metro-staging.test/api/live"));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe(
    '{"success":true,"count":0,"timestamp":0,"buses":[],"stale":true,"reason":"feed_down"}',
  );
});

test("with nothing published the API is 502 and health still answers", async () => {
  expect((await get("/api/places")).status).toBe(502);
  const health = await get("/api/health");
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ ok: false, routes_count: null });
});

test("a browser at the root gets the deployed app as text/html", async () => {
  const response = await get("/", { headers: { "user-agent": "Mozilla/5.0" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html");
  expect(response.headers.get("cache-control")).toBe("no-cache");
  expect(await response.text()).toBe("<!doctype html><title>Metro</title>");
});

test("an unreachable catalog origin is 502 after one retry", async () => {
  const response = await get("/", {
    headers: { "user-agent": "duckdb/v1.5.6" },
  });
  expect(response.status).toBe(502);
  expect(await response.text()).toBe(
    "The fleet archive is unavailable right now.",
  );
});
