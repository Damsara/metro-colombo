import { Clock, Effect, Option, Redacted, Schema, Semaphore } from "effect";
import { StateStore } from "@metro/core";
import { AuthClient, AuthHttpError, isDeadToken, LankaMetroConfig, normalizePhone } from "@metro/upstream";
import type { AlertBookShape } from "./alerts.js";

export const RENEW_MARGIN_MS = 2 * 60_000;
export const CODE_EVERY_MS = 10 * 60_000;
const REFRESH_TIMEOUT = "15 seconds";

export type LoginStatus = "ok" | "login_needed" | "upstream_error";

export type SubmitOutcome =
  | { readonly _tag: "Accepted" }
  | { readonly _tag: "NoCodePending" }
  | { readonly _tag: "CodeRejected"; readonly message: string };

export type SessionShape = {
  readonly token: Effect.Effect<Option.Option<Redacted.Redacted<string>>>;
  readonly status: Effect.Effect<LoginStatus>;
  readonly submitCode: (code: string) => Effect.Effect<SubmitOutcome>;
};

const StoredSession = Schema.Struct({
  refreshToken: Schema.String,
  webviewToken: Schema.String,
  expiresAt: Schema.Number,
  refreshedAt: Schema.Number,
});
type StoredSession = Schema.Schema.Type<typeof StoredSession>;

const StoredLogin = Schema.Struct({
  reason: Schema.String,
  otpReference: Schema.NullOr(Schema.String),
  lastCodeRequestAt: Schema.NullOr(Schema.Number),
});
type StoredLogin = Schema.Schema.Type<typeof StoredLogin>;

const ACCEPTED: SubmitOutcome = { _tag: "Accepted" };
export const NO_CODE_PENDING: SubmitOutcome = { _tag: "NoCodePending" };

const loginNeededAlert = (reason: string, hasPhone: boolean) => ({
  urgent: true,
  title: "Live buses are down: login needed",
  message: hasPhone
    ? `Upstream login failed: ${reason}. A code is being texted to the login phone; the iPhone shortcut sends it back.`
    : `Upstream login failed: ${reason}. Set METRO_PHONE so a code can be texted.`,
});

const restoredAlert = { title: "Live buses: login restored", message: "The code was accepted and the live feed is resuming." };

