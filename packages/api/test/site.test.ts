import assert from "node:assert/strict";
import { test } from "node:test";
import { SiteRoutes } from "@metro/api";
import { harness } from "./support/harness.ts";

test("the site answers the API, the root and the Fleet's routes, all with CORS", async () => {
  const { get } = await harness(SiteRoutes);
  for (const path of [
    "/api/routes",
    "/api/health",
    "/api/live",
    "/",
    "/.wal",
  ]) {
    const response = await get(path, {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "*",
      path,
    );
  }
  assert.equal((await get("/api/routes")).status, 200);
  const health = await get("/api/health");
  assert.equal(health.status, 200);
  assert.equal(((await health.json()) as { ok?: boolean }).ok, true);
  const live = await get("/api/live");
  assert.equal(live.status, 200);
  assert.ok("buses" in ((await live.json()) as object));
  const root = await get("/", { headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(root.status, 200);
  assert.equal(root.headers.get("content-type"), "text/html");
  assert.equal((await get("/fleet/status")).status, 404);
  assert.equal(
    (await get("/fleet/otp", { method: "POST", body: '{"code":"123456"}' }))
      .status,
    404,
  );
});
