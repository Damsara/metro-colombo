import {
  ArrowDownUp,
  ArrowRight,
  LocateFixed,
  MapPin,
  Search,
} from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { colomboDate } from "../types";
import type { CatalogStop, Language, Place } from "../types";
import StopPicker from "./StopPicker";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { Field } from "./ui/Field";
import { IconButton } from "./ui/IconButton";

const HELPER = "pb-3 text-sm leading-relaxed";

/** The trip form: two stops, an optional location lookup and the date. */
export function TripForm({
  from,
  to,
  date,
  onFromChange,
  onToChange,
  onSwap,
  onDateChange,
  onSubmit,
  searching,
  invalidSameStop,
  stops,
  stopsLoading,
  places,
  routeColors,
  language,
  locationBusy,
  locationMessage,
  onLocate,
}: {
  from: CatalogStop | null;
  to: CatalogStop | null;
  date: string;
  onFromChange: (stop: CatalogStop | null) => void;
  onToChange: (stop: CatalogStop | null) => void;
  onSwap: () => void;
  onDateChange: (date: string) => void;
  onSubmit: () => void;
  searching: boolean;
  invalidSameStop: boolean;
  stops: CatalogStop[];
  stopsLoading: boolean;
  places: ReadonlyArray<Place>;
  routeColors: ReadonlyMap<string, string>;
  language: Language;
  locationBusy: boolean;
  /** What the location lookup found, or "" before it runs. */
  locationMessage: string;
  onLocate: () => void;
}) {
  const { t } = useLingui();
  return (
    <form
      className="relative"
      // The submit handler moves a past date to today instead of
      // letting the browser block the search.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div
        className={`relative flex items-stretch gap-2.5 px-3 py-3.5 max-md:gap-2 ${cardClass()}`}
      >
        <div
          className="flex w-6 flex-col items-center pt-5 pb-4 text-green"
          aria-hidden="true"
        >
          <span className="size-3 rounded-full border-2 border-green" />
          <i className="my-1 min-h-12 flex-1 border-l-2 border-dotted border-line-strong" />
          <MapPin size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <StopPicker
            label={t`Starting from`}
            placeholder={t`Type a stop or a place`}
            value={from}
            stops={stops}
            language={language}
            loading={stopsLoading}
            routeColors={routeColors}
            places={places}
            onChange={onFromChange}
          />
          <div className="my-3 mr-7 border-t border-line" />
          <StopPicker
            label={t`Going to`}
            placeholder={t`Where do you want to go?`}
            value={to}
            stops={stops}
            language={language}
            loading={stopsLoading}
            routeColors={routeColors}
            places={places}
            onChange={onToChange}
          />
        </div>
        <IconButton
          variant="tinted"
          className="-ml-2 self-center max-md:-ml-1"
          label={t`Swap starting and destination stops`}
          disabled={!from && !to}
          onClick={onSwap}
        >
          <ArrowDownUp size={19} />
        </IconButton>
      </div>
      <Button
        variant="quiet"
        className="my-1"
        disabled={locationBusy || !stops.length}
        onClick={onLocate}
      >
        <LocateFixed size={17} />
        {locationBusy
          ? t`Finding your location…`
          : t`Use my location for the nearest stop`}
      </Button>
      {locationMessage && (
        <p className={`${HELPER} text-muted`} role="status">
          {locationMessage}
        </p>
      )}
      <Field layout="inline" className="mb-4" label={t`Travel date`}>
        <input
          type="date"
          className="min-h-9 max-w-44 bg-transparent text-ink max-md:min-h-12 max-md:w-full max-md:max-w-none"
          aria-label={t`Travel date`}
          required
          min={colomboDate()}
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
        />
      </Field>
      {invalidSameStop && (
        <p className={`${HELPER} text-danger`} role="alert">
          {t`Choose a different destination from your starting stop.`}
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        block
        align="start"
        type="submit"
        disabled={!from || !to || !date || invalidSameStop}
        // Stays focusable while searching so keyboard focus isn't lost.
        aria-disabled={searching}
      >
        <Search size={20} />
        {searching ? t`Finding your buses…` : t`Find my bus`}
        <ArrowRight size={20} />
      </Button>
    </form>
  );
}
