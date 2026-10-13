import { Cause, Effect, Option, Schema } from "effect";
import { parseJson } from "@metro/core";
import type { HttpClient, HttpClientResponse } from "effect/http";
import { UpstreamError } from "./reference.js";

export const REFERENCE_TIMEOUT = "15 seconds";

export type Detail = (body: unknown, status: number) => string | undefined;
const noDetail: Detail = () => undefined;

// Reading the refusal's body also drains it, which workerd needs.
const refused = (
  response: HttpClientResponse.HttpClientResponse,
  detail: Detail,
) =>
  response.json.pipe(
    Effect.map((body) => detail(body, response.status)),
    Effect.orElseSucceed(() => undefined),
    Effect.flatMap((found) =>
      Effect.fail(
        new UpstreamError({
          message: `upstream answered HTTP ${response.status}`,
          status: response.status,
          ...(found === undefined ? {} : { detail: found }),
        }),
      ),
    ),
  );

const read = <A, E>(
  http: HttpClient.HttpClient,
  url: string,
  headers: Readonly<Record<string, string>>,
  detail: Detail,
  body: (
    response: HttpClientResponse.HttpClientResponse,
  ) => Effect.Effect<A, E>,
): Effect.Effect<A, UpstreamError> =>
  http.get(url, { headers }).pipe(
    Effect.flatMap(
      (response): Effect.Effect<A, E | UpstreamError> =>
        response.status >= 200 && response.status < 300
          ? body(response)
          : refused(response, detail),
    ),
    Effect.timeout(REFERENCE_TIMEOUT),
    // Fixed messages only: a client error's message can quote the request.
    Effect.mapError((error) =>
      error instanceof UpstreamError
        ? error
        : new UpstreamError({
            message: Cause.isTimeoutError(error)
              ? "upstream timed out"
              : "upstream request failed",
          }),
    ),
  );

const unreadable = () =>
  new UpstreamError({ message: "upstream reply unreadable" });

export const fetchJson = (
  http: HttpClient.HttpClient,
  url: string,
  options: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly detail?: Detail;
  } = {},
) =>
  read(http, url, options.headers ?? {}, options.detail ?? noDetail, (r) =>
    r.text.pipe(
      Effect.flatMap((text) =>
        Option.match(parseJson(text), {
          onNone: () => Effect.fail(unreadable()),
          onSome: Effect.succeed,
        }),
      ),
    ),
  );

export const fetchText = (http: HttpClient.HttpClient, url: string) =>
  read(http, url, {}, noDetail, (r) => r.text);

export const decodeWith =
  <A>(schema: Schema.Codec<A, unknown>) =>
  (body: unknown) =>
    Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError(unreadable));

export const checkedAs =
  <A>(schema: Schema.Codec<A, unknown>) =>
  (body: unknown): Effect.Effect<A, UpstreamError> =>
    Schema.is(schema)(body) ? Effect.succeed(body) : Effect.fail(unreadable());
