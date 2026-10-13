import assert from "node:assert/strict";
import { test } from "node:test";
import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect";
import { HttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import {
  fakeHttpClient,
  type FakeReply,
  type FakeRequest,
} from "@metro/core/testing";
import { CatalogRoutes, makeCatalogRoutes, UiIndex } from "@metro/api";
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
});

test("a failing origin is tried once more, then the archive is 502", async () => {
  const fails = (): FakeReply => ({ status: 500, text: "boom" });
  const twice = origin([fails, fails]);
  const response = await (
    await site(twice.client)
  ).get("/", { headers: { "user-agent": DUCKDB } });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    await response.text(),
    "The fleet archive is unavailable right now.",
  );
  assert.equal(twice.requests.length, 2);
  const once = origin([fails]);
  const recovered = await (
    await site(once.client)
  ).get("/", { headers: { "user-agent": DUCKDB } });
  assert.equal(recovered.status, 200);
});

test("an origin that never answers gives up rather than holding the request", async () => {
  const silent = HttpClient.make(() => Effect.never);
  const { get, time } = await site(silent, {}, makeCatalogRoutes(50));
  const pending = get("/", { headers: { "user-agent": DUCKDB } });
  for (let attempt = 0; attempt < 2; attempt++) {
    while (time.pending() === 0)
      await new Promise((resolve) => setTimeout(resolve, 1));
    time.advance(50);
  }
  const response = await pending;
  assert.equal(response.status, 502);
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
