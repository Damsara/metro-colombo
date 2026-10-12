import { Clock, Effect, Layer, Option, Schema } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { type Alert, Alerts, COLOMBO_UTC_OFFSET_MS, StateStore } from "@metro/core";
import { FleetConfig } from "./config.js";

export const NtfyAlerts = Layer.effect(
  Alerts,
  Effect.gen(function* () {
    const { alertWebhookUrl } = yield* FleetConfig;
    const http = yield* HttpClient.HttpClient;
    return Alerts.of({
      send: (alert) =>
        Option.match(alertWebhookUrl, {
          onNone: () => Effect.logWarning(alert.title, alert.message),
          onSome: (url) =>
            http
              .post(url, {
                // Plain text with title, priority and tags headers is ntfy's format; other webhooks still get the text.
                headers: {
                  title: alert.title,
                  priority: alert.urgent ? "high" : "default",
                  tags: alert.urgent ? "rotating_light" : "white_check_mark",
                },
                body: HttpBody.text(alert.message),
              })
              .pipe(
                Effect.flatMap((response) =>
                  response.status < 300 ? Effect.void : Effect.logWarning("alert rejected", response.status),
                ),
                Effect.timeout("10 seconds"),
                Effect.catch((error) => Effect.logWarning("alert not sent", error)),
                Effect.andThen(Effect.logInfo(alert.title, alert.message)),
              ),
        }),
    });
  }),
);

export type Problem = "login" | "feed_stale" | "archive_failing";

// No bus runs overnight, so a silent feed then is expected rather than a fault.
export const QUIET_HOURS = { from: 23, until: 5 } as const;

export const isQuietHour = (ms: number) => {
  const hour = new Date(ms + COLOMBO_UTC_OFFSET_MS).getUTCHours();
  return hour >= QUIET_HOURS.from || hour < QUIET_HOURS.until;
};

export type AlertBookShape = {
  readonly raise: (problem: Problem, alert: Alert) => Effect.Effect<void>;
  readonly resolve: (problem: Problem, alert: Alert) => Effect.Effect<void>;
  readonly open: Effect.Effect<ReadonlyArray<Problem>>;
};

const HOUR_MS = 3_600_000;
const Book = Schema.Record(Schema.String, Schema.Struct({ since: Schema.Number, sentAt: Schema.Number }));

export const makeAlertBook = Effect.gen(function* () {
  const state = yield* StateStore;
  const alerts = yield* Alerts;
  const stored = yield* state.get("alerts").pipe(
    Effect.map(Option.flatMap(Schema.decodeUnknownOption(Book))),
    Effect.orElseSucceed(() => Option.none()),
  );
  const book: Record<string, { since: number; sentAt: number }> = Option.match(stored, {
    onNone: () => ({}),
    onSome: (entries) => ({ ...entries }),
  });
  const save = state.set("alerts", book).pipe(Effect.catch((error) => Effect.logWarning("alert book not saved", error.message)));

  const raise = (problem: Problem, alert: Alert) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const entry = book[problem];
      if (entry && now - entry.sentAt < HOUR_MS) return;
      yield* alerts.send(alert);
      book[problem] = { since: entry?.since ?? now, sentAt: now };
      yield* save;
    });

  const resolve = (problem: Problem, alert: Alert) =>
    Effect.gen(function* () {
      if (!book[problem]) return;
      delete book[problem];
      yield* save;
      yield* alerts.send(alert);
    });

  const shape: AlertBookShape = { raise, resolve, open: Effect.sync(() => Object.keys(book) as Problem[]) };
  return shape;
});
