import { Effect, Layer, Predicate, Semaphore } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { Agent, fetch as undiciFetch } from "undici";

// About 1 in 20 new connections from this network stalls ~7s; dialling again is faster.
export const CONNECT_TIMEOUT_MS = 1500;
export const HEDGE_DELAY_MS = 300;
export const MAX_CONCURRENT_REQUESTS = 8;

// While HTTP/2 is possible undici queues every request behind the first TLS handshake, which would hold the hedge back.
const agent = new Agent({
  allowH2: false,
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

export const withFastConnect = (client: HttpClient.HttpClient) => {
  const permits = Semaphore.makeUnsafe(MAX_CONCURRENT_REQUESTS);
  return client.pipe(
    HttpClient.transform((response) =>
      Effect.provideService(response, FetchHttpClient.Fetch, fetchWithAgent),
    ),
    HttpClient.retry({ while: isConnectTimeout, times: 1 }),
    HttpClient.transform((attempt, request) =>
      request.method === "GET"
        ? permits.withPermit(
            Effect.race(
              attempt,
              Effect.delay(permits.withPermit(attempt), HEDGE_DELAY_MS),
            ),
          )
        : permits.withPermit(attempt),
    ),
  );
};

export const UpstreamHttp = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, withFastConnect),
).pipe(Layer.provide(FetchHttpClient.layer));
