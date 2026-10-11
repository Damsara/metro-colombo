import { useMemo } from "react";
import { BusFront } from "lucide-react";
import {
  busKey,
  resolveBusDirectionId,
  type LiveBus,
  type Route,
} from "../types";
import { useLingui } from "@lingui/react/macro";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { OccupancyBadge } from "./OccupancyBadge";

const EMPTY = "text-xs leading-normal text-muted";

export default function LiveBusList({
  buses,
  selectedBusId,
  route,
  directionId,
  unavailable,
  onBusSelect,
  onShowOtherDirection,
}: {
  buses: LiveBus[];
  selectedBusId: string | null;
  route: Route;
  directionId?: string | null;
  /** The live feed is unreachable or disconnected. */
  unavailable: boolean;
  onBusSelect: (bus: LiveBus | null) => void;
  onShowOtherDirection: () => void;
}) {
  const { t } = useLingui();
  const onRoute = useMemo(
    () => buses.filter((bus) => bus.route_code === route.code),
    [buses, route.code],
  );
  const filtered = useMemo(
    () =>
      onRoute.filter((bus) => {
        if (!directionId || !bus.direction_id) return true;
        return resolveBusDirectionId(route, bus.direction_id) === directionId;
      }),
    [onRoute, directionId, route],
  );
  const elsewhere = onRoute.length - filtered.length;
  const selected = selectedBusId
    ? (filtered.find((bus) => busKey(bus) === selectedBusId) ?? null)
    : null;
  const selectedLabel = selected?.registration_number || t`Bus`;

  return (
    <section aria-label={t`Live buses on this route`}>
      <div className="mb-2 flex items-center gap-2 text-ink">
        <BusFront className="text-live" size={15} aria-hidden="true" />
        <strong className="flex-1 text-sm font-bold">
          {t`Live on this direction`}
        </strong>
        <Badge>{filtered.length}</Badge>
      </div>

      {unavailable ? (
        <p className={EMPTY} role="status">
          {t`Live bus positions are unavailable right now. Timetables still work.`}
        </p>
      ) : filtered.length === 0 ? (
        <p className={EMPTY} role="status">
          {elsewhere > 0 ? (
            <>
              {t`None heading this way right now · ${elsewhere} on the other direction`}{" "}
              <Button
                variant="link"
                className="text-ink"
                onClick={onShowOtherDirection}
              >
                {t`Show that direction`}
              </Button>
            </>
          ) : (
            t`No buses reporting here right now.`
          )}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {filtered.map((bus) => {
            const key = busKey(bus);
            const isSelected = key !== "" && key === selectedBusId;
            const label = bus.registration_number || t`Bus`;
            return (
              <li key={key || `${bus.lat}:${bus.lng}`}>
                <button
                  type="button"
                  className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-line bg-card px-3 text-sm text-ink aria-pressed:border-brand aria-pressed:bg-tint-100 aria-pressed:ring-1 aria-pressed:ring-brand aria-pressed:ring-inset hover-fine:not-aria-pressed:bg-tint-50"
                  aria-pressed={isSelected}
                  onClick={() => onBusSelect(isSelected ? null : bus)}
                >
                  <span className="max-w-[14ch] truncate font-semibold">
                    {label}
                  </span>
                  <OccupancyBadge bus={bus} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <p className="mt-2.5 text-xs leading-normal text-muted">
          {t`${selectedLabel} is selected. Tap it again to stop following.`}
        </p>
      )}
    </section>
  );
}
