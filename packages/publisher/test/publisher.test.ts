import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Fiber, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import {
  FALLBACK_OCCASIONS,
  MANIFEST_CACHE,
  MANIFEST_KEY,
  type ObjectStoreShape,
  type S,
  STATUS_KEY,
  StoreError,
  VERSIONED_CACHE,
} from "@metro/core";
import {
  memoryObjectStore,
  spyObjectStore,
  testClockAt,
} from "@metro/core/testing";
import type { AlertBookShape } from "@metro/fleet";
import { makeReferencePublisher } from "@metro/publisher";
import { type ReferenceUpstreamShape, UpstreamError } from "@metro/upstream";
import { unzip } from "../../core/test/support/unzip.ts";

const T0 = Date.parse("2099-10-13T09:00:00+05:30");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const dir = (id: string, from: string, to: string) => ({
  id,
  start_location: from,
  end_location: to,
  status: "active",
  geojson_url: `https://storage.googleapis.com/lmt/${id}.geojson`,
});
const CM06: S.Route = {
  code: "CM06",
  id: "route-6",
  name: "Kollupitiya Circular Route",
  status: "active",
  is_favorite: false,
  directions: [
    dir("d1", "Kollupitiya", "Bambalapitiya"),
    dir("d2", "Bambalapitiya", "Kollupitiya"),
  ],
  color_hex: "#491C80",
};
const CM01: S.Route = {
  code: "CM01",
  id: "route-1",
  name: "Makumbura - Colombo Fort",
  status: "active",
  is_favorite: false,
  directions: [dir("c1", "Makumbura", "Colombo")],
  color_hex: "#1A5A96",
};
const stop = (id: string, code: string): S.Stop => ({
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
const line = (lng: number) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[lng, 6.9]] },
    },
  ],
});
const PLACE = {
  id: 1,
  name: "Lotus Tower Colombo",
  name_si: "",
  name_ta: "",
  category: "Landmark",
  walk_meters: 657,
  stop_code: "KCR100",
  stop_id: "s1",
};
const OCCASIONS = [
  {
    date: "2099-10-25",
    title: "Vap Full Moon Poya Day",
    kind: "poya" as const,
  },
];

const fakeUpstream = () => {
  const failing = new Set<string>();
  const hanging = new Set<string>();
  const tokens: Array<string | undefined> = [];
  const fake = {
    failing,
    hanging,
    tokens,
    onHang: () => {},
    slow: false,
    inFlight: 0,
    mostInFlight: 0,
    lines: { d1: 79.85 } as Record<string, number>,
    data: {
      routes: [CM06, CM01] as ReadonlyArray<S.Route>,
      stops: {
        d1: [stop("s1", "KCR100"), stop("s2", "KCR101")],
        d2: [stop("s2", "KCR101"), stop("s1", "KCR100")],
        c1: [stop("s9", "MKB100")],
      } as Record<string, ReadonlyArray<S.Stop>>,
    },
  };
  const answer = <A>(name: string, value: () => A) =>
    Effect.suspend(() =>
      hanging.has(name)
        ? Effect.andThen(
            Effect.sync(() => fake.onHang()),
            Effect.never,
          )
        : failing.has(name)
          ? Effect.fail(
              new UpstreamError({
                message: `${name} unavailable`,
                status: 503,
              }),
            )
          : Effect.succeed(value()),
    );
  const perDirection = <A>(effect: Effect.Effect<A, UpstreamError>) =>
    Effect.suspend(() => {
      if (!fake.slow) return effect;
      fake.mostInFlight = Math.max(fake.mostInFlight, ++fake.inFlight);
      return Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve, 2)),
      ).pipe(
        Effect.andThen(effect),
        Effect.ensuring(Effect.sync(() => void fake.inFlight--)),
      );
    });
  const upstream: ReferenceUpstreamShape = {
    needsLogin: true,
    routes: (token) =>
      Effect.andThen(
        Effect.sync(
          () =>
            void tokens.push(
              Option.getOrUndefined(Option.map(token, Redacted.value)),
            ),
        ),
        answer("routes", () => fake.data.routes),
      ),
    stops: (_token, route, direction) =>
      perDirection(
        answer(
          `stops/${route.code}/${direction.id}`,
          () => fake.data.stops[direction.id],
        ),
      ),
    geometry: (_token, route, direction) =>
      perDirection(
        answer(`paths/${route.code}/${direction.id}`, () =>
          line(fake.lines[direction.id] ?? 79.86),
        ),
      ),
    places: answer("places", () => [PLACE]),
    occasions: answer("occasions", () => OCCASIONS),
    journey: () => Effect.die("journeys aren't published"),
  };
  return Object.assign(fake, { upstream });
};

