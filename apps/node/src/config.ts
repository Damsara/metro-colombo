import { Config, Data, Effect } from "effect";

export const NodeConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(8789)),
  host: Config.String("HOST").pipe(Config.withDefault("127.0.0.1")),
  statePath: Config.String("FLEET_STATE_PATH").pipe(
    Config.withDefault(".fleet-state.json"),
  ),
  dataDir: Config.String("DATA_DIR").pipe(Config.withDefault(".fleet-data")),
  s3Endpoint: Config.option(Config.String("S3_ENDPOINT")),
  s3AccessKeyId: Config.option(Config.Redacted("S3_ACCESS_KEY_ID")),
  s3SecretAccessKey: Config.option(Config.Redacted("S3_SECRET_ACCESS_KEY")),
  bucket: Config.String("ARCHIVE_BUCKET").pipe(
    Config.withDefault("metro-data-staging"),
  ),
});

export const PRODUCTION_BUCKET = "metro-data";

export class UnsafeBucket extends Data.TaggedError("UnsafeBucket")<{
  readonly message: string;
}> {}

// Until the switch-over, nothing new may write the archive the live site reads.
export const guardBucket = (bucket: string) =>
  bucket === PRODUCTION_BUCKET
    ? Effect.fail(
        new UnsafeBucket({
          message: `ARCHIVE_BUCKET=${bucket} is production; use a staging bucket`,
        }),
      )
    : Effect.void;
