import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Fiber, Layer, Option, Redacted } from "effect";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import {
  Alerts,
  StateError,
  StateStore,
  type StateStoreShape,
} from "@metro/core";
import {
  memoryStateStore,
  recordingAlerts,
  testClockAt,
} from "@metro/core/testing";
import { AuthClient } from "@metro/upstream";
import { makeAlertBook, makeSession, type SessionShape } from "@metro/fleet";
import { capturedLogs } from "./suites/alerts.suite.ts";
import { fakeLankaMetro } from "./support/fake-lanka-metro.ts";

const T0 = Date.parse("2026-10-12T08:00:00+05:30");
const MINUTE = 60_000;
const expired = {
  refreshToken: "stored",
  webviewToken: "old",
  expiresAt: T0 - MINUTE,
  refreshedAt: T0 - 61 * MINUTE,
};

const setup = (
  options: {
    session?: unknown;
    env?: Record<string, string>;
    state?: StateStoreShape;
  } = {},
) => {
  const log: string[] = [];
  const upstream = fakeLankaMetro(log);
  const backing = new Map<string, string>();
  if (options.session) backing.set("session", JSON.stringify(options.session));
  const base = options.state ?? memoryStateStore(backing);
  const state: StateStoreShape = {
    ...base,
    set: (key, value) =>
      Effect.andThen(
        Effect.sync(
          () =>
            void log.push(
              `save ${key}${key === "session" ? ` ${(value as { refreshToken: string }).refreshToken}` : ""}`,
            ),
        ),
        base.set(key, value),
      ),
  };
  const alerts = recordingAlerts();
  const logs = capturedLogs();
  const env = options.env ?? { METRO_PHONE: "0771234567" };
  const layer = Layer.mergeAll(
    AuthClient.layer.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, upstream.client)),
    ),
    Layer.succeed(StateStore, state),
    Layer.succeed(Alerts, alerts.alerts),
    logs.layer,
  ).pipe(
    Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
    Layer.provideMerge(testClockAt(T0)),
  );
  const run = <A>(use: (session: SessionShape) => Effect.Effect<A>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* makeSession(yield* makeAlertBook);
        return yield* use(session);
      }).pipe(Effect.provide(layer)),
    );
  return { upstream, alerts, backing, log, logs: logs.lines, run };
};

const tokenText = (token: Option.Option<Redacted.Redacted<string>>) =>
  Option.getOrUndefined(Option.map(token, Redacted.value));

test("concurrent callers share one refresh", async () => {
  const { upstream, run } = setup({ session: expired });
  const tokens = await run((session) =>
    Effect.all(
      Array.from({ length: 5 }, () => session.token),
      { concurrency: "unbounded" },
    ),
  );
  assert.deepEqual(tokens.map(tokenText), Array(5).fill("webview-1"));
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
});

test("the new refresh token is saved before the new session is used", async () => {
  const { log, run } = setup({ session: expired });
  await run((session) => session.token);
  assert.deepEqual(log, [
    "call refresh",
    "save session refresh-1",
    "call webview-token",
    "save session refresh-1",
  ]);
});

test("if the webview call fails after a refresh, the new refresh token is kept and not spent again for a minute", async () => {
  const { upstream, backing, run } = setup({ session: expired });
  upstream.settings.webviewStatus = 503;
  const result = await run((session) =>
    Effect.gen(function* () {
      const token = yield* session.token;
      const status = yield* session.status;
      const saved = JSON.parse(backing.get("session") ?? "{}").refreshToken;
      upstream.settings.webviewStatus = 200;
      yield* TestClock.adjust("1 second");
      const early = yield* session.token;
      const callsEarly = [...upstream.calls.refresh];
      yield* TestClock.adjust("60 seconds");
      const later = yield* session.token;
      return { token, status, saved, early, callsEarly, later };
    }),
  );
  assert.equal(tokenText(result.token), undefined);
  assert.equal(result.status, "upstream_error");
  assert.equal(result.saved, "refresh-1");
  assert.equal(tokenText(result.early), undefined);
  assert.deepEqual(result.callsEarly, ["stored"]);
  assert.equal(tokenText(result.later), "webview-2");
  assert.deepEqual(upstream.calls.refresh, ["stored", "refresh-1"]);
});

