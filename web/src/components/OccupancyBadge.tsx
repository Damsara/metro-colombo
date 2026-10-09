import { occupancy, type LiveBus } from "../types";
import { Badge } from "./ui/Badge";

/** How full a bus is ("32/60"), coloured by how crowded it is. */
export function OccupancyBadge({ bus }: { bus: LiveBus }) {
  const occ = occupancy(bus);
  if (!occ) return null;
  const tone =
    occ.percent >= 0.85 ? "danger" : occ.percent >= 0.55 ? "warning" : "live";
  return (
    <Badge tone={tone}>
      {occ.current}/{occ.total}
    </Badge>
  );
}
