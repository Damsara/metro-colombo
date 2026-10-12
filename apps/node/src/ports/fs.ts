import { randomUUID } from "node:crypto";
import { open, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Effect } from "effect";

const codeOf = (error: unknown) =>
  (error as NodeJS.ErrnoException | undefined)?.code;

export const missing = (error: unknown) => codeOf(error) === "ENOENT";

// Only the errno code goes into the message, since a parse error quotes the file's contents.
export const attemptWith =
  <E>(fail: (message: string) => E) =>
  <A>(what: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => {
        const code = codeOf(cause);
        return fail(
          `${what} failed${typeof code === "string" ? ` (${code})` : ""}`,
        );
      },
    });

const writeSynced = async (
  path: string,
  data: string | Uint8Array,
  mode: number | undefined,
) => {
  const handle = await open(path, "w", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const syncFolder = async (path: string) => {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const replaceFile = async (
  path: string,
  data: string | Uint8Array,
  options: {
    readonly mode?: number;
    readonly scratch?: string;
    readonly durable?: boolean;
  } = {},
) => {
  const temporary = join(
    options.scratch ?? dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    if (options.durable) await writeSynced(temporary, data, options.mode);
    else
      await writeFile(
        temporary,
        data,
        options.mode === undefined ? {} : { mode: options.mode },
      );
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  if (options.durable) await syncFolder(dirname(path));
};
