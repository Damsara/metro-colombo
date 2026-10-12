import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ConfigProvider, Effect, Exit, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { type Alert, Alerts } from "../src/alerts.js";
import { Auth, normalizePhone } from "../src/auth.js";

// The refresh token is dead; a code texted to the phone logs in again, like the real server.
const fakeUpstream = (options: { refreshStatus?: number } = {}) => {
  const calls = {
    refresh: 0,
    checkPhone: 0,
    verify: 0,
    phones: [] as string[],
  };
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const reply = (status: number, body: unknown) =>
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), { status }),
        );
      const sent = JSON.parse(
        new TextDecoder().decode((request.body as { body: Uint8Array }).body),
      ) as Record<string, string>;
      if (url.pathname.endsWith("/auth/refresh")) {
        calls.refresh += 1;
        return reply(options.refreshStatus ?? 400, {
          error: { code: "INVALID_REFRESH_TOKEN" },
        });
      }
      if (url.pathname.endsWith("/customer/check-phone")) {
        calls.checkPhone += 1;
        calls.phones.push(sent.phone);
        return reply(200, {
          data: { otp_reference: `ref-${calls.checkPhone}`, has_account: true },
        });
      }
      if (url.pathname.endsWith("/customer/verify-otp")) {
        calls.verify += 1;
        return sent.otp_code === "123456" &&
          sent.otp_reference === `ref-${calls.checkPhone}`
          ? reply(200, {
              data: {
                tokens: { access_token: "access", refresh_token: "fresh" },
              },
            })
          : reply(400, { error: { code: "INVALID_OTP" } });
      }
      return reply(200, {
        data: { webview_token: "webview-new", expires_in: 3600 },
      });
    }),
  );
  return { calls, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const recordingAlerts = () => {
  const sent: Alert[] = [];
  const layer = Layer.succeed(
    Alerts,
    Alerts.of({ send: (alert) => Effect.sync(() => void sent.push(alert)) }),
  );
  return { sent, layer };
};

const setup = (env: Record<string, string>, refreshStatus?: number) => {
  const dir = mkdtempSync(path.join(tmpdir(), "auth-login-"));
  const stateFile = path.join(dir, "auth-state");
  writeFileSync(stateFile, JSON.stringify({ refresh_token: "dead" }));
  const upstream = fakeUpstream({ refreshStatus });
  const alerts = recordingAlerts();
  const run = <A, E>(program: Effect.Effect<A, E, Auth>) =>
    Effect.runPromise(
      program.pipe(
        Effect.provide(
          Auth.layer.pipe(
            Layer.provide(upstream.layer),
            Layer.provide(alerts.layer),
            Layer.provide(
              ConfigProvider.layer(
                ConfigProvider.fromEnvRecord({
                  AUTH_STATE_PATH: stateFile,
                  ...env,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  return { stateFile, upstream, alerts, run };
};

test("a dead refresh token alerts once, texts one code, and stops refreshing", async () => {
  const { upstream, alerts, run } = setup({ METRO_PHONE: "0771 234 567" });

  const exits = await run(
    Effect.gen(function* () {
      const auth = yield* Auth;
      return [
        yield* Effect.exit(auth.currentToken),
        yield* Effect.exit(auth.currentToken),
        yield* Effect.exit(auth.currentToken),
      ];
    }),
  );

  assert.ok(exits.every(Exit.isFailure));
  assert.equal(upstream.calls.refresh, 1);
  assert.equal(upstream.calls.checkPhone, 1);
  assert.deepEqual(upstream.calls.phones, ["+94771234567"]);
  assert.equal(alerts.sent.length, 1);
  assert.equal(alerts.sent[0]?.urgent, true);
});

test("the texted code logs in again, saves the new token and says so", async () => {
  const { stateFile, upstream, alerts, run } = setup({
    METRO_PHONE: "0771234567",
  });

  const token = await run(
    Effect.gen(function* () {
      const auth = yield* Auth;
      yield* Effect.exit(auth.currentToken);
      const wrong = yield* Effect.exit(auth.submitCode("999999"));
      assert.ok(Exit.isFailure(wrong));
      yield* auth.submitCode("123456");
      return yield* auth.currentToken;
    }),
  );

  assert.equal(Redacted.value(token), "webview-new");
  assert.equal(upstream.calls.verify, 2);
  assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), {
    refresh_token: "fresh",
  });
  assert.deepEqual(
    alerts.sent.map((alert) => alert.title),
    ["Live buses are down: login needed", "Live buses: login restored"],
  );
});

test("a code with nothing pending is refused without calling upstream", async () => {
  const { upstream, run } = setup({ METRO_PHONE: "0771234567" });

  const exit = await run(
    Effect.gen(function* () {
      return yield* Effect.exit((yield* Auth).submitCode("123456"));
    }),
  );

  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /NoCodePending/);
  assert.equal(upstream.calls.verify, 0);
});

test("without a phone the alert still goes out but no code is requested", async () => {
  const { upstream, alerts, run } = setup({});

  await run(
    Effect.gen(function* () {
      yield* Effect.exit((yield* Auth).currentToken);
    }),
  );

  assert.equal(upstream.calls.checkPhone, 0);
  assert.equal(alerts.sent.length, 1);
});

test("an upstream outage is not mistaken for a dead token", async () => {
  const { upstream, alerts, run } = setup({ METRO_PHONE: "0771234567" }, 503);

  await run(
    Effect.gen(function* () {
      const auth = yield* Auth;
      yield* Effect.exit(auth.currentToken);
      yield* Effect.exit(auth.currentToken);
    }),
  );

  assert.equal(upstream.calls.refresh, 2);
  assert.equal(upstream.calls.checkPhone, 0);
  assert.equal(alerts.sent.length, 0);
});

test("Sri Lankan numbers are normalised and anything else is rejected", () => {
  assert.equal(normalizePhone("077 123 4567"), "+94771234567");
  assert.equal(normalizePhone("+94 77 123 4567"), "+94771234567");
  assert.equal(normalizePhone("12345"), undefined);
});
