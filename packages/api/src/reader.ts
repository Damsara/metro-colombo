import { Clock, Context, Data, Effect, Layer, Option, Schema } from "effect";
import {
  EdgeCache,
  type EdgeCacheShape,
  Manifest,
  MANIFEST_KEY,
  ObjectStore,
  type ObjectStoreShape,
  parseJson,
} from "@metro/core";

export const MANIFEST_TTL_MS = 60_000;
export const FILE_TTL_SECONDS = 86_400;

export class ReferenceMissing extends Data.TaggedError("ReferenceMissing")<{
  readonly message: string;
}> {}

export type ReferenceReaderShape = {
  readonly manifest: Effect.Effect<Manifest, ReferenceMissing>;
  readonly file: (name: string) => Effect.Effect<Uint8Array, ReferenceMissing>;
  readonly typed: <A>(
    name: string,
    schema: Schema.Codec<A, unknown>,
  ) => Effect.Effect<A, ReferenceMissing>;
  readonly direct: <A>(
    key: string,
    schema: Schema.Codec<A, unknown>,
    ttlSeconds: number,
  ) => Effect.Effect<Option.Option<A>, ReferenceMissing>;
};

const decoder = new TextDecoder();
const missing = (message: string) => new ReferenceMissing({ message });

// Checked, not decoded: decoding would put the keys in schema order instead of the published order.
const checked = <A>(schema: Schema.Codec<A, unknown>, body: Uint8Array) =>
  Option.filter(parseJson(decoder.decode(body)), Schema.is(schema));

export const makeReferenceReader = (
  store: ObjectStoreShape,
  cache: EdgeCacheShape,
) =>
  Effect.map(Clock.Clock, (clock): ReferenceReaderShape => {
    let held:
      | { readonly manifest: Manifest; readonly until: number }
      | undefined;

    const get = (key: string) =>
      store.get(key).pipe(Effect.mapError((error) => missing(error.message)));

    const cachedBody = (key: string, ttlSeconds: number) =>
      Effect.gen(function* () {
        const cached = yield* cache.get(key);
        if (Option.isSome(cached)) return cached;
        const stored = yield* get(key);
        if (Option.isNone(stored)) return Option.none<Uint8Array>();
        yield* cache.put(key, stored.value.body, ttlSeconds);
        return Option.some(stored.value.body);
      });

    const manifest = Effect.gen(function* () {
      const now = clock.currentTimeMillisUnsafe();
      if (held && now < held.until) return held.manifest;
      const found = Option.flatMap(yield* get(MANIFEST_KEY), (object) =>
        Option.flatMap(
          parseJson(decoder.decode(object.body)),
          Schema.decodeUnknownOption(Manifest),
        ),
      );
      if (Option.isNone(found)) return yield* missing("no reference manifest");
      held = { manifest: found.value, until: now + MANIFEST_TTL_MS };
      return found.value;
    });

    const file = (name: string) =>
      Effect.gen(function* () {
        const { files } = yield* manifest;
        if (!Object.hasOwn(files, name))
          return yield* missing(`no reference file ${name}`);
        const body = yield* cachedBody(files[name], FILE_TTL_SECONDS);
        if (Option.isNone(body))
          return yield* missing(`reference file ${files[name]} is missing`);
        return body.value;
      });

    return {
      manifest,
      file,
      typed: (name, schema) =>
        Effect.flatMap(file(name), (body) =>
          Option.match(checked(schema, body), {
            onNone: () =>
              Effect.fail(missing(`reference file ${name} is unreadable`)),
            onSome: Effect.succeed,
          }),
        ),
      direct: (key, schema, ttlSeconds) =>
        Effect.map(
          cachedBody(key, ttlSeconds),
          Option.flatMap((body) => checked(schema, body)),
        ),
    };
  });

export class ReferenceReader extends Context.Service<
  ReferenceReader,
  ReferenceReaderShape
>()("metro/ReferenceReader") {
  static readonly layer = Layer.effect(
    ReferenceReader,
    Effect.gen(function* () {
      return yield* makeReferenceReader(yield* ObjectStore, yield* EdgeCache);
    }),
  );
}
