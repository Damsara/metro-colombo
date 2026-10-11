import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { OccasionKind } from "../types";

export const GREETINGS: Record<OccasionKind, (i18n: I18n) => string> = {
  vesak: (i18n) => t(i18n)`Happy Vesak`,
  poson: (i18n) => t(i18n)`Happy Poson`,
  poya: (i18n) => t(i18n)`A peaceful Poya day`,
  avurudu: (i18n) => t(i18n)`Happy Sinhala and Tamil New Year`,
  deepavali: (i18n) => t(i18n)`Happy Deepavali`,
  christmas: (i18n) => t(i18n)`Merry Christmas`,
  thaiPongal: (i18n) => t(i18n)`Happy Thai Pongal`,
  eidUlFitr: (i18n) => t(i18n)`Eid Mubarak`,
  eidUlAdha: (i18n) => t(i18n)`Eid Mubarak`,
  miladUnNabi: (i18n) => t(i18n)`Blessed Milad-un-Nabi`,
  mahasivarathri: (i18n) => t(i18n)`Blessed Maha Shivaratri`,
  goodFriday: (i18n) => t(i18n)`Good Friday`,
  nationalDay: (i18n) => t(i18n)`Happy National Day`,
  newYear: (i18n) => t(i18n)`Happy New Year`,
  newYearsEve: (i18n) => t(i18n)`Happy New Year's Eve`,
  mayDay: (i18n) => t(i18n)`Happy May Day`,
};

export const holidayNote = (i18n: I18n): string =>
  t(i18n)`Public holiday: buses may run a holiday timetable.`;
