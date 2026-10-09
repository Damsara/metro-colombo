import { ArrowRight, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { stopName, type Language, type Stop } from "../types";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { Eyebrow } from "./ui/Eyebrow";
import { IconButton } from "./ui/IconButton";

const PLACEMENT = {
  // Over the map, beside the legend.
  map: "absolute right-7.5 bottom-19 w-80 max-w-[calc(100%-60px)] shadow-card max-lg:right-5 max-lg:bottom-56 max-md:inset-x-4 max-md:bottom-52 max-md:w-auto max-md:max-w-none",
  // Over the trip panel on phones, dimming the page behind it.
  panel:
    "fixed inset-x-4 bottom-20 hidden shadow-[0_0_0_100vmax_#21362d35,var(--shadow-card)] max-md:block",
  // Pinned to the bottom of the full-screen phone map.
  immersive:
    "absolute inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] max-h-[min(42vh,320px)] overflow-y-auto overscroll-contain shadow-card",
};

/** A selected stop, with actions to start or end a trip there. */
export function StopCard({
  stop,
  language,
  placement,
  immersive = false,
  onClose,
  onChoose,
}: {
  stop: Stop;
  language: Language;
  placement: keyof typeof PLACEMENT;
  immersive?: boolean;
  onClose: () => void;
  onChoose: (target: "from" | "to") => void;
}) {
  const { t } = useLingui();
  const onMap = placement === "map";
  return (
    <div
      className={`z-20 p-5 ${cardClass()} ${PLACEMENT[immersive ? "immersive" : placement]}`}
      role="dialog"
      aria-label={stopName(stop, language)}
    >
      <IconButton
        variant="plain"
        className="absolute top-3 right-3"
        label={t`Close stop details`}
        onClick={onClose}
      >
        <X size={19} />
      </IconButton>
      {onMap && <Eyebrow>{t`Bus stop`}</Eyebrow>}
      <h2 className="my-1.5 pr-10 text-2xl">{stopName(stop, language)}</h2>
      {onMap && <p className="mb-4 text-xs text-muted">{stop.stop_code}</p>}
      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={() => onChoose("from")}>
          {t`Start here`}
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => onChoose("to")}
        >
          {t`Go here`}
          {onMap && <ArrowRight size={17} />}
        </Button>
      </div>
    </div>
  );
}
