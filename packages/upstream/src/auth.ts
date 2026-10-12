import { Context, Data, Effect, Layer, Schema } from "effect";
import { HttpBody, HttpClient, type HttpClientResponse } from "effect/http";
import { LankaMetroConfig } from "./config.js";

export class AuthHttpError extends Data.TaggedError("AuthHttpError")<{
  readonly endpoint: string;
  readonly message: string;
  readonly status?: number;
}> {}

// Only a 4xx on refresh means the token is dead; 408, 429, 5xx and network failures are outages.
export const isDeadToken = (error: AuthHttpError) =>
  error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;

export type TokenPair = { readonly accessToken: string; readonly refreshToken: string };
export type WebviewToken = { readonly token: string; readonly expiresInSeconds: number };

export const normalizePhone = (raw: string): string | undefined => {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("94") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+94${digits.slice(1)}`;
  return undefined;
};

// verify-otp's reply nests the tokens differently by account state.
export const findTokens = (value: unknown, found: { access?: string; refresh?: string } = {}) => {
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

const RefreshResponse = Schema.Struct({
  data: Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
});
const WebviewResponse = Schema.Struct({
  data: Schema.Struct({ webview_token: Schema.String, expires_in: Schema.Number }),
});
const CheckPhoneResponse = Schema.Struct({
  data: Schema.Struct({ otp_reference: Schema.String }),
});

export type AuthClientShape = {
  readonly refresh: (refreshToken: string) => Effect.Effect<TokenPair, AuthHttpError>;
  readonly webview: (accessToken: string) => Effect.Effect<WebviewToken, AuthHttpError>;
  readonly checkPhone: (phone: string) => Effect.Effect<string, AuthHttpError>;
  readonly verifyOtp: (reference: string, code: string) => Effect.Effect<TokenPair, AuthHttpError>;
};

export class AuthClient extends Context.Service<AuthClient, AuthClientShape>()("metro/AuthClient") {
  static readonly layer = Layer.effect(
    AuthClient,
    Effect.gen(function* () {
      const { eimskyBase } = yield* LankaMetroConfig;
      const http = yield* HttpClient.HttpClient;
      const base = `${eimskyBase}/user-service/api/v1/auth`;

      const send = (endpoint: string, body: unknown, bearer?: string) =>
        http
          .post(`${base}/${endpoint}`, {
            headers: {
              "content-type": "application/json",
              ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            },
            body: HttpBody.jsonUnsafe(body),
          })
          .pipe(
            Effect.mapError(() => new AuthHttpError({ endpoint, message: `upstream /auth/${endpoint} failed` })),
            Effect.flatMap((response) =>
              response.status < 400
                ? Effect.succeed(response)
                : Effect.andThen(
                    Effect.ignore(response.arrayBuffer),
                    Effect.fail(
                      new AuthHttpError({
                        endpoint,
                        message: `upstream /auth/${endpoint} answered HTTP ${response.status}`,
                        status: response.status,
                      }),
                    ),
                  ),
            ),
          );

      const readWith =
        <A>(endpoint: string, decode: (input: unknown) => Effect.Effect<A, Schema.SchemaError>) =>
        (response: HttpClientResponse.HttpClientResponse) =>
          response.json.pipe(
            Effect.flatMap(decode),
            Effect.mapError(() => new AuthHttpError({ endpoint, message: `upstream /auth/${endpoint} reply unreadable` })),
          );

      return AuthClient.of({
        refresh: (refreshToken) =>
          send("refresh", { refresh_token: refreshToken }).pipe(
            Effect.flatMap(readWith("refresh", Schema.decodeUnknownEffect(RefreshResponse))),
            Effect.map(({ data }) => ({ accessToken: data.access_token, refreshToken: data.refresh_token })),
          ),
        webview: (accessToken) =>
          send("webview-token", {}, accessToken).pipe(
            Effect.flatMap(readWith("webview-token", Schema.decodeUnknownEffect(WebviewResponse))),
            Effect.map(({ data }) => ({ token: data.webview_token, expiresInSeconds: data.expires_in })),
          ),
        checkPhone: (phone) =>
          send("customer/check-phone", { phone }).pipe(
            Effect.flatMap(readWith("customer/check-phone", Schema.decodeUnknownEffect(CheckPhoneResponse))),
            Effect.map(({ data }) => data.otp_reference),
          ),
        verifyOtp: (reference, code) =>
          send("customer/verify-otp", { otp_reference: reference, otp_code: code }).pipe(
            Effect.flatMap(readWith("customer/verify-otp", (input) => Effect.succeed(input))),
            Effect.flatMap((body) => {
              const tokens = findTokens(body);
              return tokens.access && tokens.refresh
                ? Effect.succeed({ accessToken: tokens.access, refreshToken: tokens.refresh })
                : Effect.fail(new AuthHttpError({ endpoint: "customer/verify-otp", message: "verify-otp returned no tokens" }));
            }),
          ),
      });
    }),
  );
}
