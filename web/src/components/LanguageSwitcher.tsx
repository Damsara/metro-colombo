import { useLingui } from "@lingui/react/macro";
import { useLanguage } from "../lib/language";
import type { Language } from "../types";

const OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "si", label: "සිංහල" },
  { value: "ta", label: "தமிழ்" },
];

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  const { t } = useLingui();

  return (
    <div
      role="group"
      aria-label={t`Language`}
      className="inline-flex items-center gap-px rounded-full border border-line bg-white p-0.5"
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
            className="relative rounded-full px-2.5 py-1.5 text-xs leading-none font-semibold text-muted transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5 hover:not-aria-pressed:text-ink aria-pressed:bg-green aria-pressed:text-white"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
