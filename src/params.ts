import type * as S from "./schemas.js";

export const directionMatches = (
  param: string,
  direction: S.Direction,
  index: number,
) => {
  const value = param.toLowerCase();
  return (
    param === direction.id ||
    value === String(index) ||
    value === (index === 0 ? "forward" : "reverse") ||
    value === direction.start_location.toLowerCase()
  );
};

export const isStopUuid = (ref: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);

/** A real calendar date in `YYYY-MM-DD` form. */
export const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
