import { createHash, timingSafeEqual } from "node:crypto";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Auth } from "./auth.js";
import { OtpConfig } from "./config.js";

const digest = (value: string) => createHash("sha256").update(value).digest();

export const bearerMatches = (header: string | undefined, secret: string) =>
  header !== undefined &&
  timingSafeEqual(digest(header), digest(`Bearer ${secret}`));

const reply = (status: number, body: unknown) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

const CodeBody = Schema.Struct({ code: Schema.String });

// The iPhone shortcut posts each SMS code here; anyone without the secret sees no endpoint at all.
export const OtpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const { secret } = yield* OtpConfig;
    const handler = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (
        Option.isNone(secret) ||
        !bearerMatches(
          request.headers["authorization"],
          Redacted.value(secret.value),
        )
      )
        return reply(404, { error: "not found" });
      const body = yield* HttpServerRequest.schemaBodyJson(CodeBody).pipe(
        Effect.option,
      );
      const code = Option.map(body, ({ code }) => code.trim());
      if (Option.isNone(code) || !/^\d{6}$/.test(code.value))
        return reply(400, { error: "expected a six-digit code" });
      return yield* (yield* Auth).submitCode(code.value).pipe(
        Effect.as(reply(200, { ok: true })),
        Effect.catchTags({
          NoCodePending: () =>
            Effect.succeed(reply(409, { error: "no code is pending" })),
          AuthError: (error) =>
            Effect.as(
              Effect.logWarning("login code rejected", error),
              reply(400, { error: error.message }),
            ),
        }),
      );
    }).pipe(Effect.withSpan("otp.submit"));
    return HttpRouter.add("POST", "/fleet/otp", handler);
  }),
);
