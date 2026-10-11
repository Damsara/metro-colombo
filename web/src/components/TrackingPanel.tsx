import { plural } from "@lingui/core/macro";
import { Plural, useLingui } from "@lingui/react/macro";
import { BusFront, CircleCheck, MapPinOff, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { minutesLabel, timeLabel, towards } from "../i18n";
import { liveSignal, type FollowState } from "../lib/follow";
import { followStatus } from "../lib/followLabels";
import { usePlaceName } from "../lib/placeNames";
import { liveMinutes, progressRows } from "../lib/tracking";
import type { Reassignment, Tracking } from "../state/useTracking";
import { stopName, type Language } from "../types";
import { OccupancyMeter } from "./OccupancyBadge";
import { RouteChip } from "./RouteChip";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";

const ROW =
  "relative flex min-h-9 items-center gap-3 not-last:after:absolute not-last:after:top-6.5 not-last:after:-bottom-2.5 not-last:after:left-2.5 not-last:after:border-l-2 not-last:after:border-line-strong";
const DOT = "grid size-5 shrink-0 place-items-center";

/**
 * The stops from the bus to the one that matters next, bus in red, your stop
 * in bold.
 */
function ProgressLine({
  tracking,
  target,
  targetNote,
  language,
}: {
  tracking: Tracking;
  target: number;
  targetNote: string;
  language: Language;
}) {
  const { t } = useLingui();
  const { stops, position } = tracking;
  if (!stops || position === null) return null;
  const rows = progressRows(stops, position, target);
  if (!rows.length) return null;
  return (
    <ol className="mt-4 flex flex-col gap-2" aria-label={t`Stops to go`}>
      {rows.map((row, index) => {
        if (row.kind === "bus")
          return (
            <li key="bus" className={ROW}>
              <span className={DOT}>
                <span className="grid size-5 place-items-center rounded-full bg-bus text-white">
                  <BusFront size={12} aria-hidden="true" />
                </span>
              </span>
              <span className="text-sm font-semibold text-bus">
                {t`Your bus`}
              </span>
            </li>
          );
        if (row.kind === "gap")
          return (
            <li key={`gap-${index}`} className={`${ROW} text-sm text-muted`}>
              <span className={DOT} aria-hidden="true">
                <span className="size-1 rounded-full bg-faint" />
              </span>
              <Plural
                value={row.count}
                one="# more stop"
                other="# more stops"
              />
            </li>
          );
        return (
          <li key={`stop-${row.index}`} className={ROW}>
            <span className={DOT} aria-hidden="true">
              {row.bus ? (
                <span className="grid size-5 place-items-center rounded-full bg-bus text-white">
                  <BusFront size={12} />
                </span>
              ) : row.target ? (
                <span className="size-4 rounded-full border-4 border-ink bg-card" />
              ) : (
                <span className="size-2.5 rounded-full border-2 border-line-strong bg-card" />
              )}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${row.target ? "text-base font-semibold" : "text-sm"}`}
            >
              {stopName(row.stop, language)}
            </span>
            {row.bus && (
              <span className="shrink-0 text-xs font-semibold text-bus">
                {t`Bus is here`}
              </span>
            )}
            {row.target && !row.bus && (
              <span className="shrink-0 text-xs font-semibold text-muted">
                {targetNote}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function BusChangeNotice({
  reassigned,
  onAcknowledge,
}: {
  reassigned: Reassignment | null;
  onAcknowledge: () => void;
}) {
  const { t } = useLingui();
  const plate = reassigned?.to;
  return (
    <div aria-live="polite">
      {reassigned && (
        <div
          className={`mt-3 flex items-center gap-3 px-4 py-2.5 text-sm ${cardClass()}`}
        >
          <p className="min-w-0 flex-1 font-semibold">
            {t`Your bus changed to ${plate}`}
          </p>
          <Button variant="secondary" size="xs" onClick={onAcknowledge}>
            {t`OK`}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * "Your bus is coming": where the tracked bus is against your boarding stop,
 * then against the stop you get off at, until you arrive.
 */
export function TrackingPanel({
  tracking,
  language,
  routeColors,
  followState,
  onFollow,
  onStop,
}: {
  tracking: Tracking;
  language: Language;
  routeColors: ReadonlyMap<string, string>;
  /** Whether the map is following the tracked bus. */
  followState: FollowState;
  onFollow: () => void;
  onStop: () => void;
}) {
  const { t, i18n } = useLingui();
  const place = usePlaceName();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The button that started tracking is gone, so focus lands on the status.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  const { ride, bus, phase, lost, boardLeft, alightLeft, liveBus, now } =
    tracking;
  if (!ride || !bus) return null;

  const plate = bus.registration_number || t`Your bus`;
  const board = stopName(ride.board, language);
  const alight = stopName(ride.alight, language);
  const boarding =
    phase === "waiting" || phase === "approaching" || phase === "headOut";
  const minutes = boarding && !lost ? liveMinutes(ride.board, now) : null;

  const awayLine = (left: number | null) =>
    left === null
      ? t`${plate} is on its way to ${board}`
      : left === 0
        ? t`${plate} is at ${board}`
        : t({
            message: plural(left, {
              one: `${plate} is # stop from ${board}`,
              other: `${plate} is # stops from ${board}`,
            }),
          });

  let headline: string;
  let detail: string | null = null;
  let soon = false;
  let icon: ReactNode = null;
  if (lost) {
    headline = t`Live position lost; showing schedule`;
    icon = <MapPinOff size={22} aria-hidden="true" />;
  } else if (phase === "headOut") {
    headline = t`Head to the stop now`;
    detail = awayLine(boardLeft);
    soon = true;
  } else if (boarding) {
    headline = awayLine(boardLeft);
  } else if (phase === "riding") {
    headline =
      alightLeft === null
        ? t`On your way to ${alight}`
        : t({
            message: plural(alightLeft, {
              one: `# stop to ${alight}`,
              other: `# stops to ${alight}`,
            }),
          });
  } else if (phase === "nextStop") {
    headline = t`Get off at the next stop`;
    detail = t`Next stop: ${alight}`;
    soon = true;
  } else {
    headline = t`You’ve arrived`;
    detail = t`You’re at ${alight}.`;
    icon = <CircleCheck size={22} aria-hidden="true" />;
  }

  const announcement = {
    headOut: t`Head to the stop now`,
    nextStop: t`Get off at the next stop`,
    arrived: t`You’ve arrived`,
    lost: t`Live position lost; showing schedule`,
  };
  const scheduled = (value: string | undefined) =>
    value && Number.isFinite(Date.parse(value))
      ? timeLabel(i18n, value)
      : t`Time unavailable`;
  const minutesText = minutes !== null ? minutesLabel(i18n, minutes) : "";

  return (
    <section
      aria-labelledby={headingId}
      className="motion-safe:animate-page-forward"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-md">
            {liveSignal(followState) && (
              <span
                className="size-2.5 shrink-0 animate-follow-pulse rounded-full bg-bus"
                aria-hidden="true"
              />
            )}
            <strong className="truncate font-semibold">{plate}</strong>
            <RouteChip
              code={ride.route.code}
              color={routeColors.get(ride.route.code)}
              size="xs"
            />
          </p>
          <p className="truncate text-xs text-muted">
            {towards(i18n, place(ride.end_location))}
          </p>
          <p className="truncate text-xs font-semibold" aria-live="polite">
            {phase === "arrived" || (lost && followState === "lost")
              ? ""
              : followStatus(i18n, followState)}
          </p>
        </div>
        {followState !== "following" &&
          followState !== "lost" &&
          phase !== "arrived" && (
            <Button variant="bus" size="xs" pill onClick={onFollow}>
              {t`Follow`}
            </Button>
          )}
        <Button
          variant="quiet"
          aria-label={phase === "arrived" && !lost ? t`Done` : t`End trip`}
          onClick={onStop}
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <BusChangeNotice
        reassigned={tracking.reassigned}
        onAcknowledge={tracking.acknowledgeReassigned}
      />

      <div
        className={`mt-3 rounded-lg px-4 py-3.5 ${
          soon ? "border border-stripe bg-soon text-soon-ink" : cardClass()
        }`}
      >
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="flex items-start gap-2 text-2xl leading-snug font-semibold tracking-tight outline-none max-md:text-xl"
        >
          {icon && <span className="mt-0.5 shrink-0 text-muted">{icon}</span>}
          {headline}
        </h2>
        {detail && (
          <p
            className={`mt-1 text-md ${soon ? "font-semibold" : "text-muted"}`}
          >
            {detail}
          </p>
        )}
        {(minutes !== null || (liveBus && !lost && phase !== "arrived")) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {minutes !== null && (
              <span className={`font-semibold ${soon ? "" : "text-bus"}`}>
                {t`About ${minutesText}`}
              </span>
            )}
            {liveBus && !lost && phase !== "arrived" && (
              <OccupancyMeter bus={liveBus} />
            )}
          </p>
        )}
      </div>

      {lost ? (
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-md">
          <dt className="min-w-0">
            <span className="block truncate font-semibold">{board}</span>
            <span className="text-sm text-muted">{t`Scheduled departure`}</span>
          </dt>
          <dd className="font-semibold">
            {scheduled(ride.board.scheduled_time)}
          </dd>
          <dt className="min-w-0">
            <span className="block truncate font-semibold">{alight}</span>
            <span className="text-sm text-muted">{t`Scheduled arrival`}</span>
          </dt>
          <dd className="font-semibold">
            {scheduled(ride.alight.scheduled_time)}
          </dd>
        </dl>
      ) : boarding ? (
        <ProgressLine
          tracking={tracking}
          target={tracking.boardIndex}
          targetNote={t`Your stop`}
          language={language}
        />
      ) : phase !== "arrived" ? (
        <ProgressLine
          tracking={tracking}
          target={tracking.alightIndex}
          targetNote={t`Get off here`}
          language={language}
        />
      ) : null}

      <div className="mt-5 flex flex-col gap-2">
        {phase === "arrived" && !lost ? (
          <Button variant="primary" block onClick={onStop}>
            {t`Done`}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" block onClick={onStop}>
            {t`End trip`}
          </Button>
        )}
      </div>

      {/* One polite message per milestone, not one per live update. */}
      <p className="sr-only" aria-live="polite">
        {tracking.announcement ? announcement[tracking.announcement] : ""}
      </p>
    </section>
  );
}
