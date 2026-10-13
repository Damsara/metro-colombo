import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Logger, Layer, Option, Redacted } from "effect";
import { JourneyRoutes } from "@metro/api";
import { UpstreamError } from "@metro/upstream";
import { harness, type HarnessOptions } from "./support/harness.ts";

const PLAN = {
  from_stop: { id: "s1" },
  to_stop: { id: "s2" },
  date: "2026-10-13",
  queried_at: "2026-10-13T03:30:00Z",
  is_now: true,
  options: [{ duration: 12 }],
};
const SECRET = "webview-secret";
const UUID_A = "cac3f318-8978-4ef4-b530-19919deadcb8";
const UUID_B = "881f4119-2a64-414a-ba11-65424a857fe6";

const q = (from: string, to: string, date?: string) =>
  `/api/journey?${new URLSearchParams({ from, to, ...(date ? { date } : {}) })}`;

const journeySite = async (
  options: HarnessOptions & {
    needsLogin?: boolean;
    fail?: UpstreamError;
    routes?: Layer.Layer<never, unknown, unknown>;
  } = {},
) => {
  const calls: Array<[string, string, string]> = [];
  let failure = options.fail;
  const tokens: Array<string | undefined> = [];
  let tokenCalls = 0;
  const h = await harness(options.routes ?? JourneyRoutes, {
    ...options,
    upstream: {
      needsLogin: options.needsLogin ?? false,
      journey: (token, from, to, date) =>
        Effect.suspend(() => {
          calls.push([from, to, date]);
          tokens.push(Option.getOrUndefined(Option.map(token, Redacted.value)));
          return failure
            ? Effect.fail(failure)
            : Effect.succeed({ ...PLAN, date });
        }),
    },
    client: {
      token: Effect.sync(() => {
        tokenCalls++;
        return Option.some(Redacted.make(SECRET));
      }),
    },
  });
  return {
    ...h,
    calls,
    tokens,
    tokenCalls: () => tokenCalls,
    failWith: (error: UpstreamError | undefined) => void (failure = error),
  };
};

const sleepersAppear = async (time: { pending: () => number }) => {
  while (time.pending() === 0)
    await new Promise((resolve) => setTimeout(resolve, 1));
};

const expectError = async (
  response: Response,
  status: number,
  body: string,
) => {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), body);
};

test("without both stops it's production's 400", async () => {
  const { get } = await journeySite();
  const message =
    '{"error":"`from` and `to` (stop_code or stop uuid) are required"}';
  await expectError(await get("/api/journey"), 400, message);
  await expectError(await get("/api/journey?from=KCR100"), 400, message);
  await expectError(await get("/api/journey?from=&to=KCR101"), 400, message);
});

test("a date that isn't YYYY-MM-DD is 400", async () => {
  const { get } = await journeySite();
  await expectError(
    await get(q("KCR100", "KCR101", "2026-13-01")),
    400,
    '{"error":"`date` must be YYYY-MM-DD"}',
  );
});

test("an unknown stop code is 400, even one named like an object's own property", async () => {
  const { get } = await journeySite();
  await expectError(
    await get(q("KCR100", "NOPE1")),
    400,
    '{"error":"unknown stop: NOPE1"}',
  );
  await expectError(
    await get(q("constructor", "KCR101")),
    400,
    '{"error":"unknown stop: constructor"}',
  );
});

test("stop codes become ids and the date defaults to today in Colombo", async () => {
  const h = await journeySite({ at: Date.parse("2026-10-12T18:45:00Z") });
  const response = await h.get(q("KCR100", "KCR101"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    await response.text(),
    JSON.stringify({ ...PLAN, date: "2026-10-13" }),
  );
  assert.deepEqual(h.calls, [["s1", "s2", "2026-10-13"]]);
});

test("stop ids are used as they are, without reading the stop list", async () => {
  const h = await journeySite({ reference: null });
  const response = await h.get(q(UUID_A, UUID_B, "2026-10-13"));
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [[UUID_A, UUID_B, "2026-10-13"]]);
});

test("a plan is kept 60 seconds per pair of stops and date, and the reverse trip is its own", async () => {
  const h = await journeySite();
  await h.get(q("KCR100", "KCR101"));
  await h.get(q("KCR100", "KCR101"));
  assert.equal(h.calls.length, 1);
  await h.get(q("KCR101", "KCR100"));
  assert.equal(h.calls.length, 2);
  await h.get(q("KCR100", "KCR101", "2026-10-14"));
  assert.equal(h.calls.length, 3);
  h.time.advance(59_999);
  await h.get(q("KCR100", "KCR101"));
  assert.equal(h.calls.length, 3);
  h.time.advance(1);
  await h.get(q("KCR100", "KCR101"));
  assert.equal(h.calls.length, 4);
});

test("a failed search is never kept", async () => {
  const h = await journeySite({
    fail: new UpstreamError({ message: "down", status: 503 }),
  });
  await h.get(q("KCR100", "KCR101"));
  await h.get(q("KCR100", "KCR101"));
  assert.equal(h.calls.length, 2);
});