const flaky = (inner: ObjectStoreShape) => {
  let allowed = Number.POSITIVE_INFINITY;
  let refused = (_key: string) => false;
  const store: ObjectStoreShape = {
    ...inner,
    put: (key, body, options) =>
      Effect.suspend(() =>
        refused(key) || allowed-- <= 0
          ? Effect.fail(
              new StoreError({ message: `put of ${key} refused`, status: 503 }),
            )
          : inner.put(key, body, options),
      ),
  };
  return {
    store,
    failAfter: (puts: number) => void (allowed = puts),
    refuseWhen: (rule: (key: string) => boolean) => void (refused = rule),
  };
};

const setup = () => {
  const storage = flaky(memoryObjectStore());
  const objects = spyObjectStore(storage.store);
  const fake = fakeUpstream();
  const alerts: string[] = [];
  const book: AlertBookShape = {
    raise: (problem, alert) =>
      Effect.sync(() => void alerts.push(`raise ${problem}: ${alert.title}`)),
    resolve: (problem) =>
      Effect.sync(() => void alerts.push(`resolve ${problem}`)),
    open: Effect.succeed([]),
  };
  const publisher = Effect.runSync(
    makeReferencePublisher({
      store: objects.store,
      upstream: fake.upstream,
      book,
      token: Effect.succeed(Option.some(Redacted.make("webview-1"))),
    }),
  );
  const at = <A>(ms: number, effect: Effect.Effect<A>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testClockAt(ms))));
  const read = async (key: string) => {
    const found = await Effect.runPromise(objects.store.get(key));
    assert.ok(Option.isSome(found), `${key} is missing`);
    return found.value;
  };
  const json = async (key: string) =>
    JSON.parse(new TextDecoder().decode((await read(key)).body));
  const manifest = () => json(MANIFEST_KEY);
  const file = async (name: string) => json((await manifest()).files[name]);
  const putsSince = (count: number) =>
    objects.puts.slice(count).map((put) => put.key);
  return {
    storage,
    objects,
    fake,
    alerts,
    publisher,
    at,
    read,
    json,
    manifest,
    file,
    putsSince,
  };
};

test("a first run writes every file under a versioned name, then the manifest, then the status", async () => {
  const h = setup();
  const report = await h.at(T0, h.publisher.run);
  assert.equal(report.ok, true);
  const manifest = await h.manifest();
  assert.equal(manifest.updated_at, T0);
  assert.deepEqual(Object.keys(manifest.files), [
    "gtfs/static",
    "occasions",
    "paths/CM01/c1",
    "paths/CM06/d1",
    "paths/CM06/d2",
    "places",
    "routes",
    "stop-ids",
    "stops/CM01",
    "stops/CM06",
  ]);
  for (const key of Object.values(manifest.files) as string[]) {
    const object = await h.read(key);
    assert.match(key, /^reference\/.+\.[0-9a-f]{16}\.(json|zip)$/);
    assert.equal(object.cacheControl, VERSIONED_CACHE);
    assert.equal(
      object.contentType,
      key.endsWith(".zip") ? "application/zip" : "application/json",
    );
  }
  const order = h.putsSince(0);
  assert.deepEqual(order.slice(-2), [MANIFEST_KEY, STATUS_KEY]);
  assert.equal((await h.read(MANIFEST_KEY)).cacheControl, MANIFEST_CACHE);
  assert.deepEqual(await h.json(STATUS_KEY), {
    checked_at: T0,
    ok: true,
    failed: [],
    consecutive_failures: 0,
    last_success_at: T0,
  });
  assert.deepEqual(h.fake.tokens, ["webview-1"]);
});

