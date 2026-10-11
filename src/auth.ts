import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Metric,
  Option,
  Redacted,
  Ref,
  Schema,
  Semaphore,
} from "effect";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { UpstreamConfig } from "./config.js";

export type Endpoint =
  | "routes"
  | "stops"
  | "journey"
  | "places"
  | "geometry"
  | "colours"
  | "occasions"
  | "auth";
export type Outcome =
  "ok" | "http_error" | "decode_error" | "timeout" | "transport";

const requests = Metric.counter("upstream.requests", { incremental: true });
const decodeFailures = Metric.counter("upstream.decode_failures", {
  incremental: true,
});
const fallbacks = Metric.counter("upstream.fallbacks", { incremental: true });

export const countRequest = (endpoint: Endpoint, outcome: Outcome) =>
  Metric.update(Metric.withAttributes(requests, { endpoint, outcome }), 1).pipe(
    Effect.andThen(
      outcome === "decode_error"
        ? Metric.update(Metric.withAttributes(decodeFailures, { endpoint }), 1)
        : Effect.void,
    ),
  );

export const countFallback = (endpoint: Endpoint) =>
  Metric.update(Metric.withAttributes(fallbacks, { endpoint }), 1);

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  message: Schema.String,
}) {}

type TokenState = {
  readonly webviewToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
};

// Renew early so a request never races the 1-hour expiry boundary.
const RENEW_MARGIN = Duration.minutes(10);

const RefreshResponse = Schema.Struct({
  data: Schema.Struct({
    access_token: Schema.String,
    refresh_token: Schema.String,
  }),
});
const WebviewResponse = Schema.Struct({
  data: Schema.Struct({
    webview_token: Schema.String,
    expires_in: Schema.Number,
  }),
});

const readStoredRefresh = (file: string) => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" &&
      parsed !== null &&
      "refresh_token" in parsed &&
      typeof parsed.refresh_token === "string"
      ? parsed.refresh_token
      : "";
  } catch {
    return "";
  }
};

export class Auth extends Context.Service<
  Auth,
  { readonly currentToken: Effect.Effect<Redacted.Redacted<string>, AuthError> }
>()("lmt-go/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const config = yield* UpstreamConfig;
      const http = yield* HttpClient.HttpClient;
      const clock = yield* Clock.Clock;
      const authBase = `${config.eimskyBase}/user-service/api/v1/auth`;
      const stateFile = path.resolve(config.authStatePath);

      // The stored token wins because the seed is spent after the first refresh.
      const stored = readStoredRefresh(stateFile);
      const envSeed = Option.match(config.refreshToken, {
        onNone: () => "",
        onSome: Redacted.value,
      });
      const seed = stored || envSeed;
      let fallbackSeed = stored && envSeed !== stored ? envSeed : "";

      const state = yield* Ref.make<TokenState | null>(
        seed ? { webviewToken: "", refreshToken: seed, expiresAt: 0 } : null,
      );
      // Refresh tokens are single-use, so racing renewals would leave one holding a dead token.
      const renewing = yield* Semaphore.make(1);

      const isFresh = (current: TokenState | null) =>
        current !== null &&
        current.webviewToken !== "" &&
        current.expiresAt - clock.currentTimeMillisUnsafe() >
          Duration.toMillis(RENEW_MARGIN);

      const post = <A>(
        schema: Schema.Codec<A, unknown>,
        endpoint: string,
        body: unknown,
        bearer?: string,
      ) =>
        http
          .post(`${authBase}/${endpoint}`, {
            headers: {
              "content-type": "application/json",
              ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            },
            body: HttpBody.jsonUnsafe(body),
          })
          .pipe(
            Effect.tapError(() => countRequest("auth", "transport")),
            Effect.flatMap((response) =>
              HttpClientResponse.schemaBodyJson(schema)(response).pipe(
                Effect.tapError((error) =>
                  countRequest(
                    "auth",
                    Schema.isSchemaError(error) ? "decode_error" : "transport",
                  ),
                ),
              ),
            ),
            Effect.tap(() => countRequest("auth", "ok")),
            Effect.mapError(
              () =>
                new AuthError({ message: `upstream /auth/${endpoint} failed` }),
            ),
          );

      const renew = Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (isFresh(current)) return;
        if (!current?.refreshToken) {
          return yield* new AuthError({
            message: "no refresh token; run scripts/otp-login.mjs once",
          });
        }
        const refreshWith = (token: string) =>
          post(RefreshResponse, "refresh", { refresh_token: token });
        const refresh = yield* refreshWith(current.refreshToken).pipe(
          Effect.catch((error) => {
            const retry = fallbackSeed;
            fallbackSeed = "";
            return retry ? refreshWith(retry) : Effect.fail(error);
          }),
        );
        const webview = yield* post(
          WebviewResponse,
          "webview-token",
          {},
          refresh.data.access_token,
        );
        yield* Ref.set(state, {
          webviewToken: webview.data.webview_token,
          refreshToken: refresh.data.refresh_token,
          expiresAt:
            clock.currentTimeMillisUnsafe() + webview.data.expires_in * 1000,
        });
        yield* Effect.sync(() => {
          try {
            writeFileSync(
              stateFile,
              JSON.stringify({ refresh_token: refresh.data.refresh_token }),
              { mode: 0o600 },
            );
          } catch {
            // Keeps working until the next restart, which then needs a new login.
          }
        });
      }).pipe(Effect.withSpan("Auth.refresh"), renewing.withPermits(1));

      const currentToken = Effect.gen(function* () {
        if (!isFresh(yield* Ref.get(state))) yield* renew;
        const next = yield* Ref.get(state);
        if (!next?.webviewToken) {
          return yield* new AuthError({
            message: "no upstream token available",
          });
        }
        return Redacted.make(next.webviewToken);
      }).pipe(Effect.withSpan("Auth.currentToken"));

      return Auth.of({ currentToken });
    }),
  );
}
