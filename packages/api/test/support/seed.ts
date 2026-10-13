import { Effect } from "effect";
import {
  MANIFEST_CACHE,
  MANIFEST_KEY,
  type ObjectStoreShape,
  sha256Hex,
  VERSIONED_CACHE,
  versionedKey,
} from "@metro/core";

const utf8 = new TextEncoder();

// A string value is stored as written, so a test can fix the exact bytes.
export const seedReference = (
  store: ObjectStoreShape,
  files: Readonly<Record<string, unknown>>,
  updatedAt = 0,
) =>
  Effect.gen(function* () {
    const entries: Record<string, string> = {};
    for (const [name, value] of Object.entries(files)) {
      const body = utf8.encode(
        typeof value === "string" ? value : JSON.stringify(value),
      );
      const key = versionedKey(
        name,
        yield* Effect.promise(() => sha256Hex(body)),
        "json",
      );
      yield* store.put(key, body, {
        contentType: "application/json",
        cacheControl: VERSIONED_CACHE,
      });
      entries[name] = key;
    }
    yield* store.put(
      MANIFEST_KEY,
      utf8.encode(
        JSON.stringify({ version: 1, updated_at: updatedAt, files: entries }),
      ),
      { contentType: "application/json", cacheControl: MANIFEST_CACHE },
    );
  });
