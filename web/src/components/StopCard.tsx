import { ArrowRight, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { stopName, type Language, type Stop } from "../types";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { Eyebrow } from "./ui/Eyebrow";
import { IconButton } from "./ui/IconButton";

// Over the map beside the legend, or on phones just above the drawer.
const PLACEMENT =
  "absolute right-7.5 bottom-19 w-80 max-w-[calc(100%-60px)] shadow-card max-lg:right-5 max-lg:bottom-56 max-md:inset-x-3 max-md:bottom-[calc(var(--drawer-inset,0px)+12px)] max-md:w-auto max-md:max-w-none";

/** A selected stop, with actions to start or end a trip there. */
export function StopCard({
  stop,
  language,
  onClose,
  onChoose,
}: {
  stop: Stop;
  language: Language;
  onClose: () => void;
  onChoose: (target: "from" | "to") => void;
}) {
  const { t } = useLingui();
  return (
    <div
      className={`z-20 p-5 ${cardClass()} ${PLACEMENT}`}
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
      <Eyebrow>{t`Bus stop`}</Eyebrow>
      <h2 className="my-1.5 pr-10 text-2xl">{stopName(stop, language)}</h2>
      <p className="mb-4 text-xs text-muted">{stop.stop_code}</p>
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
          <ArrowRight size={17} />
        </Button>
      </div>
    </div>
  );
}
