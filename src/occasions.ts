import { Cause, Clock, Context, Duration, Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import { countFallback, countRequest } from "./auth.js";
import { OccasionsConfig } from "./config.js";
import {
  OCCASION_KINDS,
  type Occasion,
  type OccasionKind,
} from "./occasion-kinds.js";
import { FALLBACK_OCCASIONS } from "./occasions-fallback.js";
import { staleCache, UpstreamError } from "./upstream.js";

const RULES: ReadonlyArray<readonly [RegExp, OccasionKind]> = [
  [/vesak/i, "vesak"],
  [/poson/i, "poson"],
  [/sinhala|tamil new year/i, "avurudu"],
  [/deepavali/i, "deepavali"],
  [/christmas/i, "christmas"],
  [/pongal/i, "thaiPongal"],
  [/fitr/i, "eidUlFitr"],
  [/alha|adha/i, "eidUlAdha"],
  [/milad/i, "miladUnNabi"],
  [/sivarathri/i, "mahasivarathri"],
  [/good friday/i, "goodFriday"],
  [/national day/i, "nationalDay"],
  [/poya/i, "poya"],
  [/may day/i, "mayDay"],
];

export function classify(title: string): OccasionKind | null {
  return RULES.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

export function parseIcs(text: string): Array<{ date: string; title: string }> {
  const lines = text.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  const events: Array<{ date: string; title: string }> = [];
  let date: string | undefined;
  let title: string | undefined;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") date = title = undefined;
    const start = /^DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/.exec(line);
    if (start) date = `${start[1]}-${start[2]}-${start[3]}`;
    if (line.startsWith("SUMMARY:")) title = line.slice(8).trim();
    if (line === "END:VEVENT" && date && title) events.push({ date, title });
  }
  return events;
}

export function fixedOccasions(fromYear: number, toYear: number): Occasion[] {
  const result: Occasion[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    result.push(
      { date: `${year}-01-01`, kind: "newYear", title: "New Year's Day" },
      { date: `${year}-12-31`, kind: "newYearsEve", title: "New Year's Eve" },
    );
  }
  return result;
}

const priority = (kind: OccasionKind) => OCCASION_KINDS.indexOf(kind);

export function toOccasions(
  events: ReadonlyArray<{ date: string; title: string }>,
  fromYear: number,
  toYear: number,
): Occasion[] {
  const fromFeed = events.flatMap((event): Occasion[] => {
    const kind = classify(event.title);
    return kind ? [{ ...event, kind }] : [];
  });
  return [...fromFeed, ...fixedOccasions(fromYear, toYear)].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || priority(a.kind) - priority(b.kind),
  );
}

const UPCOMING_DAYS = 400;
const FEED_TIMEOUT = Duration.seconds(15);
// Warn this long before the feed runs out, while there's time to find a new one.
const FEED_ENDING_DAYS = 60;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const COLOMBO_UTC_OFFSET_MS = 5.5 * 3_600_000;

const colomboToday = Clock.currentTimeMillis.pipe(
  Effect.map((now) =>
    new Date(now + COLOMBO_UTC_OFFSET_MS).toISOString().slice(0, 10),
  ),
);

export function upcomingFrom(
  all: ReadonlyArray<Occasion>,
  today: string,
): Occasion[] {
  const year = Number(today.slice(0, 4));
  const until = addDays(today, UPCOMING_DAYS);
  const seen = new Set<string>();
  return [...all, ...fixedOccasions(year, year + 1)]
    .filter((o) => o.date >= today && o.date <= until)
    .filter((o) => {
      const key = `${o.date}|${o.kind}`;
      return !seen.has(key) && seen.add(key);
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || priority(a.kind) - priority(b.kind),
    );
}

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
