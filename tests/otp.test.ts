import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { Auth, AuthError, NoCodePending } from "../src/auth.js";
import { bearerMatches, OtpRoutes } from "../src/otp.js";

const handlerWith = (
  env: Record<string, string>,
  submitCode: (code: string) => Effect.Effect<void, AuthError | NoCodePending>,
) => {
  const submitted: string[] = [];
  const auth = Layer.succeed(
    Auth,
    Auth.of({
      currentToken: Effect.die("unused"),
      submitCode: (code) =>
        Effect.andThen(
          Effect.sync(() => void submitted.push(code)),
          submitCode(code),
        ),
    }),
  );
  const { handler } = HttpRouter.toWebHandler(
    Layer.mergeAll(OtpRoutes, auth).pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
    ),
  );
  const post = (body: unknown, authorization?: string) =>
    handler(
      new Request("http://metro.test/fleet/otp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  return { post, submitted };
};

const accept = () => Effect.void;

test("the right secret and a six-digit code reach the login", async () => {
  const { post, submitted } = handlerWith({ OTP_SECRET: "s3cret" }, accept);

  const response = await post({ code: " 123456 " }, "Bearer s3cret");

  assert.equal(response.status, 200);
  assert.deepEqual(submitted, ["123456"]);
});

test("a wrong or missing secret looks like no endpoint at all", async () => {
  const { post, submitted } = handlerWith({ OTP_SECRET: "s3cret" }, accept);

  assert.equal((await post({ code: "123456" }, "Bearer nope")).status, 404);
  assert.equal((await post({ code: "123456" })).status, 404);
  assert.deepEqual(submitted, []);
});

test("without OTP_SECRET set the endpoint is off", async () => {
  const { post } = handlerWith({}, accept);

  assert.equal((await post({ code: "123456" }, "Bearer ")).status, 404);
});

test("anything but a six-digit code is refused before the login sees it", async () => {
  const { post, submitted } = handlerWith({ OTP_SECRET: "s3cret" }, accept);

  assert.equal((await post({ code: "12345" }, "Bearer s3cret")).status, 400);
  assert.equal((await post({ nope: 1 }, "Bearer s3cret")).status, 400);
  assert.deepEqual(submitted, []);
});

test("a code nobody asked for gets 409, and a rejected one 400", async () => {
  const pending = handlerWith({ OTP_SECRET: "s3cret" }, () =>
    Effect.fail(new NoCodePending()),
  );
  const rejected = handlerWith({ OTP_SECRET: "s3cret" }, () =>
    Effect.fail(new AuthError({ message: "wrong code", status: 400 })),
  );

  assert.equal(
    (await pending.post({ code: "123456" }, "Bearer s3cret")).status,
    409,
  );
  assert.equal(
    (await rejected.post({ code: "123456" }, "Bearer s3cret")).status,
    400,
  );
});

test("the bearer check needs the exact header", () => {
  assert.equal(bearerMatches("Bearer abc", "abc"), true);
  assert.equal(bearerMatches("bearer abc", "abc"), false);
  assert.equal(bearerMatches("Bearer abcd", "abc"), false);
  assert.equal(bearerMatches(undefined, "abc"), false);
});
