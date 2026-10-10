import { useEffect, useId, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowRightLeft,
  CalendarPlus,
  BusFront,
  CircleDashed,
  Check,
  ChevronDown,
  Clock3,
  RefreshCw,
  Route,
  TriangleAlert,
  Footprints,
  LocateFixed,
} from "lucide-react";
import { ApiError, useRouteStops } from "../api";
import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  countdown,
  countdownLabel,
  distanceLabel,
  minutesLabel,
  timeLabel,
  towards,
} from "../i18n";
import { usePlaceName } from "../lib/placeNames";
import { busPosition, stopsUntil } from "../lib/tracking";
import { OccupancyMeter } from "./OccupancyBadge";
import { RouteChip } from "./RouteChip";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { Notice } from "./ui/Notice";
import {
  colomboDate,
  findLiveBus,
  hasAssignedBus,
  isOnRide,
  stopName,
} from "../types";
import type {
  JourneyOption,
  JourneyPlan,
  Language,
  Leg,
  LiveBus,
  Move,
  Ride,
  Stop,
} from "../types";

interface JourneyResultsProps {
  plan: JourneyPlan | undefined;
  loading: boolean;
  error: Error | null;
  language: Language;
  selected: JourneyOption | null;
  onSelect: (option: JourneyOption | null) => void;
  onRetry: () => void;
  /** Search the same trip on the day after `plan.date`. */
  onNextDay: () => void;
  routeColors: ReadonlyMap<string, string>;
  liveBuses: readonly LiveBus[];
  onShowBus: (bus: LiveBus) => void;
  /** Follow a live bus on this ride through to the stop you get off at. */
  onTrack?: (option: JourneyOption, ride: Ride, bus: LiveBus) => void;
}

const PAGE_SIZE = 5;
// Rupees with Western digits, as printed on Sri Lankan tickets in every language.
const FARE_FORMAT = new Intl.NumberFormat("en-LK", {
  maximumFractionDigits: 2,
});

// How often the list re-checks which departures have already gone, which also
// keeps the countdowns current.
const CLOCK_TICK_MS = 15_000;

const STATE = "mt-5";
// Each step's icon is joined to the next by a dotted line.
const LEG =
  "relative flex gap-3 pb-5 not-last:after:absolute not-last:after:top-10 not-last:after:bottom-1 not-last:after:left-4 not-last:after:border-l-2 not-last:after:border-dotted not-last:after:border-line-strong";
const LEG_ICON =
  "grid size-8 shrink-0 place-items-center rounded-md bg-tint-100 text-brand";
const LEG_TEXT = "mb-1 text-base leading-relaxed";
const LEG_META = "mb-1 text-sm leading-relaxed text-muted";
const LEG_LIVE = "mb-1 text-sm leading-relaxed font-semibold text-brand";

export function journeyKey(option: JourneyOption): string {
  return [
    option.departure_time,
    option.arrival_time,
    ...option.legs.map((leg) =>
      leg.kind === "ride"
        ? `${leg.ride.route.code}:${leg.ride.direction_id}:${leg.ride.slot_id ?? ""}:${leg.ride.bus?.id ?? leg.ride.bus?.registration_number ?? ""}:${leg.ride.board.id}:${leg.ride.alight.id}`
        : `move:${leg.move.from_stop.id}:${leg.move.to_stop.id}`,
    ),
  ].join("|");
}

function scheduledTime(i18n: I18n, value: string | undefined): string {
  return value && Number.isFinite(Date.parse(value))
    ? timeLabel(i18n, value)
    : t(i18n)`Time unavailable`;
}

function knownNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function hasLiveEstimate(
  stop: Ride["board"],
): stop is Ride["board"] & { estimated_time: string } {
  return stop.time_status === "live" && !!stop.estimated_time;
}

// A live estimate replaces the timetable once the operator reports one.
function boardTime(option: JourneyOption): number {
  const firstRide = option.legs.find((leg) => leg.kind === "ride");
  const board = firstRide?.kind === "ride" ? firstRide.ride.board : undefined;
  const live =
    board && hasLiveEstimate(board)
      ? Date.parse(board.estimated_time)
      : Number.NaN;
  return Number.isFinite(live) ? live : Date.parse(option.departure_time);
}

