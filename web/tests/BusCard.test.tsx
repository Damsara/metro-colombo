import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BusCard } from "../src/components/BusCard";
import type { BusJourney, JourneyStop, StripItem } from "../src/lib/busCard";
import type { FollowState } from "../src/lib/follow";
import { LanguageProvider } from "../src/lib/language";
import type { BusJourneyResult } from "../src/state/useBusJourney";
import type { LiveBus, Stop } from "../src/types";

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

const strips = vi.hoisted(() => new Map<object, StripItem[]>());
vi.mock("../src/lib/busCard", () => ({
  journeyStrip: (journey: object) => strips.get(journey) ?? [],
}));

function stopAt(id: string): Stop {
  return {
    id,
    stop_code: id,
    stop_name_en: id,
    stop_name_si: id,
    stop_name_tm: id,
    latitude: 6.9,
    longitude: 79.9,
  };
}
function at(
  id: string,
  index: number,
  state: JourneyStop["state"],
  mark?: JourneyStop["mark"],
): JourneyStop {
  return { stop: stopAt(id), index, state, mark };
}

const bus: LiveBus = {
  id: "b1",
  lat: 6.9,
  lng: 79.9,
  registration_number: "WP-NE-6544",
  route_code: "100",
  direction_id: "d1",
  current_capacity: 10,
  total_capacity: 60,
};

const kottawa = at("Kottawa", 3, "passed");
const pannipitiya = at("Pannipitiya", 4, "next");
const maharagama = at("Maharagama", 5, "ahead");
const nugegoda = at("Nugegoda", 9, "ahead", "board");
const pettah = at("Pettah", 14, "ahead");
const plain: BusJourney = {
  routeCode: "100",
  directionId: "d1",
  position: 3.4,
  lastPassed: kottawa,
  ahead: [pannipitiya, maharagama, pettah],
  terminus: pettah,
  board: null,
  alight: null,
  stopsToBoard: null,
};
strips.set(plain, [
  { kind: "stop", stop: kottawa },
  { kind: "bus" },
  { kind: "stop", stop: pannipitiya },
  { kind: "stop", stop: maharagama },
  { kind: "gap", count: 8 },
  { kind: "stop", stop: pettah },
]);
const mine: BusJourney = {
  ...plain,
  ahead: [pannipitiya, maharagama, nugegoda, pettah],
  board: nugegoda,
  stopsToBoard: 6,
};
strips.set(mine, [
  { kind: "stop", stop: kottawa },
  { kind: "bus" },
  { kind: "stop", stop: pannipitiya },
  { kind: "gap", count: 4 },
  { kind: "stop", stop: nugegoda },
  { kind: "gap", count: 4 },
  { kind: "stop", stop: pettah },
]);

const ready = (journey: BusJourney): BusJourneyResult => ({
  status: "ready",
  journey,
});

function render(
  result: BusJourneyResult | null,
  {
    state = "following",
    expanded = false,
    inline = true,
    onSeeAllStops = () => {},
  }: {
    state?: FollowState;
    expanded?: boolean;
    inline?: boolean;
    onSeeAllStops?: () => void;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: new QueryClient(),
      children: createElement(LanguageProvider, {
        children: createElement(BusCard, {
          bus,
          routeCode: "100",
          destination: "Pettah",
          state,
          result,
          color: "#0a7d55",
          language: "en",
          expanded,
          inline,
          onFollow: () => {},
          onRelease: () => {},
          onExpand: () => {},
          onSeeAllStops,
        }),
      }),
    }),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ");
const strip = (html: string) =>
  html.match(/<ol[^>]*aria-label="Stops ahead"[^>]*>.*?<\/ol>/)?.[0] ?? "";

