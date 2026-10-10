import { BusFront } from "lucide-react";
import { useLingui } from "@lingui/react/macro";

const LEGEND_ITEM = "flex items-center gap-1.5";

/** The key in the map's corner. */
export function MapLegend({
  showLive,
  hidden,
}: {
  showLive: boolean;
  hidden: boolean;
}) {
  const { t } = useLingui();
  return (
    // Screen readers get the map key from MapView.
    <div
      className={`absolute bottom-7.5 left-7.5 flex items-center gap-4 rounded-md border border-line bg-card/95 px-4 py-2.5 text-2xs text-muted max-md:inset-x-4 max-md:bottom-6 max-md:justify-center max-md:gap-6 ${
        hidden ? "hidden" : ""
      }`}
      aria-hidden="true"
    >
      <span className={LEGEND_ITEM}>
        <i
          className="size-2.5 rounded-full border-2 border-ink bg-card"
          aria-hidden="true"
        />
        {t`Bus stop`}
      </span>
      {showLive && (
        <span className={LEGEND_ITEM}>
          <BusFront
            className="size-5 shrink-0 rounded-full bg-bus/15 p-0.5 text-bus"
            size={16}
            aria-hidden="true"
          />
          {t`Live bus`}
        </span>
      )}
      <span className={`${LEGEND_ITEM} max-lg:hidden`}>
        {showLive
          ? t`Tap a stop to plan · tap a bus to follow`
          : t`Tap a stop to plan a trip`}
      </span>
    </div>
  );
}
