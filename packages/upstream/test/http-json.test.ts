import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Logger } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { fetchJson, type UpstreamError } from "@metro/upstream";

const URL_WITH_TOKEN = "https://upstream.example/api/thing?token=url-secret";
const TOKEN = "Bearer header-secret";

const replying = (status: number, body: string) => {
  const sent: Response[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const response = new Response(body, { status });
      sent.push(response);
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
  return { client, sent };
};

const failed = (client: HttpClient.HttpClient) => {
  const lines: string[] = [];
  const logs = Logger.layer([
    Logger.make(({ message, cause }) =>
      lines.push(`${JSON.stringify(message)} ${String(cause)}`),
    ),
  ]);
  return Effect.runPromise(
    fetchJson(client, URL_WITH_TOKEN, {
      headers: { authorization: TOKEN },
      detail: () => "detail",
    }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.logError("read failed", error)),
      Effect.provide(logs),
    ),
  ).then((error) => ({ error, lines }));
};

const everything = (error: UpstreamError, lines: ReadonlyArray<string>) =>
  [
    JSON.stringify(error),
    String(error),
    error.stack ?? "",
    ...Object.values(error).map(String),
    ...lines,
  ].join("\n");

test("a client failure that quotes the URL and token reports neither", async () => {
  const client = HttpClient.make((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          description: `GET ${request.url} ${JSON.stringify(request.headers)}`,
        }),
      }),
    ),
  );
  const { error, lines } = await failed(client);
  assert.equal(error.message, "upstream request failed");
  assert.equal(error.status, undefined);
  assert.equal(lines.length > 0, true);
  const seen = everything(error, lines);
  for (const secret of ["url-secret", "header-secret", "upstream.example"]) {
    assert.equal(seen.includes(secret), false, secret);
  }
});

test("a refusal whose body isn't JSON keeps its status and has no detail", async () => {
  const { error } = await failed(replying(503, "<html>down</html>").client);
  assert.equal(error.status, 503);
  assert.equal(error.detail, undefined);
  assert.equal(error.message, "upstream answered HTTP 503");
});

test("a refusal's body is read", async () => {
  const { client, sent } = replying(500, '{"error":"boom"}');
  await failed(client);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].bodyUsed, true);
});

test("a success whose body isn't JSON is unreadable", async () => {
  const { error } = await failed(replying(200, "not json").client);
  assert.equal(error.message, "upstream reply unreadable");
  assert.equal(error.status, undefined);
});
