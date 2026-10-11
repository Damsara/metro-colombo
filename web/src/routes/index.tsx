import { createFileRoute } from "@tanstack/react-router";
import App from "../App";
import {
  decodeTrackedRide,
  decodeTripRequest,
  encodeTrackedRide,
  encodeTripRequest,
} from "../lib/tracking";

export interface HomeSearch {
  /** The old full-screen phone map. Old links open the app with the map in view. */
  map?: 1;
  /** The trip results page, so the Back button returns to the form. */
  trip?: 1;
  /** An open bus route, so the Back button returns to the list. */
  route?: 1;
  /** Tracking a journey's bus, so the Back button returns to the results. */
  track?: 1;
  journey?: string;
  ride?: string;
}

const flag = (value: unknown) => value === 1 || value === "1";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const journey = decodeTripRequest(search.journey);
    const ride = decodeTrackedRide(search.ride);
    return {
      ...(flag(search.map) ? { map: 1 } : {}),
      ...(flag(search.trip) ? { trip: 1 } : {}),
      ...(flag(search.route) ? { route: 1 } : {}),
      ...(flag(search.track) ? { track: 1 } : {}),
      ...(journey ? { journey: encodeTripRequest(journey) } : {}),
      ...(ride ? { ride: encodeTrackedRide(ride) } : {}),
    };
  },
  component: App,
});