function stopTime(stop: Ride["board"]): string | undefined {
  return hasLiveEstimate(stop) ? stop.estimated_time : stop.scheduled_time;
}

/** The first ride whose assigned bus is live and running it now. */
function liveRide(
  option: JourneyOption,
  liveBuses: readonly LiveBus[],
  now: number,
): { ride: Ride; bus: LiveBus } | undefined {
  for (const leg of option.legs) {
    if (leg.kind !== "ride") continue;
    const bus = findLiveBus(liveBuses, leg.ride.bus);
    if (bus && isOnRide(bus, leg.ride, now)) return { ride: leg.ride, bus };
  }
  return undefined;
}

/**
 * How many stops the bus makes until it reaches `boardId`, on the direction's
 * full stop list: 1 when it is next, 0 while the bus is there, negative once
 * it has passed, null when the stop isn't on the list.
 */
export function stopsAway(
  bus: Pick<LiveBus, "lat" | "lng">,
  stops: readonly Stop[],
  boardId: string,
): number | null {
  const board = stops.findIndex((stop) => stop.id === boardId);
  const position = busPosition(bus, stops);
  if (board < 0 || position === null) return null;
  return stopsUntil(position, board);
}

/** The option to mark "Next bus": the soonest one still to leave today. */
export function nextBusIndex(
  options: readonly JourneyOption[],
  isToday: boolean,
  now: number,
): number {
  if (!isToday) return -1;
  let soonest = -1;
  options.forEach((option, index) => {
    const time = boardTime(option);
    if (time >= now && (soonest < 0 || time < boardTime(options[soonest])))
      soonest = index;
  });
  return soonest;
}

function fareLabel(i18n: I18n, totalFare: JourneyOption["total_fare"]): string {
  if (!totalFare.complete || !knownNumber(totalFare.full_amount))
    return t(i18n)`Fare unavailable`;
  const fare = FARE_FORMAT.format(totalFare.full_amount);
  return totalFare.category_assumed
    ? t(i18n)`Fare · Rs. ${fare} (estimate)`
    : t(i18n)`Fare · Rs. ${fare}`;
}

// The planner returns back-to-back rides without a walking leg when the
// change happens at the same stop.
function ChangeLeg({
  from,
  to,
  language,
}: {
  from: Ride;
  to: Ride;
  language: Language;
}) {
  const arrive = Date.parse(stopTime(from.alight) ?? "");
  const depart = Date.parse(stopTime(to.board) ?? "");
  const wait = (depart - arrive) / 60_000;
  const { t, i18n } = useLingui();
  const changeName = stopName(to.board, language);
  const waitLabel = knownNumber(wait) ? minutesLabel(i18n, wait) : "";
  return (
    <li className={LEG}>
      <span className={LEG_ICON}>
        <ArrowRightLeft size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 [&_strong]:font-semibold">
        <strong>{t`Change bus at ${changeName}`}</strong>
        {knownNumber(wait) && (
          <p className={LEG_META}>{t`Wait about ${waitLabel}`}</p>
        )}
      </div>
    </li>
  );
}

function WalkLeg({ move, language }: { move: Move; language: Language }) {
  const { t, i18n } = useLingui();
  const fromName = stopName(move.from_stop, language);
  const toName = stopName(move.to_stop, language);
  const minutes = move.estimated_minutes;
  const distance = move.distance_meters;
  return (
    <li className={LEG}>
      <span className={LEG_ICON}>
        <Footprints size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 [&_strong]:font-semibold">
        <strong>{t`Walk`}</strong>
        <p className={LEG_TEXT}>
          <Trans>From {fromName}</Trans>
        </p>
        <p className={LEG_TEXT}>
          <Trans>To {toName}</Trans>
        </p>
        {(knownNumber(minutes) || knownNumber(distance)) && (
          <p className={LEG_META}>
            {knownNumber(minutes) && minutesLabel(i18n, minutes)}
            {knownNumber(minutes) && knownNumber(distance) && " · "}
            {knownNumber(distance) && distanceLabel(i18n, distance)}
          </p>
        )}
      </div>
    </li>
  );
}

