import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { analyticsAvailable } from "../src/lib/analytics";
import { readConsent } from "../src/lib/consent";

afterEach(() => vi.unstubAllGlobals());

const storage = (value: string | null, broken = false) =>
  vi.stubGlobal("localStorage", {
    getItem: () => {
      if (broken) throw new Error("blocked");
      return value;
    },
  });

test("reads a saved choice and ignores anything else", () => {
  storage("granted");
  assert.equal(readConsent(), "granted");
  storage("denied");
  assert.equal(readConsent(), "denied");
  storage("yes");
  assert.equal(readConsent(), null);
  storage(null);
  assert.equal(readConsent(), null);
  storage(null, true);
  assert.equal(readConsent(), null);
});

test("only asks when the build has an id and Do Not Track is off", () => {
  vi.stubGlobal("navigator", { doNotTrack: null });
  assert.equal(analyticsAvailable("G-TEST123"), true);
  assert.equal(analyticsAvailable(undefined), false);
  assert.equal(analyticsAvailable("UA-1-1"), false);
  vi.stubGlobal("navigator", { doNotTrack: "1" });
  assert.equal(analyticsAvailable("G-TEST123"), false);
});
