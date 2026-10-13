const COLOMBO_OFFSET_MS = 330 * 60_000;
const START_MINUTE = 7;

const colomboTime = (now: number) => new Date(now + COLOMBO_OFFSET_MS);

export const colomboHourKey = (now: number) =>
  colomboTime(now).toISOString().slice(0, 13);

export const compactorHourDue = (now: number, lastStarted: string | null) => {
  const hour = colomboHourKey(now);
  return colomboTime(now).getUTCMinutes() >= START_MINUTE &&
    hour !== lastStarted
    ? hour
    : null;
};