/** The live estimate for a stop when there is one, else its timetable time. */
function StopTimeLine({
  stop,
  scheduledLabel,
  liveLabel,
}: {
  stop: Ride["board"];
  scheduledLabel: string;
  liveLabel: string;
}) {
  const { i18n } = useLingui();
  if (hasLiveEstimate(stop)) {
    return (
      <p className={LEG_LIVE}>
        {liveLabel}: {scheduledTime(i18n, stop.estimated_time)}
      </p>
    );
  }
  if (!stop.scheduled_time) return null;
  return (
    <p className={LEG_META}>
      {scheduledLabel}: {scheduledTime(i18n, stop.scheduled_time)}
    </p>
  );
}

function LiveBusButton({
  bus,
  onRide,
  onShowBus,
  onTrack,
}: {
  bus: LiveBus;
  onRide: boolean;
  onShowBus: (bus: LiveBus) => void;
  onTrack?: () => void;
}) {
  const { t } = useLingui();
  if (onRide && onTrack) {
    // Tracking leads; a plain look at the map stays one tap away.
    return (
      <>
        <Button variant="bus" size="xs" pill onClick={onTrack}>
          <span
            className="size-2 shrink-0 animate-follow-pulse rounded-full bg-white"
            aria-hidden="true"
          />
          {t`Track this bus`}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          pill
          onClick={() => onShowBus(bus)}
        >
          {t`Show on map`}
          <LocateFixed size={14} aria-hidden="true" />
        </Button>
      </>
    );
  }
  if (onRide) {
    return (
      <Button variant="secondary" size="xs" pill onClick={() => onShowBus(bus)}>
        <span
          className="size-2 shrink-0 animate-follow-pulse rounded-full bg-brand"
          aria-hidden="true"
        />
        {t`Live · show on map`}
        <LocateFixed size={14} aria-hidden="true" />
      </Button>
    );
  }
  // Live, but still on another run. Say so, rather than let someone watch it
  // head the other way thinking it's theirs.
  return (
    <Button variant="neutral" size="xs" pill onClick={() => onShowBus(bus)}>
      {t`On another trip now · see where`}
    </Button>
  );
}

interface RideDisplayProps {
  routeColors: ReadonlyMap<string, string>;
  liveBuses: readonly LiveBus[];
  onShowBus: (bus: LiveBus) => void;
  onTrack?: (ride: Ride, bus: LiveBus) => void;
  now: number;
}

function RideLeg({
  ride,
  language,
  routeColors,
  liveBuses,
  onShowBus,
  onTrack,
  now,
}: { ride: Ride; language: Language } & RideDisplayProps) {
  const { t, i18n } = useLingui();
  const place = usePlaceName();
  const liveBus = findLiveBus(liveBuses, ride.bus);
  const onRide = !!liveBus && isOnRide(liveBus, ride, now);
  const boardName = stopName(ride.board, language);
  const alightName = stopName(ride.alight, language);
  return (
    <li className={LEG}>
      <span className={LEG_ICON}>
        <BusFront size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 [&_strong]:font-semibold">
        <p className="mb-2.5 text-base leading-relaxed">
          <RouteChip
            code={ride.route.code}
            color={routeColors.get(ride.route.code)}
            size="sm"
          />{" "}
          <strong>{towards(i18n, place(ride.end_location))}</strong>
        </p>
        {!hasAssignedBus(ride) && (
          <p className="mb-2 flex items-center gap-1.5 text-sm leading-relaxed text-muted">
            <CircleDashed size={15} aria-hidden="true" />
            {t`No bus assigned yet, so it can't be followed live.`}
          </p>
        )}
        {ride.bus?.registration_number && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-sm leading-relaxed text-muted">
              {t`Assigned bus`}:{" "}
              <strong className="text-ink">
                {ride.bus.registration_number}
              </strong>
            </p>
            {liveBus && (
              <LiveBusButton
                bus={liveBus}
                onRide={onRide}
                onShowBus={onShowBus}
                onTrack={onTrack && (() => onTrack(ride, liveBus))}
              />
            )}
          </div>
        )}
        <p className={LEG_TEXT}>
          <Trans>
            <strong>Get on at</strong> {boardName}
          </Trans>
        </p>
        <StopTimeLine
          stop={ride.board}
          scheduledLabel={t`Scheduled departure`}
          liveLabel={t`Live departure estimate`}
        />
        <ArrowDown className="my-1 text-faint" size={16} aria-hidden="true" />
        <p className={LEG_TEXT}>
          <Trans>
            <strong>Get off at</strong> {alightName}
          </Trans>
        </p>
        <StopTimeLine
          stop={ride.alight}
          scheduledLabel={t`Scheduled arrival`}
          liveLabel={t`Live arrival estimate`}
        />
        {knownNumber(ride.travel_minutes) && (
          <p className={LEG_META}>{minutesLabel(i18n, ride.travel_minutes)}</p>
        )}
      </div>
    </li>
  );
}

