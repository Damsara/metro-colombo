import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useJourney } from "../src/api";
import { LanguageProvider } from "../src/lib/language";
import { encodeTripRequest } from "../src/lib/tracking";
import { Route } from "../src/routes/index";
import { useTrip } from "../src/state/useTrip";

vi.mock("../src/App", () => ({ default: () => null }));
vi.mock("../src/api", async (original) => ({
  ...(await original<typeof import("../src/api")>()),
  useJourney: vi.fn(() => ({ data: undefined, isFetching: true })),
}));

function Probe() {
  const trip = useTrip([]);
  return createElement("output", null, trip.showResults ? "results" : "form");
}

test("a restored search renders results before the stop catalog or plan arrives", async () => {
  const request = { from: "first", to: "last", date: "2026-10-11" };
  const params = new URLSearchParams({
    trip: "1",
    track: "1",
    journey: encodeTripRequest(request),
  });
  const root = createRootRoute();
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    validateSearch: Route.options.validateSearch,
    component: Probe,
  });
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: [`/?${params}`] }),
  });
  await router.load();
  const html = renderToString(
    createElement(LanguageProvider, {
      children: createElement(RouterProvider, { router }),
    }),
  );
  assert.match(html, /<output>results<\/output>/);
  assert.doesNotMatch(html, /<output>form<\/output>/);
  assert.deepEqual(vi.mocked(useJourney).mock.calls.at(-1)?.[0], request);
});
