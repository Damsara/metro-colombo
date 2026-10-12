import assert from "node:assert/strict";
import { test } from "node:test";
import { Duration, Effect, Fiber } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { TestClock } from "effect/testing";
import { makeR2Store } from "../src/archive/r2.js";

const settings = {
  accountId: "acct",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "metro-data",
  publicUrl: "https://data.example.test",
};

const recording = (
  respond: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Response | null | "drop",
) => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const http = HttpClient.make((request) => {
    requests.push(request);
    const response = respond(request);
    if (response === "drop")
      return Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request }),
        }),
      );
    return response
      ? Effect.succeed(HttpClientResponse.fromWeb(request, response))
      : Effect.never;
  });
  return { requests, store: makeR2Store(settings, http) };
};

// Signing resolves on the real event loop, so the test clock moves in small steps around it.
const advance = (total: Duration.Duration) =>
  Effect.gen(function* () {
    const step = Duration.millis(100);
    for (let moved = 0; moved < Duration.toMillis(total); moved += 100) {
      yield* Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve, 1)),
      );
      yield* TestClock.adjust(step);
    }
  });

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())));

const param = (request: HttpClientRequest.HttpClientRequest, name: string) =>
  request.urlParams.params.find(([key]) => key === name)?.[1] ??
  new URL(request.url).searchParams.get(name) ??
  undefined;

test("uploads are signed for R2 and addressed path-style", async () => {
  const { requests, store } = recording(() => new Response(null));
  await run(
    store.put("raw/2026-10-12/001507-a.ndjson.gz", new Uint8Array([1, 2]), {
      contentType: "application/x-ndjson",
      cacheControl: "public, max-age=60",
    }),
  );
  const [request] = requests;
  assert.equal(request.method, "PUT");
  assert.equal(
    request.url,
    "https://acct.r2.cloudflarestorage.com/metro-data/raw/2026-10-12/001507-a.ndjson.gz",
  );
  assert.match(
    request.headers["authorization"] ?? "",
    /^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/auto\/s3\/aws4_request/,
  );
  assert.equal(request.headers["cache-control"], "public, max-age=60");
  assert.equal(request.body._tag, "Uint8Array");
});

test("a server error is retried, then reported with its status", async () => {
  const { requests, store } = recording(
    () => new Response("nope", { status: 503 }),
  );
  const error = await run(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.flip(
          store.put("a", new Uint8Array(), { contentType: "text/plain" }),
        ),
      );
      yield* advance(Duration.seconds(10));
      return yield* Fiber.join(fiber);
    }),
  );
  assert.equal(error._tag, "ArchiveError");
  assert.equal(error.status, 503);
  assert.equal(requests.length, 4);
});

test("a client error is not retried", async () => {
  const { requests, store } = recording(
    () => new Response("denied", { status: 403 }),
  );
  const error = await run(
    Effect.flip(
      store.put("a", new Uint8Array(), { contentType: "text/plain" }),
    ),
  );
  assert.equal(error.status, 403);
  assert.equal(requests.length, 1);
});

test("a request that hangs times out instead of stalling the archive", async () => {
  const { store } = recording(() => null);
  const error = await run(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(store.list("raw/")));
      yield* advance(Duration.seconds(90));
      return yield* Fiber.join(fiber);
    }),
  );
  assert.equal(error._tag, "ArchiveError");
  assert.match(error.message, /timed out/);
});

test("listing follows continuation tokens and unescapes keys", async () => {
  const pages = [
    "<ListBucketResult><Contents><Key>raw/2026-10-12/a&amp;b.gz</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>t1</NextContinuationToken></ListBucketResult>",
    "<ListBucketResult><Contents><Key>raw/2026-10-12/c.gz</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>",
  ];
  const { requests, store } = recording(() => new Response(pages.shift()));
  const keys = await run(store.list("raw/2026-10-12/"));
  assert.deepEqual(keys, ["raw/2026-10-12/a&b.gz", "raw/2026-10-12/c.gz"]);
  assert.equal(param(requests[0], "prefix"), "raw/2026-10-12/");
  assert.equal(param(requests[1], "continuation-token"), "t1");
});

test("public reads go through the public domain without signing", async () => {
  const { requests, store } = recording(
    () => new Response("x", { status: 206 }),
  );
  const response = await run(
    store.fetchPublic("catalog/metro.duckdb", { range: "bytes=0-9" }),
  );
  assert.equal(response.status, 206);
  assert.equal(
    requests[0].url,
    "https://data.example.test/catalog/metro.duckdb",
  );
  assert.equal(requests[0].headers["range"], "bytes=0-9");
  assert.equal(requests[0].headers["authorization"], undefined);
});

test("a public read that drops on the network is tried again", async () => {
  let attempts = 0;
  const { requests, store } = recording(() =>
    ++attempts === 1 ? "drop" : new Response("x", { status: 206 }),
  );
  const response = await run(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        store.fetchPublic("catalog/metro.duckdb", { range: "bytes=0-9" }),
      );
      yield* advance(Duration.seconds(2));
      return yield* Fiber.join(fiber);
    }),
  );
  assert.equal(response.status, 206);
  assert.equal(requests.length, 2);
});
