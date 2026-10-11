import { ArrowRight, BusFront, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { towards } from "../i18n";
import { liveSignal, type FollowState } from "../lib/follow";
import { followStatus } from "../lib/followLabels";
import { usePlaceName } from "../lib/placeNames";
import { useTransitData } from "../state/TransitData";
import { busDirection, occupancy, type LiveBus } from "../types";
import { OccupancyMeter } from "./OccupancyBadge";
import { RouteChip } from "./RouteChip";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

/** The bus being tracked: who it is, where it's going and how full it is. */
export function FollowBusPill({
  bus,
  state,
  onFollow,
  onRelease,
}: {
  bus: LiveBus;
  state: FollowState;
  onFollow: () => void;
  onRelease: () => void;
}) {
  const { i18n, t } = useLingui();
  const { routes, routeColors } = useTransitData();
  const place = usePlaceName();
  const route = routes.find((item) => item.code === bus.route_code);
  const destination = busDirection(route, bus.direction_id)?.end_location;

  return (
    <div
      // On phones it rides just above the drawer.
      className="absolute top-3.5 left-1/2 z-10 flex max-w-[68%] -translate-x-1/2 items-center gap-3 rounded-2xl bg-card py-2 pr-2 pl-3.5 text-ink shadow-float max-md:top-auto max-md:bottom-[calc(var(--drawer-inset,0px)+12px)] max-md:w-[calc(100%-24px)] max-md:max-w-none"
      role="group"
      aria-label={t`Tracked bus`}
    >
      {liveSignal(state) ? (
        <span
          className="size-3 shrink-0 animate-follow-pulse rounded-full bg-brand"
          aria-hidden="true"
        />
      ) : (
        <BusFront className="shrink-0 text-bus" size={18} aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="min-w-0 truncate text-muted" aria-live="polite">
            {followStatus(i18n, state)}
          </span>
          <strong className="shrink-0 font-semibold">
            {bus.registration_number || "—"}
          </strong>
          {bus.route_code && (
            <RouteChip
              code={bus.route_code}
              color={routeColors.get(bus.route_code)}
              size="xs"
            />
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
  );
}
