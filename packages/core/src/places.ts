import type * as S from "./schemas.js";

export type LinkablePlace = Omit<S.Place, "stop_code" | "stop_id"> & {
  readonly nearest_stop_id: number;
};

export type LinkableStop = {
  readonly id: number;
  readonly stop_code: string;
  readonly eimsky_id: string;
};

export function linkPlaces(
  places: ReadonlyArray<LinkablePlace>,
  stops: ReadonlyArray<LinkableStop>,
): ReadonlyArray<S.Place> {
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  return places.flatMap(({ nearest_stop_id, ...place }) => {
    const stop = byId.get(nearest_stop_id);
    return stop
      ? [
          {
            ...place,
            name: place.name.trim(),
            stop_code: stop.stop_code,
            stop_id: stop.eimsky_id,
          },
        ]
      : [];
  });
}
