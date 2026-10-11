import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import type { ArchiveStoreShape } from "../src/archive/r2.js";
import { encodeChunk } from "../src/archive/rows.js";
import {
  catalogResponse,
  isDuckDbAgent,
  todayResponse,
} from "../src/archive/serve.js";

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

const store = (overrides: Partial<ArchiveStoreShape>): ArchiveStoreShape => ({
  enabled: true,
  publicUrl: "https://data.example.test",
  put: () => Effect.die("unused"),
  list: () => Effect.die("unused"),
  get: () => Effect.die("unused"),
  fetchPublic: () => Effect.die("unused"),
  ...overrides,
});

test("the catalog is proxied with ranges and only safe headers", async () => {
  let asked: Record<string, string> = {};
  const response = await Effect.runPromise(
    catalogResponse(
      store({
        fetchPublic: (path, headers) => {
          asked = { path, ...headers };
          return Effect.succeed(
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
          );
        },
      }),
      { method: "GET", range: "bytes=0-9", ifNoneMatch: undefined },
    ),
  );
  assert.deepEqual(asked, { path: "catalog/metro.duckdb", range: "bytes=0-9" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-9/100");
  assert.equal(response.headers.get("etag"), '"abc"');
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cf-ray"), null);
  assert.equal(await response.text(), "0123456789");
});

test("HEAD gets the catalog's headers without a body", async () => {
  const response = await Effect.runPromise(
    catalogResponse(
      store({
        fetchPublic: () =>
          Effect.succeed(
            new Response("abc", { headers: { "content-length": "3" } }),
          ),
      }),
      { method: "HEAD", range: undefined, ifNoneMatch: undefined },
    ),
  );
  assert.equal(response.headers.get("content-length"), "3");
  assert.equal(response.body, null);
});

test("today's chunks stream back as one gzip file, in order", async () => {
  const chunks: Record<string, Uint8Array> = {
    "raw/2026-10-12/000500-a.ndjson.gz": encodeChunk([
      { bus_id: "first", lat: 1, lng: 1, received_at: 1 },
    ]),
    "raw/2026-10-12/001000-a.ndjson.gz": encodeChunk([
      { bus_id: "second", lat: 2, lng: 2, received_at: 2 },
    ]),
  };
  const response = await Effect.runPromise(
    todayResponse(
      store({
        list: (prefix) =>
          Effect.succeed(
            Object.keys(chunks)
              .filter((key) => key.startsWith(prefix))
              .reverse(),
          ),
        get: (key) => Effect.succeed(new Response(chunks[key])),
      }),
      Date.UTC(2026, 9, 11, 18, 45),
    ),
  );
  assert.equal(response.headers.get("content-type"), "application/gzip");
  const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString(
    "utf8",
  );
  assert.deepEqual(
    text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).bus_id),
    ["first", "second"],
  );
});
