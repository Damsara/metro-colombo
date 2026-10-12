import { Clock, Context, Deferred, Effect, Layer, Option, Ref } from "effect";
import type { SchedulerShape } from "@metro/core";

export const IDLE_WAKE_MS = 5_000;

export type NodeTickerShape = {
  readonly scheduler: SchedulerShape;
  readonly drive: (tick: Effect.Effect<void>) => Effect.Effect<never>;
};

type Plan = {
  readonly next: Option.Option<number>;
  readonly changed: Deferred.Deferred<void>;
};

export const makeNodeTicker = Effect.gen(function* () {
  const plan = yield* Ref.make<Plan>({
    next: Option.none(),
    changed: yield* Deferred.make<void>(),
  });
  const replan = (next: Option.Option<number>) =>
    Effect.gen(function* () {
      const changed = yield* Deferred.make<void>();
      const previous = yield* Ref.getAndSet(plan, { next, changed });
      yield* Deferred.succeed(previous.changed, undefined);
    });

  const scheduler: SchedulerShape = {
    wakeAfter: (ms) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        replan(Option.some(now + ms)),
      ),
    next: Effect.map(Ref.get(plan), ({ next }) => next),
  };

  // A wake-up set while waiting replaces the one being waited for, as a Durable Object alarm does.
  const drive = (tick: Effect.Effect<void>) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const { next, changed } = yield* Ref.get(plan);
      const wait = Option.match(next, {
        onNone: () => IDLE_WAKE_MS,
        onSome: (at) => Math.max(0, at - now),
      });
      const due = yield* Effect.raceFirst(
        Effect.as(Effect.sleep(wait), true),
        Effect.as(Deferred.await(changed), false),
      );
      if (!due) return;
      yield* replan(Option.none());
      yield* tick;
    }).pipe(Effect.forever);

  const shape: NodeTickerShape = { scheduler, drive };
  return shape;
});

export class NodeTicker extends Context.Service<NodeTicker, NodeTickerShape>()(
  "metro/NodeTicker",
) {
  static readonly layer = Layer.effect(NodeTicker, makeNodeTicker);
}
