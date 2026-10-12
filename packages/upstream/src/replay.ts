import { Clock, Effect, Layer, Option, Schema } from "effect";
import {
  type ArchiveRow,
  COLOMBO_UTC_OFFSET_MS,
  decodeArchiveChunk,
  isIsoDate,
  ObjectStore,
  parseJson,
} from "@metro/core";
import { ReplayConfig } from "./config.js";
import {
  FeedError,
  type FeedHandlers,
  LiveFeed,
  type RouteCode,
} from "./live-feed.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const STEP_MS = 1_000;
const WARM_START_MS = 60_000;

export const colomboDayStart = (day: string) =>
  Date.parse(`${day}T00:00:00+05:30`);

export const replayInstant = (now: number, day: string, speed: number) =>
  colomboDayStart(day) +
  ((((now + COLOMBO_UTC_OFFSET_MS) % DAY_MS) * speed) % DAY_MS);

export const replayHourKey = (day: string, hour: number) =>
  `replay/${day}/${String(hour).padStart(2, "0")}.ndjson.gz`;

export const replayRoutesKey = (day: string) => `replay/${day}/routes.json`;

export const toUpstreamFix = (row: ArchiveRow, shiftMs: number) => ({
  bus_id: row.bus_id,
  lat: row.lat,
  lng: row.lng,
  ...(row.registration === undefined
    ? {}
    : { registration_number: row.registration }),
  ...(row.route_id === undefined ? {} : { route_id: row.route_id }),
  ...(row.route_code === undefined ? {} : { route_code: row.route_code }),
  ...(row.direction_id === undefined ? {} : { direction_id: row.direction_id }),
  ...(row.heading === undefined ? {} : { heading: row.heading }),
  ...(row.passengers === undefined ? {} : { current_capacity: row.passengers }),
  ...(row.capacity === undefined ? {} : { total_capacity: row.capacity }),
  ...(row.reported_at === undefined
    ? {}
    : { timestamp: row.reported_at + shiftMs }),
});

const RoutesFile = Schema.Array(
  Schema.Struct({ id: Schema.String, code: Schema.String }),
);

export const ReplayFeed = Layer.effect(
  LiveFeed,
  Effect.gen(function* () {
    const { date, speed } = yield* ReplayConfig;
    if (!isIsoDate(date) || !(speed > 0)) {
      return yield* new FeedError({
        message: "REPLAY_DATE must be YYYY-MM-DD and REPLAY_SPEED above 0",
      });
    }
    const store = yield* ObjectStore;
    const dayStart = colomboDayStart(date);

    const loadHour = (hour: number) =>
      store.get(replayHourKey(date, hour)).pipe(
        Effect.mapError((error) => new FeedError({ message: error.message })),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed<ArchiveRow[]>([]),
            onSome: (object) =>
              Effect.tryPromise({
                try: () => decodeArchiveChunk(object.body),
                catch: () =>
                  new FeedError({ message: `replay hour ${hour} unreadable` }),
              }),
          }),
        ),
        Effect.map((rows) =>
          rows.sort((a, b) => a.received_at - b.received_at),
        ),
      );

    const run = (_token: unknown, handlers: FeedHandlers) =>
      Effect.gen(function* () {
        let hour = -1;
        let rows: ArchiveRow[] = [];
        let cursor = 0;
        let last = Number.NEGATIVE_INFINITY;
        while (true) {
          const now = yield* Clock.currentTimeMillis;
          const instant = replayInstant(now, date, speed);
          const currentHour = Math.floor((instant - dayStart) / HOUR_MS);
          const batch: unknown[] = [];
          if (currentHour !== hour || instant < last) {
            const advancing = hour >= 0 && currentHour !== hour;
            if (advancing) {
              while (cursor < rows.length) {
                batch.push(toUpstreamFix(rows[cursor], now - instant));
                cursor += 1;
              }
            }
            rows = [];
            rows = yield* loadHour(currentHour);
            hour = currentHour;
            const from = advancing
              ? Number.NEGATIVE_INFINITY
              : instant - WARM_START_MS;
            cursor = rows.findIndex(
              (candidate) => candidate.received_at > from,
            );
            if (cursor < 0) cursor = rows.length;
          }
          while (cursor < rows.length && rows[cursor].received_at <= instant) {
            batch.push(toUpstreamFix(rows[cursor], now - instant));
            cursor += 1;
          }
          last = instant;
          handlers.onMessage();
          handlers.onBatch(batch);
          yield* Effect.sleep(STEP_MS);
        }
      });

    const routes = () =>
      store.get(replayRoutesKey(date)).pipe(
        Effect.mapError((error) => new FeedError({ message: error.message })),
        Effect.map(
          Option.flatMap((object) =>
            parseJson(new TextDecoder().decode(object.body)),
          ),
        ),
        Effect.map(Option.flatMap(Schema.decodeUnknownOption(RoutesFile))),
        Effect.map(
          Option.match({
            onNone: (): ReadonlyArray<RouteCode> => [],
            onSome: (list) => list.map(({ id, code }) => ({ id, code })),
          }),
        ),
      );

    return LiveFeed.of({ needsLogin: false, run, routes });
  }),
);
