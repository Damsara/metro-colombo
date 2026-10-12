import assert from "node:assert/strict";
import { Effect, Option } from "effect";
import type { SchedulerShape } from "@metro/core";
import type { Register } from "@metro/core/testing";

export type WithScheduler = (body: (scheduler: SchedulerShape) => Promise<void>) => Promise<void>;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export function schedulerSuite(test: Register, name: string, withScheduler: WithScheduler) {
  test(`${name}: nothing is scheduled at first`, () =>
    withScheduler(async (scheduler) => {
      assert.ok(Option.isNone(await run(scheduler.next)));
    }));

  test(`${name}: a later wake-up replaces an earlier one`, () =>
    withScheduler(async (scheduler) => {
      await run(scheduler.wakeAfter(5_000));
      const first = await run(scheduler.next);
      await run(scheduler.wakeAfter(60_000));
      const second = await run(scheduler.next);
      assert.ok(Option.isSome(first) && Option.isSome(second));
      const gap = second.value - first.value;
      assert.ok(gap >= 54_000 && gap <= 56_000, `gap was ${gap}`);
    }));

  test(`${name}: a sooner wake-up replaces a later one`, () =>
    withScheduler(async (scheduler) => {
      await run(scheduler.wakeAfter(60_000));
      const first = await run(scheduler.next);
      await run(scheduler.wakeAfter(5_000));
      const second = await run(scheduler.next);
      assert.ok(Option.isSome(first) && Option.isSome(second));
      const gap = first.value - second.value;
      assert.ok(gap >= 54_000 && gap <= 56_000, `gap was ${gap}`);
    }));
}
