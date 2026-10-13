import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock, Duration, Effect, Fiber, Option } from "effect";
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

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a manual clock sleep resolves only once advance reaches its deadline", async () => {
  const time = manualClock(T0);
  let woke = false;
  void Effect.runPromise(
    Effect.sleep(1000).pipe(
      Effect.provide(time.layer),
      Effect.map(() => void (woke = true)),
    ),
  );
  await tick();
  time.advance(999);
  await tick();
  assert.equal(woke, false);
  time.advance(1);
  await tick();
  assert.equal(woke, true);
});

test("manual clock sleepers resume in wake-time order", async () => {
  const time = manualClock(T0);
  const order: number[] = [];
  for (const ms of [300, 100, 200])
    void Effect.runPromise(
      Effect.sleep(ms).pipe(
        Effect.provide(time.layer),
        Effect.map(() => void order.push(ms)),
      ),
    );
  await tick();
  time.advance(500);
  await tick();
  assert.deepEqual(order, [100, 200, 300]);
});

test("a zero sleep resumes at once and an infinite sleep never does", async () => {
  const time = manualClock(T0);
  await Effect.runPromise(Effect.sleep(0).pipe(Effect.provide(time.layer)));
  let woke = false;
  void Effect.runPromise(
    Effect.sleep(Duration.infinity).pipe(
      Effect.provide(time.layer),
      Effect.map(() => void (woke = true)),
    ),
  );
  await tick();
  time.advance(Number.MAX_SAFE_INTEGER);
  await tick();
  assert.equal(woke, false);
  assert.equal(time.pending(), 0);
});

test("an interrupted manual clock sleeper is removed", async () => {
  const time = manualClock(T0);
  const fiber = Effect.runFork(
    Effect.sleep(1000).pipe(Effect.provide(time.layer)),
  );
  await tick();
  assert.equal(time.pending(), 1);
  await Effect.runPromise(Fiber.interrupt(fiber));
  assert.equal(time.pending(), 0);
});

test("Effect.timeout under a manual clock fires on advance", async () => {
  const time = manualClock(T0);
  let settled: string | undefined;
  void Effect.runPromise(
    Effect.never.pipe(
      Effect.timeout(5000),
      Effect.flip,
      Effect.provide(time.layer),
    ),
  ).then((error) => void (settled = error._tag));
  await tick();
  assert.equal(time.pending(), 1);
  time.advance(4999);
  await tick();
  assert.equal(settled, undefined);
  time.advance(1);
  await tick();
  assert.equal(settled, "TimeoutError");
});

test("advance rejects negative, NaN and infinite amounts", () => {
  const time = manualClock(T0);
  assert.throws(() => time.advance(-1), Error);
  assert.throws(() => time.advance(Number.NaN), Error);
  assert.throws(() => time.advance(Infinity), Error);
});