test("the files hold what production serves", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  assert.equal(
    JSON.stringify(await h.file("routes")),
    JSON.stringify([CM06, CM01]),
  );
  const stops = await h.file("stops/CM06");
  assert.deepEqual(Object.keys(stops[0]), [
    "route_code",
    "route_name",
    "direction_id",
    "direction_label",
    "stops",
  ]);
  assert.deepEqual(
    stops.map((entry: { direction_label: string }) => entry.direction_label),
    ["Kollupitiya -> Bambalapitiya", "Bambalapitiya -> Kollupitiya"],
  );
  assert.deepEqual(await h.file("stop-ids"), {
    KCR100: "s1",
    KCR101: "s2",
    MKB100: "s9",
  });
  assert.deepEqual(await h.file("paths/CM06/d1"), line(79.85));
  const archive = (await h.read((await h.manifest()).files["gtfs/static"]))
    .body;
  assert.deepEqual([...archive.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test("an unchanged run rewrites only the status", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  const before = h.objects.puts.length;
  await h.at(T0 + HOUR, h.publisher.run);
  assert.deepEqual(h.putsSince(before), [STATUS_KEY]);
});

test("a changed stop list writes that route's stops, the stop ids, the archive and the manifest", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  const before = h.objects.puts.length;
  h.fake.data.stops = { ...h.fake.data.stops, c1: [stop("s9", "MKB101")] };
  await h.at(T0 + HOUR, h.publisher.run);
  const manifest = await h.manifest();
  assert.deepEqual(
    h.putsSince(before).sort(),
    [
      manifest.files["gtfs/static"],
      manifest.files["stop-ids"],
      manifest.files["stops/CM01"],
      MANIFEST_KEY,
      STATUS_KEY,
    ].sort(),
  );
  assert.equal(manifest.updated_at, T0 + HOUR);
});

test("a failed fetch keeps the previous file and is reported", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  const first = await h.manifest();
  h.fake.failing.add("stops/CM06/d2");
  h.fake.failing.add("places");
  const report = await h.at(T0 + HOUR, h.publisher.run);
  assert.equal(report.ok, false);
  assert.deepEqual(report.failed, ["places", "stops/CM06"]);
  assert.deepEqual(await h.manifest(), first);
  const status = await h.json(STATUS_KEY);
  assert.deepEqual(
    [
      status.ok,
      status.failed,
      status.consecutive_failures,
      status.last_success_at,
    ],
    [false, ["places", "stops/CM06"], 1, T0],
  );
});

test("a failed route list keeps every previous file", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  const first = await h.manifest();
  h.fake.failing.add("routes");
  const report = await h.at(T0 + HOUR, h.publisher.run);
  assert.deepEqual(report.failed, ["routes"]);
  assert.deepEqual(await h.manifest(), first);
});

test("a route that is no longer listed leaves the manifest, and its files stay", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  const first = await h.manifest();
  h.fake.data.routes = [CM06];
  await h.at(T0 + HOUR, h.publisher.run);
  const names = Object.keys((await h.manifest()).files);
  assert.equal(names.includes("stops/CM01"), false);
  assert.equal(names.includes("paths/CM01/c1"), false);
  await h.read(first.files["stops/CM01"]);
});

test("a failed holiday feed with nothing published before publishes the bundled list", async () => {
  const h = setup();
  h.fake.failing.add("occasions");
  const report = await h.at(T0, h.publisher.run);
  assert.deepEqual(report.failed, ["occasions"]);
  assert.deepEqual(await h.file("occasions"), FALLBACK_OCCASIONS);
});

test("three failed runs in a row raise the alert, and a good run resolves it", async () => {
  const h = setup();
  h.fake.failing.add("places");
  await h.at(T0, h.publisher.run);
  await h.at(T0 + HOUR, h.publisher.run);
  assert.deepEqual(h.alerts, []);
  await h.at(T0 + 2 * HOUR, h.publisher.run);
  assert.deepEqual(h.alerts, [
    "raise reference_failing: Reference data: updates failing",
  ]);
  h.fake.failing.clear();
  await h.at(T0 + 3 * HOUR, h.publisher.run);
  assert.equal(h.alerts.at(-1), "resolve reference_failing");
});

test("a store that fails mid-run leaves the previous manifest whole", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  const first = await h.manifest();
  h.fake.data.stops = {
    ...h.fake.data.stops,
    c1: [stop("s9", "MKB101")],
    d1: [stop("s1", "KCR100")],
  };
  h.storage.failAfter(1);
  const report = await h.at(T0 + HOUR, h.publisher.run);
  assert.deepEqual(report, { ok: false, failed: ["store"], written: [] });
  h.storage.failAfter(Number.POSITIVE_INFINITY);
  assert.deepEqual(await h.manifest(), first);
  for (const key of Object.values(first.files) as string[]) await h.read(key);
});

