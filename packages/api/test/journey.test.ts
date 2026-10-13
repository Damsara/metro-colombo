import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Option, Redacted } from "effect";
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
  options: HarnessOptions & { needsLogin?: boolean; fail?: UpstreamError } = {},
) => {
  const calls: Array<[string, string, string]> = [];
  const tokens: Array<string | undefined> = [];
  let tokenCalls = 0;
  const h = await harness(JourneyRoutes, {
    ...options,
    upstream: {
      needsLogin: options.needsLogin ?? false,
      journey: (token, from, to, date) =>
        Effect.suspend(() => {
          calls.push([from, to, date]);
          tokens.push(Option.getOrUndefined(Option.map(token, Redacted.value)));
          return options.fail
            ? Effect.fail(options.fail)
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
  return { ...h, calls, tokens, tokenCalls: () => tokenCalls };
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

test("with a login the Fleet's token is used and never shown; without one it isn't asked for", async () => {
  const authed = await journeySite({
    needsLogin: true,
    fail: new UpstreamError({
      message: "upstream answered HTTP 401",
      status: 401,
    }),
  });
  const response = await authed.get(q("KCR100", "KCR101"));
  assert.doesNotMatch(await response.text(), new RegExp(SECRET));
  assert.deepEqual(authed.tokens, [SECRET]);
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
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, []);
  h.time.advance(3_000);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [undefined]);
});
