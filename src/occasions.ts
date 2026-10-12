import { Cause, Clock, Context, Duration, Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import {
  addDays,
  FALLBACK_OCCASIONS,
  type Occasion,
  parseIcs,
  toOccasions,
  upcomingFrom,
} from "@metro/core";
import { countFallback, countRequest } from "./auth.js";
import { OccasionsConfig } from "./config.js";
import { staleCache, UpstreamError } from "./upstream.js";

const FEED_TIMEOUT = Duration.seconds(15);
// Warn this long before the feed runs out, while there's time to find a new one.
const FEED_ENDING_DAYS = 60;

const COLOMBO_UTC_OFFSET_MS = 5.5 * 3_600_000;

const colomboToday = Clock.currentTimeMillis.pipe(
  Effect.map((now) =>
    new Date(now + COLOMBO_UTC_OFFSET_MS).toISOString().slice(0, 10),
  ),
);

export class Occasions extends Context.Service<
  Occasions,
  {
    readonly upcoming: (
      today: string,
    ) => Effect.Effect<ReadonlyArray<Occasion>>;
  }
>()("lmt-go/Occasions") {
  static readonly layer = Layer.effect(
    Occasions,
    Effect.gen(function* () {
      const { icsUrl } = yield* OccasionsConfig;
      const http = yield* HttpClient.HttpClient;
      const fetchFeed = Effect.gen(function* () {
        const response = yield* http.get(icsUrl).pipe(
          Effect.tapError(() => countRequest("occasions", "transport")),
          Effect.mapError(
            (cause) =>
              new UpstreamError({ message: "holiday feed unreachable", cause }),
          ),
        );
        if (response.status < 200 || response.status >= 300) {
          yield* countRequest("occasions", "http_error");
          return yield* new UpstreamError({
            message: `holiday feed responded with HTTP ${response.status}`,
            status: response.status,
          });
        }
        const text = yield* response.text.pipe(
          Effect.mapError(
            (cause) =>
              new UpstreamError({ message: "holiday feed unreadable", cause }),
          ),
        );
        const events = parseIcs(text);
        if (events.length === 0) {
          yield* countRequest("occasions", "decode_error");
          return yield* new UpstreamError({ message: "holiday feed is empty" });
        }
        yield* countRequest("occasions", "ok");
        const last = events.reduce(
          (latest, event) => (event.date > latest ? event.date : latest),
          "",
        );
        if (last < addDays(yield* colomboToday, FEED_ENDING_DAYS))
          yield* Effect.logWarning("holiday feed ends soon", { last });
        const years = events.map((event) => Number(event.date.slice(0, 4)));
        return toOccasions(events, Math.min(...years), Math.max(...years) + 1);
      }).pipe(
        Effect.timeout(FEED_TIMEOUT),
        Effect.catchIf(Cause.isTimeoutError, () =>
          Effect.andThen(
            countRequest("occasions", "timeout"),
            Effect.fail(
              new UpstreamError({ message: "holiday feed timed out" }),
            ),
          ),
        ),
        Effect.withSpan("Occasions.fetchFeed"),
      );
      const feed = yield* staleCache(() => fetchFeed, {
        name: "occasions",
        freshTtl: Duration.hours(24),
        staleTtl: Duration.days(30),
        capacity: 1,
      });
      return Occasions.of({
        upcoming: (today) =>
          feed("all").pipe(
            Effect.tapError((error) =>
              Effect.andThen(
                countFallback("occasions"),
                Effect.logWarning("holiday feed unavailable", error),
              ),
            ),
            Effect.orElseSucceed(() => FALLBACK_OCCASIONS),
            Effect.map((all) => upcomingFrom(all, today)),
          ),
      });
    }),
  );
}