/** Each leg in order, with a change step between back-to-back rides. */
function JourneySteps({
  option,
  language,
  ...rideProps
}: { option: JourneyOption; language: Language } & RideDisplayProps) {
  const { t } = useLingui();
  return (
    <ol className="p-0" aria-label={t`Journey steps`}>
      {option.legs.flatMap((leg, legIndex) => {
        const previous = option.legs[legIndex - 1];
        const change =
          leg.kind === "ride" && previous?.kind === "ride" ? (
            <ChangeLeg
              from={previous.ride}
              to={leg.ride}
              language={language}
              key={`change-${legIndex}`}
            />
          ) : null;
        return [
          change,
          <JourneyLeg
            leg={leg}
            language={language}
            {...rideProps}
            key={legIndex}
          />,
        ];
      })}
    </ol>
  );
}

function JourneyLeg({
  leg,
  language,
  ...rideProps
}: { leg: Leg; language: Language } & RideDisplayProps) {
  return leg.kind === "move" ? (
    <WalkLeg move={leg.move} language={language} />
  ) : (
    <RideLeg ride={leg.ride} language={language} {...rideProps} />
  );
}

/** "● Bus live · 3 stops away", with how full it is. */
function LiveStatus({ ride, bus }: { ride: Ride; bus: LiveBus }) {
  const { t } = useLingui();
  const route = useRouteStops(ride.route.code, ride.direction_id);
  const away = route.data
    ? stopsAway(bus, route.data.stops, ride.board.id)
    : null;
  return (
    <span className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 font-semibold text-bus">
        <span
          className="size-2 shrink-0 animate-follow-pulse rounded-full bg-bus"
          aria-hidden="true"
        />
        {t`Bus live`}
        {away !== null && away >= 0 && (
          <>
            <span aria-hidden="true">·</span>
            {away === 0 ? (
              t`At your stop`
            ) : (
              <Plural value={away} one="# stop away" other="# stops away" />
            )}
          </>
        )}
      </span>
      <OccupancyMeter bus={bus} />
    </span>
  );
}

/**
 * One journey: a summary button that expands to its steps. The steps only
 * render while the card is selected.
 */
