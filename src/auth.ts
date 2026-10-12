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
import { Alerts } from "./alerts.js";
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
  | "ok"
  | "http_error"
  | "decode_error"
  | "timeout"
  | "transport";

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
  status: Schema.optional(Schema.Number),
}) {}

export class NoCodePending extends Schema.TaggedError<NoCodePending>()(
  "NoCodePending",
  {},
) {}

type TokenState = {
  readonly webviewToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
};

// Renew early so a request never races the 1-hour expiry boundary.
const RENEW_MARGIN = Duration.minutes(10);
// Each request texts the phone, and a code stays valid for 5 minutes.
const CODE_EVERY = Duration.minutes(10);

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
const CheckPhoneResponse = Schema.Struct({
  data: Schema.Struct({ otp_reference: Schema.String }),
});

export const normalizePhone = (raw: string): string | undefined => {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("94") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10)
    return `+94${digits.slice(1)}`;
  return undefined;
};

// verify-otp's reply nests the tokens differently by account state.
const findTokens = (
  value: unknown,
  found: { access?: string; refresh?: string } = {},
) => {
  if (typeof value !== "object" || value === null) return found;
  const record = value as Record<string, unknown>;
  for (const [key, field] of [
    ["access_token", "access"],
    ["refresh_token", "refresh"],
  ] as const) {
    const token = record[key];
    if (typeof token === "string" && token) found[field] ??= token;
  }
  for (const nested of Object.values(record)) findTokens(nested, found);
  return found;
};

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
  {
    readonly currentToken: Effect.Effect<Redacted.Redacted<string>, AuthError>;
    readonly submitCode: (
      code: string,
    ) => Effect.Effect<void, AuthError | NoCodePending>;
  }
>()("lmt-go/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const config = yield* UpstreamConfig;
      const http = yield* HttpClient.HttpClient;
      const clock = yield* Clock.Clock;
      const alerts = yield* Alerts;
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
      const phone = Option.match(config.phone, {
        onNone: () => undefined,
        onSome: normalizePhone,
      });
      if (Option.isSome(config.phone) && !phone)
        yield* Effect.logWarning("METRO_PHONE is not a Sri Lankan number");

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

      const send = (endpoint: string, body: unknown, bearer?: string) =>
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
            Effect.mapError(
              () =>
                new AuthError({ message: `upstream /auth/${endpoint} failed` }),
            ),
            Effect.flatMap((response) =>
              response.status < 400
                ? Effect.succeed(response)
                : Effect.andThen(
                    countRequest("auth", "http_error"),
                    new AuthError({
                      message: `upstream /auth/${endpoint} answered HTTP ${response.status}`,
                      status: response.status,
                    }),
                  ),
            ),
          );

      const post = <A>(
        schema: Schema.Codec<A, unknown>,
        endpoint: string,
        body: unknown,
        bearer?: string,
      ) =>
        send(endpoint, body, bearer).pipe(
          Effect.flatMap((response) =>
            HttpClientResponse.schemaBodyJson(schema)(response).pipe(
              Effect.tapError((error) =>
                countRequest(
                  "auth",
                  Schema.isSchemaError(error) ? "decode_error" : "transport",
                ),
              ),
              Effect.mapError(
                () =>
                  new AuthError({
                    message: `upstream /auth/${endpoint} failed`,
                  }),
              ),
            ),
          ),
          Effect.tap(() => countRequest("auth", "ok")),
        );

      const adopt = (refreshToken: string, accessToken: string) =>
        Effect.gen(function* () {
          const webview = yield* post(
            WebviewResponse,
            "webview-token",
            {},
            accessToken,
          );
          yield* Ref.set(state, {
            webviewToken: webview.data.webview_token,
            refreshToken,
            expiresAt:
              clock.currentTimeMillisUnsafe() + webview.data.expires_in * 1000,
          });
          yield* Effect.sync(() => {
            try {
              writeFileSync(
                stateFile,
                JSON.stringify({ refresh_token: refreshToken }),
                { mode: 0o600 },
              );
            } catch {
              // Keeps working until the next restart, which then needs a new login.
            }
          });
        });

      let loginNeeded = false;
      let pendingCode: string | undefined;
      let lastCodeRequest = Number.NEGATIVE_INFINITY;

      const requestCode = Effect.gen(function* () {
        const now = clock.currentTimeMillisUnsafe();
        if (!phone || now - lastCodeRequest < Duration.toMillis(CODE_EVERY))
          return;
        lastCodeRequest = now;
        const sent = yield* post(CheckPhoneResponse, "customer/check-phone", {
          phone,
        });
        pendingCode = sent.data.otp_reference;
        yield* Effect.logInfo("login code requested");
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("login code request failed", error),
        ),
      );

      // Stops calling refresh until a code arrives; retrying a dead token never revives it.
      const needLogin = (reason: string) =>
        Effect.gen(function* () {
          if (!loginNeeded) {
            loginNeeded = true;
            yield* alerts.send({
              urgent: true,
              title: "Live buses are down: login needed",
              message: phone
                ? `Upstream login failed: ${reason}. A code is being texted to the login phone; the iPhone shortcut sends it back.`
                : `Upstream login failed: ${reason}. Set METRO_PHONE, or run scripts/otp-login.mjs and redeploy.`,
            });
          }
          yield* requestCode;
          return yield* new AuthError({ message: `login needed: ${reason}` });
        });

      const isDead = (error: AuthError) =>
        error.status !== undefined && error.status >= 400 && error.status < 500;

      const renew = Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (isFresh(current)) return;
        if (loginNeeded)
          return yield* needLogin("the refresh token was rejected");
        if (!current?.refreshToken) return yield* needLogin("no refresh token");
        const refreshWith = (token: string) =>
          post(RefreshResponse, "refresh", { refresh_token: token });
        const refresh = yield* refreshWith(current.refreshToken).pipe(
          Effect.catch((error) => {
            const retry = fallbackSeed;
            fallbackSeed = "";
            return retry ? refreshWith(retry) : Effect.fail(error);
          }),
          Effect.catchIf(isDead, (error) =>
            needLogin(`the refresh token was rejected (HTTP ${error.status})`),
          ),
        );
        yield* adopt(refresh.data.refresh_token, refresh.data.access_token);
      }).pipe(Effect.withSpan("Auth.refresh"), renewing.withPermits(1));

      const submitCode = (code: string) =>
        Effect.gen(function* () {
          if (!pendingCode) return yield* new NoCodePending();
          const response = yield* send("customer/verify-otp", {
            otp_reference: pendingCode,
            otp_code: code,
          });
          const body = yield* response.json.pipe(
            Effect.mapError(
              () => new AuthError({ message: "verify-otp reply unreadable" }),
            ),
          );
          const tokens = findTokens(body);
          if (!tokens.access || !tokens.refresh) {
            return yield* new AuthError({
              message: "verify-otp returned no tokens",
            });
          }
          yield* adopt(tokens.refresh, tokens.access);
          pendingCode = undefined;
          fallbackSeed = "";
          lastCodeRequest = Number.NEGATIVE_INFINITY;
          if (loginNeeded) {
            loginNeeded = false;
            yield* alerts.send({
              title: "Live buses: login restored",
              message: "The code was accepted and the live feed is resuming.",
            });
          }
        }).pipe(Effect.withSpan("Auth.submitCode"), renewing.withPermits(1));

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

      return Auth.of({ currentToken, submitCode });
    }),
  );
}
