import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Option, Schema } from "effect";
import {
  makeMemoryEdgeCache,
  MANIFEST_KEY,
  type ObjectStoreShape,
  RoutesFile,
  StoreError,
} from "@metro/core";
import {
  manualClock,
  memoryObjectStore,
  spyObjectStore,
} from "@metro/core/testing";
import { makeReferenceReader } from "@metro/api";
import { seedReference } from "./support/seed.ts";

const T0 = Date.parse("2099-10-13T09:00:00+05:30");
const ROUTES_TEXT =
  '[{"code":"CM06","id":"r","name":"n","status":"active","is_favorite":false,"directions":[],"color_hex":"#491C80"}]';

const setup = async (
  files: Record<string, unknown> | null = { routes: ROUTES_TEXT },
  inner: ObjectStoreShape = memoryObjectStore(),
) => {
  const time = manualClock(T0);
  const spy = spyObjectStore(inner);
  if (files) await Effect.runPromise(seedReference(spy.store, files));
  const cache = Effect.runSync(
    makeMemoryEdgeCache().pipe(Effect.provide(time.layer)),
  );
  const reader = Effect.runSync(
    makeReferenceReader(spy.store, cache).pipe(Effect.provide(time.layer)),
  );
  return {
    time,
    spy,
    reader,
    run: <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect),
    fail: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(Effect.flip(effect)),
  };
};

test("the manifest is read at most once a minute", async () => {
  const h = await setup();
  await h.run(h.reader.file("routes"));
  h.time.advance(59_999);
  await h.run(h.reader.file("routes"));
  assert.equal(h.spy.gets.filter((key) => key === MANIFEST_KEY).length, 1);
  h.time.advance(1);
  await h.run(h.reader.file("routes"));
  assert.equal(h.spy.gets.filter((key) => key === MANIFEST_KEY).length, 2);
});

test("a file comes from the store once and then from the edge cache", async () => {
  const h = await setup();
  await h.run(h.reader.file("routes"));
  await h.run(h.reader.file("routes"));
  const versioned = h.spy.gets.filter((key) =>
    key.startsWith("reference/routes."),
  );
  assert.equal(versioned.length, 1);
});

test("a typed file keeps the key order it was published with", async () => {
  const h = await setup();
  assert.equal(
    JSON.stringify(await h.run(h.reader.typed("routes", RoutesFile))),
    ROUTES_TEXT,
  );
});

test("no manifest, no entry, an unreadable file or the wrong shape is ReferenceMissing", async () => {
  const empty = await setup(null);
  assert.equal(
    (await empty.fail(empty.reader.file("routes")))._tag,
    "ReferenceMissing",
  );
  const h = await setup({ routes: ROUTES_TEXT, broken: "{", odd: '{"a":1}' });
  assert.equal(
    (await h.fail(h.reader.file("places")))._tag,
    "ReferenceMissing",
  );
  assert.equal(
    (await h.fail(h.reader.typed("broken", Schema.Unknown)))._tag,
    "ReferenceMissing",
  );
  assert.equal(
    (await h.fail(h.reader.typed("odd", RoutesFile)))._tag,
    "ReferenceMissing",
  );
  assert.equal(
    (await h.fail(h.reader.file("constructor")))._tag,
    "ReferenceMissing",
  );
});

test("a store that can't be read is ReferenceMissing", async () => {
  const failing: ObjectStoreShape = {
    ...memoryObjectStore(),
    get: (key) =>
      Effect.fail(new StoreError({ message: `R2 read of ${key} failed` })),
  };
  const h = await setup(null, failing);
  const error = await h.fail(h.reader.manifest);
  assert.equal(error._tag, "ReferenceMissing");
});

test("an unversioned key is read directly, cached for its TTL, and none when absent", async () => {
  const h = await setup();
  await h.run(
    h.spy.store.put("live/live.json", new TextEncoder().encode('{"count":1}'), {
      contentType: "application/json",
    }),
  );
  const Live = Schema.Struct({ count: Schema.Number });
  assert.deepEqual(
    await h.run(h.reader.direct("live/live.json", Live, 5)),
    Option.some({ count: 1 }),
  );
  await h.run(h.reader.direct("live/live.json", Live, 5));
  assert.equal(h.spy.gets.filter((key) => key === "live/live.json").length, 1);
  h.time.advance(5_000);
  await h.run(h.reader.direct("live/live.json", Live, 5));
  assert.equal(h.spy.gets.filter((key) => key === "live/live.json").length, 2);
  assert.ok(
    Option.isNone(
      await h.run(h.reader.direct("reference/status.json", Live, 60)),
    ),
  );
});
