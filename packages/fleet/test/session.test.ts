import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { Alerts, StateError, StateStore, type StateStoreShape } from "@metro/core";
import { memoryStateStore, recordingAlerts, testClockAt } from "@metro/core/testing";
import { AuthClient } from "@metro/upstream";
import { makeAlertBook, makeSession, type SessionShape } from "@metro/fleet";
import { fakeLankaMetro } from "./support/fake-lanka-metro.ts";

const T0 = Date.parse("2026-10-12T08:00:00+05:30");
const MINUTE = 60_000;
const expired = { refreshToken: "stored", webviewToken: "old", expiresAt: T0 - MINUTE, refreshedAt: T0 - 61 * MINUTE };

const setup = (options: { session?: unknown; env?: Record<string, string>; state?: StateStoreShape } = {}) => {
  const log: string[] = [];
  const upstream = fakeLankaMetro(log);
  const backing = new Map<string, string>();
  if (options.session) backing.set("session", JSON.stringify(options.session));
  const base = options.state ?? memoryStateStore(backing);
  const state: StateStoreShape = {
    ...base,
    set: (key, value) =>
      Effect.andThen(
        Effect.sync(() => void log.push(`save ${key}${key === "session" ? ` ${(value as { refreshToken: string }).refreshToken}` : ""}`)),
        base.set(key, value),
      ),
  };
  const alerts = recordingAlerts();
  const env = options.env ?? { METRO_PHONE: "0771234567" };
  const layer = Layer.mergeAll(
    AuthClient.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, upstream.client))),
    Layer.succeed(StateStore, state),
    Layer.succeed(Alerts, alerts.alerts),
  ).pipe(Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))), Layer.provideMerge(testClockAt(T0)));
  const run = <A>(use: (session: SessionShape) => Effect.Effect<A>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* makeSession(yield* makeAlertBook);
        return yield* use(session);
      }).pipe(Effect.provide(layer)),
    );
  return { upstream, alerts, backing, log, run };
};

const tokenText = (token: Option.Option<Redacted.Redacted<string>>) => Option.getOrUndefined(Option.map(token, Redacted.value));

test("concurrent callers share one refresh", async () => {
  const { upstream, run } = setup({ session: expired });
  const tokens = await run((session) => Effect.all(Array.from({ length: 5 }, () => session.token), { concurrency: "unbounded" }));
  assert.deepEqual(tokens.map(tokenText), Array(5).fill("webview-1"));
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
});

test("the new refresh token is saved before the new session is used", async () => {
  const { log, run } = setup({ session: expired });
  await run((session) => session.token);
  assert.deepEqual(log, ["call refresh", "save session refresh-1", "call webview-token", "save session refresh-1"]);
});

test("if the webview call fails after a refresh, the new refresh token is kept for the next try", async () => {
  const { upstream, backing, run } = setup({ session: expired });
  upstream.settings.webviewStatus = 503;
  const first = await run((session) => Effect.all([session.token, session.status]));
  assert.equal(tokenText(first[0]), undefined);
  assert.equal(first[1], "upstream_error");
  assert.equal(JSON.parse(backing.get("session") ?? "{}").refreshToken, "refresh-1");
  upstream.settings.webviewStatus = 200;
  await run((session) => session.token);
  assert.deepEqual(upstream.calls.refresh, ["stored", "refresh-1"]);
});

