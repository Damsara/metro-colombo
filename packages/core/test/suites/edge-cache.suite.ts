import assert from "node:assert/strict";
import { Effect, Option } from "effect";
import type { EdgeCacheShape } from "@metro/core";
import type { Register } from "@metro/core/testing";

export type WithEdgeCache = (
  body: (cache: EdgeCacheShape) => Promise<void>,
) => Promise<void>;

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (body: Uint8Array) => new TextDecoder().decode(body);
const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

export function edgeCacheSuite(
  test: Register,
  name: string,
  withCache: WithEdgeCache,
) {
  // Keys are unique per test because some caches are shared between tests.
  const key = () => `contract/${crypto.randomUUID()}`;

  test(`${name}: a cached body comes back`, () =>
    withCache(async (cache) => {
      const k = key();
      await run(cache.put(k, bytes('{"routes":[]}'), 60));
      const found = await run(cache.get(k));
      assert.ok(Option.isSome(found));
      assert.equal(text(found.value), '{"routes":[]}');
    }));

  test(`${name}: a key never put is a miss`, () =>
    withCache(async (cache) => {
      assert.ok(Option.isNone(await run(cache.get(key()))));
    }));

  test(`${name}: a later put replaces the body`, () =>
    withCache(async (cache) => {
      const k = key();
      await run(cache.put(k, bytes("one"), 60));
      await run(cache.put(k, bytes("two"), 60));
      const found = await run(cache.get(k));
      assert.equal(Option.isSome(found) && text(found.value), "two");
    }));

  test(`${name}: changing a body after putting it doesn't change the cache`, () =>
    withCache(async (cache) => {
      const k = key();
      const body = bytes("kept");
      await run(cache.put(k, body, 60));
      body[0] = 0;
      const found = await run(cache.get(k));
      assert.equal(Option.isSome(found) && text(found.value), "kept");
    }));
}
