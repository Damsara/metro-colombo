import { Cause, Clock, Effect, Exit, Layer, Option, Schema } from "effect";
import { HttpMiddleware, HttpRouter } from "effect/http";
import {
  ReferenceName,
  ReferenceStatus,
  RoutesFile,
  S,
  STATUS_KEY,
} from "@metro/core";
import { FleetClient, LIVE_JSON_KEY } from "@metro/fleet";
import { ReferenceReader } from "./reader.js";
import { json, noStore, unavailable } from "./responses.js";

export const LIVE_TTL_SECONDS = 5;
export const LIVE_FLEET_TIMEOUT_MS = 1_000;
export const STATUS_TTL_SECONDS = 60;
export const REACHABLE_WITHIN_MS = 2 * 3_600_000;

// Health checks and live map polls would drown out everything else in traces and request logs.
const untraced = <A, E, R>(handler: Effect.Effect<A, E, R>) =>
  HttpMiddleware.withLoggerDisabled(Effect.withTracerEnabled(handler, false));

const ageAt = (now: number, at: number) => Math.max(0, now - at);

export const StatusRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const reader = yield* ReferenceReader;
    const clock = yield* Clock.Clock;
    const client = yield* FleetClient;
    const isLive = Schema.is(S.LiveFeed);
    const published = reader.direct(
      LIVE_JSON_KEY,
      S.LiveFeed,
      LIVE_TTL_SECONDS,
    );

    // The published file trails the Fleet by up to a tick, so it only stands in when the Fleet can't answer.
    const live = client.live.pipe(
      Effect.timeout(LIVE_FLEET_TIMEOUT_MS),
      Effect.provideService(Clock.Clock, clock),
      Effect.exit,
      Effect.flatMap((exit) =>
        Exit.isSuccess(exit) && isLive(exit.value)
          ? Effect.succeed(Option.some<S.LiveFeed>(exit.value))
          : Effect.andThen(
              Effect.logWarning(
                "live snapshot from the Fleet unavailable",
                Exit.isSuccess(exit)
                  ? "invalid document"
                  : Cause.squash(exit.cause) instanceof Error
                    ? (Cause.squash(exit.cause) as Error).name
                    : "failed",
              ),
              published,
            ),
      ),
    );

    const health = Effect.gen(function* () {
      const routes = yield* Effect.option(
        reader.typed(ReferenceName.routes, RoutesFile),
      );
      const status = Option.flatten(
        yield* Effect.option(
          reader.direct(STATUS_KEY, ReferenceStatus, STATUS_TTL_SECONDS),
        ),
      );
      const snapshot = Option.flatten(yield* Effect.option(live));
      const now = clock.currentTimeMillisUnsafe();
      const reachable = Option.exists(
        status,
        (last) => last.ok && now - last.checked_at <= REACHABLE_WITHIN_MS,
      );
      const lastSuccess = Option.flatMap(status, (last) =>
        Option.fromNullishOr(last.last_success_at),
      );
      return noStore(
        json({
          ok: Option.isSome(routes),
          routes_count: Option.match(routes, {
            onNone: () => null,
            onSome: (list) => list.length,
          }),
          upstream: reachable ? "reachable" : "unreachable",
          live: Option.match(snapshot, {
            onNone: () => null,
            onSome: (doc) => ({
              stale: doc.stale === true,
              age_ms: doc.timestamp ? ageAt(now, doc.timestamp) : null,
              ...(doc.reason ? { reason: doc.reason } : {}),
            }),
          }),
          reference_age_ms: Option.match(lastSuccess, {
            onNone: () => null,
            onSome: (at) => ageAt(now, at),
          }),
        }),
      );
    });

    const snapshot = Effect.gen(function* () {
      const doc = yield* live;
      const now = clock.currentTimeMillisUnsafe();
      return noStore(
        json(
          Option.match(doc, {
            onNone: () => ({
              success: false,
              count: 0,
              timestamp: 0,
              buses: [],
            }),
            onSome: (found) => ({
              success: found.success,
              count: found.count,
              timestamp: found.timestamp,
              ...(found.timestamp
                ? { age_ms: ageAt(now, found.timestamp) }
                : {}),
              buses: found.buses,
              ...(found.stale === undefined ? {} : { stale: found.stale }),
              ...(found.reason ? { reason: found.reason } : {}),
            }),
          }),
        ),
      );
    }).pipe(
      Effect.catchTag("ReferenceMissing", (error) =>
        Effect.as(
          Effect.logWarning("live snapshot unavailable", error.message),
          noStore(unavailable()),
        ),
      ),
    );

    return HttpRouter.addAll(
      [
        HttpRouter.route("GET", "/health", untraced(health)),
        HttpRouter.route("GET", "/live", untraced(snapshot)),
      ],
      { prefix: "/api" },
    );
  }),
);
