import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { bearerMatches, FleetClient, FleetRoutes, type FleetStatus, type SubmitOutcome } from "@metro/fleet";

const STATUS: FleetStatus = { login: "ok", feed: "connected", age_ms: 1200, lastArchiveWriteAt: null, pendingRows: 3, droppedRows: 0 };

const handlerWith = (env: Record<string, string>, outcome: SubmitOutcome = { _tag: "Accepted" }) => {
  const submitted: string[] = [];
  const client = FleetClient.of({
    status: Effect.succeed(STATUS),
    submitCode: (code) => Effect.sync(() => (submitted.push(code), outcome)),
  });
  const { handler } = HttpRouter.toWebHandler(
    FleetRoutes.pipe(
      Layer.provide(Layer.succeed(FleetClient, client)),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
    ),
  );
  const post = (body: unknown, authorization?: string) =>
    handler(
      new Request("http://metro.test/fleet/otp", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const status = (authorization?: string) =>
    handler(new Request("http://metro.test/fleet/status", { headers: authorization ? { authorization } : {} }));
  return { post, status, submitted };
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
  assert.equal((await handlerWith({}).post({ code: "123456" }, "Bearer s3cret")).status, 404);
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
  assert.equal((await handlerWith(SECRET, { _tag: "NoCodePending" }).post({ code: "123456" }, "Bearer s3cret")).status, 409);
  const refused = await handlerWith(SECRET, { _tag: "CodeRejected", message: "upstream /auth/customer/verify-otp answered HTTP 400" }).post(
    { code: "123456" },
    "Bearer s3cret",
  );
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { error: "upstream /auth/customer/verify-otp answered HTTP 400" });
});

test("the status needs the same secret", async () => {
  const { status } = handlerWith(SECRET);
  assert.equal((await status()).status, 404);
  const ok = await status("Bearer s3cret");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), STATUS);
});

test("bearer comparison needs the exact header", async () => {
  assert.equal(await Effect.runPromise(bearerMatches("Bearer s3cret", "s3cret")), true);
  assert.equal(await Effect.runPromise(bearerMatches("bearer s3cret", "s3cret")), false);
  assert.equal(await Effect.runPromise(bearerMatches(undefined, "s3cret")), false);
});

test("an empty or blank secret matches nothing, and a header of another length never matches", async () => {
  const matches = (header: string | undefined, secret: string) => Effect.runPromise(bearerMatches(header, secret));
  assert.equal(await matches("Bearer ", ""), false);
  assert.equal(await matches("Bearer  ", " "), false);
  assert.equal(await matches("Bearer \t", "\t"), false);
  assert.equal(await matches("Bearer s3cret-and-more", "s3cret"), false);
  assert.equal(await matches("Bearer s3c", "s3cret"), false);
});
