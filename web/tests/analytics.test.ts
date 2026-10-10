import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  daysAhead,
  initAnalytics,
  resetAnalytics,
  track,
  trackPage,
} from "../src/lib/analytics";

let appended: { src: string }[];
let win: {
  dataLayer?: unknown[];
  gtag?: unknown;
  location: { origin: string };
};

function browser(doNotTrack: string | null = null) {
  appended = [];
  win = { location: { origin: "https://metro.example.com" } };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { doNotTrack });
  vi.stubGlobal("document", {
    title: "Lanka Metro",
    head: { append: (node: { src: string }) => appended.push(node) },
    createElement: () => ({ async: false, src: "" }),
  });
}

const pushed = () =>
  (win.dataLayer ?? []).map((entry) => [...(entry as unknown[])]);

beforeEach(() => browser());
afterEach(() => {
  resetAnalytics();
  vi.unstubAllGlobals();
});

test("stays off without a valid measurement id", () => {
  for (const id of [undefined, "", "UA-123-1", "G-abc", "G-12 3"]) {
    assert.equal(initAnalytics(id), false);
  }
  track("open_route", { route: "CM01" });
  trackPage("/");
  assert.equal(win.dataLayer, undefined);
  assert.equal(appended.length, 0);
});

test("respects Do Not Track", () => {
  browser("1");
  assert.equal(initAnalytics("G-TEST123"), false);
  assert.equal(appended.length, 0);
});

test("loads gtag once and sends page views by hand", () => {
  assert.equal(initAnalytics("G-TEST123"), true);
  assert.equal(initAnalytics("G-TEST123"), false);
  assert.equal(appended.length, 1);
  assert.equal(
    appended[0]!.src,
    "https://www.googletagmanager.com/gtag/js?id=G-TEST123",
  );
  const [, config] = pushed();
  assert.deepEqual(config, ["config", "G-TEST123", { send_page_view: false }]);
});

test("queues events and page views once enabled", () => {
  initAnalytics("G-TEST123");
  track("search_trip", {
    from_stop: "MCC4",
    to_stop: "MCC10",
    days_ahead: 0,
    source: "form",
  });
  trackPage("/docs");
  trackPage("/docs");
  const events = pushed().slice(2);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], [
    "event",
    "search_trip",
    { from_stop: "MCC4", to_stop: "MCC10", days_ahead: 0, source: "form" },
  ]);
  assert.deepEqual(events[1], [
    "event",
    "page_view",
    {
      page_path: "/docs",
      page_location: "https://metro.example.com/docs",
      page_title: "Lanka Metro",
    },
  ]);
});

test("counts whole days ahead", () => {
  assert.equal(daysAhead("2026-10-11", "2026-10-11"), 0);
  assert.equal(daysAhead("2026-10-12", "2026-10-11"), 1);
  assert.equal(daysAhead("2026-11-01", "2026-10-31"), 1);
  assert.equal(daysAhead("2026-10-10", "2026-10-11"), -1);
});
