import { plural } from "@lingui/core/macro";
import { Plural, useLingui } from "@lingui/react/macro";
import { ArrowRight, BusFront, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { towards } from "../i18n";
import { track } from "../lib/analytics";
import {
  journeyStrip,
  type BusJourney,
  type JourneyStop,
} from "../lib/busCard";
import { liveSignal, type FollowState } from "../lib/follow";
import { followStatus } from "../lib/followLabels";
import { usePlaceName } from "../lib/placeNames";
import type { BusJourneyResult } from "../state/useBusJourney";
import {
  busKey,
  occupancy,
  stopName,
  type Language,
  type LiveBus,
} from "../types";
import { OccupancyMeter } from "./OccupancyBadge";
import { RouteChip } from "./RouteChip";
import { Button } from "./ui/Button";
import { BusMarker, StopDot, TIMELINE_DOT, TIMELINE_ROW } from "./Timeline";
import { IconButton } from "./ui/IconButton";

const FLOATING =
  "absolute top-3.5 left-1/2 z-10 flex max-h-[calc(100%-28px)] w-[min(440px,calc(100%-152px))] -translate-x-1/2 flex-col rounded-2xl bg-card text-ink shadow-float";

export function BusCard({
  bus,
  routeCode,
  destination,
  state,
  result,
  color,
  language,
  expanded = false,
  inline = false,
  onFollow,
  onRelease,
  onExpand,
  onSeeAllStops,
  onFloatingBottom,
}: {
  bus: LiveBus;
  routeCode?: string;
  destination?: string;
  state: FollowState;
  result: BusJourneyResult | null;
  color: string;
  language: Language;
  expanded?: boolean;
  inline?: boolean;
  onFollow: () => void;
  onRelease: () => void;
  onExpand?: (expanded: boolean) => void;
  onSeeAllStops: () => void;
  onFloatingBottom?: (bottom: number) => void;
}) {
  const { i18n, t } = useLingui();
  const place = usePlaceName();
  const stopsId = useId();
  const key = busKey(bus);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = inline ? expanded : openFor === key;
  const setOpen = (next: boolean) => {
    if (inline) onExpand?.(next);
    else setOpenFor(next ? key : null);
  };
  // Once per opening, not per live update.
  const expandedRoute = useRef(routeCode);
  expandedRoute.current = routeCode;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current)
      track("bus_card_expand", { route: expandedRoute.current ?? "unknown" });
    wasOpen.current = open;
  }, [open]);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = section.current;
    if (inline || !element || !onFloatingBottom) return;
    const update = () =>
      onFloatingBottom(element.offsetTop + element.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      onFloatingBottom(0);
    };
  }, [inline, onFloatingBottom]);
  const journey = result?.status === "ready" ? result.journey : null;
  const board = journey?.board;
  const toBoard = journey?.stopsToBoard;

  return (
    <section
      ref={section}
      className={inline ? "px-4 pb-6" : `${FLOATING} px-3.5`}
      style={{ "--line": color } as CSSProperties}
      aria-label={t`Tracked bus`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (open && !inline) setOpen(false);
        else onRelease();
      }}
    >
      <div
        className={`flex items-center gap-3 ${inline ? "" : "-mr-1.5 py-2"}`}
      >
        {liveSignal(state) ? (
          <span
            className="size-3 shrink-0 animate-follow-pulse rounded-full bg-brand"
            aria-hidden="true"
          />
        ) : (
          <BusFront
            className="shrink-0 text-bus"
            size={18}
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="min-w-0 truncate text-muted" aria-live="polite">
              {followStatus(i18n, state)}
            </span>
            <strong className="shrink-0 font-semibold">
              {bus.registration_number || "-"}
            </strong>
            {routeCode && (
              <RouteChip code={routeCode} color={color} size="xs" />
            )}
          </p>
          {(destination || occupancy(bus)) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              {destination && (
                <span className="inline-flex min-w-0 items-center gap-1 font-medium">
                  <ArrowRight
                    className="shrink-0 text-muted"
                    size={13}
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {towards(i18n, place(destination))}
                  </span>
                </span>
              )}
              <OccupancyMeter bus={bus} />
            </p>
          )}
        </div>
        {state !== "following" && state !== "lost" && (
          <Button variant="bus" size="xs" pill onClick={onFollow}>
            {t`Follow`}
          </Button>
        )}
        <IconButton
          variant="soft"
          size="sm"
          label={t`Stop following`}
          onClick={onRelease}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>

      {(result?.status === "unknown" || result?.status === "loading") && (
        <p
          role={result.status === "loading" ? "status" : undefined}
          className={`mt-2 text-sm text-muted ${inline ? "" : "pb-3"}`}
        >
          {result.status === "loading"
            ? t`Finding this bus’s stops…`
            : t`We can’t tell where this bus is heading`}
        </p>
      )}

      {journey && !open && (
        <div className={inline ? "mt-3" : "pt-1"} onClick={() => setOpen(true)}>
          <JourneyStrip journey={journey} language={language} />
        </div>
      )}

      {journey && (
        <button
          type="button"
          className={`flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-ink ${
            inline ? "mt-1" : "-mx-3.5 px-3.5"
          }`}
          aria-expanded={open}
          aria-controls={stopsId}
          onClick={() => setOpen(!open)}
        >
          {open ? t`Hide stops` : t`Show stops`}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      )}

      {journey && open && (
        <div
          id={stopsId}
          className={
            inline
              ? "border-t border-line pt-3"
              : "-mx-3.5 max-h-[min(60vh,28rem)] min-h-0 overflow-y-auto overscroll-contain border-t border-line px-3.5 pt-3 pb-3.5 motion-safe:animate-page-forward"
          }
        >
          {board && toBoard ? (
            <p className="text-base font-semibold">
              {t({
                message: plural(toBoard, {
                  one: `# stop to ${stopName(board.stop, language)}`,
                  other: `# stops to ${stopName(board.stop, language)}`,
                }),
              })}
            </p>
          ) : null}
          <JourneyTimeline journey={journey} language={language} />
          <Button
            variant="secondary"
            size="sm"
            block
            className="mt-4"
            onClick={onSeeAllStops}
          >
            {t`See all stops`}
          </Button>
        </div>
      )}
    </section>
  );
}

