import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { colomboHourKey, compactorHourDue } from "../src/compactor-schedule.ts";
import { compactorEnv, exitCodeOf } from "../src/compactor.ts";
import { testEnv } from "./env.ts";

const colombo = (local: string) => Date.parse(`${local}+05:30`);

test("the hour key is the Colombo hour, not the UTC one", () => {
  expect(colomboHourKey(colombo("2099-01-01T00:30:00"))).toBe("2099-01-01T00");
  expect(colomboHourKey(Date.parse("2099-01-01T18:29:59Z"))).toBe(
    "2099-01-01T23",
  );
  expect(colomboHourKey(Date.parse("2099-01-01T18:30:00Z"))).toBe(
    "2099-01-02T00",
  );
});

test("the compactor is due once per Colombo hour, from minute 7", () => {
  expect(compactorHourDue(colombo("2099-01-01T10:06:59"), null)).toBeNull();
  expect(compactorHourDue(colombo("2099-01-01T10:07:00"), null)).toBe(
    "2099-01-01T10",
  );
  expect(
    compactorHourDue(colombo("2099-01-01T10:59:00"), "2099-01-01T10"),
  ).toBeNull();
  expect(
    compactorHourDue(colombo("2099-01-01T11:03:00"), "2099-01-01T10"),
  ).toBeNull();
  expect(
    compactorHourDue(colombo("2099-01-01T11:07:00"), "2099-01-01T10"),
  ).toBe("2099-01-01T11");
});

test("the container gets the archive settings and the three secrets, and nothing else", () => {
  const env = {
    ARCHIVE_ROOT: "r2://metro-data-test",
    PUBLIC_DATA_URL: "https://data.example.test",
    ARCHIVE_R2_ACCESS_KEY_ID: "id",
    ARCHIVE_R2_SECRET_ACCESS_KEY: "secret",
    ARCHIVE_R2_ACCOUNT_ID: "account",
    OTP_SECRET: "otp",
  };
  expect(compactorEnv(env)).toEqual({
    ARCHIVE_ROOT: "r2://metro-data-test",
    ARCHIVE_PUBLIC_URL: "https://data.example.test",
    ARCHIVE_R2_ACCESS_KEY_ID: "id",
    ARCHIVE_R2_SECRET_ACCESS_KEY: "secret",
    ARCHIVE_R2_ACCOUNT_ID: "account",
    HOME: "/home/archive",
  });
  expect(
    compactorEnv({ ...env, ARCHIVE_R2_SECRET_ACCESS_KEY: undefined }),
  ).toBeNull();
  expect(compactorEnv({ ...env, ARCHIVE_R2_ACCOUNT_ID: "" })).toBeNull();
});

test("an exit code is read from the container's error", () => {
  expect(exitCodeOf(Object.assign(new Error("x"), { exitCode: 3 }))).toBe(3);
  expect(
    exitCodeOf(new Error("Container exited with unexpected exit code: 1")),
  ).toBe(1);
  expect(exitCodeOf(new Error("the container was destroyed"))).toBeUndefined();
  expect(exitCodeOf("nope")).toBeUndefined();
});

test("without its secrets the compactor doesn't start", async () => {
  const stub = testEnv.COMPACTOR.get(testEnv.COMPACTOR.idFromName("compactor"));
  expect(await stub.run()).toEqual({
    started: false,
    reason: "not configured",
  });
});

test("the Fleet starts the compactor once per Colombo hour, from minute 7, and remembers it across a restart", async () => {
  const id = testEnv.FLEET.idFromName(`compactor-${crypto.randomUUID()}`);
  const stub = () => testEnv.FLEET.get(id);
  const startAt = (local: string) =>
    runInDurableObject(stub(), async (instance) => {
      const hour = await instance.startCompactorIfDue(colombo(local));
      return hour === null ? null : await instance.compacting;
    });
  expect(await startAt("2099-01-01T10:06:00")).toBeNull();
  expect(await startAt("2099-01-01T10:07:00")).toEqual({
    started: false,
    reason: "not configured",
  });
  expect(await startAt("2099-01-01T10:40:00")).toBeNull();
  expect(
    await runInDurableObject(stub(), (_instance, state) =>
      state.storage.get("compactor:hour"),
    ),
  ).toBe("2099-01-01T10");
  await runInDurableObject(stub(), (_instance, state) => state.abort()).catch(
    () => undefined,
  );
  expect(await startAt("2099-01-01T10:50:00")).toBeNull();
  expect(await startAt("2099-01-01T11:07:00")).not.toBeNull();
});
