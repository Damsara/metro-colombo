import assert from "node:assert/strict";
import { test } from "node:test";
import { Duration, Effect, Layer, Metric, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { Auth } from "../src/auth.js";
import { UpstreamApi } from "../src/upstream.js";

const reading = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Record<string, string>,
) => {
  const match = snapshots.find(
    (snapshot) =>
      snapshot.id === id &&
      Object.entries(attributes).every(
        ([key, value]) => snapshot.attributes?.[key] === value,
      ),
  );
  return match ? Number((match.state as { count: number | bigint }).count) : 0;
};

const route = {
  code: "CM01",
  id: "r1",
  name: "CM01",
  status: "active",
  is_favorite: false,
  directions: [],
};

const run = <A, E>(
  program: Effect.Effect<A, E, UpstreamApi>,
  respond: (path: string) => { status: number; body: unknown },
) => {
  const http = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const { status, body } = respond(url.pathname);
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), { status }),
      );
    }),
  );
  return Effect.runPromise(
    program.pipe(
      Effect.provide(
        UpstreamApi.layer.pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
          Layer.provide(
            Layer.succeed(
              Auth,
              Auth.of({ currentToken: Effect.succeed(Redacted.make("t")) }),
            ),
          ),
        ),
      ),
      Effect.provide(TestClock.layer()),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    ),
  );
};

test("a good response counts as an ok request", async () => {
  const snapshots = await run(
    Effect.gen(function* () {
      yield* (yield* UpstreamApi).routes;
      return yield* Metric.snapshot;
    }),
    (path) =>
      path.endsWith("/routes/geo")
        ? { status: 200, body: { data: { routes: [route] } } }
        : { status: 200, body: { routes: [] } },
  );
  assert.equal(
    reading(snapshots, "upstream.requests", {
      endpoint: "routes",
      outcome: "ok",
    }),
    1,
  );
  assert.equal(
    reading(snapshots, "upstream.decode_failures", { endpoint: "routes" }),
    0,
  );
});

test("a response that fails decoding counts as a decode failure", async () => {
  const snapshots = await run(
    Effect.gen(function* () {
      yield* Effect.exit((yield* UpstreamApi).routes);
      return yield* Metric.snapshot;
    }),
    (path) =>
      path.endsWith("/routes/geo")
        ? { status: 200, body: { data: { routes: "nope" } } }
        : { status: 200, body: { routes: [] } },
  );
  assert.equal(
    reading(snapshots, "upstream.decode_failures", { endpoint: "routes" }),
    1,
  );
  assert.equal(
    reading(snapshots, "upstream.requests", {
      endpoint: "routes",
      outcome: "decode_error",
    }),
    1,
  );
});

test("a swallowed colour failure counts as a fallback", async () => {
  const snapshots = await run(
    Effect.gen(function* () {
      yield* (yield* UpstreamApi).routes;
      yield* TestClock.adjust(Duration.seconds(1));
      return yield* Metric.snapshot;
    }),
    (path) =>
      path.endsWith("/routes/geo")
        ? { status: 200, body: { data: { routes: [route] } } }
        : { status: 503, body: {} },
  );
  assert.equal(
    reading(snapshots, "upstream.fallbacks", { endpoint: "colours" }),
    1,
  );
  assert.equal(
    reading(snapshots, "upstream.requests", {
      endpoint: "colours",
      outcome: "http_error",
    }),
    1,
  );
});
