import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Landmark, MapPin, Search, X } from "lucide-react";
import type { I18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { distanceLabel, towards } from "../i18n";
import { usePlaceName } from "../lib/placeNames";
import { useMediaQuery } from "../lib/useMediaQuery";
import { RouteChip } from "./RouteChip";
import { IconButton } from "./ui/IconButton";
import { placeTitle, stopName } from "../types";
import type { CatalogStop, Language, Place } from "../types";

const OPTION_DETAIL = "mt-0.5 block text-xs text-muted";
const STATUS = "bg-tint-50 px-3 py-2.5 text-2xs leading-normal text-muted";

type Choice = { key: string; stop: CatalogStop; place?: Place };

/** Where the arrow keys land first: the top going down, the bottom going up. */
function startIndex(step: 1 | -1, count: number): number {
  return step === 1 ? 0 : count - 1;
}

function wrapIndex(index: number, count: number): number {
  return (index + count) % count;
}

function walkLabel(i18n: I18n, meters: number): string {
  const distance = distanceLabel(i18n, meters);
  return t(i18n)`${distance} walk`;
}

interface StopPickerProps {
  label: string;
  placeholder: string;
  value: CatalogStop | null;
  stops: CatalogStop[];
  language: Language;
  loading: boolean;
  routeColors: ReadonlyMap<string, string>;
  /** Landmarks, searchable by name; choosing one picks its nearest stop. */
  places: ReadonlyArray<Place>;
  onChange: (stop: CatalogStop | null) => void;
}

export default function StopPicker({
  label,
  placeholder,
  value,
  stops,
  language,
  loading,
  routeColors,
  places,
  onChange,
}: StopPickerProps) {
  const id = useId();
  const { t, i18n } = useLingui();
  const localPlace = usePlaceName();
  const inputId = `${id}-input`;
  const listId = `${id}-choices`;
  const helpId = `${id}-help`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const mobile = useMediaQuery("(max-width: 760px)");
  const query = value ? "" : draft.trim().toLocaleLowerCase();
  const choices = useMemo((): Choice[] => {
    const matches = (names: (string | undefined)[]) =>
      !query || names.some((name) => name?.toLocaleLowerCase().includes(query));
    const stopChoices = stops
      .filter((stop) =>
        matches([
          stop.stop_name_en,
          stop.stop_name_si,
          stop.stop_name_tm,
          stop.stop_code,
        ]),
      )
      .map((stop) => ({ key: stop.id, stop }));
    if (!query) return stopChoices;
    const placeChoices = places.flatMap((place) => {
      if (!matches([place.name, place.name_si, place.name_ta])) return [];
      const stop =
        stops.find((item) => item.ids.includes(place.stop_id)) ??
        stops.find((item) => item.stop_code === place.stop_code);
      return stop ? [{ key: `place-${place.id}`, stop, place }] : [];
    });
    return [...placeChoices, ...stopChoices];
  }, [stops, places, query]);
  const expanded = open;
  const sheetOpen = expanded && mobile;
  const activeStop = activeIndex >= 0 ? choices[activeIndex]?.stop : undefined;

  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => sheetInputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previous;
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!expanded || mobile) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [expanded, mobile]);

  useEffect(() => {
    if (expanded && activeStop) {
      document
        .getElementById(`${listId}-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [expanded, activeIndex, activeStop, listId]);

  function closePicker() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function choose(stop: CatalogStop) {
    setDraft("");
    closePicker();
    onChange(stop);
    // Blur, or onFocus would pop the menu (or the phone sheet) right back open.
    inputRef.current?.blur();
    sheetInputRef.current?.blur();
  }

  const help = loading
    ? t`Loading stops…`
    : choices.length === 0
      ? t`No matching stops. Try another name or stop code.`
      : mobile
        ? t({
            message: plural(choices.length, {
              one: "# stop. Tap one to select.",
              other: "# stops. Tap one to select.",
            }),
          })
        : t({
            message: plural(choices.length, {
              one: "# stop. Use the arrow keys to choose, then press Enter.",
              other: "# stops. Use the arrow keys to choose, then press Enter.",
            }),
          });

  const displayValue = value ? stopName(value, language) : draft;

  function onInputChange(next: string) {
    if (next === displayValue) return;
    setDraft(next);
    setActiveIndex(-1);
    setOpen(true);
    if (value) onChange(null);
  }

  function clearValue() {
    setDraft("");
    setActiveIndex(-1);
    onChange(null);
    setOpen(true);
    if (mobile) sheetInputRef.current?.focus();
    else inputRef.current?.focus();
  }

  const list = (inSheet: boolean) => (
    <ul
      id={listId}
      className={
        inSheet
          ? "h-full overflow-y-auto overscroll-contain p-1"
          : "max-h-66 overflow-y-auto overscroll-contain p-1 max-md:max-h-[min(40vh,280px)]"
      }
      role="listbox"
      aria-label={label}
      aria-busy={loading}
    >
      {choices.map(({ key, stop, place }, index) => {
        const stopLabel = stopName(stop, language);
        const walk = place ? walkLabel(i18n, place.walk_meters) : "";
        // A landmark is only a shortcut to its stop, so it never shows as chosen.
        const isValue = !place && value?.id === stop.id;
        return (
          <li key={key} role="presentation">
            <button
              type="button"
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={isValue}
              className={`flex w-full items-center gap-2 rounded-md text-left active:bg-tint-200 hover-fine:bg-tint-100 [&>svg]:text-muted ${
                index === activeIndex || isValue ? "bg-tint-100" : ""
              } ${inSheet ? "min-h-14 px-3 py-3.5" : "min-h-13 px-2 py-3"}`}
              onClick={() => choose(stop)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {place ? (
                <Landmark size={18} aria-hidden="true" />
              ) : (
                <MapPin size={18} aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-lg leading-normal font-semibold">
                  {place ? placeTitle(place, language) : stopLabel}
                </span>
                {place ? (
                  <span className={OPTION_DETAIL}>
                    {t`Nearest stop: ${stopLabel} · ${walk}`}
                  </span>
                ) : (
                  <span className={OPTION_DETAIL}>
                    {stop.towards?.length
                      ? `${towards(i18n, stop.towards.map(localPlace).join(" / "))} · `
                      : ""}
                    {stop.stop_code}
                  </span>
                )}
              </span>
              <span
                className="flex max-w-26 flex-wrap justify-end gap-1"
                aria-label={t`Routes`}
              >
                {stop.routes.map((route) => (
                  <RouteChip
                    key={route}
                    code={route}
                    color={routeColors.get(route)}
                    size="xs"
                  />
                ))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div
      className="relative min-w-0"
      ref={rootRef}
      onBlur={(event) => {
        if (mobile || sheetOpen) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          closePicker();
        }
      }}
    >
      <label
        className="block text-md font-semibold text-muted"
        htmlFor={inputId}
      >
        {label}
      </label>
      <div className="relative flex min-w-0 items-center">
        <input
          ref={inputRef}
          id={inputId}
          className={`min-h-11 w-full bg-transparent py-2 text-lg font-semibold text-ink placeholder:font-normal placeholder:text-muted ${sheetOpen ? "cursor-pointer" : ""}`}
          role="combobox"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={displayValue}
          readOnly={mobile}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-describedby={expanded ? helpId : undefined}
          aria-activedescendant={
            expanded && activeStop ? `${listId}-${activeIndex}` : undefined
          }
          onFocus={() => {
            setOpen(true);
            setActiveIndex(-1);
          }}
          onClick={() => {
            if (mobile) setOpen(true);
          }}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (!choices.length) return;
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex(
                !expanded || activeIndex < 0
                  ? startIndex(step, choices.length)
                  : wrapIndex(activeIndex + step, choices.length),
              );
            } else if (event.key === "Enter" && expanded && activeStop) {
              event.preventDefault();
              choose(activeStop);
            } else if (event.key === "Escape" && expanded) {
              event.preventDefault();
              closePicker();
            }
          }}
        />
        {(value || draft) && (
          <IconButton
            variant="plain"
            className="-mr-2.5"
            label={t`Clear ${label}`}
            onClick={clearValue}
          >
            <X size={18} aria-hidden="true" />
          </IconButton>
        )}
      </div>

      {expanded && !mobile && (
        <div className="absolute top-[calc(100%+8px)] -right-10 -left-8 z-20 overflow-hidden rounded-lg border border-line-strong bg-white shadow-menu max-md:inset-x-0">
          <p
            id={helpId}
            className={`border-b border-line ${STATUS}`}
            role="status"
            aria-live="polite"
          >
            {help}
          </p>
          {list(false)}
        </div>
      )}

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-white pt-[env(safe-area-inset-top)]"
          role="dialog"
          aria-modal="true"
          aria-label={label}
        >
          <header className="relative flex items-center border-b border-line px-3 pt-3 pb-2">
            <IconButton
              className="absolute top-2 right-2"
              label={t`Close`}
              onClick={closePicker}
            >
              <X size={22} aria-hidden="true" />
            </IconButton>
            <h2 className="flex-1 px-11 text-center text-xl font-semibold">
              {label}
            </h2>
          </header>
          <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-md border border-line-strong bg-paper px-3.5 py-1 [&>svg]:text-muted">
            <Search size={20} aria-hidden="true" />
            <input
              ref={sheetInputRef}
              className="min-h-12 min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink focus:outline-none"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={placeholder}
              value={displayValue}
              aria-describedby={helpId}
              onChange={(event) => onInputChange(event.target.value)}
            />
          </div>
          <p
            id={helpId}
            className={`mx-4 mt-2 rounded-md ${STATUS}`}
            role="status"
            aria-live="polite"
          >
            {help}
          </p>
          <div className="min-h-0 flex-1 overflow-hidden px-2 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {list(true)}
          </div>
        </div>
      )}
    </div>
  );
}
