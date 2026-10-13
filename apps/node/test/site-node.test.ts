import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const app = (path: string) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

const stop = (id: string, code: string) => ({
  id,
  stop_code: code,
  stop_name_en: code,
  stop_name_si: "",
  stop_name_tm: "",
  sequence_number: 1,
  latitude: 6.9,
  longitude: 79.86,
  status: "active",
});
const ROUTE = {
  code: "CM06",
  id: "route-6",
  name: "Kollupitiya Circular Route",
  status: "active",
  is_favorite: false,
  directions: [
    {
      id: "d1",
      start_location: "Kollupitiya",
      end_location: "Bambalapitiya",
      status: "active",
      geojson_url: "https://storage.googleapis.com/lmt/d1.geojson",
    },
  ],
  color_hex: "#491C80",
};
const ROUTES_BODY = JSON.stringify({ routes: [ROUTE] });
const STOPS = {
  route_code: "CM06",
  route_name: ROUTE.name,
  direction_id: "d1",
  direction_label: "Kollupitiya -> Bambalapitiya",
  stops: [
    stop("cac3f318-8978-4ef4-b530-19919deadcb8", "KCR100"),
    stop("881f4119-2a64-414a-ba11-65424a857fe6", "KCR101"),
  ],
};
const PLAN = {
  from_stop: { id: STOPS.stops[0].id },
  to_stop: { id: STOPS.stops[1].id },
  date: "2026-10-13",
  queried_at: "2026-10-13T03:30:00Z",
  is_now: true,
  options: [],
};

const fakeProduction = () => {
  const seen: string[] = [];
  const server = createServer((request, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://fake");
    seen.push(`${request.method} ${url.pathname}${url.search}`);
    const send = (
      status: number,
      body: string,
      type = "application/json",
      headers = {},
    ) => {
      response.writeHead(status, { "content-type": type, ...headers });
      response.end(body);
    };
    switch (url.pathname) {
      case "/api/routes":
        return send(200, ROUTES_BODY);
      case "/api/routes/CM06/stops":
        return send(200, JSON.stringify(STOPS));
      case "/api/routes/CM06/geometry":
        return send(200, '{"type":"FeatureCollection","features":[]}');
      case "/api/places":
        return send(200, '{"places":[]}');
      case "/api/occasions":
        return send(200, '{"occasions":[]}');
      case "/api/journey":
        return send(200, JSON.stringify(PLAN));
      case "/catalog/metro.duckdb":
        return send(200, "DUCK", "application/octet-stream", {
          etag: '"duck"',
        });
      default:
        return send(404, '{"error":"not found"}');
    }
  });
  return new Promise<{ origin: string; seen: string[]; close: () => void }>(
    (resolve) =>
      server.listen(0, "127.0.0.1", () =>
        resolve({
          origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          seen,
          close: () => server.close(),
        }),
      ),
  );
};

const start = (env: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "site-node-"));
  const web = join(dir, "web");
  mkdirSync(web);
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Metro</title>");
  // Clear of wiring.test.ts's ports (18789 to 20788), since node --test runs files at once.
  const port = 21_000 + Math.floor(Math.random() * 900);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", app("src/main.ts")],
    {
      env: {
        PATH: process.env.PATH ?? "",
        LIVE_FEED: "replay",
        REPLAY_DATE: "2099-01-01",
        DATA_DIR: join(dir, "data"),
        FLEET_STATE_PATH: join(dir, "state.json"),
        WEB_DIST: web,
        PORT: String(port),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += chunk));
  child.stdout?.on("data", (chunk) => (stderr += chunk));
  return { child, base: `http://127.0.0.1:${port}`, stderr: () => stderr };
};

const exitCode = (child: ReturnType<typeof spawn>) =>
  Promise.race([
    new Promise<number | null>((resolve) => child.on("exit", resolve)),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("still running after 20 s")), 20_000),
    ),
  ]).finally(() => child.kill("SIGKILL"));

// The manifest is written before status.json, so only "reachable" means the whole run has landed.
const published = async (base: string) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const health = (await (await fetch(`${base}/api/health`)).json()) as {
        ok: boolean;
        upstream: string;
      };
      if (health.ok && health.upstream === "reachable") return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("the site never published");
};

test(
  "the Node site publishes through the proxy and answers as production does",
  { timeout: 60_000 },
  async () => {
    const production = await fakeProduction();
    const { child, base } = start({
      UPSTREAM: "proxy",
      UPSTREAM_PROXY_URL: production.origin,
      PUBLIC_DATA_URL: production.origin,
    });
    try {
      await published(base);
      const routes = await fetch(`${base}/api/routes`);
      assert.equal(await routes.text(), ROUTES_BODY);
      assert.equal(
        routes.headers.get("cache-control"),
        "public, max-age=3600, stale-while-revalidate=86400",
      );
      assert.equal(routes.headers.get("access-control-allow-origin"), "*");
      assert.equal(
        await (await fetch(`${base}/api/routes/CM06/stops`)).text(),
        JSON.stringify(STOPS),
      );
      const journey = await fetch(
        `${base}/api/journey?from=KCR100&to=KCR101&date=2026-10-13`,
      );
      assert.equal(await journey.text(), JSON.stringify(PLAN));
      assert.ok(
        production.seen.includes(
          `GET /api/journey?from=${STOPS.stops[0].id}&to=${STOPS.stops[1].id}&date=2026-10-13`,
        ),
      );
      const catalog = await fetch(`${base}/`, {
        headers: { "user-agent": "duckdb/v1.5.6" },
      });
      assert.equal(await catalog.text(), "DUCK");
      const page = await fetch(`${base}/`, {
        headers: { "user-agent": "Mozilla/5.0" },
      });
      assert.equal(page.headers.get("content-type"), "text/html");
      assert.equal(page.headers.get("cache-control"), "no-cache");
      assert.equal(await page.text(), "<!doctype html><title>Metro</title>");
      assert.equal((await fetch(`${base}/fleet/status`)).status, 404);
    } finally {
      child.kill("SIGTERM");
      production.close();
    }
  },
);

for (const missing of ["UPSTREAM", "PUBLIC_DATA_URL"])
  test(
    `the Node app refuses to start without ${missing}`,
    { timeout: 30_000 },
    async () => {
      const env: Record<string, string> = {
        UPSTREAM: "proxy",
        UPSTREAM_PROXY_URL: "http://127.0.0.1:9",
        PUBLIC_DATA_URL: "http://127.0.0.1:9",
      };
      delete env[missing];
      const { child, stderr } = start(env);
      assert.notEqual(await exitCode(child), 0);
      assert.match(stderr(), new RegExp(missing));
    },
  );
