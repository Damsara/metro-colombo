import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Fiber, Layer, Option } from "effect";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import {
  fakeHttpClient,
  type FakeReply,
  type FakeRequest,
} from "@metro/core/testing";
import {
  ProxyUpstream,
  ReferenceUpstream,
  type ReferenceUpstreamShape,
} from "@metro/upstream";

const direction = {
  id: "d1",
  start_location: "Kollupitiya",
  end_location: "Bambalapitiya",
  status: "active",
  geojson_url: "https://storage.googleapis.com/lmt/CM06-0.geojson",
};
const ROUTES = [
  {
    code: "CM06",
    id: "route-1",
    name: "Kollupitiya Circular Route",
    status: "active",
    is_favorite: false,
    directions: [direction],
    color_hex: "#491C80",
  },
];
const STOP = {
  id: "stop-1",
  stop_code: "KCR100",
  stop_name_en: "Kollupitiya",
  stop_name_si: "කොල්ලුපිටිය",
  stop_name_tm: "கொள்ளுப்பிட்டி",
  sequence_number: 1,
  latitude: 6.9120149,
  longitude: 79.850639,
  status: "active",
};
const PLAN = {
  from_stop: { id: "stop-1" },
  to_stop: { id: "stop-2" },
  date: "2026-10-13",
  queried_at: "2026-10-13T04:47:00Z",
  is_now: true,
  options: [],
};
const none = Option.none();

const setup = (
  handle: (request: FakeRequest) => FakeReply,
  env: Record<string, string> = {
    UPSTREAM_PROXY_URL: "https://metro.example/",
  },
) => {
  const http = fakeHttpClient(handle);
  const layer = ProxyUpstream.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http.client)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
  );
  const use = <A, E>(
    f: (upstream: ReferenceUpstreamShape) => Effect.Effect<A, E>,
  ) =>
    Effect.gen(function* () {
      return yield* f(yield* ReferenceUpstream);
    }).pipe(Effect.provide(layer));
  return {
    http,
    run: <A, E>(f: (u: ReferenceUpstreamShape) => Effect.Effect<A, E>) =>
      Effect.runPromise(use(f)),
    fail: <A, E>(f: (u: ReferenceUpstreamShape) => Effect.Effect<A, E>) =>
      Effect.runPromise(Effect.flip(use(f))),
  };
};

test("routes come back exactly as production wrote them, colour last", async () => {
  const { run, http } = setup(() => ({
    status: 200,
    json: { routes: ROUTES },
  }));
  const routes = await run((u) => u.routes(none));
  assert.equal(JSON.stringify(routes), JSON.stringify(ROUTES));
  assert.equal(
    http.requests[0].url.toString(),
    "https://metro.example/api/routes",
  );
});

test("a direction's stops are read from production's stops route", async () => {
  const { run, http } = setup(() => ({
    status: 200,
    json: {
      route_code: "CM06",
      route_name: "Kollupitiya Circular Route",
      direction_id: "d1",
      direction_label: "Kollupitiya -> Bambalapitiya",
      stops: [STOP],
    },
  }));
  const stops = await run((u) => u.stops(none, ROUTES[0], direction));
  assert.deepEqual(stops, [STOP]);
  assert.equal(
    http.requests[0].url.toString(),
    "https://metro.example/api/routes/CM06/stops?direction=d1",
  );
});

test("geometry, places and occasions are passed through", async () => {
  const { run, http } = setup((request) => {
    switch (request.url.pathname) {
      case "/api/routes/CM06/geometry":
        return {
          status: 200,
          json: { type: "FeatureCollection", features: [] },
        };
      case "/api/places":
        return { status: 200, json: { places: [] } };
      default:
        return {
          status: 200,
          json: {
            occasions: [
              {
                date: "2026-10-25",
                title: "Vap Full Moon Poya Day",
                kind: "poya",
              },
            ],
          },
        };
    }
  });
  assert.deepEqual(await run((u) => u.geometry(none, ROUTES[0], direction)), {
    type: "FeatureCollection",
    features: [],
  });
  assert.deepEqual(await run((u) => u.places), []);
  assert.equal((await run((u) => u.occasions)).length, 1);
  assert.equal(http.requests[0].url.search, "?direction=d1");
});

test("a journey is asked for by stop ids and date", async () => {
  const { run, http } = setup(() => ({ status: 200, json: PLAN }));
  assert.deepEqual(
    await run((u) => u.journey(none, "stop-1", "stop-2", "2026-10-13")),
    PLAN,
  );
  assert.equal(
    http.requests[0].url.toString(),
    "https://metro.example/api/journey?from=stop-1&to=stop-2&date=2026-10-13",
  );
});

test("production's 400 carries its message as the detail, and a 502 its status", async () => {
  const bad = setup(() => ({
    status: 400,
    json: { error: "unknown stop: X" },
  }));
  const refused = await bad.fail((u) =>
    u.journey(none, "a", "b", "2026-10-13"),
  );
  assert.equal(refused.status, 400);
  assert.equal(refused.detail, "unknown stop: X");
  const down = setup(() => ({
    status: 502,
    json: { error: "transit data is temporarily unavailable" },
  }));
  assert.equal((await down.fail((u) => u.routes(none))).status, 502);
});

test("a body of the wrong shape is unreadable", async () => {
  const { fail } = setup(() => ({
    status: 200,
    json: { routes: [{ code: 1 }] },
  }));
  assert.equal(
    (await fail((u) => u.routes(none))).message,
    "upstream reply unreadable",
  );
});

test("a request that never answers fails after 15 seconds", async () => {
  let hung!: () => void;
  const reached = new Promise<void>((resolve) => (hung = resolve));
  const silent = HttpClient.make(() =>
    Effect.andThen(
      Effect.sync(() => hung()),
      Effect.never,
    ),
  );
  const layer = ProxyUpstream.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, silent)),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnvRecord({
          UPSTREAM_PROXY_URL: "https://metro.example",
        }),
      ),
    ),
  );
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const upstream = yield* ReferenceUpstream;
      const fiber = yield* Effect.forkChild(Effect.flip(upstream.routes(none)));
      // The clock moves only once the request is waiting, whatever ran before it.
      yield* Effect.promise(() => reached);
      yield* TestClock.adjust("15 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
  );
  assert.equal(error.message, "upstream timed out");
});

test("the proxy needs no login and no proxy URL means no proxy", async () => {
  const { run } = setup(() => ({ status: 200, json: {} }));
  assert.equal(await run((u) => Effect.succeed(u.needsLogin)), false);
  await assert.rejects(
    Effect.runPromise(
      Effect.gen(function* () {
        yield* ReferenceUpstream;
      }).pipe(
        Effect.provide(
          ProxyUpstream.pipe(
            Layer.provide(
              Layer.succeed(
                HttpClient.HttpClient,
                fakeHttpClient(() => ({ status: 200 })).client,
              ),
            ),
            Layer.provide(
              ConfigProvider.layer(ConfigProvider.fromEnvRecord({})),
            ),
          ),
        ),
      ),
    ),
  );
});