test("an upstream outage is not mistaken for a dead token", async () => {
  const { upstream, alerts, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 503;
  const status = await run((session) =>
    Effect.gen(function* () {
      yield* session.token;
      yield* TestClock.adjust(MINUTE);
      yield* session.token;
      return yield* session.status;
    }),
  );
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
  assert.deepEqual(await run((session) => session.submitCode("123456")), {
    _tag: "NoCodePending",
  });
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
      return {
        wrong,
        right,
        token: yield* session.token,
        status: yield* session.status,
      };
    }),
  );
  assert.equal(outcomes.wrong._tag, "CodeRejected");
  assert.deepEqual(outcomes.right, { _tag: "Accepted" });
  assert.equal(tokenText(outcomes.token), "webview-1");
  assert.equal(outcomes.status, "ok");
  assert.equal(backing.has("login"), false);
  assert.ok(
    log.indexOf("save session refresh-otp") <
      log.lastIndexOf("call webview-token"),
  );
  assert.deepEqual(
    alerts.sent.map((alert) => alert.title),
    ["Live buses are down: login needed", "Live buses: login restored"],
  );
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
  const writes: string[] = [];
  const failing: StateStoreShape = {
    get: () => Effect.fail(new StateError({ message: "storage unavailable" })),
    set: (key) => Effect.sync(() => void writes.push(key)),
    delete: (key) => Effect.sync(() => void writes.push(key)),
  };
  const { upstream, alerts, run } = setup({
    env: { METRO_PHONE: "0771234567", METRO_REFRESH_TOKEN: "seed" },
    state: failing,
  });
  const result = await run((session) =>
    Effect.all([session.token, session.status, session.token]),
  );
  assert.equal(tokenText(result[0]), undefined);
  assert.equal(result[1], "ok");
  assert.deepEqual(upstream.calls.refresh, []);
  assert.deepEqual(upstream.calls.checkPhone, []);
  assert.deepEqual(alerts.sent, []);
  assert.deepEqual(writes, []);
});

test("after a failed read the next tick reads storage again and refreshes the stored token, not the seed", async () => {
  const memory = memoryStateStore(
    new Map([["session", JSON.stringify(expired)]]),
  );
  let failures = 1;
  const flaky: StateStoreShape = {
    ...memory,
    get: (key) =>
      key === "session" && failures-- > 0
        ? Effect.fail(new StateError({ message: "storage unavailable" }))
        : memory.get(key),
  };
  const { upstream, alerts, run } = setup({
    env: { METRO_PHONE: "0771234567", METRO_REFRESH_TOKEN: "seed" },
    state: flaky,
  });
  const tokens = await run((session) =>
    Effect.all([session.token, session.token]),
  );
  assert.deepEqual(tokens.map(tokenText), [undefined, "webview-1"]);
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
  assert.deepEqual(alerts.sent, []);
});

test("a corrupt stored session never takes the seed: no refresh, and a login is needed", async () => {
  const { upstream, alerts, backing, run } = setup({
    session: { refreshToken: 1 },
    env: { METRO_PHONE: "0771234567", METRO_REFRESH_TOKEN: "seed" },
  });
  const [token, status] = await run((session) =>
    Effect.all([session.token, session.status]),
  );
  assert.equal(tokenText(token), undefined);
  assert.equal(status, "login_needed");
  assert.deepEqual(upstream.calls.refresh, []);
  assert.deepEqual(upstream.calls.checkPhone, ["+94771234567"]);
  assert.equal(
    JSON.parse(backing.get("login") ?? "{}").reason,
    "no refresh token",
  );
  assert.match(alerts.sent[0].message, /no refresh token/);
});

