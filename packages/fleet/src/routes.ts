import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { FleetConfig } from "./config.js";
import type { FleetStatus } from "./fleet.js";
import type { SubmitOutcome } from "./session.js";

export type FleetClientShape = {
  readonly status: Effect.Effect<FleetStatus>;
  readonly submitCode: (code: string) => Effect.Effect<SubmitOutcome>;
};

export class FleetClient extends Context.Service<FleetClient, FleetClientShape>()("metro/FleetClient") {}

const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

export const bearerMatches = (header: string | undefined, secret: string) =>
  Effect.promise(async () => {
    if (header === undefined) return false;
    const [given, expected] = await Promise.all([digest(header), digest(`Bearer ${secret}`)]);
    let difference = 0;
    for (let index = 0; index < expected.length; index++) difference |= given[index] ^ expected[index];
    return difference === 0;
  });

const reply = (status: number, body: unknown) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });

const CodeBody = Schema.Struct({ code: Schema.String });

// The iPhone shortcut posts each SMS code here; anyone without the secret sees no endpoint at all.
export const FleetRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const { otpSecret } = yield* FleetConfig;
    const client = yield* FleetClient;

    const authorised = Effect.gen(function* () {
      if (Option.isNone(otpSecret)) return false;
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* bearerMatches(request.headers["authorization"], Redacted.value(otpSecret.value));
    });

    const otp = Effect.gen(function* () {
      if (!(yield* authorised)) return reply(404, { error: "not found" });
      const body = yield* HttpServerRequest.schemaBodyJson(CodeBody).pipe(Effect.option);
      const code = Option.map(body, ({ code }) => code.trim());
      if (Option.isNone(code) || !/^\d{6}$/.test(code.value)) return reply(400, { error: "expected a six-digit code" });
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

    const status = Effect.gen(function* () {
      if (!(yield* authorised)) return reply(404, { error: "not found" });
      return reply(200, yield* client.status);
    });

    return Layer.mergeAll(HttpRouter.add("POST", "/fleet/otp", otp), HttpRouter.add("GET", "/fleet/status", status));
  }),
);