test("an upstream 400 with a message is passed on, and any other failure is 502", async () => {
  const refused = await journeySite({
    fail: new UpstreamError({
      message: "x",
      status: 400,
      detail: "No journeys found",
    }),
  });
  await expectError(
    await refused.get(q("KCR100", "KCR101")),
    400,
    '{"error":"No journeys found"}',
  );
  const down = await journeySite({
    fail: new UpstreamError({ message: "x", status: 503 }),
  });
  await expectError(
    await down.get(q("KCR100", "KCR101")),
    502,
    '{"error":"transit data is temporarily unavailable"}',
  );
});

test("with a login the Fleet's token is used and never shown or logged; without one it isn't asked for", async () => {
  const lines: string[] = [];
  const logs = Logger.layer([
    Logger.make(({ message }) => void lines.push(JSON.stringify(message))),
  ]);
  const authed = await journeySite({
    routes: Layer.merge(JourneyRoutes, logs),
    needsLogin: true,
    fail: new UpstreamError({
      message: "upstream answered HTTP 401",
      status: 401,
    }),
  });
  const response = await authed.get(q("KCR100", "KCR101"));
  assert.doesNotMatch(await response.text(), new RegExp(SECRET));
  assert.deepEqual(authed.tokens, [SECRET]);
  assert.notEqual(lines.length, 0);
  assert.equal(lines.filter((line) => line.includes(SECRET)).length, 0);
  const open = await journeySite();
  await open.get(q("KCR100", "KCR101"));
  assert.equal(open.tokenCalls(), 0);
  assert.deepEqual(open.tokens, [undefined]);
});

test("a token that never answers is given up on after 3 seconds and the plan goes out without a login", async () => {
  const calls: Array<string | undefined> = [];
  const h = await harness(JourneyRoutes, {
    upstream: {
      needsLogin: true,
      journey: (token, _from, _to, date) =>
        Effect.sync(() => {
          calls.push(Option.getOrUndefined(Option.map(token, Redacted.value)));
          return { ...PLAN, date };
        }),
    },
    client: { token: Effect.never },
  });
  const pending = h.get(q("KCR100", "KCR101"));
  await sleepersAppear(h.time);
  assert.deepEqual(calls, []);
  h.time.advance(3_000);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [undefined]);
});

test("a slow token read is abandoned after 3 seconds but never interrupted", async () => {
  let started = 0;
  let finished = 0;
  let interrupted = 0;
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  const tokens: Array<string | undefined> = [];
  const h = await harness(JourneyRoutes, {
    upstream: {
      needsLogin: true,
      journey: (token, _from, _to, date) =>
        Effect.sync(() => {
          tokens.push(Option.getOrUndefined(Option.map(token, Redacted.value)));
          return { ...PLAN, date };
        }),
    },
    client: {
      token: Effect.gen(function* () {
        started++;
        yield* Effect.promise(() => done);
        finished++;
        return Option.some(Redacted.make(SECRET));
      }).pipe(Effect.onInterrupt(() => Effect.sync(() => void interrupted++))),
    },
  });
  const pending = h.get(q("KCR100", "KCR101"));
  await sleepersAppear(h.time);
  h.time.advance(3_000);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(tokens, [undefined]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([started, finished, interrupted], [1, 1, 0]);
});

test("a stop list that can't be read is the fixed 502, not cached", async () => {
  const h = await journeySite({ reference: null });
  await expectError(
    await h.get(q("KCR100", "KCR101")),
    502,
    '{"error":"transit data is temporarily unavailable"}',
  );
});

test("a stop code the list maps to an empty id is unknown", async () => {
  const h = await journeySite({
    reference: { "stop-ids": { KCR100: "", KCR101: "s2" } },
  });
  await expectError(
    await h.get(q("KCR100", "KCR101")),
    400,
    '{"error":"unknown stop: KCR100"}',
  );
  assert.equal(h.calls.length, 0);
});

const DOWN = new UpstreamError({ message: "down", status: 503 });

test("after an upstream failure a plan kept within 3 minutes is served again, with a fresh plan's headers", async () => {
  const h = await journeySite();
  const fresh = await h.get(q("KCR100", "KCR101"));
  const body = await fresh.text();
  h.failWith(DOWN);
  h.time.advance(60_000);
  const stale = await h.get(q("KCR100", "KCR101"));
  assert.equal(h.calls.length, 2);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get("content-type"), "application/json");
  assert.equal(stale.headers.get("cache-control"), "no-store");
  assert.equal(await stale.text(), body);
  h.time.advance(119_999);
  assert.equal((await h.get(q("KCR100", "KCR101"))).status, 200);
  h.time.advance(1);
  await expectError(
    await h.get(q("KCR100", "KCR101")),
    502,
    '{"error":"transit data is temporarily unavailable"}',
  );
});

test("a stale plan is served only for the same stops and date", async () => {
  const h = await journeySite();
  await h.get(q("KCR100", "KCR101"));
  h.failWith(DOWN);
  h.time.advance(60_000);
  for (const url of [
    q("KCR101", "KCR100"),
    q("KCR100", "KCR101", "2026-10-14"),
  ])
    assert.equal((await h.get(url)).status, 502);
});

test("an upstream 400 with a message is never answered from a stale plan", async () => {
  const h = await journeySite();
  await h.get(q("KCR100", "KCR101"));
  h.failWith(
    new UpstreamError({
      message: "x",
      status: 400,
      detail: "No journeys found",
    }),
  );
  h.time.advance(60_000);
  await expectError(
    await h.get(q("KCR100", "KCR101")),
    400,
    '{"error":"No journeys found"}',
  );
});
