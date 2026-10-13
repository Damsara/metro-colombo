import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect, Exit } from "effect";
import { guardBucket } from "../src/config.ts";

const app = (path: string) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

test("the production bucket is refused and staging is allowed", async () => {
  assert.ok(
    Exit.isFailure(
      await Effect.runPromise(Effect.exit(guardBucket("metro-data"))),
    ),
  );
  assert.ok(
    Exit.isSuccess(
      await Effect.runPromise(Effect.exit(guardBucket("metro-data-staging"))),
    ),
  );
});

test("the Node app reads only its own .env, and its example replays", () => {
  const manifest = JSON.parse(readFileSync(app("package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    manifest.scripts.start,
    "tsx --env-file-if-exists=.env src/main.ts",
  );
  const example = readFileSync(app(".env.example"), "utf8");
  assert.match(example, /^LIVE_FEED=replay$/m);
  assert.doesNotMatch(example, /^METRO_REFRESH_TOKEN=/m);
  assert.match(example, /^UPSTREAM=proxy$/m);
  assert.doesNotMatch(example, /^UPSTREAM=lankametro$/m);
  assert.doesNotMatch(manifest.scripts["replay:prepare"], /env-file/);
});

test("the Node app refuses to start without LIVE_FEED", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fleet-app-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", app("src/main.ts")],
    {
      env: {
        PATH: process.env.PATH ?? "",
        UPSTREAM: "proxy",
        UPSTREAM_PROXY_URL: "http://127.0.0.1:9",
        PUBLIC_DATA_URL: "http://127.0.0.1:9",
        DATA_DIR: join(dir, "data"),
        FLEET_STATE_PATH: join(dir, "state.json"),
        PORT: String(19_789 + Math.floor(Math.random() * 1_000)),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += chunk));
  child.stdout?.on("data", (chunk) => (stderr += chunk));
  const code = await Promise.race([
    new Promise<number | null>((resolve) =>
      child.on("exit", (exitCode) => resolve(exitCode)),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("still running after 15 s")), 15_000),
    ),
  ]).finally(() => child.kill("SIGKILL"));
  assert.notEqual(code, 0);
  assert.match(stderr, /LIVE_FEED/);
});

test("the Node app serves the Fleet's status behind the secret and stops on SIGTERM", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fleet-app-"));
  const port = 18_789 + Math.floor(Math.random() * 1_000);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", app("src/main.ts")],
    {
      env: {
        PATH: process.env.PATH ?? "",
        LIVE_FEED: "replay",
        UPSTREAM: "proxy",
        UPSTREAM_PROXY_URL: "http://127.0.0.1:9",
        PUBLIC_DATA_URL: "http://127.0.0.1:9",
        REPLAY_DATE: "2026-10-11",
        DATA_DIR: join(dir, "data"),
        FLEET_STATE_PATH: join(dir, "state.json"),
        PORT: String(port),
        OTP_SECRET: "smoke-secret",
      },
      stdio: "ignore",
    },
  );
  const exited = new Promise<void>((resolve) =>
    child.on("exit", () => resolve()),
  );
  try {
    let status: Response | undefined;
    for (let attempt = 0; attempt < 60 && !status?.ok; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      status = await fetch(`http://127.0.0.1:${port}/fleet/status`, {
        headers: { authorization: "Bearer smoke-secret" },
      }).catch(() => undefined);
    }
    assert.ok(status?.ok, "the app never answered");
    assert.equal(
      ((await status.json()) as { login: string }).login,
      "not_used",
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/fleet/status`)).status,
      404,
    );
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("no exit within 15 s")), 15_000),
      ),
    ]);
  }
});
