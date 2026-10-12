import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { Alerts, type AlertsShape, StateStore } from "@metro/core";
import { memoryStateStore, recordingAlerts, testClockAt } from "@metro/core/testing";
import { type AlertBookShape, isQuietHour, makeAlertBook } from "@metro/fleet";
import { alertsSuite, capturedLogs } from "./suites/alerts.suite.ts";

alertsSuite(test, "ntfy");

const T0 = Date.parse("2026-10-12T08:00:00+05:30");
const MINUTE = 60_000;
const down = { urgent: true, title: "Live buses: feed stale", message: "No positions." };
const back = { title: "Live buses: feed back", message: "Positions again." };

const withBook = <A>(backing: Map<string, string>, sent: { readonly alerts: AlertsShape }, at: number, use: (book: AlertBookShape) => Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () { return yield* use(yield* makeAlertBook); }).pipe(
      Effect.provide(Layer.mergeAll(Layer.succeed(StateStore, memoryStateStore(backing)), Layer.succeed(Alerts, sent.alerts), testClockAt(at), capturedLogs().layer)),
    ),
  );

test("a problem alerts once an hour while it lasts, and resolving it sends one notice", async () => {
  const alerts = recordingAlerts();
  await withBook(new Map(), alerts, T0, (book) =>
    Effect.gen(function* () {
      yield* book.raise("feed_stale", down);
      yield* TestClock.adjust(30 * MINUTE);
      yield* book.raise("feed_stale", down);
      yield* TestClock.adjust(31 * MINUTE);
      yield* book.raise("feed_stale", down);
      yield* book.resolve("feed_stale", back);
      yield* book.resolve("feed_stale", back);
    }),
  );
  assert.deepEqual(alerts.sent.map((alert) => alert.title), [down.title, down.title, back.title]);
});

test("quiet hours run from 23:00 to 05:00 Colombo time", () => {
  const colombo = (time: string) => Date.parse(`2026-10-12T${time}+05:30`);
  assert.equal(isQuietHour(colombo("22:59:59")), false);
  assert.equal(isQuietHour(colombo("23:00:00")), true);
  assert.equal(isQuietHour(colombo("02:30:00")), true);
  assert.equal(isQuietHour(colombo("04:59:59")), true);
  assert.equal(isQuietHour(colombo("05:00:00")), false);
});

test("resolving a problem that never alerted sends nothing", async () => {
  const alerts = recordingAlerts();
  await withBook(new Map(), alerts, T0, (book) => book.resolve("archive_failing", back));
  assert.deepEqual(alerts.sent, []);
});

test("the book survives a restart", async () => {
  const backing = new Map<string, string>();
  const alerts = recordingAlerts();
  await withBook(backing, alerts, T0, (book) => book.raise("login", down));
  const open = await withBook(backing, alerts, T0 + 10 * MINUTE, (book) => Effect.andThen(book.raise("login", down), book.open));
  assert.equal(alerts.sent.length, 1);
  assert.deepEqual(open, ["login"]);
});

test("two raises at once for one problem send once", async () => {
  const alerts = recordingAlerts();
  const slow = { alerts: { send: (alert: typeof down) => Effect.andThen(Effect.yieldNow, alerts.alerts.send(alert)) } };
  await withBook(new Map(), slow, T0, (book) =>
    Effect.all([book.raise("login", down), book.raise("login", down)], { concurrency: "unbounded" }),
  );
  assert.equal(alerts.sent.length, 1);
});

test("an unreadable book starts empty with a warning that leaves out what was stored", async () => {
  const logs = capturedLogs();
  const backing = new Map([["alerts", JSON.stringify({ login: "secret-value" })]]);
  const open = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* makeAlertBook).open;
    }).pipe(
      Effect.provide(
        Layer.mergeAll(Layer.succeed(StateStore, memoryStateStore(backing)), Layer.succeed(Alerts, recordingAlerts().alerts), testClockAt(T0), logs.layer),
      ),
    ),
  );
  assert.deepEqual(open, []);
  assert.equal(logs.lines.some((line) => line.includes("unreadable")), true);
  assert.equal(logs.lines.some((line) => line.includes("secret-value")), false);
});
