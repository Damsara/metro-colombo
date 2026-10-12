import assert from "node:assert/strict";
import { Effect, Option } from "effect";
import type { ObjectStoreShape } from "@metro/core";
import type { Register } from "@metro/core/testing";

export type WithObjectStore = (
  body: (store: ObjectStoreShape) => Promise<void>,
) => Promise<void>;

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (body: Uint8Array) => new TextDecoder().decode(body);
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export function objectStoreSuite(
  test: Register,
  name: string,
  withStore: WithObjectStore,
) {
  // Keys are unique per test because some stores are shared between tests.
  const base = () => `contract/${crypto.randomUUID()}`;

  test(`${name}: an object comes back with its body, type and caching`, () =>
    withStore(async (store) => {
      const key = `${base()}/live/live.json`;
      await run(
        store.put(key, bytes('{"ok":true}'), {
          contentType: "application/json",
          cacheControl: "public, max-age=5",
        }),
      );
      const found = await run(store.get(key));
      assert.ok(Option.isSome(found));
      assert.equal(text(found.value.body), '{"ok":true}');
      assert.equal(found.value.contentType, "application/json");
      assert.equal(found.value.cacheControl, "public, max-age=5");
    }));

  test(`${name}: a missing key is none`, () =>
    withStore(async (store) => {
      assert.ok(Option.isNone(await run(store.get(`${base()}/missing.json`))));
    }));

  test(`${name}: a put replaces the earlier object and its metadata`, () =>
    withStore(async (store) => {
      const key = `${base()}/x.json`;
      await run(
        store.put(key, bytes("1"), {
          contentType: "application/json",
          cacheControl: "public, max-age=5",
        }),
      );
      await run(store.put(key, bytes("2"), { contentType: "text/plain" }));
      const found = await run(store.get(key));
      assert.ok(Option.isSome(found));
      assert.equal(text(found.value.body), "2");
      assert.equal(found.value.contentType, "text/plain");
      assert.equal(found.value.cacheControl, undefined);
    }));

  test(`${name}: list returns the keys under a prefix, sorted`, () =>
    withStore(async (store) => {
      const root = base();
      for (const key of [
        "raw/2026-10-12/080500-fleet.ndjson.gz",
        "raw/2026-10-12/080000-fleet.ndjson.gz",
        "raw/2026-10-13/000000-fleet.ndjson.gz",
        "today/date=2026-10-12/through=08.parquet",
        "rawer.json",
      ]) {
        await run(
          store.put(`${root}/${key}`, bytes(key), {
            contentType: "application/octet-stream",
          }),
        );
      }
      assert.deepEqual(await run(store.list(`${root}/raw/2026-10-12/`)), [
        `${root}/raw/2026-10-12/080000-fleet.ndjson.gz`,
        `${root}/raw/2026-10-12/080500-fleet.ndjson.gz`,
      ]);
      assert.deepEqual(await run(store.list(`${root}/today/`)), [
        `${root}/today/date=2026-10-12/through=08.parquet`,
      ]);
    }));

  test(`${name}: delete removes an object and deleting a missing one succeeds`, () =>
    withStore(async (store) => {
      const key = `${base()}/gone.json`;
      await run(
        store.put(key, bytes("x"), { contentType: "application/json" }),
      );
      await run(store.delete(key));
      await run(store.delete(key));
      assert.ok(Option.isNone(await run(store.get(key))));
    }));

  test(`${name}: binary bodies survive byte for byte`, () =>
    withStore(async (store) => {
      const key = `${base()}/raw/chunk.ndjson.gz`;
      const body = Uint8Array.from([31, 139, 8, 0, 0, 255, 128, 1]);
      await run(store.put(key, body, { contentType: "application/x-ndjson" }));
      const found = await run(store.get(key));
      assert.ok(Option.isSome(found));
      assert.deepEqual([...found.value.body], [...body]);
    }));
}
