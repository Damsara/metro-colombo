import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { LastMileRide } from "../src/components/LastMileRide";
import { LanguageProvider } from "../src/lib/language";
import type { Tariff } from "../src/lib/pickmeFare";

const fort = { lat: 6.9335, lng: 79.85 };
const independenceSquare = { lat: 6.9061, lng: 79.8686 };

const fitted: Tariff = {
  calibrated: true,
  minFare: 300,
  minKm: 1.5,
  aboveKmFare: 110,
  nightFare: 100,
  nightFrom: 22,
  nightTo: 5,
};

const render = (tariff?: Tariff) =>
  renderToStaticMarkup(
    createElement(LanguageProvider, {
      children: createElement(LastMileRide, {
        from: fort,
        to: independenceSquare,
        hour: 12,
        ...(tariff ? { tariff } : {}),
      }),
    }),
  );

test("the panel states a road distance and links to the app", () => {
  const html = render();
  assert.match(html, /by road/);
  assert.match(html, /href="https:\/\/app\.pickme\.lk"/);
  assert.match(html, /Open PickMe/);
});

test("no price appears until the tariff is calibrated", () => {
  const html = render();
  assert.doesNotMatch(html, /Rs /);
  assert.match(html, /Price shown in the PickMe app/);
});

test("a calibrated tariff shows a price band", () => {
  const html = render(fitted);
  assert.match(html, /Rs /);
  assert.doesNotMatch(html, /Price shown in the PickMe app/);
});
