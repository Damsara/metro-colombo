import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { TrackingPanel } from "../src/components/TrackingPanel";
import type { FollowState } from "../src/lib/follow";
import { LanguageProvider } from "../src/lib/language";
import type { Tracking } from "../src/state/useTracking";
import type { JourneyOption, LiveBus, Stop } from "../src/types";

type ButtonProps = ComponentProps<
  typeof import("../src/components/ui/Button").Button
>;
const buttons = vi.hoisted(() => [] as ButtonProps[]);
vi.mock("../src/components/ui/Button", async (original) => {
  const actual = await original<typeof import("../src/components/ui/Button")>();
  return {
    ...actual,
    Button: (props: Parameters<typeof actual.Button>[0]) => {
      buttons.push(props);
      return actual.Button(props);
    },
  };
});

const option: JourneyOption = JSON.parse(
  readFileSync(
    new URL("./fixtures/transfer-option.json", import.meta.url),
    "utf8",
  ),
);
const first = option.legs.find((leg) => leg.kind === "ride");
assert.ok(first?.kind === "ride");
const ride = first.ride;

function stopAt(id: string, latitude: number): Stop {
  return {
    id,
    stop_code: id,
    stop_name_en: id,
    stop_name_si: id,
    stop_name_tm: id,
    latitude,
    longitude: 79.9,
  };
}
// The boarding stop fourth and the alighting stop seventh on the line.
const stops = [
  stopAt("a", 6.8),
  stopAt("b", 6.81),
  stopAt("c", 6.82),
  { ...ride.board, latitude: 6.83, longitude: 79.9 },
  stopAt("e", 6.84),
  stopAt("f", 6.85),
  { ...ride.alight, latitude: 6.86, longitude: 79.9 },
];
const bus: LiveBus = {
  id: "b1",
  lat: 6.8,
  lng: 79.9,
  registration_number: "WP-NE-6544",
  current_capacity: 10,
  total_capacity: 60,
};

function render(
  overrides: Partial<Tracking> | Record<string, unknown>,
  followState: FollowState = "following",
  onStop: () => void = () => {},
): string {
  const tracking = {
    active: true,
    ride,
    bus,
    liveBus: bus,
    lost: false,
    phase: "approaching",
    announcement: null,
    stops,
    position: 0,
    boardIndex: 3,
    alightIndex: 6,
    boardLeft: 3,
    alightLeft: 6,
    now: Date.now(),
    ...overrides,
  } as Tracking;
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: new QueryClient(),
      children: createElement(LanguageProvider, {
        children: createElement(TrackingPanel, {
          tracking,
          language: "en",
          routeColors: new Map(),
          followState,
          onFollow: () => {},
          onStop,
        }),
      }),
    }),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ");

test("before boarding it counts the stops to yours, bus to stop", () => {
  const html = text(render({}));
  assert.match(html, /WP-NE-6544 is 3 stops from/);
  assert.match(html, /Bus is here/);
  assert.match(html, /Your stop/);
  assert.match(html, /Plenty of room/);
  assert.match(html, /End trip/);
  assert.doesNotMatch(html, /Stop tracking|Back to results/);
});

test("close by, it says to head out", () => {
  const html = text(
    render({ phase: "headOut", position: 2, boardLeft: 1, alightLeft: 4 }),
  );
  assert.match(html, /Head to the stop now/);
  assert.match(html, /is 1 stop from/);
});

test("on board it counts down to the stop you get off at", () => {
  const riding = text(
    render({ phase: "riding", position: 3.5, boardLeft: -1, alightLeft: 3 }),
  );
  assert.match(riding, /3 stops to/);
  assert.match(riding, /Your bus/);
  assert.match(riding, /Get off here/);
  const next = text(
    render({ phase: "nextStop", position: 5, boardLeft: -2, alightLeft: 1 }),
  );
  assert.match(next, /Get off at the next stop/);
});

test("arriving offers Done, and a lost bus falls back to the timetable", () => {
  const arrived = text(
    render({ phase: "arrived", position: 6, boardLeft: -3, alightLeft: 0 }),
  );
  assert.match(arrived, /You’ve arrived/);
  assert.match(arrived, /Done/);
  assert.doesNotMatch(arrived, /End trip/);
  const lost = text(render({ lost: true, liveBus: undefined }));
  assert.match(lost, /Live position lost; showing schedule/);
  assert.match(lost, /Scheduled departure/);
  assert.match(lost, /Scheduled arrival/);
});

test("milestones are announced once, through one polite region", () => {
  const quiet = render({});
  assert.match(quiet, /<p class="sr-only" aria-live="polite"><\/p>/);
  const nudge = render({ phase: "headOut", announcement: "headOut" });
  assert.match(
    nudge,
    /<p class="sr-only" aria-live="polite">Head to the stop now<\/p>/,
  );
});

test("the header says how the map follows the bus, with Follow when it isn't", () => {
  const following = text(render({}));
  assert.match(following, /Following/);
  assert.doesNotMatch(following, />\s*Follow\s*</);
  const looking = render({}, "lookingAround");
  assert.match(looking, /<p[^>]*aria-live="polite"[^>]*>Looking around<\/p>/);
  assert.match(looking, /<button[^>]*>Follow<\/button>/);
  const waiting = render({ liveBus: undefined }, "waiting");
  assert.match(waiting, /Waiting for signal…/);
  assert.match(waiting, /<button[^>]*>Follow<\/button>/);
  assert.doesNotMatch(waiting, /animate-follow-pulse/);
});

test("a lost bus says so once and offers no Follow", () => {
  const html = render({ lost: true, liveBus: undefined }, "lost");
  assert.equal(html.match(/Live position lost; showing schedule/g)?.length, 1);
  assert.doesNotMatch(html, /<button[^>]*>Follow<\/button>/);
});

test("a changed bus is announced with an OK to dismiss it", () => {
  const quiet = render({});
  assert.doesNotMatch(quiet, /Your bus changed/);
  const changed = render({
    reassigned: { from: "WP-NE-6544", to: "WP-NB-1234" },
  });
  assert.match(
    changed,
    /<div aria-live="polite">.*Your bus changed to WP-NB-1234.*>OK<\/button>/,
  );
});

test("the header has a button that ends the trip", () => {
  let stopped = 0;
  buttons.length = 0;
  const html = render({}, "following", () => stopped++);
  assert.match(html, /<button[^>]*aria-label="End trip"/);
  buttons
    .find((props) => props["aria-label"] === "End trip")
    ?.onClick?.({} as never);
  assert.equal(stopped, 1);
});
