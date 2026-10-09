import { createFileRoute } from "@tanstack/react-router";
import App from "../App";

export interface HomeSearch {
  /** The phone's full-screen map, so the Back button closes it. */
  map?: 1;
  /** The trip results page, so the Back button returns to the form. */
  trip?: 1;
}

const flag = (value: unknown) => value === 1 || value === "1";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    ...(flag(search.map) ? { map: 1 } : {}),
    ...(flag(search.trip) ? { trip: 1 } : {}),
  }),
  component: App,
});