test("callers queued behind a refresh that finds a dead token don't refresh again", async () => {
  const { upstream, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 400;
  const tokens = await run((session) =>
    Effect.all(
      Array.from({ length: 3 }, () => session.token),
      { concurrency: "unbounded" },
    ),
  );
  assert.deepEqual(tokens.map(tokenText), [undefined, undefined, undefined]);
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
});

test("status only reads storage, and never writes the seed", async () => {
  const { backing, log, run } = setup({ env: { METRO_REFRESH_TOKEN: "seed" } });
  assert.equal(await run((session) => session.status), "ok");
  assert.deepEqual(log, []);
  assert.equal(backing.size, 0);
});

const gatedStore = (backing: Map<string, string>) => {
  const memory = memoryStateStore(backing);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let stalled = false;
  const state: StateStoreShape = {
    ...memory,
    get: (key) =>
      Effect.flatMap(memory.get(key), (value) => {
        if (stalled || key !== "session") return Effect.succeed(value);
        stalled = true;
        return Effect.as(
          Effect.promise(() => gate),
          value,
        );
      }),
  };
  const settle = Effect.forEach(
    Array.from({ length: 200 }),
    () => Effect.yieldNow,
    { discard: true },
  );
  return { state, settle, open: Effect.sync(() => open()) };
};

test("a slow first load never overwrites a session another caller already rotated", async () => {
  const backing = new Map([["session", JSON.stringify(expired)]]);
  const gated = gatedStore(backing);
  const { upstream, run } = setup({ state: gated.state });
  const token = await run((session) =>
    Effect.gen(function* () {
      const reading = yield* Effect.forkChild(session.status);
      const first = yield* Effect.forkChild(session.token);
      yield* gated.settle;
      yield* gated.open;
      yield* Fiber.join(reading);
      yield* Fiber.join(first);
      return yield* session.token;
    }),
  );
  assert.equal(tokenText(token), "webview-1");
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").refreshToken,
    "refresh-1",
  );
});

test("a slow load never overwrites the session an accepted code just made", async () => {
  const pending = {
    reason: "the refresh token was rejected (HTTP 400)",
    otpReference: "ref-0",
    lastCodeRequestAt: T0,
  };
  const backing = new Map([
    ["session", JSON.stringify(expired)],
    ["login", JSON.stringify(pending)],
  ]);
  const gated = gatedStore(backing);
  const { upstream, run } = setup({ state: gated.state });
  const outcome = await run((session) =>
    Effect.gen(function* () {
      const waiting = yield* Effect.forkChild(session.token);
      const submitted = yield* Effect.forkChild(session.submitCode("123456"));
      yield* gated.settle;
      yield* gated.open;
      yield* Fiber.join(waiting);
      return {
        submitted: yield* Fiber.join(submitted),
        token: yield* session.token,
        status: yield* session.status,
      };
    }),
  );
  assert.deepEqual(outcome.submitted, { _tag: "Accepted" });
  assert.equal(tokenText(outcome.token), "webview-1");
  assert.equal(outcome.status, "ok");
  assert.deepEqual(upstream.calls.refresh, []);
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").refreshToken,
    "refresh-otp",
  );
});

test("a seed in empty storage is refreshed and the rotated token saved", async () => {
  const { upstream, backing, run } = setup({
    env: { METRO_REFRESH_TOKEN: "seed" },
  });
  await run((session) => session.token);
  assert.deepEqual(upstream.calls.refresh, ["seed"]);
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").refreshToken,
    "refresh-1",
  );
});

