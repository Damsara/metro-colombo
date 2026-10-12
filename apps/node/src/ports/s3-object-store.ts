import { AwsClient } from "aws4fetch";
import { Duration, Effect, Option, Redacted, Schedule } from "effect";
import {
  type HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import {
  type ObjectStoreShape,
  StoreError,
  type StoredObject,
} from "@metro/core";

export type S3Settings = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: Redacted.Redacted<string>;
  readonly secretAccessKey: Redacted.Redacted<string>;
  readonly region?: string;
};

const REQUEST_TIMEOUT = Duration.seconds(20);

const retryable = (error: StoreError) =>
  error.status === undefined || error.status >= 500 || error.status === 429;

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

export const s3ObjectStore = (
  settings: S3Settings,
  http: HttpClient.HttpClient,
): ObjectStoreShape => {
  const aws = new AwsClient({
    accessKeyId: Redacted.value(settings.accessKeyId),
    secretAccessKey: Redacted.value(settings.secretAccessKey),
    service: "s3",
    region: settings.region ?? "auto",
  });
  const bucketUrl = `${settings.endpoint.replace(/\/$/, "")}/${settings.bucket}`;
  const objectUrl = (key: string) =>
    `${bucketUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;

  // Signed per attempt, so a retry never reuses a stale signature.
  const signed = (
    method: "GET" | "PUT" | "DELETE",
    url: string,
    body?: Uint8Array,
    headers: Record<string, string> = {},
  ) =>
    Effect.tryPromise({
      try: () => aws.sign(url, { method, headers, ...(body ? { body } : {}) }),
      catch: () => new StoreError({ message: "S3 signing failed" }),
    }).pipe(
      Effect.map((request) => {
        const signedHeaders = Object.fromEntries(request.headers);
        const built = HttpClientRequest.make(method)(request.url).pipe(
          HttpClientRequest.setHeaders(signedHeaders),
        );
        return body
          ? HttpClientRequest.bodyUint8Array(
              built,
              body,
              signedHeaders["content-type"],
            )
          : built;
      }),
    );

  const send = (
    what: string,
    request: Effect.Effect<HttpClientRequest.HttpClientRequest, StoreError>,
    accept: ReadonlyArray<number> = [],
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, StoreError> =>
    request.pipe(
      Effect.flatMap((built) =>
        http.execute(built).pipe(
          Effect.mapError(
            (cause) =>
              new StoreError({
                message: `${what} failed (${cause.reason._tag})`,
              }),
          ),
        ),
      ),
      Effect.flatMap((response) =>
        (response.status >= 200 && response.status < 300) ||
        accept.includes(response.status)
          ? Effect.succeed(response)
          : Effect.fail(
              new StoreError({
                message: `${what} answered HTTP ${response.status}`,
                status: response.status,
              }),
            ),
      ),
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.catchTag("TimeoutError", () =>
        Effect.fail(new StoreError({ message: `${what} timed out` })),
      ),
      Effect.retry({
        schedule: Schedule.exponential(Duration.millis(250)),
        times: 3,
        while: retryable,
      }),
    );

  const listPage = (prefix: string, token?: string) => {
    const url = new URL(bucketUrl);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    return send(`S3 list of ${prefix}`, signed("GET", url.toString())).pipe(
      Effect.flatMap((response) =>
        response.text.pipe(
          Effect.mapError(
            () =>
              new StoreError({ message: `S3 list of ${prefix} unreadable` }),
          ),
        ),
      ),
      Effect.map((xml) => {
        const next =
          /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(
            xml,
          )?.[1];
        return {
          keys: [...xml.matchAll(/<Key>(.*?)<\/Key>/g)].map((match) =>
            unescapeXml(match[1] ?? ""),
          ),
          next:
            /<IsTruncated>true<\/IsTruncated>/.test(xml) && next !== undefined
              ? unescapeXml(next)
              : undefined,
        };
      }),
    );
  };

  return {
    get: (key) =>
      Effect.gen(function* () {
        const response = yield* send(
          `S3 read of ${key}`,
          signed("GET", objectUrl(key)),
          [404],
        );
        if (response.status === 404) return Option.none<StoredObject>();
        const buffer = yield* response.arrayBuffer.pipe(
          Effect.mapError(
            () => new StoreError({ message: `S3 read of ${key} unreadable` }),
          ),
        );
        return Option.some<StoredObject>({
          body: new Uint8Array(buffer),
          contentType: response.headers["content-type"],
          cacheControl: response.headers["cache-control"],
        });
      }),
    put: (key, body, { contentType, cacheControl }) =>
      send(
        `S3 upload of ${key}`,
        signed("PUT", objectUrl(key), body, {
          "content-type": contentType,
          ...(cacheControl ? { "cache-control": cacheControl } : {}),
        }),
      ).pipe(Effect.asVoid),
    list: (prefix) =>
      Effect.gen(function* () {
        const keys: string[] = [];
        let token: string | undefined;
        do {
          const page = yield* listPage(prefix, token);
          keys.push(...page.keys);
          token = page.next;
        } while (token);
        return keys.sort();
      }),
    delete: (key) =>
      send(`S3 delete of ${key}`, signed("DELETE", objectUrl(key)), [404]).pipe(
        Effect.asVoid,
      ),
  };
};
