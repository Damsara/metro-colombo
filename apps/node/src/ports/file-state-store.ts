import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Duration, Effect, Option } from "effect";
import { StateError, type StateStoreShape } from "@metro/core";
import { attemptWith, missing, replaceFile } from "./fs.js";

export const STATE_TIMEOUT_MS = 10_000;

const attempt = attemptWith((message) => new StateError({ message }));

export const fileStateStore = (path: string, timeoutMs = STATE_TIMEOUT_MS): StateStoreShape => {
  // Each operation starts after the one before has settled, even one that timed out, so a late write never lands over a newer one.
  let queue: Promise<unknown> = Promise.resolve();
  const serial =
    <A>(run: () => Promise<A>) =>
    () => {
      const result = queue.then(run);
      queue = result.catch(() => undefined);
      return result;
    };

  const read = async (): Promise<Record<string, unknown>> => {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (missing(error)) return {};
      throw error;
    }
    const values: unknown = JSON.parse(text);
    if (typeof values !== "object" || values === null || Array.isArray(values)) throw new Error("state file is not an object");
    return values as Record<string, unknown>;
  };

  const write = async (values: Record<string, unknown>) => {
    await mkdir(dirname(path), { recursive: true });
    await replaceFile(path, JSON.stringify(values), { mode: 0o600, durable: true });
  };

  const limited = <A>(what: string, run: () => Promise<A>) =>
    attempt(what, serial(run)).pipe(
      Effect.timeout(Duration.millis(timeoutMs)),
      Effect.catchTag("TimeoutError", () => Effect.fail(new StateError({ message: `${what} timed out` }))),
    );

  return {
    get: (key) => limited("state read", async () => Option.fromUndefinedOr((await read())[key])),
    set: (key, value) => limited("state write", async () => write({ ...(await read()), [key]: value })),
    delete: (key) =>
      limited("state write", async () => {
        const values = await read();
        if (!Object.hasOwn(values, key)) return;
        delete values[key];
        await write(values);
      }),
  };
};
