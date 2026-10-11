import { AwsClient } from "aws4fetch";
import {
  Cause,
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

export class ArchiveError extends Schema.TaggedError<ArchiveError>()(
  "ArchiveError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

export const ArchiveConfig = Config.all({
  accountId: Config.option(Config.String("ARCHIVE_R2_ACCOUNT_ID")),
  accessKeyId: Config.option(Config.String("ARCHIVE_R2_ACCESS_KEY_ID")),
  secretAccessKey: Config.option(
    Config.Redacted("ARCHIVE_R2_SECRET_ACCESS_KEY"),
  ),
  bucket: Config.String("ARCHIVE_R2_BUCKET").pipe(
    Config.withDefault("metro-data"),
  ),
  publicUrl: Config.String("ARCHIVE_PUBLIC_URL").pipe(
    Config.withDefault("https://data.metro.manasa.ai"),
  ),
});

type Settings = {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly publicUrl: string;
};

export type ArchiveStoreShape = {
  readonly enabled: boolean;
  readonly publicUrl: string;
  readonly put: (
    key: string,
    body: Uint8Array,
    options: { contentType: string; cacheControl?: string },
  ) => Effect.Effect<void, ArchiveError>;
  readonly list: (prefix: string) => Effect.Effect<string[], ArchiveError>;
  readonly fetchPublic: (
    path: string,
    headers: Record<string, string>,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, ArchiveError>;
};

const REQUEST_TIMEOUT = Duration.seconds(20);

// Network failures, R2 hiccups and throttling are worth another try; a refused request isn't.
const retryable = (error: ArchiveError) =>
  error.status === undefined || error.status >= 500 || error.status === 429;

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

export function makeR2Store(
  settings: Settings,
  http: HttpClient.HttpClient,
): ArchiveStoreShape {
  const aws = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const bucketUrl = `https://${settings.accountId}.r2.cloudflarestorage.com/${settings.bucket}`;
  const objectUrl = (key: string) =>
    `${bucketUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;

  const send = (
    what: string,
    request: Effect.Effect<HttpClientRequest.HttpClientRequest, ArchiveError>,
  ) =>
    request.pipe(
      Effect.flatMap((built) =>
        http.execute(built).pipe(
          Effect.mapError(
            (cause) =>
              new ArchiveError({
                message: `${what} failed: ${cause.message}`,
              }),
          ),
        ),
      ),
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.succeed(response)
          : Effect.fail(
              new ArchiveError({
                message: `${what} responded with HTTP ${response.status}`,
                status: response.status,
              }),
            ),
      ),
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.catchIf(Cause.isTimeoutError, () =>
        Effect.fail(new ArchiveError({ message: `${what} timed out` })),
      ),
      Effect.retry({
        schedule: Schedule.exponential(Duration.millis(250)),
        times: 3,
        while: retryable,
      }),
      Effect.withSpan("ArchiveStore.request", { attributes: { what } }),
    );

  // Signed per attempt, so a retry never reuses a stale signature.
  const signed = (url: string, init: RequestInit, body?: Uint8Array) =>
    Effect.tryPromise({
      try: () => aws.sign(url, init),
      catch: (cause) =>
        new ArchiveError({ message: `signing failed: ${String(cause)}` }),
    }).pipe(
      Effect.map((request) => {
        const headers = Object.fromEntries(request.headers);
        const built = HttpClientRequest.make(request.method as "GET" | "PUT")(
          request.url,
        ).pipe(HttpClientRequest.setHeaders(headers));
        return body
          ? HttpClientRequest.bodyUint8Array(
              built,
              body,
              headers["content-type"],
            )
          : built;
      }),
    );

  const listPage = (prefix: string, token?: string) => {
    const url = new URL(bucketUrl);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    return send("R2 list", signed(url.toString(), { method: "GET" })).pipe(
      Effect.flatMap((response) =>
        response.text.pipe(
          Effect.mapError(
            (cause) =>
              new ArchiveError({
                message: `R2 list unreadable: ${cause.message}`,
              }),
          ),
        ),
      ),
      Effect.map((xml) => ({
        keys: [...xml.matchAll(/<Key>(.*?)<\/Key>/g)].map((m) =>
          unescapeXml(m[1]),
        ),
        next: /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(
              xml,
            )?.[1]
          : undefined,
      })),
    );
  };

  return {
    enabled: true,
    publicUrl: settings.publicUrl,
    put: (key, body, { contentType, cacheControl }) =>
      send(
        `R2 upload of ${key}`,
        signed(
          objectUrl(key),
          {
            method: "PUT",
            body,
            headers: {
              "content-type": contentType,
              ...(cacheControl && { "cache-control": cacheControl }),
            },
          },
          body,
        ),
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
        return keys;
      }),
    fetchPublic: (path, headers) =>
      http
        .execute(
          HttpClientRequest.get(`${settings.publicUrl}/${path}`).pipe(
            HttpClientRequest.setHeaders(headers),
          ),
        )
        .pipe(
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.mapError(
            (cause) =>
              new ArchiveError({
                message: `public read of ${path} failed: ${cause.message}`,
              }),
          ),
        ),
  };
}

const notConfigured = () =>
  Effect.fail(new ArchiveError({ message: "archive not configured" }));

const disabled: ArchiveStoreShape = {
  enabled: false,
  publicUrl: "",
  put: notConfigured,
  list: notConfigured,
  fetchPublic: notConfigured,
};

export class ArchiveStore extends Context.Service<
  ArchiveStore,
  ArchiveStoreShape
>()("lmt-go/ArchiveStore") {
  // Its own fetch client, so archive traffic never queues behind calls to Lanka Metro.
  static readonly layer = Layer.effect(
    ArchiveStore,
    Effect.gen(function* () {
      const config = yield* ArchiveConfig;
      const credentials = Option.all({
        accountId: config.accountId,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      });
      if (Option.isNone(credentials)) {
        yield* Effect.logInfo("fleet archive off: no R2 credentials");
        return ArchiveStore.of(disabled);
      }
      return ArchiveStore.of(
        makeR2Store(
          {
            ...credentials.value,
            secretAccessKey: Redacted.value(credentials.value.secretAccessKey),
            bucket: config.bucket,
            publicUrl: config.publicUrl.replace(/\/$/, ""),
          },
          yield* HttpClient.HttpClient,
        ),
      );
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
