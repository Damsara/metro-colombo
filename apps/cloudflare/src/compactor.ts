import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.js";

export type CompactorRun = {
  started: boolean;
  exit?: number;
  ms?: number;
  reason?: string;
};

const RUN_LIMIT_MS = 25 * 60_000;

const text = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : undefined;

export const compactorEnv = (env: Record<string, unknown>) => {
  const accessKeyId = text(env.ARCHIVE_R2_ACCESS_KEY_ID);
  const secretAccessKey = text(env.ARCHIVE_R2_SECRET_ACCESS_KEY);
  const accountId = text(env.ARCHIVE_R2_ACCOUNT_ID);
  const root = text(env.ARCHIVE_ROOT);
  const publicUrl = text(env.PUBLIC_DATA_URL);
  if (!accessKeyId || !secretAccessKey || !accountId || !root || !publicUrl)
    return null;
  return {
    ARCHIVE_ROOT: root,
    ARCHIVE_PUBLIC_URL: publicUrl,
    ARCHIVE_R2_ACCESS_KEY_ID: accessKeyId,
    ARCHIVE_R2_SECRET_ACCESS_KEY: secretAccessKey,
    ARCHIVE_R2_ACCOUNT_ID: accountId,
    HOME: "/home/archive",
  };
};

export const exitCodeOf = (error: unknown) => {
  if (!(error instanceof Error)) return undefined;
  if ("exitCode" in error && typeof error.exitCode === "number")
    return error.exitCode;
  const code = /exit code:?\s*(-?\d+)/i.exec(error.message)?.[1];
  return code === undefined ? undefined : Number(code);
};

const skipped = (reason: string): CompactorRun => {
  console.log("compactor skipped", { reason });
  return { started: false, reason };
};

export class Compactor extends DurableObject<Env> {
  async run(): Promise<CompactorRun> {
    const env = compactorEnv(this.env);
    if (!env) return skipped("not configured");
    const container = this.ctx.container;
    if (!container) return skipped("no container");
    if (container.running) return skipped("running");

    const startedAt = Date.now();
    container.start({ env, enableInternet: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const limit = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), RUN_LIMIT_MS);
    });
    const outcome = await Promise.race([
      container.monitor().then(
        () => ({ exit: 0 }),
        (error: unknown) => ({ exit: exitCodeOf(error) }),
      ),
      limit,
    ]);
    clearTimeout(timer);
    const ms = Date.now() - startedAt;
    if (outcome === "timeout") {
      await container.destroy().catch(() => undefined);
      console.log("compactor timed out", { ms });
      return { started: true, ms, reason: "timeout" };
    }
    console.log("compactor finished", { exit: outcome.exit, ms });
    return { started: true, exit: outcome.exit, ms };
  }
}
