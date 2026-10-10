import { msg } from "@lingui/core/macro";
import { Users } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { occupancy, type Crowding, type LiveBus } from "../types";

const CROWDING = {
  roomy: msg`Plenty of room`,
  filling: msg`Filling up`,
  crowded: msg`Crowded`,
};

const TEXT = {
  roomy: "text-ink",
  filling: "text-warning",
  crowded: "text-danger",
};
const FILL = { roomy: "bg-muted", filling: "bg-warning", crowded: "bg-danger" };

function useOccupancyLabels(bus: LiveBus) {
  const { i18n, t } = useLingui();
  const occ = occupancy(bus);
  if (!occ) return null;
  const { current, total } = occ;
  return {
    occ,
    word: i18n._(CROWDING[occ.crowding]),
    detail: t`${current} of ${total} places taken`,
  };
}

/** A bar filled as far as the bus is full, coloured once it gets busy. */
function Fill({ percent, crowding }: { percent: number; crowding: Crowding }) {
  return (
    <span
      className="h-1.5 w-10 overflow-hidden rounded-full bg-line"
      aria-hidden="true"
    >
      <span
        className={`block h-full rounded-full ${FILL[crowding]}`}
        style={{ width: `${Math.max(6, percent * 100)}%` }}
      />
    </span>
  );
}

/** How full a bus is: a people icon and a bar; the words are in its label. */
export function OccupancyBadge({ bus }: { bus: LiveBus }) {
  const labels = useOccupancyLabels(bus);
  if (!labels) return null;
  const { occ, word, detail } = labels;
  return (
    <span
      className="inline-flex min-h-5 shrink-0 items-center gap-1 text-muted"
      role="img"
      title={`${word}, ${detail}`}
      aria-label={`${word}, ${detail}`}
    >
      <Users size={13} aria-hidden="true" />
      <Fill percent={occ.percent} crowding={occ.crowding} />
    </span>
  );
}

/** "Plenty of room ▰▰▱▱": the word first, then the proportion. */
export function OccupancyMeter({ bus }: { bus: LiveBus }) {
  const labels = useOccupancyLabels(bus);
  if (!labels) return null;
  const { occ, word, detail } = labels;
  return (
    <span className="inline-flex items-center gap-1.5" title={detail}>
      <span className={`font-semibold whitespace-nowrap ${TEXT[occ.crowding]}`}>
        {word}
      </span>
      <Fill percent={occ.percent} crowding={occ.crowding} />
      <span className="sr-only">{detail}</span>
    </span>
  );
}