test("runs stopped by a store error still count, and the third raises the alert", async () => {
  const h = setup();
  h.storage.refuseWhen((key) => key !== STATUS_KEY);
  for (const hour of [0, 1, 2])
    assert.deepEqual(await h.at(T0 + hour * HOUR, h.publisher.run), {
      ok: false,
      failed: ["store"],
      written: [],
    });
  const status = await h.json(STATUS_KEY);
  assert.deepEqual(
    [status.failed, status.consecutive_failures, status.last_success_at],
    [["store"], 3, null],
  );
  assert.deepEqual(h.alerts, [
    "raise reference_failing: Reference data: updates failing",
  ]);
});

test("runIfDue runs with no status, waits 55 minutes, and doesn't wait on a status from the future", async () => {
  const h = setup();
  assert.ok(Option.isSome(await h.at(T0, h.publisher.runIfDue)));
  assert.ok(Option.isNone(await h.at(T0 + 54 * MINUTE, h.publisher.runIfDue)));
  assert.ok(Option.isSome(await h.at(T0 + 55 * MINUTE, h.publisher.runIfDue)));
  assert.ok(Option.isSome(await h.at(T0 - 10 * HOUR, h.publisher.runIfDue)));
});

test("a run whose upstream never answers gives up at 5 minutes, records it and frees the lock", async () => {
  const h = setup();
  h.fake.hanging.add("routes");
  let hung!: () => void;
  const reached = new Promise<void>((resolve) => (hung = resolve));
  h.fake.onHang = () => hung();
  let done = false;
  const report = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.tap(h.publisher.run, () =>
          Effect.sync(() => void (done = true)),
        ),
      );
      yield* Effect.promise(() => reached);
      yield* TestClock.adjust(5 * 60_000 - 1);
      yield* Effect.yieldNow;
      assert.equal(done, false);
      yield* TestClock.adjust(1);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(testClockAt(T0))),
  );
  assert.deepEqual(report, { ok: false, failed: ["timeout"], written: [] });
  const status = await h.json(STATUS_KEY);
  assert.deepEqual(
    [status.ok, status.failed, status.consecutive_failures],
    [false, ["timeout"], 1],
  );
  assert.ok(Option.isNone(await h.at(T0 + 59 * MINUTE, h.publisher.runIfDue)));
  h.fake.hanging.clear();
  assert.equal((await h.at(T0 + 6 * MINUTE, h.publisher.run)).ok, true);
  assert.ok(Option.isSome(await h.at(T0 + 61 * MINUTE, h.publisher.runIfDue)));
});

const { color_hex: _, ...CM01_UNCOLOURED } = CM01;

test("a route without a colour keeps the colour published before, in the same place", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  const before = h.objects.puts.length;
  h.fake.data.routes = [{ ...CM06, color_hex: "#000000" }, CM01_UNCOLOURED];
  const report = await h.at(T0 + HOUR, h.publisher.run);
  assert.equal(report.ok, true);
  assert.equal(
    JSON.stringify(await h.file("routes")),
    JSON.stringify([{ ...CM06, color_hex: "#000000" }, CM01]),
  );
  const manifest = await h.manifest();
  assert.deepEqual(
    h.putsSince(before).sort(),
    [
      manifest.files.routes,
      manifest.files["gtfs/static"],
      MANIFEST_KEY,
      STATUS_KEY,
    ].sort(),
  );
});

test("a route without a colour and nothing published before stays without one", async () => {
  const h = setup();
  h.fake.data.routes = [CM06, CM01_UNCOLOURED];
  await h.at(T0, h.publisher.run);
  assert.equal(
    JSON.stringify(await h.file("routes")),
    JSON.stringify([CM06, CM01_UNCOLOURED]),
  );
});