test("a rate-limited refresh is an outage: no code and no alert", async () => {
  const { upstream, alerts, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 429;
  const status = await run((session) =>
    Effect.andThen(session.token, session.status),
  );
  assert.equal(status, "upstream_error");
  assert.deepEqual(upstream.calls.checkPhone, []);
  assert.deepEqual(alerts.sent, []);
});

test("a 401 refresh is a dead token", async () => {
  const { upstream, alerts, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 401;
  const status = await run((session) =>
    Effect.andThen(session.token, session.status),
  );
  assert.equal(status, "login_needed");
  assert.deepEqual(upstream.calls.checkPhone, ["+94771234567"]);
  assert.equal(alerts.sent.length, 1);
});

test("a stored session with more than 2 minutes left is reused without a refresh", async () => {
  const live = {
    refreshToken: "stored",
    webviewToken: "live",
    expiresAt: T0 + 3 * MINUTE,
    refreshedAt: T0 - 57 * MINUTE,
  };
  const { upstream, run } = setup({ session: live });
  const token = await run((session) => session.token);
  assert.equal(tokenText(token), "live");
  assert.deepEqual(upstream.calls.refresh, []);
});

test("concurrent callers while a login is needed request one code", async () => {
  const memory = memoryStateStore(
    new Map([["session", JSON.stringify(expired)]]),
  );
  const slow: StateStoreShape = {
    ...memory,
    set: (key, value) =>
      Effect.andThen(Effect.yieldNow, memory.set(key, value)),
  };
  const { upstream, run } = setup({ state: slow });
  upstream.settings.refreshStatus = 400;
  await run((session) =>
    Effect.gen(function* () {
      yield* session.token;
      yield* TestClock.adjust(10 * MINUTE);
      yield* Effect.all(
        Array.from({ length: 5 }, () => session.token),
        { concurrency: "unbounded" },
      );
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
    set: (key, value) =>
      failWrites
        ? Effect.fail(new StateError({ message: "write failed" }))
        : memory.set(key, value),
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
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").refreshToken,
    "refresh-2",
  );
});

const awaitingCode = {
  reason: "the refresh token was rejected (HTTP 400)",
  otpReference: "ref-0",
  lastCodeRequestAt: T0,
};

test("a failed clear of the login record after an accepted code is retried on the next tick", async () => {
  const backing = new Map([
    ["session", JSON.stringify(expired)],
    ["login", JSON.stringify(awaitingCode)],
  ]);
  const memory = memoryStateStore(backing);
  let failDeletes = true;
  const flaky: StateStoreShape = {
    ...memory,
    delete: (key) =>
      failDeletes
        ? Effect.fail(new StateError({ message: "delete failed" }))
        : memory.delete(key),
  };
  const first = setup({ state: flaky });
  const outcome = await first.run((session) =>
    Effect.gen(function* () {
      const submitted = yield* session.submitCode("123456");
      const stillThere = backing.has("login");
      failDeletes = false;
      yield* session.token;
      return { submitted, stillThere };
    }),
  );
  assert.deepEqual(outcome, {
    submitted: { _tag: "Accepted" },
    stillThere: true,
  });
  assert.equal(backing.has("login"), false);
  const restarted = setup({ state: memoryStateStore(backing) });
  const after = await restarted.run((session) =>
    Effect.all([session.token, session.status]),
  );
  assert.equal(tokenText(after[0]), "webview-1");
  assert.equal(after[1], "ok");
  assert.deepEqual(restarted.upstream.calls.checkPhone, []);
});

test("a failed session save after an accepted code still accepts it and saves on the next tick", async () => {
  const backing = new Map([
    ["session", JSON.stringify(expired)],
    ["login", JSON.stringify(awaitingCode)],
  ]);
  const memory = memoryStateStore(backing);
  let failWrites = true;
  const flaky: StateStoreShape = {
    ...memory,
    set: (key, value) =>
      failWrites
        ? Effect.fail(new StateError({ message: "write failed" }))
        : memory.set(key, value),
  };
  const { upstream, run } = setup({ state: flaky });
  const outcome = await run((session) =>
    Effect.gen(function* () {
      const submitted = yield* session.submitCode("123456");
      const during = yield* session.token;
      failWrites = false;
      const after = yield* session.token;
      return { submitted, during: tokenText(during), after: tokenText(after) };
    }),
  );
  assert.deepEqual(outcome, {
    submitted: { _tag: "Accepted" },
    during: "webview-1",
    after: "webview-1",
  });
  assert.deepEqual(upstream.calls.refresh, []);
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").refreshToken,
    "refresh-otp",
  );
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").webviewToken,
    "webview-1",
  );
  assert.equal(backing.has("login"), false);
});

test("the login record stays until the session from an accepted code is saved", async () => {
  const backing = new Map([
    ["session", JSON.stringify(expired)],
    ["login", JSON.stringify(awaitingCode)],
  ]);
  const memory = memoryStateStore(backing);
  const failingSessionWrites: StateStoreShape = {
    ...memory,
    set: (key, value) =>
      key === "session"
        ? Effect.fail(new StateError({ message: "write failed" }))
        : memory.set(key, value),
  };
  const first = setup({ state: failingSessionWrites });
  const outcome = await first.run((session) =>
    Effect.andThen(session.submitCode("123456"), session.token),
  );
  assert.equal(tokenText(outcome), "webview-1");
  assert.equal(backing.has("login"), true);
  const restarted = setup({ state: memoryStateStore(backing) });
  restarted.upstream.settings.refreshStatus = 400;
  const status = await restarted.run((session) =>
    Effect.andThen(session.token, session.status),
  );
  assert.equal(status, "login_needed");
  assert.deepEqual(restarted.upstream.calls.refresh, []);
  assert.deepEqual(restarted.upstream.calls.checkPhone, []);
});

test("interrupting a token call mid-refresh still saves the rotated refresh token", async () => {
  const backing = new Map([["session", JSON.stringify(expired)]]);
  const memory = memoryStateStore(backing);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let held = false;
  const slowSave: StateStoreShape = {
    ...memory,
    set: (key, value) => {
      if (key !== "session" || held) return memory.set(key, value);
      held = true;
      return Effect.andThen(
        Effect.promise(() => gate),
        memory.set(key, value),
      );
    },
  };
  const settle = Effect.forEach(
    Array.from({ length: 200 }),
    () => Effect.yieldNow,
    { discard: true },
  );
  const { upstream, run } = setup({ state: slowSave });
  await run((session) =>
    Effect.gen(function* () {
      const caller = yield* Effect.forkChild(session.token);
      yield* settle;
      const interrupting = yield* Effect.forkChild(Fiber.interrupt(caller));
      yield* settle;
      open();
      yield* Fiber.join(interrupting);
    }),
  );
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").refreshToken,
    "refresh-1",
  );
});

test("a restart within 10 minutes does not text another code", async () => {
  const backing = new Map([["session", JSON.stringify(expired)]]);
  const first = setup({ state: memoryStateStore(backing) });
  first.upstream.settings.refreshStatus = 400;
  await first.run((session) => session.token);
  const second = setup({ state: memoryStateStore(backing) });
  await second.run((session) =>
    Effect.andThen(TestClock.adjust(9 * MINUTE), session.token),
  );
  assert.equal(first.upstream.calls.checkPhone.length, 1);
  assert.deepEqual(second.upstream.calls.checkPhone, []);
  assert.deepEqual(second.upstream.calls.refresh, []);
  assert.deepEqual(second.alerts.sent, []);
});

test("a stored session exactly 2 minutes from expiry is renewed", async () => {
  const edge = {
    refreshToken: "stored",
    webviewToken: "live",
    expiresAt: T0 + 2 * MINUTE,
    refreshedAt: T0 - 58 * MINUTE,
  };
  const { upstream, run } = setup({ session: edge });
  const token = await run((session) => session.token);
  assert.equal(tokenText(token), "webview-1");
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
});

test("logs never carry tokens, codes, references or the phone number", async () => {
  const { upstream, logs, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 401;
  await run((session) =>
    Effect.gen(function* () {
      yield* session.token;
      yield* session.submitCode("999999");
      yield* session.submitCode("123456");
      upstream.settings.webviewStatus = 503;
      yield* TestClock.adjust(2 * 60 * MINUTE);
      yield* session.token;
    }),
  );
  assert.ok(logs.length > 0);
  for (const line of logs)
    assert.doesNotMatch(
      line,
      /stored|refresh-|access-|webview-|ref-\d|999999|123456|0771234567|94771234567/,
    );
});

test("a hung refresh times out after 15 seconds as an outage, and a waiting caller waits out the backoff", async () => {
  const { upstream, alerts, backing, run } = setup({ session: expired });
  upstream.settings.refreshHangs = true;
  const settle = Effect.forEach(
    Array.from({ length: 200 }),
    () => Effect.yieldNow,
    { discard: true },
  );
  const result = await run((session) =>
    Effect.gen(function* () {
      const hung = yield* Effect.forkChild(session.token);
      yield* settle;
      const waiting = yield* Effect.forkChild(session.token);
      yield* settle;
      upstream.settings.refreshHangs = false;
      yield* TestClock.adjust("15 seconds");
      const outcome = {
        hung: tokenText(yield* Fiber.join(hung)),
        waiting: tokenText(yield* Fiber.join(waiting)),
        status: yield* session.status,
      };
      yield* TestClock.adjust("60 seconds");
      return { ...outcome, later: tokenText(yield* session.token) };
    }),
  );
  assert.deepEqual(result, {
    hung: undefined,
    waiting: undefined,
    status: "upstream_error",
    later: "webview-1",
  });
  assert.deepEqual(upstream.calls.refresh, ["stored", "stored"]);
  assert.deepEqual(upstream.calls.checkPhone, []);
  assert.deepEqual(alerts.sent, []);
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").refreshToken,
    "refresh-2",
  );
});

test("interrupting a token call while the refresh request is in flight stops it promptly and leaves storage alone", async () => {
  const { upstream, backing, log, run } = setup({ session: expired });
  upstream.settings.refreshHangs = true;
  const settle = Effect.forEach(
    Array.from({ length: 200 }),
    () => Effect.yieldNow,
    { discard: true },
  );
  const interrupted = await run((session) =>
    Effect.gen(function* () {
      const caller = yield* Effect.forkChild(session.token);
      yield* settle;
      const interrupting = yield* Effect.forkChild(Fiber.interrupt(caller));
      yield* settle;
      return interrupting.pollUnsafe() !== undefined;
    }),
  );
  assert.equal(interrupted, true);
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
  assert.deepEqual(
    log.filter((line) => line.startsWith("save session")),
    [],
  );
  assert.equal(
    JSON.parse(backing.get("session") ?? "{}").refreshToken,
    "stored",
  );
});

test("a hung verify-otp is rejected after 15 seconds and frees the lock for a waiting caller", async () => {
  const backing = new Map([
    ["session", JSON.stringify(expired)],
    ["login", JSON.stringify(awaitingCode)],
  ]);
  const { upstream, run } = setup({ state: memoryStateStore(backing) });
  upstream.settings.verifyHangs = true;
  const settle = Effect.forEach(
    Array.from({ length: 200 }),
    () => Effect.yieldNow,
    { discard: true },
  );
  const result = await run((session) =>
    Effect.gen(function* () {
      const submitting = yield* Effect.forkChild(session.submitCode("123456"));
      yield* settle;
      const waiting = yield* Effect.forkChild(session.token);
      yield* settle;
      const blocked = waiting.pollUnsafe() === undefined;
      yield* TestClock.adjust("15 seconds");
      return {
        blocked,
        submitted: yield* Fiber.join(submitting),
        token: tokenText(yield* Fiber.join(waiting)),
      };
    }),
  );
  assert.equal(result.blocked, true);
  assert.equal(result.submitted._tag, "CodeRejected");
  assert.match((result.submitted as { message: string }).message, /timed out/);
  assert.equal(result.token, undefined);
  assert.equal(upstream.calls.verify, 1);
  assert.equal(backing.has("login"), true);
});

test("after a failed refresh, reads within a minute don't refresh again", async () => {
  const { upstream, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 503;
  const tokens = await run((session) =>
    Effect.gen(function* () {
      const first = yield* session.token;
      yield* TestClock.adjust("1 second");
      const second = yield* session.token;
      return [first, second];
    }),
  );
  assert.deepEqual(tokens.map(tokenText), [undefined, undefined]);
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
});

test("a read after the minute tries the refresh again", async () => {
  const { upstream, run } = setup({ session: expired });
  upstream.settings.refreshStatus = 503;
  const tokens = await run((session) =>
    Effect.gen(function* () {
      yield* session.token;
      yield* TestClock.adjust(59 * 1000);
      yield* session.token;
      upstream.settings.refreshStatus = 200;
      yield* TestClock.adjust(1000);
      return yield* session.token;
    }),
  );
  assert.equal(tokenText(tokens), "webview-1");
  assert.deepEqual(upstream.calls.refresh, ["stored", "stored"]);
});

test("during the backoff an unexpired webview token is still handed out", async () => {
  const nearEnd = { ...expired, expiresAt: T0 + MINUTE, webviewToken: "old" };
  const { upstream, run } = setup({ session: nearEnd });
  upstream.settings.refreshStatus = 503;
  const tokens = await run((session) =>
    Effect.gen(function* () {
      const first = yield* session.token;
      yield* TestClock.adjust("10 seconds");
      return [first, yield* session.token];
    }),
  );
  assert.deepEqual(tokens.map(tokenText), ["old", "old"]);
  assert.deepEqual(upstream.calls.refresh, ["stored"]);
});
