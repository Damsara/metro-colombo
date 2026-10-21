import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ADMIN_HTML, ADMIN_SCRIPT } from "./admin-page.js";
import { FleetConfig } from "./config.js";
import type { FleetStatus } from "./fleet.js";
import type { StartOutcome, SubmitOutcome } from "./session.js";
import type { LiveDocument } from "./snapshot.js";

export type FleetClientShape = {
  readonly status: Effect.Effect<FleetStatus>;
  readonly live: Effect.Effect<LiveDocument>;
  readonly submitCode: (code: string) => Effect.Effect<SubmitOutcome>;
  readonly startLogin: (phone: string) => Effect.Effect<StartOutcome>;
  readonly token: Effect.Effect<Option.Option<Redacted.Redacted<string>>>;
};

export class FleetClient extends Context.Service<
  FleetClient,
  FleetClientShape
>()("metro/FleetClient") {}

const digest = async (text: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );

export const bearerMatches = (header: string | undefined, secret: string) =>
  Effect.promise(async () => {
    if (header === undefined || secret.trim() === "") return false;
    const [given, expected] = await Promise.all([
      digest(header),
      digest(`Bearer ${secret}`),
    ]);
    let difference = 0;
    for (let index = 0; index < expected.length; index++)
      difference |= given[index] ^ expected[index];
    return difference === 0;
  });

const reply = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

const ADMIN_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const CodeBody = Schema.Struct({ code: Schema.String });
const PhoneBody = Schema.Struct({ phone: Schema.String });

// The iPhone shortcut posts each SMS code here; anyone without the secret sees no endpoint at all.
export const FleetRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const { otpSecret } = yield* FleetConfig;
    const client = yield* FleetClient;

    const authorised = Effect.gen(function* () {
      if (Option.isNone(otpSecret)) return false;
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* bearerMatches(
        request.headers["authorization"],
        Redacted.value(otpSecret.value),
      );
    });

    const otp = Effect.gen(function* () {
      if (!(yield* authorised)) return reply(404, { error: "not found" });
      const body = yield* HttpServerRequest.schemaBodyJson(CodeBody).pipe(
        Effect.option,
      );
      const code = Option.map(body, ({ code }) => code.trim());
      if (Option.isNone(code) || !/^\d{6}$/.test(code.value))
        return reply(400, { error: "expected a six-digit code" });
      const outcome = yield* client.submitCode(code.value);
      switch (outcome._tag) {
        case "Accepted":
          return reply(200, { ok: true });
        case "NoCodePending":
          return reply(409, { error: "no code is pending" });
        case "CodeRejected":
          return reply(400, { error: outcome.message });
      }
    }).pipe(Effect.withSpan("fleet.otp"));

    const login = Effect.gen(function* () {
      if (!(yield* authorised)) return reply(404, { error: "not found" });
      const body = yield* HttpServerRequest.schemaBodyJson(PhoneBody).pipe(
        Effect.option,
      );
      if (Option.isNone(body))
        return reply(400, { error: "expected a phone number" });
      const outcome = yield* client.startLogin(body.value.phone);
      switch (outcome._tag) {
        case "CodeSent":
          return reply(202, { ok: true });
        case "InvalidPhone":
          return reply(400, { error: "expected a Sri Lankan mobile number" });
        case "NoAccount":
          return reply(422, { error: "no LMT-GO account for this number" });
        case "TooSoon": {
          const seconds = Math.ceil(outcome.retryAfterMs / 1000);
          return reply(
            429,
            { error: "a code was sent moments ago", retry_after_s: seconds },
            { "retry-after": String(seconds) },
          );
        }
        case "LoginNotUsed":
          return reply(409, { error: "this server does not log in" });
        case "Failed":
          return reply(502, { error: outcome.message });
      }
    }).pipe(Effect.withSpan("fleet.login"));

    const status = Effect.gen(function* () {
      if (!(yield* authorised)) return reply(404, { error: "not found" });
      return reply(200, yield* client.status);
    });

    // With no secret set there is nothing to log in with, so the page is hidden too.
    const page = (body: string, contentType: string) =>
      Effect.succeed(
        Option.isNone(otpSecret)
          ? reply(404, { error: "not found" })
          : HttpServerResponse.text(body, {
              contentType,
              headers: ADMIN_HEADERS,
            }),
      );

    return Layer.mergeAll(
      HttpRouter.add("GET", "/fleet/admin", page(ADMIN_HTML, "text/html")),
      HttpRouter.add(
        "GET",
        "/fleet/admin.js",
        page(ADMIN_SCRIPT, "text/javascript"),
      ),
      HttpRouter.add("POST", "/fleet/login", login),
      HttpRouter.add("POST", "/fleet/otp", otp),
      HttpRouter.add("GET", "/fleet/status", status),
    );
  }),
);
