import { Effect, Layer, Predicate } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { Agent, fetch as undiciFetch } from "undici";

// About 1 in 20 new connections from this network stalls ~7s; dialling again is faster.
export const CONNECT_TIMEOUT_MS = 1500;

const agent = new Agent({
  connect: { timeout: CONNECT_TIMEOUT_MS },
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
});

const fetchWithAgent = ((input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: agent,
  })) as typeof globalThis.fetch;

export const isConnectTimeout = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && Predicate.isObject(current); depth++) {
    if (
      Predicate.hasProperty(current, "code") &&
      current.code === "UND_ERR_CONNECT_TIMEOUT"
    )
      return true;
    current = Predicate.hasProperty(current, "reason")
      ? current.reason
      : Predicate.hasProperty(current, "cause")
        ? current.cause
        : undefined;
  }
  return false;
};

export const withFastConnect = (client: HttpClient.HttpClient) =>
  client.pipe(
    HttpClient.transform((response) =>
      Effect.provideService(response, FetchHttpClient.Fetch, fetchWithAgent),
    ),
    HttpClient.retry({ while: isConnectTimeout, times: 1 }),
  );

export const UpstreamHttp = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, withFastConnect),
).pipe(Layer.provide(FetchHttpClient.layer));
