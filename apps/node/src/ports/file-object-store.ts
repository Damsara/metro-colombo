import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { Effect, Option } from "effect";
import {
  type ObjectStoreShape,
  StoreError,
  type StoredObject,
} from "@metro/core";
import { attemptWith, missing, replaceFile } from "./fs.js";

const META = ".meta";
const SCRATCH = ".tmp";
const attempt = attemptWith((message) => new StoreError({ message }));

const safe = (key: string) =>
  key
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        segment !== META &&
        segment !== SCRATCH,
    );

const orNone = async <A>(run: () => Promise<A>): Promise<A | undefined> => {
  try {
    return await run();
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
};

export const fileObjectStore = (root: string): ObjectStoreShape => {
  const bodyPath = (key: string) => join(root, ...key.split("/"));
  const metaPath = (key: string) =>
    `${join(root, META, ...key.split("/"))}.json`;
  const scratch = join(root, SCRATCH);

  const checked = <A>(what: string, key: string, run: () => Promise<A>) =>
    safe(key)
      ? attempt(`${what} of ${key}`, run)
      : Effect.fail(
          new StoreError({ message: `${what} of ${key} refused: unsafe key` }),
        );

  const walk = async (dir: string): Promise<string[]> => {
    const entries =
      (await orNone(() => readdir(dir, { withFileTypes: true }))) ?? [];
    const nested = await Promise.all(
      entries
        .filter(
          (entry) =>
            !(dir === root && (entry.name === META || entry.name === SCRATCH)),
        )
        .map((entry) =>
          entry.isDirectory()
            ? walk(join(dir, entry.name))
            : Promise.resolve([join(dir, entry.name)]),
        ),
    );
    return nested.flat();
  };

  return {
    get: (key) =>
      checked("read", key, async () => {
        const body = await orNone(() => readFile(bodyPath(key)));
        if (body === undefined) return Option.none<StoredObject>();
        const metaText = await orNone(() => readFile(metaPath(key), "utf8"));
        const meta: { contentType?: string; cacheControl?: string } =
          metaText === undefined ? {} : JSON.parse(metaText);
        return Option.some<StoredObject>({
          body: new Uint8Array(body),
          contentType: meta.contentType ?? "application/octet-stream",
          cacheControl: meta.cacheControl,
        });
      }),
    put: (key, body, { contentType, cacheControl }) =>
      checked("write", key, async () => {
        for (const dir of [
          dirname(bodyPath(key)),
          dirname(metaPath(key)),
          scratch,
        ])
          await mkdir(dir, { recursive: true });
        await replaceFile(
          metaPath(key),
          JSON.stringify({ contentType, cacheControl }),
          { scratch },
        );
        await replaceFile(bodyPath(key), body, { scratch });
      }),
    list: (prefix) =>
      attempt(`list of ${prefix}`, async () =>
        (await walk(root))
          .map((file) => relative(root, file).split(sep).join("/"))
          .filter((key) => key.startsWith(prefix))
          .sort(),
      ),
    delete: (key) =>
      checked("delete", key, async () => {
        await rm(bodyPath(key), { force: true });
        await rm(metaPath(key), { force: true });
      }),
  };
};
