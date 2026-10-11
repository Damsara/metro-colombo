import { useLingui } from "@lingui/react/macro";
import { ChevronDown, Globe } from "lucide-react";
import { useLanguage } from "../lib/language";
import { isLanguage, type Language } from "../types";

const OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "si", label: "සිංහල" },
  { value: "ta", label: "தமிழ்" },
  { value: "hi", label: "हिन्दी" },
  { value: "ru", label: "Русский" },
  { value: "zh", label: "中文" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "ja", label: "日本語" },
];

/**
 * Three buttons on wider screens; on phones, where the header is short, one
 * native drop-down that opens the system picker.
 */
export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  const { t } = useLingui();
  const current = OPTIONS.find((option) => option.value === language);

  return (
    <>
      <div
        role="group"
        aria-label={t`Language`}
        className="inline-flex items-center gap-px rounded-full border border-line bg-card p-0.5 max-md:hidden"
      >
        {OPTIONS.map((option) => {
          const active = option.value === language;
          return (
            <button
              key={option.value}
              type="button"
              lang={option.value}
              aria-pressed={active}
              onClick={() => setLanguage(option.value)}
              className="relative rounded-full px-2.5 py-1.5 text-xs leading-none font-semibold text-muted transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5 hover:not-aria-pressed:text-ink aria-pressed:bg-ink aria-pressed:text-white"
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {/* The drop-down is invisible over a pill showing the current choice,
          so the pill stays as narrow as its label. */}
      <label className="relative inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-card pr-2.5 pl-3 text-sm font-semibold text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink md:hidden">
        <span className="sr-only">{t`Language`}</span>
        <Globe size={16} aria-hidden="true" className="text-muted" />
        <span lang={current?.value} aria-hidden="true">
          {current?.label}
        </span>
        <ChevronDown size={15} aria-hidden="true" className="text-muted" />
        <select
          value={language}
          onChange={(event) => {
            if (isLanguage(event.target.value)) setLanguage(event.target.value);
          }}
          className="absolute inset-0 cursor-pointer appearance-none opacity-0 focus-visible:outline-none"
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value} lang={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
