import assert from "node:assert/strict";
import { test } from "node:test";
import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect";
import { HttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import {
  fakeHttpClient,
  type FakeReply,
  type FakeRequest,
} from "@metro/core/testing";
import {
  CatalogRoutes,
  makeCatalogRoutes,
  UI_TIMEOUT_MS,
  UiIndex,
} from "@metro/api";
import { harness, type HarnessOptions } from "./support/harness.ts";

const DUCKDB = "duckdb/v1.5.6(osx_arm64)";
const ETAG = '"83a539e0a7fb63b310dd5455b478a161"';
const MODIFIED = "Tue, 13 Oct 2026 04:37:55 GMT";

const origin = (replies: Array<(request: FakeRequest) => FakeReply> = []) =>
  fakeHttpClient((request) => {
    const next = replies.shift();
    if (next) return next(request);
    if (request.headers["range"])
      return {
        status: 206,
        bytes: new Uint8Array([1, 2, 3, 4]),
        headers: {
          "content-range": "bytes 0-3/274432",
          etag: ETAG,
          "last-modified": MODIFIED,
        },
      };
    if (request.headers["if-none-match"] === ETAG)
      return { status: 304, headers: { etag: ETAG } };
    return {
      status: 200,
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
      headers: { etag: ETAG, "last-modified": MODIFIED },
    };
  });

const site = (
  http: HttpClient.HttpClient,
  options: HarnessOptions = {},
  routes = CatalogRoutes,
) => harness(routes, { http, ...options });

test("DuckDB gets the catalog with its range passed on and production's headers", async () => {
  const fake = origin();
  const { get } = await site(fake.client);
  const response = await get("/", {
    headers: { "user-agent": DUCKDB, range: "bytes=0-3" },
  });
  assert.equal(response.status, 206);
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([1, 2, 3, 4]),
  );
  for (const [name, value] of [
    ["content-type", "application/octet-stream"],
    ["cache-control", "private, max-age=300"],
    ["vary", "User-Agent"],
    ["accept-ranges", "bytes"],
    ["content-range", "bytes 0-3/274432"],
    ["etag", ETAG],
    ["last-modified", MODIFIED],
  ])
    assert.equal(response.headers.get(name), value, name);
  assert.equal(
    fake.requests[0].url.toString(),
    "https://data.example/catalog/metro.duckdb",
  );
  assert.equal(fake.requests[0].method, "GET");
  assert.equal(fake.requests[0].headers["range"], "bytes=0-3");
});

test("a HEAD goes upstream as a HEAD and comes back without a body", async () => {
  const fake = origin();
  const { get } = await site(fake.client);
  const response = await get("/", {
    method: "HEAD",
    headers: { "user-agent": DUCKDB },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), ETAG);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal(fake.requests[0].method, "HEAD");
});

test("a matching etag is 304", async () => {
  const { get } = await site(origin().client);
  const response = await get("/", {
    headers: { "user-agent": DUCKDB, "if-none-match": ETAG },
  });
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("content-type"), null);
  assert.equal(response.headers.get("etag"), ETAG);
});

const answered = async (count: number, requests: ReadonlyArray<unknown>) => {
  for (let tries = 0; requests.length < count && tries < 500; tries++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(requests.length, count);
  await new Promise((resolve) => setTimeout(resolve, 1));
};

test("a failing origin is tried twice more, 100 ms then 200 ms later, then the archive is 502", async () => {
  const fails = (): FakeReply => ({ status: 500, text: "boom" });
  const thrice = origin([fails, fails, fails]);
  const { get, time } = await site(thrice.client);
  const pending = get("/", { headers: { "user-agent": DUCKDB } });
  await answered(1, thrice.requests);
  time.advance(99);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(thrice.requests.length, 1);
  time.advance(1);
  await answered(2, thrice.requests);
  time.advance(199);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(thrice.requests.length, 2);
  time.advance(1);
  const response = await pending;
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    await response.text(),
    "The fleet archive is unavailable right now.",
  );
  assert.equal(thrice.requests.length, 3);
});

