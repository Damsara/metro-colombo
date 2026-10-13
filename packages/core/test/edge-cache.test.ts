import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock, Effect, Option } from "effect";
import { makeMemoryEdgeCache } from "@metro/core";
import { manualClock } from "@metro/core/testing";
import { edgeCacheSuite } from "./suites/edge-cache.suite.ts";

const T0 = Date.parse("2099-10-13T09:00:00+05:30");
const made = (time = manualClock(T0), capacity?: number) =>
  Effect.runSync(
    makeMemoryEdgeCache(capacity).pipe(Effect.provide(time.layer)),
  );

edgeCacheSuite(test, "memory", (body) => body(made()));

test("a memory entry expires after its TTL", async () => {
  const time = manualClock(T0);
  const cache = made(time);
  await Effect.runPromise(cache.put("k", new Uint8Array([1]), 60));
  time.advance(59_999);
  assert.ok(Option.isSome(await Effect.runPromise(cache.get("k"))));
  time.advance(1);
  assert.ok(Option.isNone(await Effect.runPromise(cache.get("k"))));
});

test("the memory cache drops the oldest entry past its capacity", async () => {
  const cache = made(manualClock(T0), 2);
  for (const key of ["a", "b", "c"])
    await Effect.runPromise(cache.put(key, new Uint8Array([1]), 60));
  assert.ok(Option.isNone(await Effect.runPromise(cache.get("a"))));
  assert.ok(Option.isSome(await Effect.runPromise(cache.get("c"))));
});

test("a manual clock is the time Effect reads", async () => {
  const time = manualClock(T0);
  const read = Clock.currentTimeMillis.pipe(Effect.provide(time.layer));
  assert.equal(await Effect.runPromise(read), T0);
  time.advance(5);
  assert.equal(await Effect.runPromise(read), T0 + 5);
});
