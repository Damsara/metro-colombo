import { AwsClient } from "aws4fetch";
import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";

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

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ArchiveStoreShape = {
  readonly enabled: boolean;
  readonly publicUrl: string;
  readonly put: (
    key: string,
    body: Uint8Array,
    options: { contentType: string; cacheControl?: string },
  ) => Effect.Effect<void, ArchiveError>;
  readonly list: (prefix: string) => Effect.Effect<string[], ArchiveError>;
  readonly get: (key: string) => Effect.Effect<Response, ArchiveError>;
  readonly fetchPublic: (
    path: string,
    headers: Record<string, string>,
  ) => Effect.Effect<Response, ArchiveError>;
};

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

const request = (
  run: () => Promise<Response>,
  what: string,
): Effect.Effect<Response, ArchiveError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new ArchiveError({ message: `${what} failed: ${String(cause)}` }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(
            new ArchiveError({
              message: `${what} responded with HTTP ${response.status}`,
              status: response.status,
            }),
          ),
    ),
  );

export function makeR2Store(
  settings: Settings,
  fetchImpl: Fetch = fetch,
): ArchiveStoreShape {
  const aws = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const bucketUrl = `https://${settings.accountId}.r2.cloudflarestorage.com/${settings.bucket}`;
  const signed = (url: string, init: RequestInit) => async () =>
    fetchImpl(await aws.sign(url, init));
  const objectUrl = (key: string) =>
    `${bucketUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;

  const listPage = (prefix: string, token?: string) => {
    const url = new URL(bucketUrl);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    return request(signed(url.toString(), { method: "GET" }), "R2 list").pipe(
      Effect.flatMap((response) => Effect.promise(() => response.text())),
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
      request(
        signed(objectUrl(key), {
          method: "PUT",
          body,
          headers: {
            "content-type": contentType,
            ...(cacheControl && { "cache-control": cacheControl }),
          },
        }),
        `R2 upload of ${key}`,
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
    get: (key) =>
      request(signed(objectUrl(key), { method: "GET" }), `R2 read of ${key}`),
    fetchPublic: (path, headers) =>
      Effect.tryPromise({
        try: () => fetchImpl(`${settings.publicUrl}/${path}`, { headers }),
        catch: (cause) =>
          new ArchiveError({ message: `public read failed: ${String(cause)}` }),
      }),
  };
}

const disabled: ArchiveStoreShape = {
  enabled: false,
  publicUrl: "",
  put: () =>
    Effect.fail(new ArchiveError({ message: "archive not configured" })),
  list: () =>
    Effect.fail(new ArchiveError({ message: "archive not configured" })),
  get: () =>
    Effect.fail(new ArchiveError({ message: "archive not configured" })),
  fetchPublic: () =>
    Effect.fail(new ArchiveError({ message: "archive not configured" })),
};

export class ArchiveStore extends Context.Service<
  ArchiveStore,
  ArchiveStoreShape
>()("lmt-go/ArchiveStore") {
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
        makeR2Store({
          ...credentials.value,
          secretAccessKey: Redacted.value(credentials.value.secretAccessKey),
          bucket: config.bucket,
          publicUrl: config.publicUrl.replace(/\/$/, ""),
        }),
      );
    }),
  );
}
