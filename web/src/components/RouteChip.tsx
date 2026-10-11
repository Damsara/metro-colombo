import { routeColor } from "../lib/routeColor";

const SIZES = {
  md: "min-h-7 min-w-12 px-2 text-xs",
  sm: "min-h-6 min-w-10 px-1.5 text-2xs",
  xs: "min-h-5 min-w-9 px-1 text-2xs",
};

export function RouteChip({
  code,
  color,
  size = "md",
}: {
  code: string;
  color?: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-sm font-bold whitespace-nowrap text-white ${SIZES[size]}`}
      style={{ background: routeColor(color) }}
    >
      {code}
    </span>
  );
}
