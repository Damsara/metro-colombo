import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classify,
  fixedOccasions,
  parseIcs,
  toOccasions,
} from "../src/occasions.js";

const ics = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261025",
  "SUMMARY:Vap Full Moon Poya Day",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260501",
  "SUMMARY:May Day",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260501",
  "SUMMARY:Vesak Full Moon",
  "  Poya Day",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260301",
  "SUMMARY:Sri Lanka Holidays in your calendar!",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("parses all-day events and unfolds continuation lines", () => {
  assert.deepEqual(parseIcs(ics), [
    { date: "2026-10-25", title: "Vap Full Moon Poya Day" },
    { date: "2026-05-01", title: "May Day" },
    { date: "2026-05-01", title: "Vesak Full Moon Poya Day" },
    { date: "2026-03-01", title: "Sri Lanka Holidays in your calendar!" },
  ]);
});

test("classifies every title the feed uses", () => {
  const cases: Array<[string, string | null]> = [
    ["Vesak Full Moon Poya Day", "vesak"],
    ["Day following Vesak Full Moon Poya Day", "vesak"],
    ["Poson Full Moon Poya Day", "poson"],
    ["Adhi-Vap Full Moon Poya Day", "poya"],
    ["Nawam Full Moon Poya Day", "poya"],
    ["Day prior to Sinhala & Tamil New Year Day", "avurudu"],
    ["Sinhala and Tamil New Year Day", "avurudu"],
    ["Deepavali Festival Day", "deepavali"],
    ["Christmas", "christmas"],
    ["Tamil Thai Pongal Day", "thaiPongal"],
    ["Id Ul Fitr", "eidUlFitr"],
    ["Id ul-Alha", "eidUlAdha"],
    ["Milad-un-Nabi", "miladUnNabi"],
    ["Mahasivarathri Day", "mahasivarathri"],
    ["Good Friday", "goodFriday"],
    ["National Day", "nationalDay"],
    ["May Day", "mayDay"],
    ["Sri Lanka Holidays in your calendar!", null],
  ];
  for (const [title, kind] of cases) assert.equal(classify(title), kind, title);
});

test("adds New Year's Day and Eve for each year", () => {
  assert.deepEqual(fixedOccasions(2026, 2026), [
    { date: "2026-01-01", kind: "newYear", title: "New Year's Day" },
    { date: "2026-12-31", kind: "newYearsEve", title: "New Year's Eve" },
  ]);
});

test("drops unknown events and orders a shared date by priority", () => {
  const result = toOccasions(parseIcs(ics), 2026, 2026);
  assert.deepEqual(
    result.map((o) => `${o.date} ${o.kind}`),
    [
      "2026-01-01 newYear",
      "2026-05-01 vesak",
      "2026-05-01 mayDay",
      "2026-10-25 poya",
      "2026-12-31 newYearsEve",
    ],
  );
});
