import { useMemo } from "react";
import { ArrowLeft, BusFront, ChevronRight } from "lucide-react";
import { distanceMeters } from "../api";
import { Plural, useLingui } from "@lingui/react/macro";
import { towards } from "../i18n";
import { usePlaceName } from "../lib/placeNames";
import { routeColor } from "../lib/routeColor";
import { secondaryStopName } from "../lib/stopCard";
import {
  busKey,
  nameLanguage,
  resolveBusDirectionId,
  stopName,
} from "../types";
import type { CatalogStop, Language, LiveBus, Route, Stop } from "../types";
import LiveBusList from "./LiveBusList";
import { OccupancyBadge } from "./OccupancyBadge";
import { RouteChip } from "./RouteChip";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { Notice } from "./ui/Notice";

export function RouteList({
  routes,
  stops,
  liveCountByRoute,
  onOpen,
}: {
  routes: Route[];
  stops: CatalogStop[];
  liveCountByRoute: ReadonlyMap<string, number>;
  onOpen: (route: Route) => void;
}) {
  const { t } = useLingui();
  const place = usePlaceName();
  const stopCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stop of stops)
      for (const code of stop.routes)
        counts.set(code, (counts.get(code) ?? 0) + 1);
    return counts;
  }, [stops]);
  const sorted = useMemo(
    () =>
      [...routes].sort(
        (a, b) =>
          (liveCountByRoute.get(b.code) ?? 0) -
            (liveCountByRoute.get(a.code) ?? 0) || a.code.localeCompare(b.code),
      ),
    [routes, liveCountByRoute],
  );
  return (
    <ul className="flex flex-col gap-2.5">
      {sorted.map((route) => {
        const live = liveCountByRoute.get(route.code) ?? 0;
        const count = stopCount.get(route.code);
        const [first] = route.directions;
        return (
          <li key={route.code}>
            <button
              type="button"
              className={`flex min-h-20 w-full items-center gap-3 px-3.5 py-3.5 text-left hover-fine:border-line-strong ${cardClass()}`}
              onClick={() => onOpen(route)}
            >
              <RouteChip code={route.code} color={route.color_hex} />
              <span className="min-w-0 flex-1">
                <strong className="block text-base leading-snug">
                  {first
                    ? `${place(first.start_location)} ⇄ ${place(first.end_location)}`
                    : route.name}
                </strong>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {count !== undefined && (
                    <Plural value={count} one="# stop" other="# stops" />
                  )}
                  {live > 0 && (
                    <Badge>
                      <span
                        className="mr-1 size-1.5 rounded-full bg-live"
                        aria-hidden="true"
                      />
                      {t`${live} live`}
                    </Badge>
                  )}
                </span>
              </span>
              <ChevronRight className="shrink-0 text-faint" size={20} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function RouteDetail({
  route,
  directionIndex,
  onDirectionChange,
  stops,
  stopsPending,
  stopsError,
  onRetryStops,
  buses,
  liveUnavailable,
  selectedBusId,
  onBusSelect,
  selectedStopId,
  onStopSelect,
  onBack,
  language,
}: {
  route: Route;
  directionIndex: number;
  onDirectionChange: (index: number) => void;
  stops: Stop[] | undefined;
  stopsPending: boolean;
  stopsError: boolean;
  onRetryStops: () => void;
  buses: LiveBus[];
  liveUnavailable: boolean;
  selectedBusId: string | null;
  onBusSelect: (bus: LiveBus | null) => void;
  selectedStopId: string | undefined;
  /** Null closes the selected stop; `keyboard` when picked without a pointer. */
  onStopSelect: (stop: Stop | null, keyboard: boolean) => void;
  onBack: () => void;
  language: Language;
}) {
  const { t, i18n } = useLingui();
  const place = usePlaceName();
  const color = routeColor(route.color_hex);
  const directionId = route.directions[directionIndex]?.id;
  const ordered = useMemo(
    () =>
      (stops ?? [])
        .slice()
        .sort((a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0)),
    [stops],
  );
  const busesByStop = useMemo(() => {
    const placed = new Map<number, LiveBus[]>();
    if (!ordered.length) return placed;
    for (const bus of buses) {
      if (bus.route_code !== route.code) continue;
      if (
        directionId &&
        bus.direction_id &&
        resolveBusDirectionId(route, bus.direction_id) !== directionId
      )
        continue;
      const here = { latitude: bus.lat, longitude: bus.lng };
      let nearest = 0;
      ordered.forEach((stop, index) => {
        if (distanceMeters(here, stop) < distanceMeters(here, ordered[nearest]))
          nearest = index;
      });
      placed.set(nearest, [...(placed.get(nearest) ?? []), bus]);
    }
    return placed;
  }, [buses, ordered, route, directionId]);
  const live = liveCountForRoute(buses, route.code);
  const otherDirectionIndex =
    directionIndex === 0 && route.directions.length > 1 ? 1 : 0;

  return (
    <div>
      <Button variant="quiet" onClick={onBack}>
        <ArrowLeft size={17} />
        {t`All bus routes`}
      </Button>
      <h2 className="mt-3 mb-4 flex items-start gap-2.5">
        <RouteChip code={route.code} color={route.color_hex} />
        <span className="flex min-w-0 flex-col gap-1.5">
          <strong className="text-2xl leading-tight font-bold">
            {route.name}
          </strong>
          {!liveUnavailable && (
            <span className="inline-flex w-fit items-center gap-2 text-xs font-semibold text-ink">
              <span
                className={`inline-block size-2 shrink-0 rounded-full ${live > 0 ? "bg-brand" : "bg-faint"}`}
              />
              {`${live} ${t`live`}`}
            </span>
          )}
        </span>
      </h2>

      <div
        role="radiogroup"
        aria-label={t`Direction`}
        className={`mb-3 grid gap-1.5 rounded-lg bg-tint-50 p-1.5 ${route.directions.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {route.directions.map((direction, index) => {
          const startName = place(direction.start_location);
          const endName = place(direction.end_location);
          return (
            <button
              key={direction.id}
              type="button"
              role="radio"
              aria-checked={index === directionIndex}
              onClick={() => onDirectionChange(index)}
              className="flex min-h-14 min-w-0 flex-col justify-center rounded-md px-3 py-2 text-left text-muted aria-checked:bg-card aria-checked:text-ink aria-checked:shadow-card hover-fine:not-aria-checked:bg-tint-100"
            >
              <strong className="text-sm leading-snug font-semibold">
                {towards(i18n, endName)}
              </strong>
              <small className="mt-0.5 text-2xs leading-snug">
                {t`from ${startName}`}
              </small>
            </button>
          );
        })}
      </div>

      <div className="mb-6 rounded-lg border border-line bg-card p-3.5">
        <LiveBusList
          buses={buses}
          selectedBusId={selectedBusId}
          route={route}
          directionId={directionId}
          unavailable={liveUnavailable}
          onBusSelect={onBusSelect}
          onShowOtherDirection={() => onDirectionChange(otherDirectionIndex)}
        />
      </div>

      {stopsPending && <p role="status">{t`Loading the stops…`}</p>}
      {stopsError && (
        <Notice
          tone="danger"
          role="alert"
          className="my-4"
          action={
            <Button variant="link" onClick={onRetryStops}>
              {t`Try again`}
            </Button>
          }
        >
          {t`The stops couldn’t be loaded.`}
        </Notice>
      )}
      <ol className="pl-3">
        {ordered.flatMap((stop, index) => {
          const selected = selectedStopId === stop.id;
          const secondary = secondaryStopName(stop, language);
          return [
            <li
              key={stop.id}
              className="relative not-last:before:absolute not-last:before:top-1/2 not-last:before:-bottom-1/2 not-last:before:-left-px not-last:before:w-0.5 not-last:before:bg-line"
            >
              {/* The whole row, dot included, opens the stop's card; tapping the open stop again closes it. */}
              <button
                type="button"
                className="group relative -ml-3 flex min-h-16 w-[calc(100%+12px)] items-center gap-3.5 rounded-md py-3 pr-2 pl-1.5 text-left aria-pressed:bg-tint-100 hover-fine:not-aria-pressed:bg-tint-50"
                aria-pressed={selected}
                onClick={(event) =>
                  onStopSelect(selected ? null : stop, event.detail === 0)
                }
              >
                <span
                  className="z-10 size-3 shrink-0 rounded-full border-2 bg-card group-aria-pressed:-mx-0.5 group-aria-pressed:size-4 group-aria-pressed:border-ink group-aria-pressed:bg-card group-aria-pressed:ring-3 group-aria-pressed:ring-paper"
                  style={selected ? undefined : { borderColor: color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <strong className="block text-base leading-snug font-semibold">
                    {stopName(stop, language)}
                  </strong>
                  {secondary && (
                    <span
                      lang={nameLanguage(language) === "en" ? "si" : "en"}
                      className="block text-sm leading-snug text-muted"
                    >
                      {secondary}
                    </span>
                  )}
                </span>
                <ChevronRight
                  className="shrink-0 text-faint group-aria-pressed:text-ink"
                  size={17}
                  aria-hidden="true"
                />
              </button>
            </li>,
            ...(busesByStop.get(index) ?? []).map((bus) => {
              const key = busKey(bus);
              const selected = key !== "" && key === selectedBusId;
              return (
                <BusAtStop
                  key={`bus-${key || `${bus.lat}:${bus.lng}`}`}
                  bus={bus}
                  nearName={stopName(stop, language)}
                  color={color}
                  selected={selected}
                  onToggle={() => onBusSelect(selected ? null : bus)}
                />
              );
            }),
          ];
        })}
      </ol>
    </div>
  );
}

function BusAtStop({
  bus,
  nearName,
  color,
  selected,
  onToggle,
}: {
  bus: LiveBus;
  nearName: string;
  color: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useLingui();
  return (
    <li className="relative flex items-center gap-3 py-2 before:absolute before:inset-y-0 before:-left-px before:w-0.5 before:bg-line">
      <span
        className="z-10 -ml-3.5 grid size-7 shrink-0 place-items-center rounded-full text-white shadow-card"
        style={{ background: color }}
        aria-hidden="true"
      >
        <BusFront size={15} />
      </span>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-card px-3 text-left text-sm aria-pressed:border-brand aria-pressed:bg-tint-100 hover-fine:not-aria-pressed:bg-tint-50"
      >
        <span className="min-w-0 flex-1 truncate">
          <strong className="font-semibold">
            {bus.registration_number || t`Bus`}
          </strong>{" "}
          <span className="text-muted">{t`near ${nearName}`}</span>
        </span>
        <OccupancyBadge bus={bus} />
        <span className="text-2xs font-semibold text-brand">
          {selected ? t`On map` : t`Follow`}
        </span>
      </button>
    </li>
  );
}

function liveCountForRoute(buses: LiveBus[], code: string): number {
  return buses.filter((bus) => bus.route_code === code).length;
}
