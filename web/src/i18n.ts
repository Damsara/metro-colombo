import { i18n, type I18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { messages as en } from "./locales/en/messages.po";
import { messages as si } from "./locales/si/messages.po";
import { messages as ta } from "./locales/ta/messages.po";
import { COLOMBO_OFFSET_MS, isLanguage, type Language } from "./types";

i18n.load({ en, si, ta });

export { i18n };

export function towards(i18n: I18n, place: string): string {
  return t(i18n)`Towards ${place}`;
}

export function distanceLabel(i18n: I18n, meters: number): string {
  if (meters < 1000) {
    const metres = Math.round(meters);
    return t(i18n)`${metres} m`;
  }
  const km = (meters / 1000).toFixed(1);
  return t(i18n)`${km} km`;
}

export function minutesLabel(i18n: I18n, value: number): string {
  const minutes = Math.round(value);
  return t(i18n)`${minutes} min`;
}

// Month and weekday names come from the catalogs, not Intl.DateTimeFormat:
// Chrome has no Sinhala date data (it quietly falls back to English) and
// Safari uses the traditional month names, like වප් for October, which belong
// on a Poya calendar.
const WEEKDAYS = [
  msg({ message: "Sun", context: "weekday" }),
  msg({ message: "Mon", context: "weekday" }),
  msg({ message: "Tue", context: "weekday" }),
  msg({ message: "Wed", context: "weekday" }),
  msg({ message: "Thu", context: "weekday" }),
  msg({ message: "Fri", context: "weekday" }),
  msg({ message: "Sat", context: "weekday" }),
];
const MONTHS = [
  msg({ message: "Jan", context: "month" }),
  msg({ message: "Feb", context: "month" }),
  msg({ message: "Mar", context: "month" }),
  msg({ message: "Apr", context: "month" }),
  msg({ message: "May", context: "month" }),
  msg({ message: "Jun", context: "month" }),
  msg({ message: "Jul", context: "month" }),
  msg({ message: "Aug", context: "month" }),
  msg({ message: "Sep", context: "month" }),
  msg({ message: "Oct", context: "month" }),
  msg({ message: "Nov", context: "month" }),
  msg({ message: "Dec", context: "month" }),
];

/** A travel date (YYYY-MM-DD) such as "Sat, 10 Oct". */
export function dateLabel(i18n: I18n, isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  const weekday = i18n._(WEEKDAYS[date.getUTCDay()]);
  const day = date.getUTCDate();
  const month = i18n._(MONTHS[date.getUTCMonth()]);
  return t(i18n)({
    message: `${weekday}, ${day} ${month}`,
    comment: "Short travel date, e.g. Sat, 10 Oct",
  });
}

/** A readable clock time, such as "3:05 PM". */
export function timeLabel(i18n: I18n, value: string): string {
  const colombo = new Date(Date.parse(value) + COLOMBO_OFFSET_MS);
  const hours = colombo.getUTCHours();
  const hour = hours % 12 || 12;
  const minute = String(colombo.getUTCMinutes()).padStart(2, "0");
  const period = hours < 12 ? t(i18n)`AM` : t(i18n)`PM`;
  return t(i18n)({
    message: `${hour}:${minute} ${period}`,
    comment: "Clock time; period is AM or PM",
  });
}

export function preferredLanguage(
  languages: readonly string[],
): Language | undefined {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return undefined;
}
