import {
  createExecutionContext,
  createScheduledController,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { expect, test } from "vitest";
import { encodeArchiveChunk } from "@metro/core";
import {
  colomboDayStart,
  replayHourKey,
  replayInstant,
  replayRoutesKey,
} from "@metro/upstream";
import worker from "../src/worker.ts";
import stagingConfig from "../wrangler.jsonc?raw";
import { emptyArchive, testEnv } from "./env.ts";

const DAY = "2026-10-11";
const HOUR_MS = 3_600_000;
const fleet = () => testEnv.FLEET.get(testEnv.FLEET.idFromName("fleet"));
type Status = { login: string; feed: string };

const waitFor = async (ready: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out");
};

test("alarms replay the archived hour into live.json and vehicles.pb", async () => {
  const instant = replayInstant(Date.now(), DAY, 1);
  const hour = Math.floor((instant - colomboDayStart(DAY)) / HOUR_MS);
  const hourStart = colomboDayStart(DAY) + hour * HOUR_MS;
  const row = (bus_id: string, ago: number) => {
    const received_at = Math.max(hourStart, instant - ago);
    return {
      bus_id,
      route_id: "route-1",
      lat: 6.9,
      lng: 79.86,
      reported_at: received_at - 100,
      received_at,
    };
  };
  await testEnv.ARCHIVE.put(
    replayHourKey(DAY, hour),
    await encodeArchiveChunk([row("bus-a", 10_000), row("bus-b", 5_000)]),
  );
  await testEnv.ARCHIVE.put(
    replayRoutesKey(DAY),
    JSON.stringify([{ id: "route-1", code: "138" }]),
  );

  const stub = fleet();
  expect(((await stub.status()) as Status).login).toBe("not_used");
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  await waitFor(
    async () => ((await stub.status()) as Status).feed === "connected",
  );
  expect(await runDurableObjectAlarm(stub)).toBe(true);

  const live = await testEnv.ARCHIVE.get("live/live.json");
  expect(live?.httpMetadata?.cacheControl).toBe("public, max-age=5");
  const doc = (await live?.json()) as {
    stale: boolean;
    buses: { id: string; route_code?: string }[];
  };
  expect(doc.stale).toBe(false);
  expect(doc.buses.map((bus) => [bus.id, bus.route_code]).sort()).toEqual([
    ["bus-a", "138"],
    ["bus-b", "138"],
  ]);
  expect(await testEnv.ARCHIVE.head("live/vehicles.pb")).not.toBeNull();
});

test("the Worker hides the Fleet's endpoints without the secret and forwards them with it", async () => {
  const post = (authorization?: string) =>
    worker.fetch(
      new Request("https://metro-staging.test/fleet/otp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ code: "123456" }),
      }),
      testEnv as never,
    );
  expect((await post()).status).toBe(404);
  expect((await post("Bearer wrong")).status).toBe(404);
  expect((await post(`Bearer ${testEnv.OTP_SECRET}`)).status).toBe(409);
  const status = await worker.fetch(
    new Request("https://metro-staging.test/fleet/status", {
      headers: { authorization: `Bearer ${testEnv.OTP_SECRET}` },
    }),
    testEnv as never,
  );
  expect(status.status).toBe(200);
  expect(((await status.json()) as Status).login).toBe("not_used");
});

test("the cron puts the Fleet's alarm back if it is missing", async () => {
  const stub = fleet();
  await stub.status();
  await runInDurableObject(stub, (_instance, state) =>
    state.storage.deleteAlarm(),
  );
  const context = createExecutionContext();
  await worker.scheduled(
    createScheduledController(),
    testEnv as never,
    context,
  );
  await waitOnExecutionContext(context);
  expect(
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.getAlarm(),
    ),
  ).not.toBeNull();
});

test("the staging Worker writes only to the staging bucket, on workers.dev, replaying, with no seed token", () => {
  // JSONC allows trailing commas, which JSON.parse rejects.
  const config = JSON.parse(stagingConfig.replace(/,(\s*[}\]])/g, "$1"));
  expect(config.name).toBe("metro-staging");
  expect(config.workers_dev).toBe(true);
  expect(config.routes).toBeUndefined();
  expect(config.route).toBeUndefined();
  expect(config.r2_buckets).toEqual([
    { binding: "ARCHIVE", bucket_name: "metro-data-staging" },
  ]);
  expect(config.vars.LIVE_FEED).toBe("replay");
  expect(Object.keys(config.vars)).not.toContain("METRO_REFRESH_TOKEN");
  expect(config.vars.UPSTREAM).toBe("proxy");
  expect(config.vars.UPSTREAM_PROXY_URL).toBe("https://metro.manasa.ai");
  expect(config.vars.PUBLIC_DATA_URL).toBe("https://data.metro.manasa.ai");
  expect(config.assets).toEqual({
    directory: "../../web/dist",
    binding: "ASSETS",
    not_found_handling: "single-page-application",
    run_worker_first: ["/", "/.wal", "/api/*", "/fleet/*"],
  });
});

test("the production env is metro on metro.manasa.ai, recording live data into metro-data, with no secrets in config", () => {
  const config = JSON.parse(stagingConfig.replace(/,(\s*[}\]])/g, "$1"));
  const production = config.env.production;
  expect(production.name).toBe("metro");
  expect(production.workers_dev).toBe(false);
  expect(production.routes).toEqual([
    { pattern: "metro.manasa.ai/*", zone_name: "manasa.ai" },
  ]);
  expect(production.r2_buckets).toEqual([
    { binding: "ARCHIVE", bucket_name: "metro-data" },
  ]);
  expect(production.durable_objects).toEqual(config.durable_objects);
  expect(production.migrations).toEqual(config.migrations);
  expect(production.vars).toEqual({
    LIVE_FEED: "lankametro",
    FLEET_INSTANCE: "fleet",
    UPSTREAM: "lankametro",
    PUBLIC_DATA_URL: "https://data.metro.manasa.ai",
  });
  expect(JSON.stringify(production)).not.toMatch(/staging/);
});

test("the Fleet's publisher records a failed run and tries again while no routes are published", async () => {
  await emptyArchive();
  const stub = fleet();
  const report = await stub.publishReferenceIfDue();
  expect(report?.ok).toBe(false);
  expect(report?.failed).toEqual(["occasions", "places", "routes"]);
  const status = await (
    await testEnv.ARCHIVE.get("reference/status.json")
  )?.json();
  expect(status).toMatchObject({
    ok: false,
    consecutive_failures: 1,
    last_success_at: null,
  });
  expect((await stub.publishReferenceIfDue())?.ok).toBe(false);
});

test("a replaying Fleet hands out no session token", async () => {
  expect(await fleet().sessionToken()).toBeNull();
});
