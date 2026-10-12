import assert from "node:assert/strict";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import { type Alert, Alerts } from "@metro/core";
import { fakeHttpClient, type Register } from "@metro/core/testing";
import { NtfyAlerts } from "@metro/fleet";

const send = async (env: Record<string, string>, alert: Alert, status = 200) => {
  const http = fakeHttpClient(() => ({ status, text: "ok" }));
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* (yield* Alerts).send(alert);
    }).pipe(
      Effect.provide(
        NtfyAlerts.pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, http.client)),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
        ),
      ),
    ),
  );
  return http.requests;
};

const WEBHOOK = { ALERT_WEBHOOK_URL: "https://ntfy.test/metro-staging" };

export function alertsSuite(test: Register, name: string) {
  test(`${name}: an urgent alert is a plain-text ntfy post with a high priority`, async () => {
    const [request, ...rest] = await send(WEBHOOK, { urgent: true, title: "Live buses are down: login needed", message: "Upstream login failed." });
    assert.equal(rest.length, 0);
    assert.equal(request.method, "POST");
    assert.equal(request.url.toString(), "https://ntfy.test/metro-staging");
    assert.equal(request.text, "Upstream login failed.");
    assert.equal(request.headers["title"], "Live buses are down: login needed");
    assert.equal(request.headers["priority"], "high");
    assert.equal(request.headers["tags"], "rotating_light");
  });

  test(`${name}: a resolved notice goes out at the default priority`, async () => {
    const [request] = await send(WEBHOOK, { title: "Live buses: login restored", message: "Resuming." });
    assert.equal(request.headers["priority"], "default");
    assert.equal(request.headers["tags"], "white_check_mark");
  });

  test(`${name}: without a webhook nothing is posted`, async () => {
    assert.deepEqual(await send({}, { title: "t", message: "m" }), []);
  });

  test(`${name}: a webhook that refuses never fails the sender`, async () => {
    assert.equal((await send(WEBHOOK, { title: "t", message: "m" }, 500)).length, 1);
  });
}