test("an upstream outage is not mistaken for a dead token", async () => {
  const { upstream, alerts, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 503;
  const status = await run((session) => Effect.andThen(Effect.andThen(session.token, session.token), session.status));
  assert.equal(status, "upstream_error");
  assert.deepEqual(upstream.calls.refresh, ["stored", "stored"]);
  assert.deepEqual(upstream.calls.checkPhone, []);
  assert.deepEqual(alerts.sent, []);
});

test("without a phone the alert still goes out but no code is requested", async () => {
  const { upstream, alerts, run } = setup({ session: expired, env: {} });
  upstream.settings.refreshStatus = 401;
  await run((session) => session.token);
  assert.deepEqual(upstream.calls.checkPhone, []);
  assert.equal(alerts.sent.length, 1);
  assert.match(alerts.sent[0].message, /Set METRO_PHONE/);
});

test("a code with nothing pending is refused without calling upstream", async () => {
  const { upstream, run } = setup({ session: expired });
  assert.deepEqual(await run((session) => session.submitCode("123456")), { _tag: "NoCodePending" });
  assert.equal(upstream.calls.verify, 0);
});

test("a wrong code is rejected and the right one logs in, saving the token first", async () => {
  const { upstream, alerts, backing, log, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 400;
  const outcomes = await run((session) =>
    Effect.gen(function* () {
      yield* session.token;
      const wrong = yield* session.submitCode("999999");
      const right = yield* session.submitCode("123456");
      return { wrong, right, token: yield* session.token, status: yield* session.status };
    }),
  );
  assert.equal(outcomes.wrong._tag, "CodeRejected");
  assert.deepEqual(outcomes.right, { _tag: "Accepted" });
  assert.equal(tokenText(outcomes.token), "webview-1");
  assert.equal(outcomes.status, "ok");
  assert.equal(backing.has("login"), false);
  assert.ok(log.indexOf("save session refresh-otp") < log.lastIndexOf("call webview-token"));
  assert.deepEqual(alerts.sent.map((alert) => alert.title), ["Live buses are down: login needed", "Live buses: login restored"]);
});

test("codes go out at most every 10 minutes while the login is needed", async () => {
  const { upstream, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 400;
  await run((session) =>
    Effect.gen(function* () {
      yield* session.token;
      yield* TestClock.adjust(9 * MINUTE);
      yield* session.token;
      yield* TestClock.adjust(MINUTE);
      yield* session.token;
    }),
  );
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
  assert.equal(upstream.calls.checkPhone.length, 2);
});

test("a storage read failure is not empty storage: no seed, no refresh, no alert", async () => {
  const failing: StateStoreShape = {
    get: () => Effect.fail(new StateError({ message: "storage unavailable" })),
    set: () => Effect.void,
    delete: () => Effect.void,
  };
  const { upstream, alerts, run } = setup({ env: { METRO_PHONE: "0771234567", METRO_REFRESH_TOKEN: "seed" }, state: failing });
  const result = await run((session) => Effect.all([session.token, session.status]));
  assert.equal(tokenText(result[0]), undefined);
  assert.notEqual(result[1], "login_needed");
  assert.deepEqual(upstream.calls.refresh, []);
  assert.deepEqual(alerts.sent, []);
});

test("a seed is taken into empty storage and saved there", async () => {
  const { upstream, backing, run } = setup({ env: { METRO_REFRESH_TOKEN: "seed" } });
  await run((session) => session.token);
  assert.deepEqual(upstream.calls.refresh, ["seed"]);
  assert.equal(JSON.parse(backing.get("session") ?? "{}").refreshToken, "refresh-1");
});

test("a rate-limited refresh is an outage: no code and no alert", async () => {
  const { upstream, alerts, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 429;
  const status = await run((session) => Effect.andThen(session.token, session.status));
  assert.equal(status, "upstream_error");
  assert.deepEqual(upstream.calls.checkPhone, []);
  assert.deepEqual(alerts.sent, []);
});

test("a 401 refresh is a dead token", async () => {
  const { upstream, alerts, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 401;
  const status = await run((session) => Effect.andThen(session.token, session.status));
  assert.equal(status, "login_needed");
  assert.deepEqual(upstream.calls.checkPhone, ["+94771234567"]);
  assert.equal(alerts.sent.length, 1);
});

test("a stored session with more than 2 minutes left is reused without a refresh", async () => {
  const live = { refreshToken: "stored", webviewToken: "live", expiresAt: T0 + 3 * MINUTE, refreshedAt: T0 - 57 * MINUTE };
  const { upstream, run } = setup({ session: live });
  const token = await run((session) => session.token);
  assert.equal(tokenText(token), "live");
  assert.deepEqual(upstream.calls.refresh, []);
});

test("concurrent callers while a login is needed request one code", async () => {
  const memory = memoryStateStore(new Map([["session", JSON.stringify(expired)]]));
  const slow: StateStoreShape = { ...memory, set: (key, value) => Effect.andThen(Effect.yieldNow, memory.set(key, value)) };
  const { upstream, run } = setup({ state: slow });
  upstream.settings.refreshStatus = 400;
  await run((session) =>
    Effect.gen(function* () {
      yield* session.token;
      yield* TestClock.adjust(10 * MINUTE);
      yield* Effect.all(Array.from({ length: 5 }, () => session.token), { concurrency: "unbounded" });
    }),
  );
  assert.equal(upstream.calls.checkPhone.length, 2);
});

test("a failed session write after a refresh keeps the new refresh token for the next try", async () => {
  const backing = new Map([["session", JSON.stringify(expired)]]);
  const memory = memoryStateStore(backing);
  let failWrites = true;
  const flaky: StateStoreShape = {
    ...memory,
    set: (key, value) => (failWrites ? Effect.fail(new StateError({ message: "write failed" })) : memory.set(key, value)),
  };
  const { upstream, run } = setup({ state: flaky });
  await run((session) =>
    Effect.gen(function* () {
      yield* session.token;
      failWrites = false;
      yield* session.token;
    }),
  );
  assert.deepEqual(upstream.calls.refresh, ["stored", "refresh-1"]);
  assert.equal(JSON.parse(backing.get("session") ?? "{}").refreshToken, "refresh-2");
});
