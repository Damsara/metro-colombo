import { useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { IconButton } from "../components/ui/IconButton";
import type { OccasionTheme } from "./types";

export function OccasionGreeting({
  theme,
  onTurnOff,
  variant,
}: {
  theme: OccasionTheme;
  onTurnOff: () => void;
  variant: "card" | "strip";
}) {
  const { i18n, t } = useLingui();
  const note = theme.note?.(i18n);
  return (
    <div
      className={
        variant === "strip"
          ? "pointer-events-auto flex items-start gap-2 rounded-xl bg-paper/95 py-1.5 pr-1 pl-3 text-xs leading-snug text-ink shadow-float"
          : "flex items-start gap-2"
      }
    >
      <div className="min-w-0">
        <strong
          className={`block font-semibold ${variant === "card" ? "text-2xl tracking-tight" : "text-sm"}`}
        >
          {theme.greeting(i18n)}
        </strong>
        {note && <span className="text-muted">{note}</span>}
      </div>
      <IconButton
        variant="plain"
        size="sm"
        className="pointer-events-auto hover-fine:bg-tint-50"
        label={t`Turn off festive touches`}
        title={t`Turn off festive touches`}
        onClick={onTurnOff}
      >
        <X size={14} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
