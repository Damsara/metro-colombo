import { useEffect, useId, useRef } from "react";
import { ArrowRight, ExternalLink, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { towards } from "../i18n";
import { usePlaceName } from "../lib/placeNames";
import {
  googleMapsUrl,
  secondaryStopName,
  servedBy,
  stopActions,
  type StopTarget,
} from "../lib/stopCard";
import { stopName, type CatalogStop, type Language, type Stop } from "../types";
import { RouteChip } from "./RouteChip";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { IconButton } from "./ui/IconButton";

// Over the map beside the legend. Phones show the card in the drawer instead.
const FLOATING = `absolute right-7.5 bottom-19 z-20 w-84 max-w-[calc(100%-60px)] p-5 shadow-card max-lg:right-5 max-lg:bottom-56 ${cardClass()}`;

/**
 * A selected stop: its names, the routes calling there and where they go,
 * and actions to start or end a trip there. The action that finishes a
 * half-planned trip leads.
 */
export function StopCard({
  stop,
  entry,
  language,
  routeColors,
  from,
  to,
  inline = false,
  focusHeading = false,
  onClose,
  onChoose,
}: {
  stop: Stop;
  /** The stop's catalog entry, which knows the routes calling there. */
  entry: CatalogStop | undefined;
  language: Language;
  routeColors: ReadonlyMap<string, string>;
  from: Stop | null;
  to: Stop | null;
  /** In the phone's drawer rather than floating over the map. */
  inline?: boolean;
  /** Move focus to the stop's name, for a card opened from the keyboard. */
  focusHeading?: boolean;
  onClose: () => void;
  /** `search` is set when the choice completes the trip. */
  onChoose: (target: StopTarget, search: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const place = usePlaceName();
  const headingId = useId();
  const servedId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Where focus was when the card opened, to go back to on close.
  const opener = useRef<Element | null>(null);

  const name = stopName(stop, language);
  const secondary = secondaryStopName(stop, language);
  const routes = servedBy(entry?.services, stop.stop_name_en);
  const actions = stopActions(stop, from, to);
  const secondaryAction: StopTarget = actions.primary === "to" ? "from" : "to";
  const label = { from: t`Start here`, to: t`Go here` };

  const dismiss = () => {
    const target = opener.current;
    onClose();
    // After the close renders: on phones the opener was hidden under the card.
    requestAnimationFrame(() => {
      if (target instanceof HTMLElement && target.isConnected)
        target.focus({ preventScroll: true });
    });
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    // Kept from the first run: a second (Strict Mode) run would find the
    // heading focused.
    opener.current ??= document.activeElement;
    if (focusHeading) heading.current?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => {
      // The phone drawer's dialog layer marks every Escape as handled, so
      // this doesn't check defaultPrevented.
      if (event.key === "Escape") dismissRef.current();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
    // Each stop gets its own card (keyed by id), so this runs once per stop.
  }, []);

  let completes: { shown: string; spoken: string } | null = null;
  if (actions.completes?.from) {
    const start = stopName(actions.completes.from, language);
    completes = {
      shown: t`From ${start} → here`,
      spoken: t`Trip from ${start} to this stop`,
    };
  } else if (actions.completes?.to) {
    const end = stopName(actions.completes.to, language);
    completes = {
      shown: t`Here → ${end}`,
      spoken: t`Trip from this stop to ${end}`,
    };
  }

  return (
    <section
      className={inline ? "relative px-4 pt-1 pb-6" : FLOATING}
      aria-labelledby={headingId}
    >
      <IconButton
        variant="plain"
        className={`absolute ${inline ? "top-0 right-2" : "top-2.5 right-2.5"}`}
        label={t`Close stop details`}
        onClick={dismiss}
      >
        <X size={19} />
      </IconButton>
      <div className="pr-11">
        <h2
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="text-3xl leading-tight font-semibold tracking-tight outline-none max-md:text-2xl"
        >
          {name}
        </h2>
        {secondary && (
          <p
            lang={language === "en" ? "si" : "en"}
            className="mt-0.5 text-base text-muted"
          >
            {secondary}
          </p>
        )}
        {actions.current && (
          <p className="mt-1 text-xs text-muted">
            {actions.current === "from" ? t`Your start` : t`Your destination`}
          </p>
        )}
        <a
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink underline underline-offset-2"
          href={googleMapsUrl(stop)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t`See on Google Maps`}
          <ExternalLink size={14} aria-hidden="true" />
          <span className="sr-only">{t`(opens in a new tab)`}</span>
        </a>
      </div>

      {completes && (
        <p className="mt-4 text-sm font-semibold">
          <span aria-hidden="true">{completes.shown}</span>
          <span className="sr-only">{completes.spoken}</span>
        </p>
      )}
      <div className={`flex gap-2 ${completes ? "mt-2" : "mt-4"}`}>
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => onChoose(actions.primary, !!actions.completes)}
        >
          {label[actions.primary]}
          <ArrowRight size={17} aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => onChoose(secondaryAction, false)}
        >
          {label[secondaryAction]}
        </Button>
      </div>

      {routes.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 id={servedId} className="text-xs font-semibold text-muted">
            {t`Served by`}
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5" aria-labelledby={servedId}>
            {routes.map(({ route, towards: places }) => {
              const shown = places.map(place);
              const spokenPlaces = shown.join(", ");
              return (
                <li key={route} className="flex min-h-7 items-center gap-2.5">
                  <span aria-hidden="true" className="contents">
                    <RouteChip code={route} color={routeColors.get(route)} />
                    {shown.length > 0 && (
                      <span className="min-w-0 text-sm leading-snug">
                        {towards(i18n, shown.join(" / "))}
                      </span>
                    )}
                  </span>
                  <span className="sr-only">
                    {shown.length
                      ? t`Route ${route} towards ${spokenPlaces}`
                      : t`Route ${route}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
