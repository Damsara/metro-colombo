import type { ReactNode } from "react";

const TONES = {
  neutral: "bg-tint-100 text-ink",
  live: "bg-live-50 text-live",
  warning: "bg-warning-50 text-warning",
  danger: "bg-danger-50 text-danger",
  // A departure that is close, e.g. "Leaves in 3 min".
  soon: "bg-soon text-soon-ink",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: keyof typeof TONES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex min-h-5 shrink-0 items-center justify-center rounded-full px-2 text-2xs font-bold whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
