import { Clock, Effect, Fiber, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import {
  colomboDay,
  EdgeCache,
  isIsoDate,
  isStopUuid,
  parseJson,
  ReferenceName,
  StopIdsFile,
} from "@metro/core";
import { FleetClient } from "@metro/fleet";
import { ReferenceUpstream } from "@metro/upstream";
import { type ReferenceMissing, ReferenceReader } from "./reader.js";
import { BadRequest, CACHE, respond } from "./responses.js";

export const JOURNEY_TTL_SECONDS = 60;
const TOKEN_TIMEOUT = "3 seconds";

const JourneyQuery = Schema.Struct({
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString,
  date: Schema.optional(Schema.String),
});

export const JourneyRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const reader = yield* ReferenceReader;
    const upstream = yield* ReferenceUpstream;
    const client = yield* FleetClient;
    const cache = yield* EdgeCache;
    const clock = yield* Clock.Clock;
    const token = upstream.needsLogin
      ? client.token.pipe(
          Effect.forkDetach,
          Effect.flatMap(Fiber.join),
          Effect.timeoutOption(TOKEN_TIMEOUT),
          Effect.map(Option.flatten),
          Effect.provideService(Clock.Clock, clock),
        )
      : Effect.succeed(Option.none());
    const utf8 = new TextEncoder();
    const decoder = new TextDecoder();

    const resolve = (
      ref: string,
      ids: Effect.Effect<Readonly<Record<string, string>>, ReferenceMissing>,
    ) =>
      isStopUuid(ref)
        ? Effect.succeed(ref)
        : Effect.flatMap(ids, (known) =>
            Object.hasOwn(known, ref) && known[ref]
              ? Effect.succeed(known[ref])
              : Effect.fail(
                  new BadRequest({ message: `unknown stop: ${ref}` }),
                ),
          );

    const journey = Effect.gen(function* () {
      const query = yield* HttpServerRequest.schemaSearchParams(
        JourneyQuery,
      ).pipe(
        Effect.mapError(
          () =>
            new BadRequest({
              message: "`from` and `to` (stop_code or stop uuid) are required",
            }),
        ),
      );
      const date = query.date ?? colomboDay(clock.currentTimeMillisUnsafe());
      if (!isIsoDate(date))
        return yield* new BadRequest({ message: "`date` must be YYYY-MM-DD" });
      const ids = yield* Effect.cached(
        reader.typed(ReferenceName.stopIds, StopIdsFile),
      );
      const from = yield* resolve(query.from, ids);
      const to = yield* resolve(query.to, ids);
      const key = `journey/${from}|${to}|${date}`;
      const cached = Option.flatMap(yield* cache.get(key), (body) =>
        parseJson(decoder.decode(body)),
      );
      if (Option.isSome(cached)) return cached.value;
      const plan = yield* upstream.journey(yield* token, from, to, date).pipe(
        Effect.catchIf(
          (error) => error.status === 400 && error.detail !== undefined,
          (error) => Effect.fail(new BadRequest({ message: error.detail! })),
        ),
      );
      yield* cache.put(
        key,
        utf8.encode(JSON.stringify(plan)),
        JOURNEY_TTL_SECONDS,
      );
      return plan;
    });

    // The default date is today, and today's plans carry live estimates, so browsers don't keep them.
    return HttpRouter.addAll(
      [HttpRouter.route("GET", "/journey", respond(journey, CACHE.none))],
      { prefix: "/api" },
    );
  }),
);
