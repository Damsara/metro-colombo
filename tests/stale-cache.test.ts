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
      {
        name: "test",
        freshTtl: Duration.minutes(10),
        staleTtl: Duration.minutes(30),
        capacity: 4,
      },
    );

    assert.equal(yield* get("a"), "v1:a");
    assert.equal(yield* get("a"), "v1:a");
    assert.equal(calls, 1);

    upstreamOk = false;
    yield* TestClock.adjust(Duration.minutes(20));

    assert.equal(yield* get("a"), "v1:a");
    yield* Effect.yieldNow;
    assert.equal(calls, 2);

    yield* TestClock.adjust(Duration.minutes(20));

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
      {
        name: "test",
        freshTtl: Duration.minutes(10),
        staleTtl: Duration.minutes(30),
        capacity: 2,
      },
    );

    assert.equal(yield* get("a"), "value-a");
    assert.equal(yield* get("b"), "value-b");
    assert.equal(yield* get("c"), "value-c");

    upstreamOk = false;
    yield* TestClock.adjust(Duration.minutes(15));

    assert.equal(yield* get("c"), "value-c");
    assert.ok(
      Exit.isFailure(yield* Effect.exit(get("a"))),
      "evicted keys have no stale value",
    );
  });

  await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
});

test("answers stale requests at once and refreshes once in the background", async () => {
  const program = Effect.gen(function* () {
    let calls = 0;
    const get = yield* staleCache(
      (key: string) =>
        Effect.gen(function* () {
          calls += 1;
          if (calls > 1) yield* Effect.sleep(Duration.seconds(10));
          return `v${calls}:${key}`;
        }),
      {
        name: "test",
        freshTtl: Duration.minutes(10),
        staleTtl: Duration.minutes(30),
        capacity: 4,
      },
    );

    assert.equal(yield* get("a"), "v1:a");
    yield* TestClock.adjust(Duration.minutes(11));

    assert.equal(yield* get("a"), "v1:a");
    assert.equal(yield* get("a"), "v1:a");
    yield* Effect.yieldNow;
    assert.equal(calls, 2);

    yield* TestClock.adjust(Duration.seconds(10));
    yield* Effect.yieldNow;
    assert.equal(yield* get("a"), "v2:a");
    assert.equal(calls, 2);
  });

  await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
});

test("waits for the origin when there is nothing usable to serve", async () => {
  const program = Effect.gen(function* () {
    let calls = 0;
    const get = yield* staleCache(
      (key: string) =>
        Effect.sync(() => {
          calls += 1;
          return `v${calls}:${key}`;
        }),
      {
        name: "test",
        freshTtl: Duration.minutes(10),
        staleTtl: Duration.minutes(30),
        capacity: 4,
      },
    );

    assert.equal(yield* get("a"), "v1:a");
    yield* TestClock.adjust(Duration.minutes(31));
    assert.equal(yield* get("a"), "v2:a");
  });

  await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
});

test("past serveStaleFor, waits for a fresh value and falls back to the old one only on failure", async () => {
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
      {
        name: "test",
        freshTtl: Duration.minutes(1),
        serveStaleFor: Duration.minutes(2),
        staleTtl: Duration.minutes(10),
        capacity: 4,
      },
    );

    assert.equal(yield* get("a"), "v1:a");
    yield* TestClock.adjust(Duration.seconds(90));
    assert.equal(yield* get("a"), "v1:a");
    yield* Effect.yieldNow;
    assert.equal(calls, 2);

    yield* TestClock.adjust(Duration.minutes(3));
    assert.equal(yield* get("a"), "v3:a");

    upstreamOk = false;
    yield* TestClock.adjust(Duration.minutes(3));
    assert.equal(yield* get("a"), "v3:a");

    yield* TestClock.adjust(Duration.minutes(8));
    assert.ok(Exit.isFailure(yield* Effect.exit(get("a"))));
  });

  await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
});