export const makeSession = (alerts: AlertBookShape) =>
  Effect.gen(function* () {
    const auth = yield* AuthClient;
    const state = yield* StateStore;
    const config = yield* LankaMetroConfig;
    const phone = Option.flatMap(config.phone, (raw) => Option.fromUndefinedOr(normalizePhone(raw)));
    // Refresh tokens are single use, so two refreshes at once would leave one holding a dead token.
    const semaphore = yield* Semaphore.make(1);
    const loadLock = yield* Semaphore.make(1);

    let loaded = false;
    let session: StoredSession | undefined;
    let login: StoredLogin | undefined;
    let lastError: "upstream_error" | undefined;
    let sessionUnsaved = false;
    let loginUncleared = false;

    // Every change to memory happens after the load, so a load that finds loaded set never overwrites newer state.
    const load = loadLock.withPermits(1)(
      Effect.gen(function* () {
        if (loaded) return;
        const storedSession = yield* state.get("session");
        const storedLogin = yield* state.get("login");
        session = Option.getOrUndefined(Option.flatMap(storedSession, Schema.decodeUnknownOption(StoredSession)));
        login = Option.getOrUndefined(Option.flatMap(storedLogin, Schema.decodeUnknownOption(StoredLogin)));
        if (Option.isNone(storedSession) && Option.isSome(config.seedRefreshToken)) {
          session = { refreshToken: Redacted.value(config.seedRefreshToken.value), webviewToken: "", expiresAt: 0, refreshedAt: 0 };
        }
        loaded = true;
      }),
    );

    // Memory is updated first so a failed write never loses a refresh token that upstream has already rotated.
    const saveSession = (next: StoredSession) =>
      Effect.andThen(
        Effect.sync(() => void ((session = next), (sessionUnsaved = true))),
        Effect.andThen(state.set("session", next), Effect.sync(() => void (sessionUnsaved = false))),
      );
    const keepSession = (next: StoredSession) =>
      saveSession(next).pipe(Effect.catch((error) => Effect.logWarning("session not saved, retrying next tick", error.message)));
    const saveLogin = (next: StoredLogin) =>
      Effect.andThen(Effect.sync(() => void ((login = next), (loginUncleared = false))), state.set("login", next));
    // Storage keeps the login record until the new session is saved, so a restart never falls back to the spent token.
    const clearLogin = Effect.andThen(
      Effect.sync(() => void ((login = undefined), (loginUncleared = true))),
      Effect.suspend(() =>
        sessionUnsaved
          ? Effect.void
          : state.delete("login").pipe(
              Effect.andThen(Effect.sync(() => void (loginUncleared = false))),
              Effect.catch((error) => Effect.logWarning("login state not cleared, retrying next tick", error.message)),
            ),
      ),
    );
    const retryWrites = semaphore.withPermits(1)(
      Effect.suspend(() =>
        Effect.andThen(
          sessionUnsaved && session ? keepSession(session) : Effect.void,
          Effect.suspend(() => (loginUncleared && !login && !sessionUnsaved ? clearLogin : Effect.void)),
        ),
      ),
    );
    const fresh = (now: number) =>
      session !== undefined && session.webviewToken !== "" && session.expiresAt - now > RENEW_MARGIN_MS;

    const requestCode = Effect.gen(function* () {
      const current = login;
      const now = yield* Clock.currentTimeMillis;
      if (!current || Option.isNone(phone)) return;
      if (current.lastCodeRequestAt !== null && now - current.lastCodeRequestAt < CODE_EVERY_MS) return;
      yield* saveLogin({ ...current, lastCodeRequestAt: now });
      // Once upstream has texted the code, nothing may interrupt before its reference is saved.
      yield* Effect.uninterruptibleMask((restore) =>
        Effect.flatMap(restore(auth.checkPhone(phone.value)), (reference) =>
          saveLogin({ ...current, lastCodeRequestAt: now, otpReference: reference }),
        ),
      );
      yield* Effect.logInfo("login code requested");
    }).pipe(Effect.catch((error) => Effect.logWarning("login code request failed", error.message)));

    const needLogin = (reason: string) =>
      Effect.gen(function* () {
        if (!login) yield* saveLogin({ reason, otpReference: null, lastCodeRequestAt: null });
        yield* alerts.raise("login", loginNeededAlert(reason, Option.isSome(phone)));
        yield* requestCode;
      });

    const adopt = (refreshToken: string, accessToken: string) =>
      auth.webview(accessToken).pipe(
        Effect.flatMap((webview) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* keepSession({
              refreshToken,
              webviewToken: webview.token,
              expiresAt: now + webview.expiresInSeconds * 1000,
              refreshedAt: now,
            });
            lastError = undefined;
          }),
        ),
        Effect.catchTag("AuthHttpError", (error) =>
          Effect.andThen(Effect.sync(() => void (lastError = "upstream_error")), Effect.logWarning("webview token failed", error.message)),
        ),
      );

    const refresh = semaphore.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (login || fresh(now)) return;
        const current = session;
        if (!current?.refreshToken) return yield* needLogin("no refresh token");
        // Once upstream has answered, the old token is spent, so nothing may interrupt before the new one is saved.
        const pair = yield* Effect.uninterruptibleMask((restore) =>
          restore(
            auth.refresh(current.refreshToken).pipe(
              Effect.timeout(REFRESH_TIMEOUT),
              Effect.catchTag("TimeoutError", () =>
                Effect.fail(new AuthHttpError({ endpoint: "refresh", message: "upstream /auth/refresh timed out" })),
              ),
            ),
          ).pipe(Effect.tap((rotated) => saveSession({ ...current, refreshToken: rotated.refreshToken, webviewToken: "", expiresAt: 0 }))),
        ).pipe(
          Effect.map(Option.some),
          Effect.catchTag("AuthHttpError", (error) =>
            isDeadToken(error)
              ? Effect.as(needLogin(`the refresh token was rejected (HTTP ${error.status})`), Option.none())
              : Effect.as(
                  Effect.andThen(Effect.sync(() => void (lastError = "upstream_error")), Effect.logWarning("refresh failed", error.message)),
                  Option.none(),
                ),
          ),
        );
        if (Option.isNone(pair)) return;
        yield* adopt(pair.value.refreshToken, pair.value.accessToken);
      }),
    );

    const token = Effect.gen(function* () {
      yield* load;
      if (sessionUnsaved || loginUncleared) yield* retryWrites;
      if (login) {
        yield* semaphore.withPermits(1)(Effect.suspend(() => (login ? needLogin(login.reason) : Effect.void)));
        if (login) return Option.none<Redacted.Redacted<string>>();
      }
      if (!fresh(yield* Clock.currentTimeMillis)) yield* refresh;
      const now = yield* Clock.currentTimeMillis;
      return session && session.webviewToken !== "" && session.expiresAt > now
        ? Option.some(Redacted.make(session.webviewToken))
        : Option.none<Redacted.Redacted<string>>();
    }).pipe(
      Effect.catch((error) => Effect.as(Effect.logWarning("session state unavailable", error.message), Option.none<Redacted.Redacted<string>>())),
    );

    const status = load.pipe(
      Effect.ignore,
      Effect.map((): LoginStatus => (login ? "login_needed" : (lastError ?? "ok"))),
    );

    const submitCode = (code: string) =>
      semaphore
        .withPermits(1)(
          Effect.gen(function* () {
            yield* load;
            const reference = login?.otpReference;
            if (!reference) return NO_CODE_PENDING;
            const verified = yield* auth.verifyOtp(reference, code).pipe(
              Effect.map((pair) => ({ ok: true as const, pair })),
              Effect.catchTag("AuthHttpError", (error) => Effect.succeed({ ok: false as const, message: error.message })),
            );
            if (!verified.ok) return { _tag: "CodeRejected", message: verified.message } satisfies SubmitOutcome;
            yield* keepSession({ refreshToken: verified.pair.refreshToken, webviewToken: "", expiresAt: 0, refreshedAt: 0 });
            yield* clearLogin;
            yield* adopt(verified.pair.refreshToken, verified.pair.accessToken);
            yield* alerts.resolve("login", restoredAlert);
            return ACCEPTED;
          }),
        )
        .pipe(
          Effect.catch((error) =>
            Effect.succeed<SubmitOutcome>({ _tag: "CodeRejected", message: `login state unavailable: ${error.message}` }),
          ),
        );

    const shape: SessionShape = { token, status, submitCode };
    return shape;
  });
