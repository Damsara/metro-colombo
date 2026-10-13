import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect";
import { HttpClient } from "effect/http";
import {
  fakeHttpClient,
  type FakeReply,
  type FakeRequest,
} from "@metro/core/testing";
import {
  LankaMetroReference,
  ReferenceUpstream,
  ReferenceUpstreamFromConfig,
  type ReferenceUpstreamShape,
} from "@metro/upstream";

const EIMSKY = "https://metrobusapiprod.eimsky.com/fare-service/api/v1";
const LK = "https://lankametro.lk";
const GEOJSON = "https://storage.googleapis.com/lmt/CM06-0.geojson";
const SECRET = "webview-secret";
const TOKEN = Option.some(Redacted.make(SECRET));

const direction = {
  id: "d1",
  start_location: "Kollupitiya",
  end_location: "Bambalapitiya",
  status: "active",
  geojson_url: GEOJSON,
};
const upstreamRoute = {
  code: "CM06",
  id: "route-1",
  name: "Kollupitiya Circular Route",
  status: "active",
  is_favorite: false,
  directions: [direction],
};
const stop = {
  id: "stop-1",
  stop_code: "KCR100",
  stop_name_en: " Kollupitiya\n",
  stop_name_si: "කොල්ලුපිටිය ",
  stop_name_tm: "\nகொள்ளுப்பிட்டி",
  sequence_number: 1,
  latitude: 6.9120149,
  longitude: 79.850639,
  status: "active",
};
const ICS =
  "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261025\r\nSUMMARY:Vap Full Moon Poya Day\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

type Replies = Record<
  string,
  FakeReply | ((request: FakeRequest) => FakeReply)
>;

const REPLIES: Replies = {
  [`${EIMSKY}/routes/geo`]: {
    status: 200,
    json: { data: { routes: [upstreamRoute] } },
  },
  [`${LK}/api/routes`]: {
    status: 200,
    json: { routes: [{ code: "CM06", color_hex: "#491C80" }] },
  },
  [`${EIMSKY}/routes/route-1/stops`]: {
    status: 200,
    json: { data: { stops: [stop] } },
  },
  [`${EIMSKY}/journeys/plan`]: {
    status: 200,
    json: {
      data: {
        from_stop: { id: "stop-1" },
        to_stop: { id: "stop-2" },
        date: "2026-10-13",
        queried_at: "2026-10-13T04:47:00Z",
        is_now: true,
        options: [{ option_token: "booking", duration: 12 }],
      },
    },
  },
  [GEOJSON]: { status: 200, json: { type: "FeatureCollection", features: [] } },
  [`${LK}/api/places`]: {
    status: 200,
    json: {
      places: [
        {
          id: 1,
          name: " Lotus Tower ",
          name_si: "si",
          name_ta: "ta",
          category: "Landmark",
          nearest_stop_id: 7,
          walk_meters: 657,
        },
        {
          id: 2,
          name: "Nowhere",
          name_si: "",
          name_ta: "",
          category: "Landmark",
          nearest_stop_id: 99,
          walk_meters: 1,
        },
      ],
    },
  },
  [`${LK}/api/stops`]: {
    status: 200,
    json: { stops: [{ id: 7, stop_code: "MCC48", eimsky_id: "stop-48" }] },
  },
  ["https://ics.calendarlabs.com/517/c90b2261/Sri_Lanka_Holidays.ics"]: {
    status: 200,
    text: ICS,
  },
};

const setup = (overrides: Replies = {}, env: Record<string, string> = {}) => {
  const replies = { ...REPLIES, ...overrides };
  const http = fakeHttpClient((request) => {
    const reply = replies[`${request.url.origin}${request.url.pathname}`];
    return typeof reply === "function"
      ? reply(request)
      : (reply ?? {
          status: 404,
          json: { error: { message: "no such path" } },
        });
  });
  const layer = LankaMetroReference.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http.client)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
  );
  const use = <A, E>(f: (u: ReferenceUpstreamShape) => Effect.Effect<A, E>) =>
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

test("routes need a session, and without one nothing is asked", async () => {
  const { fail, http } = setup();
  const error = await fail((u) => u.routes(Option.none()));
  assert.equal(error.status, 502);
  assert.equal(error.message, "no upstream session");
  assert.equal(http.requests.length, 0);
});

test("routes are read with the session and coloured as production colours them", async () => {
  const { run, http } = setup();
  const routes = await run((u) => u.routes(TOKEN));
  assert.equal(http.requests[0].headers.authorization, `Bearer ${SECRET}`);
  assert.equal(
    JSON.stringify(routes),
    '[{"code":"CM06","id":"route-1","name":"Kollupitiya Circular Route","status":"active","is_favorite":false,"directions":[{"id":"d1","start_location":"Kollupitiya","end_location":"Bambalapitiya","status":"active","geojson_url":"https://storage.googleapis.com/lmt/CM06-0.geojson"}],"color_hex":"#491C80"}]',
  );
});

