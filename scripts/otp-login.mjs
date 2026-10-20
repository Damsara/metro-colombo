#!/usr/bin/env node
// Seeds the refresh token into `.env`; run once, or after ~7 days offline once it has expired.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const BASE = process.env.EIMSKY_BASE ?? "https://metrobusapiprod.eimsky.com";
const AUTH = `${BASE}/user-service/api/v1/auth`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, ".env");
// Holds the pending code's reference between `--send` and `--verify`.
const REFERENCE_PATH = resolve(ROOT, ".otp-reference");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

function readEnv() {
  return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
}

function envValue(name) {
  const match = readEnv().match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : undefined;
}

function upsertEnv(entries) {
  let env = readEnv();
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    env = new RegExp(`^${key}=`, "m").test(env)
      ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${env.trimEnd()}\n${line}\n`;
  }
  writeFileSync(ENV_PATH, env, { mode: 0o600 });
}

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("94") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10)
    return `+94${digits.slice(1)}`;
  return undefined;
}

async function post(path, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${AUTH}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) =>
    rl.question(question, (answer) => {
      rl.close();
      resolvePromise(answer.trim());
    }),
  );
}

function extractTokens(obj, found = {}) {
  if (!obj || typeof obj !== "object") return found;
  for (const key of [
    "access_token",
    "accessToken",
    "refresh_token",
    "refreshToken",
  ]) {
    if (typeof obj[key] === "string" && obj[key]) found[key] = obj[key];
  }
  for (const value of Object.values(obj)) extractTokens(value, found);
  return found;
}

function persist(tokens) {
  const refresh = tokens.refresh_token ?? tokens.refreshToken;
  if (!refresh) fail("no refresh token in response");
  upsertEnv({ METRO_REFRESH_TOKEN: refresh });
  console.log("Wrote METRO_REFRESH_TOKEN to .env");
}

if (process.argv.includes("--refresh")) {
  const refreshToken = envValue("METRO_REFRESH_TOKEN");
  if (!refreshToken) fail("No METRO_REFRESH_TOKEN in .env. Log in first.");
  const res = await post("/refresh", { refresh_token: refreshToken });
  if (res.status >= 400) fail(`refresh failed (HTTP ${res.status})`);
  persist(extractTokens(res.json));
  process.exit(0);
}

const tokenIndex = process.argv.indexOf("--token");
if (tokenIndex !== -1) {
  const token = process.argv[tokenIndex + 1];
  if (!token) fail("usage: node scripts/otp-login.mjs --token <refresh_token>");
  upsertEnv({ METRO_REFRESH_TOKEN: token });
  console.log("Wrote METRO_REFRESH_TOKEN to .env");
  process.exit(0);
}

async function sendCode(raw) {
  const phone = normalizePhone(raw ?? process.env.PHONE ?? "");
  if (!phone) {
    fail("usage: node scripts/otp-login.mjs <phone>  (e.g. 0712345678)");
  }
  const check = await post("/customer/check-phone", { phone });
  if (check.status !== 200 || !check.json?.data) {
    fail(`check-phone failed: ${check.text}`);
  }
  const { otp_reference, has_account } = check.json.data;
  console.log(
    `OTP sent to ${phone}${has_account === false ? " (new account)" : ""}`,
  );
  return otp_reference;
}

async function verifyCode(otp_reference, code, interactive) {
  const verify = await post("/customer/verify-otp", {
    otp_reference,
    otp_code: code,
  });
  if (verify.status >= 400) fail(`verify-otp failed (HTTP ${verify.status})`);

  // New accounts: verify-otp returns a `verified_reference` that `register` exchanges for tokens.
  let tokens = extractTokens(verify.json);
  if (verify.json?.data?.purpose === "register" && !tokens.access_token) {
    if (!interactive) {
      fail(
        "New account: run `node scripts/otp-login.mjs <phone>` to register.",
      );
    }
    console.log("\nNew account: registration required.");
    const verified_reference =
      verify.json.data.verified_reference ?? otp_reference;
    const reg = await post("/customer/register", {
      verified_reference,
      first_name: await prompt("First name: "),
      last_name: await prompt("Last name: "),
      national_id: await prompt("National ID: "),
    });
    if (reg.status >= 400) fail(`registration failed (HTTP ${reg.status})`);
    tokens = extractTokens(reg.json);
  }
  persist(tokens);
}

const sendIndex = process.argv.indexOf("--send");
if (sendIndex !== -1) {
  const reference = await sendCode(process.argv[sendIndex + 1]);
  writeFileSync(REFERENCE_PATH, reference, { mode: 0o600 });
  console.log("Then run: node scripts/otp-login.mjs --verify <code>");
  process.exit(0);
}

const verifyIndex = process.argv.indexOf("--verify");
if (verifyIndex !== -1) {
  const code = process.argv[verifyIndex + 1];
  if (!code) fail("usage: node scripts/otp-login.mjs --verify <code>");
  if (!existsSync(REFERENCE_PATH)) fail("No code pending; run --send first.");
  await verifyCode(readFileSync(REFERENCE_PATH, "utf8").trim(), code, false);
  rmSync(REFERENCE_PATH);
  process.exit(0);
}

const reference = await sendCode(process.argv[2]);
await verifyCode(reference, await prompt("Enter the OTP code: "), true);