test("a throttled or failing origin that recovers within the retries gets the catalog through", async () => {
  const throttled = (): FakeReply => ({ status: 429, text: "slow down" });
  const fails = (): FakeReply => ({ status: 500, text: "boom" });
  const flaky = origin([throttled, fails]);
  const { get, time } = await site(flaky.client);
  const pending = get("/", { headers: { "user-agent": DUCKDB } });
  await answered(1, flaky.requests);
  time.advance(100);
  await answered(2, flaky.requests);
  time.advance(200);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(flaky.requests.length, 3);
});

test("a refusal other than 429 is passed on without a retry", async () => {
  const refused = origin([() => ({ status: 403, text: "no" })]);
  const response = await (
    await site(refused.client)
  ).get("/", { headers: { "user-agent": DUCKDB } });
  assert.equal(response.status, 403);
  assert.equal(refused.requests.length, 1);
});

test(
  "an origin that never answers gives up rather than holding the request",
  { timeout: 2_000 },
  async () => {
    const attempts: string[] = [];
    const silent = HttpClient.make(() => {
      attempts.push("attempt");
      return Effect.never;
    });
    const { get, time } = await site(silent, {}, makeCatalogRoutes(50));
    const pending = get("/", { headers: { "user-agent": DUCKDB } });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await answered(attempt, attempts);
      time.advance(50);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        time.advance(100 * 2 ** (attempt - 1));
      }
    }
    const response = await pending;
    assert.equal(response.status, 502);
    assert.equal(attempts.length, 3);
  },
);

test("a missing app index keeps its own status and cache-control", async () => {
  const { get } = await site(origin().client, {
    ui: UiIndex.of({
      response: Effect.succeed(
        HttpServerResponse.text("missing", {
          status: 404,
          headers: { "cache-control": "no-store" },
        }),
      ),
    }),
  });
  const response = await get("/", { headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test(
  "an app index that hangs is a 502 after its limit",
  { timeout: 2_000 },
  async () => {
    const { get, time } = await site(origin().client, {
      ui: UiIndex.of({ response: Effect.never }),
    });
    const pending = get("/", { headers: { "user-agent": "Mozilla/5.0" } });
    for (let tries = 0; time.pending() === 0 && tries < 500; tries++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    time.advance(UI_TIMEOUT_MS);
    const response = await pending;
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
  },
);

test("an app index that throws is a 502", async () => {
  const { get } = await site(origin().client, {
    ui: UiIndex.of({ response: Effect.die(new Error("index exploded")) }),
  });
  const response = await get("/", { headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await response.text(), /exploded/);
});

test("a browser gets the app, never cached by a shared cache", async () => {
  const { get } = await site(origin().client);
  const response = await get("/", { headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html");
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.equal(response.headers.get("vary"), "User-Agent");
  assert.equal(await response.text(), "<!doctype html><title>Metro</title>");
});

test("DuckDB's write-ahead log is an empty 404 for an hour", async () => {
  const { get } = await site(origin().client);
  for (const method of ["GET", "HEAD"]) {
    const response = await get("/.wal", { method });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test("PUBLIC_DATA_URL is required", async () => {
  const build = (env: Record<string, string>) =>
    Effect.runPromise(
      Effect.exit(
        Effect.scoped(
          Layer.build(
            CatalogRoutes.pipe(
              Layer.provide(
                Layer.mergeAll(
                  HttpRouter.layer,
                  Layer.succeed(HttpClient.HttpClient, origin().client),
                  Layer.succeed(
                    UiIndex,
                    UiIndex.of({
                      response: Effect.succeed(HttpServerResponse.text("")),
                    }),
                  ),
                  ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  assert.ok(
    Exit.isSuccess(await build({ PUBLIC_DATA_URL: "https://data.example" })),
  );
  const missing = await build({});
  assert.ok(Exit.isFailure(missing));
  assert.match(Cause.pretty(missing.cause), /PUBLIC_DATA_URL/);
});
