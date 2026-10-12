import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import { fakeHttpClient, type FakeReply, type FakeRequest } from "@metro/core/testing";
import { AuthClient, type AuthClientShape, isDeadToken, normalizePhone } from "@metro/upstream";

const BASE = "https://metrobusapiprod.eimsky.com/user-service/api/v1/auth";

const setup = (reply: (request: FakeRequest) => FakeReply) => {
  const http = fakeHttpClient(reply);
  const layer = AuthClient.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http.client)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({}))),
  );
  const run = <A, E>(use: (auth: AuthClientShape) => Effect.Effect<A, E>) =>
    Effect.runPromise(Effect.gen(function* () { return yield* use(yield* AuthClient); }).pipe(Effect.provide(layer)));
  return { requests: http.requests, run };
};

test("refresh posts the refresh token and returns the new pair", async () => {
  const { requests, run } = setup(() => ({ status: 200, json: { data: { access_token: "a2", refresh_token: "r2" } } }));
  assert.deepEqual(await run((auth) => auth.refresh("r1")), { accessToken: "a2", refreshToken: "r2" });
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url.toString(), `${BASE}/refresh`);
  assert.deepEqual(JSON.parse(requests[0].text), { refresh_token: "r1" });
  assert.equal(requests[0].headers["authorization"], undefined);
});

test("a 4xx on refresh is a dead token and a 5xx is an outage", async () => {
  const dead = await setup(() => ({ status: 400, json: { error: { code: "INVALID_REFRESH_TOKEN" } } })).run((auth) => Effect.flip(auth.refresh("r1")));
  const outage = await setup(() => ({ status: 503, text: "upstream connect error" })).run((auth) => Effect.flip(auth.refresh("r1")));
  assert.equal(dead.status, 400);
  assert.equal(isDeadToken(dead), true);
  assert.equal(outage.status, 503);
  assert.equal(isDeadToken(outage), false);
});

test("an unreadable refresh reply is an error without a status", async () => {
  const error = await setup(() => ({ status: 200, json: { data: {} } })).run((auth) => Effect.flip(auth.refresh("r1")));
  assert.equal(error.status, undefined);
  assert.equal(isDeadToken(error), false);
});

test("the webview token is fetched with the access token as bearer", async () => {
  const { requests, run } = setup(() => ({ status: 200, json: { data: { webview_token: "w", expires_in: 3600 } } }));
  assert.deepEqual(await run((auth) => auth.webview("a2")), { token: "w", expiresInSeconds: 3600 });
  assert.equal(requests[0].url.toString(), `${BASE}/webview-token`);
  assert.equal(requests[0].headers["authorization"], "Bearer a2");
});

test("a code request posts the phone and returns the OTP reference", async () => {
  const { requests, run } = setup(() => ({ status: 200, json: { data: { otp_reference: "ref-1", has_account: true } } }));
  assert.equal(await run((auth) => auth.checkPhone("+94771234567")), "ref-1");
  assert.equal(requests[0].url.toString(), `${BASE}/customer/check-phone`);
  assert.deepEqual(JSON.parse(requests[0].text), { phone: "+94771234567" });
});

test("verify-otp finds the nested tokens, and a reply without them is an error", async () => {
  const ok = setup(() => ({ status: 200, json: { data: { tokens: { access_token: "a", refresh_token: "r" } } } }));
  assert.deepEqual(await ok.run((auth) => auth.verifyOtp("ref-1", "123456")), { accessToken: "a", refreshToken: "r" });
  assert.equal(ok.requests[0].url.toString(), `${BASE}/customer/verify-otp`);
  assert.deepEqual(JSON.parse(ok.requests[0].text), { otp_reference: "ref-1", otp_code: "123456" });
  const empty = await setup(() => ({ status: 200, json: { data: {} } })).run((auth) => Effect.flip(auth.verifyOtp("ref-1", "123456")));
  assert.equal(empty.message, "verify-otp returned no tokens");
  const wrong = await setup(() => ({ status: 400, json: { error: { code: "INVALID_OTP" } } })).run((auth) => Effect.flip(auth.verifyOtp("ref-1", "000000")));
  assert.equal(wrong.status, 400);
});

test("Sri Lankan numbers are normalised and anything else is rejected", () => {
  assert.equal(normalizePhone("077 123 4567"), "+94771234567");
  assert.equal(normalizePhone("+94 77 123 4567"), "+94771234567");
  assert.equal(normalizePhone("12345"), undefined);
});
