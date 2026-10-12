import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { Alerts } from "../src/alerts.js";
import { Auth } from "../src/auth.js";

// Each refresh token works once and is replaced by the next, like the real server.
const fakeAuthServer = (valid: string) => {
  const calls = { refresh: 0, webview: 0 };
  const client = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const reply = (status: number, body: unknown) =>
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), { status }),
        );
      if (url.pathname.endsWith("/auth/refresh")) {
        calls.refresh += 1;
        yield* Effect.sleep(5);
        const sent = JSON.parse(
          new TextDecoder().decode((request.body as { body: Uint8Array }).body),
        ) as { refresh_token: string };
        if (sent.refresh_token !== valid) return reply(401, {});
        valid = `refresh-${calls.refresh}`;
        return reply(200, {
          data: { access_token: "access", refresh_token: valid },
        });
      }
      calls.webview += 1;
      return reply(200, {
        data: { webview_token: `webview-${calls.webview}`, expires_in: 3600 },
      });
    }),
  );
  return { calls, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const run = <A, E>(
  program: Effect.Effect<A, E, Auth>,
  env: Record<string, string>,
  http: Layer.Layer<HttpClient.HttpClient>,
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(
        Auth.layer.pipe(
          Layer.provide(http),
          Layer.provide(
            Layer.succeed(Alerts, Alerts.of({ send: () => Effect.void })),
          ),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)),
          ),
        ),
      ),
    ),
  );

test("renews once for concurrent callers and stores the rotated token", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "auth-"));
  const stateFile = path.join(dir, "auth-state");
  const server = fakeAuthServer("seed");

  const tokens = await run(
    Effect.gen(function* () {
      const auth = yield* Auth;
      return yield* Effect.all(
        [auth.currentToken, auth.currentToken, auth.currentToken],
        { concurrency: "unbounded" },
      );
    }),
    { METRO_REFRESH_TOKEN: "seed", AUTH_STATE_PATH: stateFile },
    server.layer,
  );

  assert.deepEqual(tokens.map(Redacted.value), [
    "webview-1",
    "webview-1",
    "webview-1",
  ]);
  assert.equal(server.calls.refresh, 1);
  assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), {
    refresh_token: "refresh-1",
  });
});

test("uses the stored token over the spent seed", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "auth-"));
  const stateFile = path.join(dir, "auth-state");
  writeFileSync(stateFile, JSON.stringify({ refresh_token: "stored" }));
  const server = fakeAuthServer("stored");

  const token = await run(
    Effect.gen(function* () {
      return yield* (yield* Auth).currentToken;
    }),
    { METRO_REFRESH_TOKEN: "seed", AUTH_STATE_PATH: stateFile },
    server.layer,
  );

  assert.equal(Redacted.value(token), "webview-1");
  assert.equal(server.calls.refresh, 1);
});

test("falls back to a newer seed when the stored token is dead", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "auth-"));
  const stateFile = path.join(dir, "auth-state");
  writeFileSync(stateFile, JSON.stringify({ refresh_token: "expired" }));
  const server = fakeAuthServer("seed");

  const token = await run(
    Effect.gen(function* () {
      return yield* (yield* Auth).currentToken;
    }),
    { METRO_REFRESH_TOKEN: "seed", AUTH_STATE_PATH: stateFile },
    server.layer,
  );

  assert.equal(Redacted.value(token), "webview-1");
  assert.equal(server.calls.refresh, 2);
  assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), {
    refresh_token: "refresh-2",
  });
});