test("a route listed twice is published as listed, and the archive keeps the first of it", async () => {
  const h = setup();
  const twice = {
    ...CM01,
    id: "route-1b",
    name: "Makumbura - Kaduwela",
    directions: [dir("c2", "Makumbura", "Kaduwela")],
  };
  h.fake.data.routes = [CM06, CM01, twice];
  h.fake.data.stops = { ...h.fake.data.stops, c2: [stop("s8", "KDW100")] };
  h.fake.lines.c2 = 79.99;
  assert.equal((await h.at(T0, h.publisher.run)).ok, true);
  const files = await unzip(
    (await h.read((await h.manifest()).files["gtfs/static"])).body,
  );
  const rows = (name: string) =>
    new TextDecoder()
      .decode(files.get(name)!.bytes)
      .trim()
      .split("\r\n")
      .slice(1);
  assert.equal(
    JSON.stringify(await h.file("routes")),
    JSON.stringify([CM06, CM01, twice]),
  );
  assert.deepEqual(
    rows("routes.txt").map((row) => row.split(",").slice(0, 4).join(",")),
    [
      "CM06,LMT,CM06,Kollupitiya Circular Route",
      "CM01,LMT,CM01,Makumbura - Colombo Fort",
    ],
  );
  const shapes = rows("shapes.txt");
  assert.deepEqual(shapes, [
    "CM06_0,6.9,79.85,1",
    "CM06_1,6.9,79.86,1",
    "CM01_0,6.9,79.86,1",
  ]);
});

test("directions are fetched four at a time", async () => {
  const h = setup();
  const many = Array.from({ length: 10 }, (_, index) =>
    dir(`m${index}`, "A", "B"),
  );
  h.fake.data.routes = [{ ...CM06, directions: many }];
  h.fake.data.stops = Object.fromEntries(
    many.map((direction) => [direction.id, [stop("s1", "KCR100")]]),
  );
  h.fake.slow = true;
  assert.equal((await h.at(T0, h.publisher.run)).ok, true);
  assert.equal(h.fake.mostInFlight, 4);
});

test("a direction that is no longer listed leaves the manifest", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  h.fake.data.routes = [{ ...CM06, directions: [CM06.directions[0]] }, CM01];
  assert.equal((await h.at(T0 + HOUR, h.publisher.run)).ok, true);
  const names = Object.keys((await h.manifest()).files);
  assert.equal(names.includes("paths/CM06/d2"), false);
  assert.equal(names.includes("paths/CM06/d1"), true);
  assert.equal(names.includes("paths/CM01/c1"), true);
});

test("a status that can't be written leaves the run's report as it was", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  h.fake.data.stops = { ...h.fake.data.stops, c1: [stop("s9", "MKB101")] };
  h.storage.refuseWhen((key) => key === STATUS_KEY);
  const report = await h.at(T0 + HOUR, h.publisher.run);
  const manifest = await h.manifest();
  assert.deepEqual(report, {
    ok: true,
    failed: [],
    written: [
      manifest.files["stops/CM01"],
      manifest.files["stop-ids"],
      manifest.files["gtfs/static"],
      MANIFEST_KEY,
    ],
  });
  assert.equal((await h.json(STATUS_KEY)).checked_at, T0);
  assert.deepEqual(h.alerts, [
    "resolve reference_failing",
    "resolve reference_failing",
  ]);
  h.storage.refuseWhen(() => false);
  await h.at(T0 + 2 * HOUR, h.publisher.run);
  const status = await h.json(STATUS_KEY);
  assert.deepEqual(
    [status.checked_at, status.ok, status.consecutive_failures],
    [T0 + 2 * HOUR, true, 0],
  );
});

test("a run where one file changes and another fetch fails publishes the new key beside the old one", async () => {
  const h = setup();
  await h.at(T0, h.publisher.run);
  const first = await h.manifest();
  h.fake.data.stops = { ...h.fake.data.stops, c1: [stop("s9", "MKB101")] };
  h.fake.failing.add("places");
  const report = await h.at(T0 + HOUR, h.publisher.run);
  assert.deepEqual(report.failed, ["places"]);
  const manifest = await h.manifest();
  assert.notEqual(manifest.files["stops/CM01"], first.files["stops/CM01"]);
  assert.equal(manifest.files.places, first.files.places);
  assert.deepEqual(await h.file("stops/CM01"), [
    {
      route_code: "CM01",
      route_name: "Makumbura - Colombo Fort",
      direction_id: "c1",
      direction_label: "Makumbura -> Colombo",
      stops: [stop("s9", "MKB101")],
    },
  ]);
  assert.deepEqual(await h.file("places"), [PLACE]);
});