function useMarkLabels(): Record<NonNullable<JourneyStop["mark"]>, string> {
  const { t } = useLingui();
  return { board: t`Your stop`, alight: t`Get off here` };
}

function JourneyStrip({
  journey,
  language,
}: {
  journey: BusJourney;
  language: Language;
}) {
  const { t } = useLingui();
  const items = journeyStrip(journey);
  const busAt = items.findIndex((item) => item.kind === "bus");
  const last = items.length - 1;
  return (
    <ol className="flex items-start" aria-label={t`Stops ahead`}>
      {items.map((item, index) => {
        const key =
          item.kind === "stop"
            ? `stop-${item.stop.index}`
            : `${item.kind}-${index}`;
        const terminus =
          item.kind === "stop" && item.stop.index === journey.terminus.index;
        return (
          <li
            key={key}
            className={`relative flex min-w-0 flex-col items-center ${
              item.kind === "stop" ? "flex-1" : "w-9 flex-none"
            }`}
          >
            <span
              className="relative flex h-5 w-full items-center justify-center"
              aria-hidden="true"
            >
              {index > 0 && (
                <span
                  className={`absolute top-1/2 right-1/2 left-0 h-0.5 -translate-y-1/2 bg-(--line) ${
                    index <= busAt ? "opacity-35" : ""
                  }`}
                />
              )}
              {index < last && (
                <span
                  className={`absolute top-1/2 right-0 left-1/2 h-0.5 -translate-y-1/2 bg-(--line) ${
                    index < busAt ? "opacity-35" : ""
                  }`}
                />
              )}
              {item.kind === "bus" ? (
                <BusMarker />
              ) : item.kind === "gap" ? (
                <span className="relative rounded-full bg-card px-1 text-2xs font-semibold text-muted">
                  +{item.count}
                </span>
              ) : (
                <StopDot
                  marked={!!item.stop.mark}
                  terminus={terminus}
                  passed={item.stop.state === "passed"}
                />
              )}
            </span>
            {item.kind === "bus" && <span className="sr-only">{t`Bus`}</span>}
            {item.kind === "gap" && (
              <span className="sr-only">
                <Plural
                  value={item.count}
                  one="# more stop"
                  other="# more stops"
                />
              </span>
            )}
            {item.kind === "stop" && (
              <StripLabel
                stop={item.stop}
                terminus={terminus}
                language={language}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StripLabel({
  stop,
  terminus,
  language,
}: {
  stop: JourneyStop;
  terminus: boolean;
  language: Language;
}) {
  const marks = useMarkLabels();
  const name = stopName(stop.stop, language);
  const mark = stop.mark && marks[stop.mark];
  return (
    <span className="mt-1 w-full px-0.5 text-center text-2xs leading-tight">
      <span
        className={`block truncate ${
          mark || terminus
            ? "font-semibold"
            : stop.state === "passed"
              ? "text-muted"
              : ""
        }`}
        title={name}
      >
        {name}
      </span>
      {mark && <span className="block truncate font-semibold">{mark}</span>}
    </span>
  );
}

type TimelineRow =
  | { kind: "bus" }
  | { kind: "stop"; stop: JourneyStop; terminus: boolean };

function JourneyTimeline({
  journey,
  language,
}: {
  journey: BusJourney;
  language: Language;
}) {
  const { t } = useLingui();
  const marks = useMarkLabels();
  const { lastPassed, ahead, terminus } = journey;
  const rows: TimelineRow[] = [];
  if (lastPassed)
    rows.push({ kind: "stop", stop: lastPassed, terminus: false });
  if (ahead[0]?.state !== "here") rows.push({ kind: "bus" });
  for (const stop of ahead)
    rows.push({ kind: "stop", stop, terminus: stop.index === terminus.index });
  if (ahead.at(-1)?.index !== terminus.index)
    rows.push({ kind: "stop", stop: terminus, terminus: true });

  return (
    <ol className="mt-3 flex flex-col gap-2" aria-label={t`Stops ahead`}>
      {rows.map((row) => {
        if (row.kind === "bus")
          return (
            <li key="bus" className={TIMELINE_ROW}>
              <span className={TIMELINE_DOT}>
                <BusMarker />
              </span>
              <span className="text-sm font-semibold text-bus">{t`Bus`}</span>
            </li>
          );
        const { stop, terminus: end } = row;
        const here = stop.state === "here";
        const passed = stop.state === "passed";
        const mark = stop.mark && marks[stop.mark];
        return (
          <li
            key={`stop-${stop.index}`}
            className={`${TIMELINE_ROW} ${passed ? "after:opacity-35" : ""}`}
          >
            <span className={TIMELINE_DOT} aria-hidden="true">
              {here ? (
                <BusMarker />
              ) : (
                <StopDot marked={!!stop.mark} terminus={end} passed={passed} />
              )}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${
                mark || end ? "text-base font-semibold" : "text-sm"
              } ${passed ? "text-muted" : ""}`}
            >
              {stopName(stop.stop, language)}
            </span>
            {stop.state === "next" && (
              <span className="shrink-0 text-xs font-semibold text-muted">
                {t({ message: "Next", context: "stop" })}
              </span>
            )}
            {here && (
              <span className="shrink-0 text-xs font-semibold text-bus">
                {t`Bus is here`}
              </span>
            )}
            {mark && (
              <span className="shrink-0 text-xs font-semibold">{mark}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
