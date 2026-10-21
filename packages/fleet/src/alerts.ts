import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  Semaphore,
} from "effect";
import { HttpBody, HttpClient } from "effect/http";
import {
  type Alert,
  Alerts,
  COLOMBO_UTC_OFFSET_MS,
  StateStore,
} from "@metro/core";
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
              .post(Redacted.value(url), {
                // Plain text with title, priority and tags headers is ntfy's format; other webhooks still get the text.
                headers: {
                  title: alert.title,
                  priority: alert.critical
                    ? "max"
                    : alert.urgent
                      ? "high"
                      : "default",
                  tags: alert.urgent ? "rotating_light" : "white_check_mark",
                },
                body: HttpBody.text(alert.message),
              })
              .pipe(
                // An unread response is aborted later by a GC callback, which workerd rejects outside a request.
                Effect.tap((response) => Effect.ignore(response.arrayBuffer)),
                Effect.flatMap((response) =>
                  response.status >= 200 && response.status <= 299
                    ? Effect.logInfo(alert.title, alert.message)
                    : Effect.logWarning("alert rejected", response.status),
                ),
                Effect.timeout("10 seconds"),
                // The error's message carries the request url, which is the secret.
                Effect.catch((error) =>
                  Effect.logWarning(
                    "alert not sent",
                    "reason" in error ? error.reason._tag : error._tag,
                  ),
                ),
              ),
        }),
    });
  }),
);

export type Problem =
  | "login"
  | "feed_stale"
  | "archive_failing"
  | "reference_failing";

// Only a login needs a person, so only its alert escalates when nobody acts on it.
export const ESCALATE_AFTER_MS: Partial<Record<Problem, number>> = {
  login: 15 * 60_000,
};

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
const Book = Schema.Record(
  Schema.String,
  Schema.Struct({
    since: Schema.Number,
    sentAt: Schema.Number,
    escalated: Schema.optional(Schema.Boolean),
  }),
);
type Stored = Option.Option<typeof Book.Type>;

export const makeAlertBook = Effect.gen(function* () {
  const state = yield* StateStore;
  const alerts = yield* Alerts;
  const empty = (reason: string) =>
    Effect.as(Effect.logWarning(reason), Option.none() as Stored);
  const stored: Stored = yield* state.get("alerts").pipe(
    Effect.flatMap((found) =>
      Option.match(found, {
        onNone: () => Effect.succeed(Option.none() as Stored),
        onSome: (value) =>
          Option.match(Schema.decodeUnknownOption(Book)(value), {
            onNone: () => empty("alert book unreadable, starting empty"),
            onSome: (entries) => Effect.succeed(Option.some(entries)),
          }),
      }),
    ),
    Effect.catch(() => empty("alert book not loaded, starting empty")),
  );
  const book: Record<
    string,
    { since: number; sentAt: number; escalated?: boolean }
  > = Option.match(
    stored,
    {
      onNone: () => ({}),
      onSome: (entries) => ({ ...entries }),
    },
  );
  const save = state
    .set("alerts", book)
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning("alert book not saved", error.message),
      ),
    );
  const lock = yield* Semaphore.make(1);

  const raise = (problem: Problem, alert: Alert) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const entry = book[problem];
        const escalateAfter = ESCALATE_AFTER_MS[problem];
        if (
          entry &&
          !entry.escalated &&
          escalateAfter !== undefined &&
          now - entry.since >= escalateAfter
        ) {
          yield* alerts.send({
            ...alert,
            critical: true,
            title: `Still down after ${Math.round((now - entry.since) / 60_000)} minutes: ${alert.title}`,
          });
          book[problem] = { ...entry, sentAt: now, escalated: true };
          return yield* save;
        }
        if (entry && now - entry.sentAt < HOUR_MS) return;
        yield* alerts.send(alert);
        book[problem] = { ...entry, since: entry?.since ?? now, sentAt: now };
        yield* save;
      }),
    );

  const resolve = (problem: Problem, alert: Alert) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (!book[problem]) return;
        delete book[problem];
        yield* save;
        yield* alerts.send(alert);
      }),
    );

  const shape: AlertBookShape = {
    raise,
    resolve,
    open: Effect.sync(() => Object.keys(book) as Problem[]),
  };
  return shape;
});

export class AlertBook extends Context.Service<AlertBook, AlertBookShape>()(
  "metro/AlertBook",
) {
  static readonly layer = Layer.effect(AlertBook, makeAlertBook);
}