test("routes fail when lankametro.lk's colours fail, so the last coloured file is kept", async () => {
  const { fail } = setup({
    [`${LK}/api/routes`]: { status: 500, text: "down" },
  });
  assert.equal(
    (await fail((u) => u.routes(TOKEN))).message,
    "route colours unavailable",
  );
});

test("an upstream refusal keeps its status and message, and never the token", async () => {
  const { fail } = setup({
    [`${EIMSKY}/routes/geo`]: {
      status: 401,
      json: { error: { message: "token expired" } },
    },
  });
  const error = await fail((u) => u.routes(TOKEN));
  assert.equal(error.status, 401);
  assert.equal(error.detail, "token expired");
  assert.doesNotMatch(
    `${JSON.stringify(error)} ${String(error)}`,
    new RegExp(SECRET),
  );
});

test("stops are asked for by route and direction id, with their names trimmed", async () => {
  const { run, http } = setup();
  const [found] = await run((u) =>
    u.stops(TOKEN, { ...upstreamRoute }, direction),
  );
  assert.equal(http.requests[0].url.search, "?direction_id=d1");
  assert.deepEqual(
    [found.stop_name_en, found.stop_name_si, found.stop_name_tm],
    ["Kollupitiya", "කොල්ලුපිටිය", "கொள்ளுப்பிட்டி"],
  );
});

test("a journey drops the booking token and keeps the rest", async () => {
  const { run, http } = setup();
  const plan = await run((u) =>
    u.journey(TOKEN, "stop-1", "stop-2", "2026-10-13"),
  );
  assert.deepEqual(plan.options, [{ duration: 12 }]);
  assert.equal(
    http.requests[0].url.search,
    "?from_stop_id=stop-1&to_stop_id=stop-2&date=2026-10-13",
  );
});

test("geometry is read only from Google Cloud Storage, through lankametro.lk when GCS fails", async () => {
  const outside = setup();
  const error = await outside.fail((u) =>
    u.geometry(TOKEN, upstreamRoute, {
      ...direction,
      geojson_url: "https://evil.example/x",
    }),
  );
  assert.equal(error.message, "unexpected geometry URL");
  assert.equal(outside.http.requests.length, 0);

  const proxied = setup({
    [GEOJSON]: { status: 503, text: "busy" },
    [`${LK}/gcs-proxy/lmt/CM06-0.geojson`]: {
      status: 200,
      json: { type: "FeatureCollection", features: [] },
    },
  });
  assert.deepEqual(
    await proxied.run((u) => u.geometry(TOKEN, upstreamRoute, direction)),
    {
      type: "FeatureCollection",
      features: [],
    },
  );
});

test("places are linked to their nearest stop, and unlinked ones dropped", async () => {
  const { run } = setup();
  assert.equal(
    JSON.stringify(await run((u) => u.places)),
    '[{"id":1,"name":"Lotus Tower","name_si":"si","name_ta":"ta","category":"Landmark","walk_meters":657,"stop_code":"MCC48","stop_id":"stop-48"}]',
  );
});

test("occasions come from the holiday feed with the fixed days added", async () => {
  const { run } = setup();
  const occasions = await run((u) => u.occasions);
  assert.deepEqual(
    occasions.find((o) => o.kind === "poya"),
    {
      date: "2026-10-25",
      title: "Vap Full Moon Poya Day",
      kind: "poya",
    },
  );
  assert.ok(
    occasions.some((o) => o.date === "2027-01-01" && o.kind === "newYear"),
  );
});

test("an empty holiday feed is a failure, not an empty list", async () => {
  const { fail } = setup({
    ["https://ics.calendarlabs.com/517/c90b2261/Sri_Lanka_Holidays.ics"]: {
      status: 200,
      text: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    },
  });
  assert.equal(
    (await fail((u) => u.occasions)).message,
    "holiday feed is empty",
  );
});

test("UPSTREAM chooses the implementation, and is required", async () => {
  const kind = (env: Record<string, string>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return (yield* ReferenceUpstream).needsLogin;
      }).pipe(
        Effect.provide(
          ReferenceUpstreamFromConfig.pipe(
            Layer.provide(
              Layer.succeed(
                HttpClient.HttpClient,
                fakeHttpClient(() => ({ status: 200 })).client,
              ),
            ),
            Layer.provide(
              ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)),
            ),
          ),
        ),
      ),
    );
  assert.equal(await kind({ UPSTREAM: "lankametro" }), true);
  assert.equal(
    await kind({
      UPSTREAM: "proxy",
      UPSTREAM_PROXY_URL: "https://metro.example",
    }),
    false,
  );
  await assert.rejects(kind({}));
});
