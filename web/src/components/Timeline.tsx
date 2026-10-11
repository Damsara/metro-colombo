import { BusFront } from "lucide-react";

export const TIMELINE_ROW =
  "relative flex min-h-9 items-center gap-3 not-last:after:absolute not-last:after:top-6.5 not-last:after:-bottom-2.5 not-last:after:left-2.5 not-last:after:border-l-2 not-last:after:border-(--line)";
export const TIMELINE_DOT = "grid size-5 shrink-0 place-items-center";

export function BusMarker() {
  return (
    <span className="relative grid size-5 place-items-center rounded-full bg-bus text-white">
      <BusFront size={12} aria-hidden="true" />
    </span>
  );
}

export function StopDot({
  marked = false,
  terminus = false,
  passed = false,
}: {
  marked?: boolean;
  terminus?: boolean;
  passed?: boolean;
}) {
  if (marked)
    return (
      <span className="relative size-4 rounded-full border-4 border-ink bg-card" />
    );
  if (terminus)
    return (
      <span className="relative size-3.5 rounded-sm border-[3px] border-(--line) bg-card" />
    );
  return (
    <span
      className={`relative size-2.5 rounded-full border-2 border-(--line) bg-card ${
        passed ? "opacity-50" : ""
      }`}
    />
  );
}
