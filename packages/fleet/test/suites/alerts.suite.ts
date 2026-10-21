import assert from "node:assert/strict";
import { ConfigProvider, Effect, Layer, Logger } from "effect";
import { HttpClient, HttpClientError } from "effect/http";
import { type Alert, Alerts } from "@metro/core";
import { fakeHttpClient, type Register } from "@metro/core/testing";
import { NtfyAlerts } from "@metro/fleet";

export const capturedLogs = () => {
  const lines: string[] = [];
  const layer = Logger.layer([
    Logger.make(({ message }) => void lines.push(JSON.stringify(message))),
  ]);
  return { lines, layer };
};

const deliver = async (
  client: HttpClient.HttpClient,
  env: Record<string, string>,
  alert: Alert,
) => {
  const logs = capturedLogs();
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* (yield* Alerts).send(alert);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NtfyAlerts.pipe(
            Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
            Layer.provide(
              ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)),
            ),
          ),
          logs.layer,
        ),
      ),
    ),
  );
  return logs.lines;
};

const send = async (
  env: Record<string, string>,
  alert: Alert,
  status = 200,
) => {
  const http = fakeHttpClient(() => ({ status, text: "ok" }));
  const lines = await deliver(http.client, env, alert);
  return { requests: http.requests, lines };
};

const WEBHOOK = { ALERT_WEBHOOK_URL: "https://ntfy.test/metro-staging" };

export function alertsSuite(test: Register, name: string) {
  test(`${name}: an urgent alert is a plain-text ntfy post with a high priority`, async () => {
    const { requests } = await send(WEBHOOK, {
      urgent: true,
      title: "Live buses are down: login needed",
      message: "Upstream login failed.",
    });
    const [request, ...rest] = requests;
    assert.equal(rest.length, 0);
    assert.equal(request.method, "POST");
    assert.equal(request.url.toString(), "https://ntfy.test/metro-staging");
    assert.equal(request.text, "Upstream login failed.");
    assert.equal(request.headers["title"], "Live buses are down: login needed");
    assert.equal(request.headers["priority"], "high");
    assert.equal(request.headers["tags"], "rotating_light");
  });

  test(`${name}: a critical alert goes out at the max priority`, async () => {
    const { requests } = await send(WEBHOOK, {
      urgent: true,
      critical: true,
      title: "Still down after 15 minutes: Live buses are down: login needed",
      message: "Upstream login failed.",
    });
    assert.equal(requests[0].headers["priority"], "max");
    assert.equal(requests[0].headers["tags"], "rotating_light");
  });

  test(`${name}: a resolved notice goes out at the default priority`, async () => {
    const { requests } = await send(WEBHOOK, {
      title: "Live buses: login restored",
      message: "Resuming.",
    });
    assert.equal(requests[0].headers["priority"], "default");
    assert.equal(requests[0].headers["tags"], "white_check_mark");
  });

  test(`${name}: without a webhook nothing is posted`, async () => {
    assert.deepEqual(
      (await send({}, { title: "t", message: "m" })).requests,
      [],
    );
  });

  test(`${name}: a webhook that refuses never fails the sender`, async () => {
    const { requests, lines } = await send(
      WEBHOOK,
      { title: "t", message: "m" },
      500,
    );
    assert.equal(requests.length, 1);
    assert.equal(
      lines.some((line) => line.includes("rejected")),
      true,
    );
  });

  test(`${name}: delivery is logged only after a 2xx`, async () => {
    const delivered = await send(WEBHOOK, {
      title: "Sent title",
      message: "m",
    });
    assert.equal(
      delivered.lines.some((line) => line.includes("Sent title")),
      true,
    );
    const refused = await send(
      WEBHOOK,
      { title: "Refused title", message: "m" },
      500,
    );
    assert.equal(
      refused.lines.some((line) => line.includes("Refused title")),
      false,
    );
  });

  test(`${name}: a transport failure never puts the webhook url in the logs`, async () => {
    const failing = HttpClient.make((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            description: `POST ${request.url}`,
          }),
        }),
      ),
    );
    const lines = await deliver(failing, WEBHOOK, {
      title: "Lost title",
      message: "m",
    });
    assert.equal(
      lines.some((line) => line.includes("alert not sent")),
      true,
    );
    assert.equal(
      lines.some((line) => line.includes("Lost title")),
      false,
    );
    assert.equal(
      lines.some(
        (line) => line.includes("ntfy.test") || line.includes("metro-staging"),
      ),
      false,
    );
  });
}
