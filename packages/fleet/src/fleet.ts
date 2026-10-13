import {
  Clock,
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  type Redacted,
} from "effect";
import { type Fix, ObjectStore, Scheduler, toFix } from "@metro/core";
import { LiveFeed, type RouteCode } from "@metro/upstream";
import { AlertBook, isQuietHour } from "./alerts.js";
import { FleetConfig } from "./config.js";
import { makeLivePublisher } from "./publisher.js";
import { makeRecorder } from "./recorder.js";
import {
  type LoginStatus,
  makeSession,
  NO_CODE_PENDING,
  type SubmitOutcome,
} from "./session.js";
import {
  FEED_QUIET_MS,
  FRESH_FIX_MS,
  type LiveDocument,
  staleReason,
} from "./snapshot.js";

export const TICK_MS = 5_000;
// The feed chats every few seconds, so a longer silence means the line is dead.
export const SILENT_AFTER_MS = 30_000;
export const ROUTES_EVERY_MS = 3_600_000;
export const ROUTES_RETRY_MS = 60_000;
export const ARCHIVE_ALERT_AFTER_MS = 15 * 60_000;
export const SHUTDOWN_FLUSH_MS = 10_000;
export const ROUTES_TIMEOUT_MS = 15_000;
export const TICK_DEADLINE_MS = 30_000;

// Only a session that delivered gps frames resets the backoff, so an upstream that keeps hanging up isn't redialled in a tight loop.
export const reconnectDelay = (failures: number) =>
  failures === 0 ? 1_000 : Math.min(60_000, 1_000 * 2 ** failures);

export type FeedState = "connected" | "connecting" | "down";

export type FleetStatus = {
  readonly login: LoginStatus | "not_used";
  readonly feed: FeedState;
  readonly age_ms: number | null;
  readonly lastArchiveWriteAt: number | null;
  readonly pendingRows: number;
  readonly droppedRows: number;
};

export type FleetShape = {
  readonly start: Effect.Effect<void>;
  readonly tick: Effect.Effect<void>;
  readonly status: Effect.Effect<FleetStatus>;
  readonly live: Effect.Effect<LiveDocument>;
  readonly submitCode: (code: string) => Effect.Effect<SubmitOutcome>;
  readonly token: Effect.Effect<Option.Option<Redacted.Redacted<string>>>;
  readonly shutdown: Effect.Effect<void>;
};

