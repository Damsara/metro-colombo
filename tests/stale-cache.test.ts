import assert from "node:assert/strict";
import { test } from "node:test";
import { Duration, Effect, Exit } from "effect";
import { TestClock } from "effect/testing";
import { staleCache, UpstreamError } from "../src/upstream.js";

test("serves the last good value when revalidation fails, then degrades past the stale window", async () => {
  const program = Effect.gen(function* () {
    let upstreamOk = true;
    let calls = 0;
    const get = yield* staleCache(
      (key: string) =>
        Effect.gen(function* () {
          calls += 1;
          if (!upstreamOk) {
            return yield* Effect.fail(
              new UpstreamError({ message: "upstream down" }),
            );
          }
          return `v${calls}:${key}`;
        }),
      { freshTtl: Duration.minutes(10), staleTtl: Duration.minutes(30), capacity: 4 },
    );

    assert.equal(yield* get("a"), "v1:a");
    assert.equal(yield* get("a"), "v1:a"); // cache hit
    assert.equal(calls, 1);

    upstreamOk = false;
    yield* TestClock.adjust(Duration.minutes(20)); // past fresh, within stale

    // Revalidation fails; the last good value is served.
    assert.equal(yield* get("a"), "v1:a");
    assert.equal(calls, 2);

    yield* TestClock.adjust(Duration.minutes(20)); // 40 min total: past stale

    const result = yield* Effect.exit(get("a"));
    assert.ok(Exit.isFailure(result));
  });

  await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
});

test("serves each key independently and evicts the least recently refreshed", async () => {
  const program = Effect.gen(function* () {
    let upstreamOk = true;
    const get = yield* staleCache(
      (key: string) =>
        upstreamOk
          ? Effect.succeed(`value-${key}`)
          : Effect.fail(new UpstreamError({ message: "upstream down" })),
      { freshTtl: Duration.minutes(10), staleTtl: Duration.minutes(30), capacity: 2 },
    );

    assert.equal(yield* get("a"), "value-a");
    assert.equal(yield* get("b"), "value-b");
    assert.equal(yield* get("c"), "value-c"); // evicts "a"

    upstreamOk = false;
    yield* TestClock.adjust(Duration.minutes(15)); // past fresh, within stale

    assert.equal(yield* get("c"), "value-c");
    assert.ok(Exit.isFailure(yield* Effect.exit(get("a"))), "evicted keys have no stale value");
  });

  await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
});
