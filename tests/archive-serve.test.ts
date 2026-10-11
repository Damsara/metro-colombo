import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import {
  HttpClientRequest,
  HttpClientResponse,
  HttpServerResponse,
} from "effect/http";
import type { ArchiveStoreShape } from "../src/archive/r2.js";
import { catalogResponse, isDuckDbAgent } from "../src/archive/serve.js";

test("DuckDB is recognised by its current and older user agents", () => {
  assert.equal(
    isDuckDbAgent("duckdb/v1.5.6(linux_arm64) python/3.12 069cc9f9b5"),
    true,
  );
  assert.equal(isDuckDbAgent("cpp-httplib/0.14.3"), true);
  assert.equal(
    isDuckDbAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/154.0",
    ),
    false,
  );
  assert.equal(isDuckDbAgent(undefined), false);
});

const storeServing = (
  response: Response,
  asked: Record<string, string> = {},
): ArchiveStoreShape => ({
  enabled: true,
  publicUrl: "https://data.example.test",
  put: () => Effect.die("unused"),
  list: () => Effect.die("unused"),
  fetchPublic: (path, headers) => {
    Object.assign(asked, { path, ...headers });
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        HttpClientRequest.get(`https://data.example.test/${path}`),
        response,
      ),
    );
  },
});

const asWeb = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.toWeb(response);

test("the catalog is proxied with ranges, only safe headers, and never shared-cached", async () => {
  const asked: Record<string, string> = {};
  const store = storeServing(
    new Response("0123456789", {
      status: 206,
      headers: {
        "content-range": "bytes 0-9/100",
        "content-length": "10",
        etag: '"abc"',
        "set-cookie": "nope=1",
        "cf-ray": "x",
      },
    }),
    asked,
  );
  const response = asWeb(
    await Effect.runPromise(
      catalogResponse(store, {
        method: "GET",
        range: "bytes=0-9",
        ifNoneMatch: undefined,
      }),
    ),
  );
  assert.deepEqual(asked, { path: "catalog/metro.duckdb", range: "bytes=0-9" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-9/100");
  assert.equal(response.headers.get("etag"), '"abc"');
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "private, max-age=300");
  assert.equal(response.headers.get("vary"), "User-Agent");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cf-ray"), null);
  assert.equal(await response.text(), "0123456789");
});

test("HEAD gets the catalog's headers without a body", async () => {
  const response = asWeb(
    await Effect.runPromise(
      catalogResponse(
        storeServing(
          new Response("abc", { headers: { "content-length": "3" } }),
        ),
        { method: "HEAD", range: undefined, ifNoneMatch: undefined },
      ),
    ),
  );
  assert.equal(response.headers.get("content-length"), "3");
  assert.equal(await response.text(), "");
});
