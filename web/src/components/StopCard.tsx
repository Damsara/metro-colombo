import { useEffect, useId, useRef } from "react";
import { ArrowRight, ChevronRight, ExternalLink, X } from "lucide-react";
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
import {
  nameLanguage,
  stopName,
  type CatalogStop,
  type Language,
  type Stop,
} from "../types";
import { RouteChip } from "./RouteChip";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { IconButton } from "./ui/IconButton";

const FLOATING = `absolute right-7.5 bottom-19 z-20 w-84 max-w-[calc(100%-60px)] p-5 shadow-card max-lg:right-5 max-lg:bottom-56 ${cardClass()}`;

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
  onOpenRoute,
}: {
  stop: Stop;
  entry: CatalogStop | undefined;
  language: Language;
  routeColors: ReadonlyMap<string, string>;
  from: Stop | null;
  to: Stop | null;
  inline?: boolean;
  focusHeading?: boolean;
  onClose: () => void;
  onChoose: (target: StopTarget, search: boolean) => void;
  onOpenRoute: (route: string, towards: readonly string[]) => void;
}) {
  const { t, i18n } = useLingui();
  const place = usePlaceName();
  const headingId = useId();
  const servedId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
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
            lang={nameLanguage(language) === "en" ? "si" : "en"}
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
                <li key={route}>
                  <button
                    type="button"
                    className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 text-left hover-fine:bg-tint-50"
                    onClick={() => onOpenRoute(route, places)}
                  >
                    <span aria-hidden="true" className="contents">
                      <RouteChip code={route} color={routeColors.get(route)} />
                      <span className="min-w-0 flex-1 text-sm leading-snug">
                        {shown.length > 0 && towards(i18n, shown.join(" / "))}
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-faint" />
                    </span>
                    <span className="sr-only">
                      {shown.length
                        ? t`Route ${route} towards ${spokenPlaces}`
                        : t`Route ${route}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