function JourneyCard({
  option,
  cardId,
  detailsId,
  isSelected,
  isToday,
  isNext,
  onToggle,
  language,
  ...rideProps
}: {
  option: JourneyOption;
  cardId: string;
  detailsId: string;
  isSelected: boolean;
  /** Countdowns only make sense for today's departures. */
  isToday: boolean;
  isNext: boolean;
  onToggle: () => void;
  language: Language;
} & RideDisplayProps) {
  const { t, i18n } = useLingui();
  const { routeColors, liveBuses, now } = rideProps;
  const routes = option.legs.flatMap((leg) =>
    leg.kind === "ride" ? [leg.ride.route.code] : [],
  );
  const live = liveRide(option, liveBuses, now);
  // A ride without a bus yet may still run, but can't be followed live.
  const unassigned = option.legs.some(
    (leg) => leg.kind === "ride" && !hasAssignedBus(leg.ride),
  );
  const firstRide = option.legs.find((leg) => leg.kind === "ride");
  const liveEstimate =
    firstRide?.kind === "ride" && hasLiveEstimate(firstRide.ride.board);
  // The countdown and the clock both follow the live estimate when there is
  // one, so they never disagree.
  const departs = boardTime(option);
  const departure = Number.isFinite(departs)
    ? new Date(departs).toISOString()
    : option.departure_time;
  const lead =
    isToday && Number.isFinite(departs) ? countdown(departs, now) : null;
  const leadText = lead && countdownLabel(i18n, lead);
  const times = (
    <>
      <span>{scheduledTime(i18n, departure)}</span>
      <ArrowRight size={leadText ? 14 : 18} aria-hidden="true" />
      <span>{scheduledTime(i18n, option.arrival_time)}</span>
    </>
  );
  const timeSource = liveEstimate ? t`Live estimate` : t`Scheduled`;
  return (
    <li
      className={`overflow-hidden ${cardClass({ selected: isSelected, tentative: unassigned })}`}
      id={cardId}
    >
      <button
        type="button"
        className="block min-h-11 w-full px-4 pt-3.5 pb-3 text-left"
        aria-expanded={isSelected}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        {isNext && (
          <Badge tone="soon" className="mb-1.5">
            {t`Next bus`}
          </Badge>
        )}
        {leadText ? (
          <span
            className={`block text-2xl font-semibold tracking-tight max-md:text-xl ${lead?.kind === "left" ? "text-muted" : ""}`}
          >
            {leadText}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-2xl font-semibold tracking-tight max-md:text-xl [&>svg]:text-faint">
            {times}
          </span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted [&>svg]:text-faint">
          {leadText && (
            <>
              {times}
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className={liveEstimate ? "font-semibold text-bus" : ""}>
            {timeSource}
          </span>
        </span>
        {live && <LiveStatus ride={live.ride} bus={live.bus} />}
        <span className="mt-3 flex flex-wrap items-center gap-2">
          <span className="flex flex-wrap gap-1">
            {routes.map((route, routeIndex) => (
              <RouteChip
                key={`${route}-${routeIndex}`}
                code={route}
                color={routeColors.get(route)}
                size="sm"
              />
            ))}
          </span>
          {unassigned && (
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-2xs font-semibold text-muted">
              <CircleDashed size={12} aria-hidden="true" />
              {t`No bus assigned yet`}
            </span>
          )}
          <span className="text-2xs text-muted">
            <Plural
              value={option.transfers}
              _0="Direct · no bus change"
              _1="Change bus once"
              other="Change bus # times"
            />
          </span>
        </span>
        <span className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>
            {fareLabel(i18n, option.total_fare)}
            <span aria-hidden="true"> · </span>
            {knownNumber(option.total_minutes)
              ? minutesLabel(i18n, option.total_minutes)
              : t`Duration unavailable`}
          </span>
          <span className="flex items-center gap-1 text-2xs">
            {isSelected ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )}
            {t`Journey steps`}
          </span>
        </span>
      </button>
      <div
        id={detailsId}
        className="border-t border-line bg-tint-50 px-4 pt-4 pb-2"
        hidden={!isSelected}
      >
        {isSelected && (
          <JourneySteps option={option} language={language} {...rideProps} />
        )}
      </div>
    </li>
  );
}

export default function JourneyResults({
  plan,
  loading,
  error,
  language,
  selected,
  onSelect,
  onRetry,
  onNextDay,
  routeColors,
  liveBuses,
  onShowBus,
  onTrack,
}: JourneyResultsProps) {
  const id = useId();
  const { t } = useLingui();
  const [now, setNow] = useState(Date.now);
  const [pagination, setPagination] = useState<{
    plan: JourneyPlan | undefined;
    count: number;
  }>({ plan, count: PAGE_SIZE });
  const visibleCount = pagination.plan === plan ? pagination.count : PAGE_SIZE;
  const today = colomboDate(now);
  const options = useMemo(() => {
    if (!plan) return [];
    return plan.options
      .filter((option) => plan.date > today || boardTime(option) >= now)
      .sort((a, b) => boardTime(a) - boardTime(b));
  }, [plan, today, now]);

  // A departure that has passed drops out of the list; release it from the map too.
  useEffect(() => {
    if (
      selected &&
      plan &&
      !options.some((option) => journeyKey(option) === journeyKey(selected))
    )
      onSelect(null);
  }, [selected, plan, options, onSelect]);

  const selectedIndex = selected
    ? options.findIndex((option) => journeyKey(option) === journeyKey(selected))
    : -1;
  useEffect(() => {
    if (selectedIndex < 0) return;
    document
      .getElementById(`${id}-card-${selectedIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [id, selectedIndex]);

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, CLOCK_TICK_MS);
    window.addEventListener("focus", updateClock);
    document.addEventListener("visibilitychange", updateClock);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateClock);
      document.removeEventListener("visibilitychange", updateClock);
    };
  }, [plan]);

  useEffect(() => {
    if (plan?.date !== today || options.length === 0) return;
    const nextDeparture = boardTime(options[0]);
    if (!Number.isFinite(nextDeparture)) return;
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(1, nextDeparture - Date.now() + 1),
    );
    return () => window.clearTimeout(timeout);
  }, [plan, today, options]);

  const remaining = options.length - visibleCount;
  const isToday = plan?.date === today;
  const nextIndex = nextBusIndex(options, isToday, now);

  if (loading) {
    return (
      <Notice
        className={STATE}
        icon={<Clock3 size={26} aria-hidden="true" />}
        title={t`Finding scheduled journeys…`}
      >
        {t`Please wait a moment.`}
      </Notice>
    );
  }
  if (error instanceof ApiError && error.status === 400) {
    return (
      <Notice
        tone="danger"
        role="alert"
        className={STATE}
        icon={<TriangleAlert size={26} aria-hidden="true" />}
        title={t`This trip can’t be planned`}
      >
        {t`Check both stops and choose today or a later date.`}
      </Notice>
    );
  }
  if (error) {
    return (
      <Notice
        tone="danger"
        role="alert"
        className={STATE}
        icon={<TriangleAlert size={26} aria-hidden="true" />}
        title={t`Could not load journeys`}
        action={
          <Button size="sm" onClick={onRetry}>
            <RefreshCw size={18} aria-hidden="true" />
            {t`Try again`}
          </Button>
        }
      >
        {t`Check your connection and try again.`}
      </Notice>
    );
  }
  if (!plan) {
    return (
      <Notice
        className={STATE}
        icon={<Route size={26} aria-hidden="true" />}
        title={t`Where would you like to go?`}
      >
        {t`Choose your starting stop and destination to find a journey.`}
      </Notice>
    );
  }
  if (!options.length) {
    const expiredToday = plan.date === today && plan.options.length > 0;
    return (
      <Notice
        className={STATE}
        icon={<Clock3 size={26} aria-hidden="true" />}
        title={
          expiredToday
            ? t`No more scheduled departures today`
            : t`No scheduled journeys found`
        }
        action={
          <Button size="sm" onClick={onNextDay}>
            <CalendarPlus size={18} aria-hidden="true" />
            {expiredToday ? t`Show tomorrow’s buses` : t`Show the next day`}
          </Button>
        }
      >
        {t`Try the next day or different stops.`}
      </Notice>
    );
  }

  return (
    <section className="mt-6" aria-labelledby={`${id}-heading`}>
      <div className="flex items-center justify-between gap-2.5">
        <h3 id={`${id}-heading`} className="text-xl font-semibold">
          {t`Buses for your trip`}
        </h3>
        <Badge>
          <Plural value={options.length} one="# option" other="# options" />
        </Badge>
      </div>
      <ol className="mt-4 flex flex-col gap-3">
        {options.slice(0, visibleCount).map((option, index) => {
          const key = journeyKey(option);
          const isSelected = selected !== null && journeyKey(selected) === key;
          return (
            <JourneyCard
              key={key}
              option={option}
              cardId={`${id}-card-${index}`}
              detailsId={`${id}-steps-${index}`}
              isSelected={isSelected}
              isToday={isToday}
              isNext={index === nextIndex}
              onToggle={() => onSelect(isSelected ? null : option)}
              language={language}
              routeColors={routeColors}
              liveBuses={liveBuses}
              onShowBus={onShowBus}
              onTrack={onTrack && ((ride, bus) => onTrack(option, ride, bus))}
              now={now}
            />
          );
        })}
      </ol>
      {remaining > 0 && (
        <Button
          size="sm"
          block
          className="mt-4"
          onClick={() =>
            setPagination({ plan, count: visibleCount + PAGE_SIZE })
          }
        >
          <ChevronDown size={18} aria-hidden="true" />
          {t`Show more journeys (${remaining} more)`}
        </Button>
      )}
      <p className="mt-4 text-xs text-muted">{t`All times are Sri Lanka time.`}</p>
    </section>
  );
}
