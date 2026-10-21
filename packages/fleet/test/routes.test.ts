import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import {
  bearerMatches,
  FleetClient,
  FleetRoutes,
  type FleetStatus,
  type StartOutcome,
  type SubmitOutcome,
} from "@metro/fleet";

const STATUS: FleetStatus = {
  login: "ok",
  feed: "connected",
  age_ms: 1200,
  lastArchiveWriteAt: null,
  pendingRows: 3,
  droppedRows: 0,
};

const handlerWith = (
  env: Record<string, string>,
  outcome: SubmitOutcome = { _tag: "Accepted" },
  started: StartOutcome = { _tag: "CodeSent" },
) => {
  const submitted: string[] = [];
  const phones: string[] = [];
  const client = FleetClient.of({
    status: Effect.succeed(STATUS),
    live: Effect.die("not used by this test"),
    submitCode: (code) => Effect.sync(() => (submitted.push(code), outcome)),
    startLogin: (phone) => Effect.sync(() => (phones.push(phone), started)),
    token: Effect.succeed(Option.none()),
  });
  const { handler } = HttpRouter.toWebHandler(
    FleetRoutes.pipe(
      Layer.provide(Layer.succeed(FleetClient, client)),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
    ),
  );
  const post = (body: unknown, authorization?: string, path = "otp") =>
    handler(
      new Request(`http://metro.test/fleet/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const status = (authorization?: string) =>
    handler(
      new Request("http://metro.test/fleet/status", {
        headers: authorization ? { authorization } : {},
      }),
    );
  return { handler, post, status, submitted, phones };
};

const SECRET = { OTP_SECRET: "s3cret" };

test("the right secret and a six-digit code reach the Fleet", async () => {
  const { post, submitted } = handlerWith(SECRET);
  const response = await post({ code: " 123456 " }, "Bearer s3cret");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(submitted, ["123456"]);
});

test("a wrong or missing secret looks like no endpoint at all", async () => {
  const { post, submitted } = handlerWith(SECRET);
  assert.equal((await post({ code: "123456" }, "Bearer nope")).status, 404);
  assert.equal((await post({ code: "123456" })).status, 404);
  assert.equal(
    (await handlerWith({}).post({ code: "123456" }, "Bearer s3cret")).status,
    404,
  );
  assert.deepEqual(submitted, []);
});

test("anything but six digits is a 400", async () => {
  const { post, submitted } = handlerWith(SECRET);
  assert.equal((await post({ code: "12345" }, "Bearer s3cret")).status, 400);
  assert.equal((await post({ otp: "123456" }, "Bearer s3cret")).status, 400);
  assert.equal((await post("not json", "Bearer s3cret")).status, 400);
  assert.deepEqual(submitted, []);
});

test("nothing pending is a 409 and a refused code is a 400 with the reason", async () => {
  assert.equal(
    (
      await handlerWith(SECRET, { _tag: "NoCodePending" }).post(
        { code: "123456" },
        "Bearer s3cret",
      )
    ).status,
    409,
  );
  const refused = await handlerWith(SECRET, {
    _tag: "CodeRejected",
    message: "upstream /auth/customer/verify-otp answered HTTP 400",
  }).post({ code: "123456" }, "Bearer s3cret");
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), {
    error: "upstream /auth/customer/verify-otp answered HTTP 400",
  });
});

test("the status needs the same secret", async () => {
  const { status } = handlerWith(SECRET);
  assert.equal((await status()).status, 404);
  const ok = await status("Bearer s3cret");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), STATUS);
});

test("bearer comparison needs the exact header", async () => {
  assert.equal(
    await Effect.runPromise(bearerMatches("Bearer s3cret", "s3cret")),
    true,
  );
  assert.equal(
    await Effect.runPromise(bearerMatches("bearer s3cret", "s3cret")),
    false,
  );
  assert.equal(
    await Effect.runPromise(bearerMatches(undefined, "s3cret")),
    false,
  );
});

test("an empty or blank secret matches nothing, and a header of another length never matches", async () => {
  const matches = (header: string | undefined, secret: string) =>
    Effect.runPromise(bearerMatches(header, secret));
  assert.equal(await matches("Bearer ", ""), false);
  assert.equal(await matches("Bearer  ", " "), false);
  assert.equal(await matches("Bearer \t", "\t"), false);
  assert.equal(await matches("Bearer s3cret-and-more", "s3cret"), false);
  assert.equal(await matches("Bearer s3c", "s3cret"), false);
});

test("a login posts the number to the Fleet behind the same secret", async () => {
  const { post, phones } = handlerWith(SECRET);
  assert.equal(
    (await post({ phone: "0771234567" }, "Bearer nope", "login")).status,
    404,
  );
  assert.equal(
    (await post({ number: "077" }, "Bearer s3cret", "login")).status,
    400,
  );
  const sent = await post({ phone: "0771234567" }, "Bearer s3cret", "login");
  assert.equal(sent.status, 202);
  assert.deepEqual(await sent.json(), { ok: true });
  assert.deepEqual(phones, ["0771234567"]);
});

test("each login outcome has its own status", async () => {
  const statusFor = async (started: StartOutcome) => {
    const response = await handlerWith(SECRET, undefined, started).post(
      { phone: "0771234567" },
      "Bearer s3cret",
      "login",
    );
    return {
      status: response.status,
      retry: response.headers.get("retry-after"),
    };
  };
  assert.equal((await statusFor({ _tag: "InvalidPhone" })).status, 400);
  assert.equal((await statusFor({ _tag: "NoAccount" })).status, 422);
  assert.deepEqual(await statusFor({ _tag: "TooSoon", retryAfterMs: 20_500 }), {
    status: 429,
    retry: "21",
  });
  assert.equal((await statusFor({ _tag: "LoginNotUsed" })).status, 409);
  assert.equal(
    (await statusFor({ _tag: "Failed", message: "upstream down" })).status,
    502,
  );
});

test("the admin page is served with a strict policy, and hidden without a secret", async () => {
  const { handler } = handlerWith(SECRET);
  const page = await handler(new Request("http://metro.test/fleet/admin"));
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(
    page.headers.get("content-security-policy") ?? "",
    /script-src 'self'.*frame-ancestors 'none'/,
  );
  assert.match(await page.text(), /<script src="\/fleet\/admin.js">/);
  const script = await handler(new Request("http://metro.test/fleet/admin.js"));
  assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.match(await script.text(), /\/fleet\/login/);
  const hidden = await handlerWith({}).handler(
    new Request("http://metro.test/fleet/admin"),
  );
  assert.equal(hidden.status, 404);
});