const makeFleet = Effect.gen(function* () {
  const config = yield* FleetConfig;
  const feed = yield* LiveFeed;
  const store = yield* ObjectStore;
  const scheduler = yield* Scheduler;
  const clock = yield* Clock.Clock;
  const scope = yield* Effect.scope;
  const alerts = yield* AlertBook;
  const session = yield* makeSession(alerts);
  const recorder = yield* makeRecorder({ store, instance: config.instance });
  const publisher = yield* makeLivePublisher(store);

  const fixes = new Map<string, Fix>();
  let routes: ReadonlyArray<RouteCode> = [];
  let routesDueAt = 0;
  let running = false;
  let fiber: Fiber.Fiber<void> | undefined;
  let lastMessageAt = 0;
  let lastBatchAt = 0;
  let sessionHadData = false;
  let sessionHeardFrom = false;
  let failures = 0;
  let reconnectAt = 0;
  let restored = false;
  let shutDown = false;
  let ticking = false;
  const startedAt = clock.currentTimeMillisUnsafe();

  // Any gps frame counts, even an empty one, so a quiet night on a live feed doesn't read as the feed being down.
  const handlers = {
    onMessage: () => {
      lastMessageAt = clock.currentTimeMillisUnsafe();
      sessionHeardFrom = true;
    },
    onBatch: (payload: ReadonlyArray<unknown>) => {
      const receivedAt = clock.currentTimeMillisUnsafe();
      lastBatchAt = receivedAt;
      sessionHadData = true;
      for (const value of payload) {
        const fix = toFix(value, receivedAt);
        if (!fix) continue;
        fixes.set(fix.id, fix);
        recorder.record(fix);
      }
    },
  };

  const noToken = Effect.succeed(Option.none<Redacted.Redacted<string>>());
  const token = feed.needsLogin ? session.token : noToken;
  const loginNeeded = feed.needsLogin
    ? Effect.map(session.status, (status) => status === "login_needed")
    : Effect.succeed(false);

  const closed = Effect.sync(() => {
    running = false;
    failures = sessionHadData ? 0 : failures + 1;
    reconnectAt = clock.currentTimeMillisUnsafe() + reconnectDelay(failures);
  });

  const superviseFeed = (
    current: Option.Option<Redacted.Redacted<string>>,
    mustStop: boolean,
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (
        running &&
        fiber &&
        (mustStop || now - lastMessageAt > SILENT_AFTER_MS)
      )
        yield* Fiber.interrupt(fiber);
      if (shutDown || running || now < reconnectAt) return;
      if (feed.needsLogin && Option.isNone(current)) return;
      yield* Effect.uninterruptibleMask((restore) => {
        running = true;
        sessionHadData = false;
        sessionHeardFrom = false;
        lastMessageAt = now;
        return restore(
          feed
            .run(current, handlers)
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("live feed closed", error.message),
              ),
            ),
        ).pipe(
          Effect.ensuring(closed),
          Effect.forkIn(scope, { startImmediately: true }),
          Effect.tap((forked) => Effect.sync(() => void (fiber = forked))),
        );
      });
    });

  const refreshRoutes = (current: Option.Option<Redacted.Redacted<string>>) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (now < routesDueAt) return;
      if (feed.needsLogin && Option.isNone(current)) return;
      routesDueAt = now + ROUTES_RETRY_MS;
      routes = yield* feed
        .routes(current)
        .pipe(Effect.timeout(ROUTES_TIMEOUT_MS));
      routesDueAt = now + ROUTES_EVERY_MS;
    }).pipe(
      Effect.catchTag("TimeoutError", () =>
        Effect.logWarning("route codes not refreshed", "timed out"),
      ),
      Effect.catch((error) =>
        Effect.logWarning("route codes not refreshed", error.message),
      ),
    );

  const snapshotInput = (now: number) =>
    Effect.map(loginNeeded, (needed) => ({
      now,
      fixes: [...fixes.values()],
      routes,
      lastBatchAt,
      reason: staleReason({ now, lastBatchAt, loginNeeded: needed }),
    }));

  const publish = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const [id, fix] of fixes)
      if (now - fix.receivedAt > FRESH_FIX_MS) fixes.delete(id);
    yield* publisher.publish(yield* snapshotInput(now));
  });

  const live = Effect.suspend(() =>
    Effect.map(
      snapshotInput(clock.currentTimeMillisUnsafe()),
      publisher.current,
    ),
  );

  const checkAlerts = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (now - Math.max(lastBatchAt, startedAt) > FEED_QUIET_MS) {
      if (!isQuietHour(now) && !(yield* loginNeeded)) {
        yield* alerts.raise("feed_stale", {
          urgent: true,
          title: "Live buses: feed stale",
          message: "No positions from the live feed for over 2 minutes.",
        });
      }
    } else {
      yield* alerts.resolve("feed_stale", {
        title: "Live buses: feed back",
        message: "Positions are arriving again.",
      });
    }
    const archive = yield* recorder.status;
    if (
      archive.failingSince !== null &&
      now - archive.failingSince > ARCHIVE_ALERT_AFTER_MS
    ) {
      yield* alerts.raise("archive_failing", {
        urgent: true,
        title: "Fleet archive: writes failing",
        message: `Archive uploads have failed for over 15 minutes; ${archive.pendingRows} rows pending, ${archive.droppedRows} dropped.`,
      });
    } else if (archive.failingSince === null) {
      yield* alerts.resolve("archive_failing", {
        title: "Fleet archive: writes recovered",
        message: "Archive uploads are succeeding again.",
      });
    }
  });

  const work = Effect.gen(function* () {
    const current = yield* token;
    yield* superviseFeed(current, yield* loginNeeded);
    yield* refreshRoutes(current);
    yield* publish;
    yield* recorder.flushIfDue;
    yield* checkAlerts;
  }).pipe(
    Effect.timeout(TICK_DEADLINE_MS),
    Effect.catchCause((cause) => Effect.logError("fleet tick failed", cause)),
  );

  // Overlapping ticks would race the publisher, so a tick that finds one running only reschedules.
  const tick = Effect.suspend(() =>
    shutDown
      ? Effect.void
      : Effect.uninterruptibleMask((restore) => {
          if (ticking) return Effect.void;
          ticking = true;
          return Effect.ensuring(
            restore(work),
            Effect.sync(() => void (ticking = false)),
          );
        }).pipe(Effect.ensuring(scheduler.wakeAfter(TICK_MS))),
  ).pipe(Effect.withSpan("Fleet.tick"));

  const start = Effect.gen(function* () {
    if (!restored) {
      restored = true;
      yield* publisher.restore;
    }
    if (Option.isNone(yield* scheduler.next)) yield* scheduler.wakeAfter(1_000);
  });

  const status = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const archive = yield* recorder.status;
    const login: FleetStatus["login"] = feed.needsLogin
      ? yield* session.status
      : "not_used";
    const state: FeedState = !running
      ? "down"
      : sessionHeardFrom
        ? "connected"
        : "connecting";
    const result: FleetStatus = {
      login,
      feed: state,
      age_ms: lastBatchAt ? now - lastBatchAt : null,
      lastArchiveWriteAt: archive.lastWriteAt,
      pendingRows: archive.pendingRows,
      droppedRows: archive.droppedRows,
    };
    return result;
  });

  // The recorder's flush holds its own non-re-entrant lock, so shutdown calls it once and outside any other lock.
  const shutdown = Effect.gen(function* () {
    if (shutDown) return;
    shutDown = true;
    yield* Effect.andThen(
      fiber ? Fiber.interrupt(fiber) : Effect.void,
      recorder.flush,
    ).pipe(Effect.timeoutOption(SHUTDOWN_FLUSH_MS), Effect.asVoid);
  });

  yield* Effect.addFinalizer(() => shutdown);

  const shape: FleetShape = {
    start,
    tick,
    status,
    live,
    submitCode: (code) =>
      feed.needsLogin
        ? session.submitCode(code)
        : Effect.succeed(NO_CODE_PENDING),
    token,
    shutdown,
  };
  return shape;
});

export class Fleet extends Context.Service<Fleet, FleetShape>()("metro/Fleet") {
  static readonly layer = Layer.effect(Fleet, makeFleet).pipe(
    Layer.provideMerge(AlertBook.layer),
  );
}
