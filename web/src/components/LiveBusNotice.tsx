import { useMemo } from "react";
import { resolveBusDirectionId, type LiveBus, type Route } from "../types";
import { useLingui } from "@lingui/react/macro";
import { Button } from "./ui/Button";

const NOTICE = "mb-4 text-xs leading-normal text-muted";

// The stop list shows each live bus, so this only speaks up when it can't.
export default function LiveBusNotice({
  buses,
  route,
  directionId,
  unavailable,
  onShowOtherDirection,
}: {
  buses: LiveBus[];
  route: Route;
  directionId?: string | null;
  unavailable: boolean;
  onShowOtherDirection: () => void;
}) {
  const { t } = useLingui();
  const onRoute = useMemo(
    () => buses.filter((bus) => bus.route_code === route.code),
    [buses, route.code],
  );
  const thisWay = useMemo(
    () =>
      onRoute.filter((bus) => {
        if (!directionId || !bus.direction_id) return true;
        return resolveBusDirectionId(route, bus.direction_id) === directionId;
      }).length,
    [onRoute, directionId, route],
  );
  const elsewhere = onRoute.length - thisWay;

  if (unavailable)
    return (
      <p className={NOTICE} role="status">
        {t`Live bus positions are unavailable right now. Timetables still work.`}
      </p>
    );
  if (thisWay > 0) return null;
  return (
    <p className={NOTICE} role="status">
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
  );
}