test("collapsed, it shows the bus, where it's going and the strip", () => {
  const html = render(ready(plain));
  const words = text(html);
  assert.match(words, /WP-NE-6544/);
  assert.match(words, /Following/);
  assert.match(words, /Pettah/);
  assert.match(words, /Plenty of room/);
  const line = text(strip(html));
  assert.match(line, /Kottawa\s+Bus\s+Pannipitiya\s+Maharagama/);
  assert.match(line, /Pettah/);
  assert.doesNotMatch(line, /Your stop/);
  assert.match(html, /aria-expanded="false"[^>]*>Show stops/);
  assert.doesNotMatch(words, /See all stops/);
});

test("the strip counts the stops it leaves out", () => {
  assert.match(text(strip(render(ready(plain)))), /\+8\s+8 more stops/);
  const gaps = text(strip(render(ready(mine)))).match(/4 more stops/g);
  assert.equal(gaps?.length, 2);
});

test("your stop is named on the strip, not just coloured", () => {
  const line = text(strip(render(ready(mine))));
  assert.match(line, /Nugegoda\s+Your stop/);
});

test("expanded, it lists every stop left with the bus and Next", () => {
  const html = render(ready(mine), { expanded: true });
  const words = text(html);
  assert.match(html, /aria-expanded="true"[^>]*>Hide stops/);
  assert.match(
    render(ready(mine), { expanded: true, inline: false }),
    /aria-expanded="false"[^>]*>Show stops/,
  );
  assert.match(words, /6 stops to Nugegoda/);
  assert.match(
    words,
    /Kottawa\s+Bus\s+Pannipitiya\s+Next\s+Maharagama\s+Nugegoda\s+Your stop\s+Pettah/,
  );
  assert.match(words, /See all stops/);
});

test("no stop count while the bus is at your stop", () => {
  const words = text(
    render(ready({ ...mine, stopsToBoard: 0 }), { expanded: true }),
  );
  assert.doesNotMatch(words, /stops? to Nugegoda/);
});

test("a bus at a stop sits on that stop in the timeline", () => {
  const atStop: BusJourney = {
    ...plain,
    position: 4,
    ahead: [at("Pannipitiya", 4, "here"), maharagama, pettah],
  };
  const words = text(render(ready(atStop), { expanded: true }));
  assert.match(words, /Pannipitiya\s+Bus is here/);
  assert.doesNotMatch(words, /Kottawa\s+Bus\s+Pannipitiya/);
});

test("the terminus ends the timeline even when the journey leaves it out", () => {
  const short: BusJourney = { ...plain, ahead: [pannipitiya] };
  const words = text(render(ready(short), { expanded: true }));
  assert.match(words, /Pannipitiya\s+Next\s+Pettah/);
});

test("an unknown bus shows its header and says so, with no strip", () => {
  const html = render({ status: "unknown", reason: "offRoute" });
  assert.match(text(html), /WP-NE-6544/);
  assert.match(text(html), /We can’t tell where this bus is heading/);
  assert.equal(strip(html), "");
  assert.doesNotMatch(html, /Show stops/);
});

test("while loading it shows a quiet row", () => {
  const html = render({ status: "loading" });
  assert.match(html, /role="status"[^>]*>Finding this bus’s stops…/);
  assert.equal(strip(html), "");
  assert.doesNotMatch(html, /Show stops/);
});

test("Follow shows only when the map isn't already following", () => {
  const follow = /<button[^>]*>Follow<\/button>/;
  assert.doesNotMatch(render(ready(plain)), follow);
  assert.doesNotMatch(render(ready(plain), { state: "lost" }), follow);
  const looking = render(ready(plain), { state: "lookingAround" });
  assert.match(looking, follow);
  assert.match(text(looking), /Looking around/);
  assert.match(render(ready(plain), { state: "waiting" }), follow);
});

test("See all stops hands over to the route view", () => {
  let opened = 0;
  buttons.length = 0;
  render(ready(plain), { expanded: true, onSeeAllStops: () => opened++ });
  buttons
    .find((props) => props.children === "See all stops")
    ?.onClick?.({} as never);
  assert.equal(opened, 1);
});
