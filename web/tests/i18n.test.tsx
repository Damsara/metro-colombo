import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";
import JourneyResults from "../src/components/JourneyResults";
import {
  dateLabel,
  distanceLabel,
  i18n,
  preferredLanguage,
  timeLabel,
} from "../src/i18n";
import { LanguageProvider } from "../src/lib/language";
import {
  LANGUAGES,
  nameLanguage,
  placeTitle,
  stopName,
  type JourneyOption,
  type Language,
  type Place,
  type Stop,
} from "../src/types";
import { secondaryStopName } from "../src/lib/stopCard";

afterEach(() => {
  vi.unstubAllGlobals();
  i18n.activate("en");
});

function inLanguage<T>(language: Language, run: () => T): T {
  i18n.activate(language);
  return run();
}

test("dates use catalog month and weekday names in every browser", () => {
  // 2026-10-10 is a Saturday.
  assert.equal(
    inLanguage("en", () => dateLabel(i18n, "2026-10-10")),
    "Sat, 10 Oct",
  );
  assert.equal(
    inLanguage("si", () => dateLabel(i18n, "2026-10-10")),
    "ඔක් 10, සෙන",
  );
  assert.equal(
    inLanguage("ta", () => dateLabel(i18n, "2026-10-10")),
    "சனி, 10 அக்.",
  );
});

test("times are Colombo clock times in each language's format", () => {
  const afternoon = "2026-10-09T09:35:00Z"; // 15:05 in Colombo
  const morning = "2026-10-08T18:30:00Z"; // 00:00 in Colombo
  assert.equal(
    inLanguage("en", () => timeLabel(i18n, afternoon)),
    "3:05 PM",
  );
  assert.equal(
    inLanguage("en", () => timeLabel(i18n, morning)),
    "12:00 AM",
  );
  assert.equal(
    inLanguage("si", () => timeLabel(i18n, afternoon)),
    "ප.ව. 3.05",
  );
  assert.equal(
    inLanguage("ta", () => timeLabel(i18n, afternoon)),
    "3:05 PM",
  );
});

test("units follow each language's order", () => {
  assert.equal(
    inLanguage("en", () => distanceLabel(i18n, 420)),
    "420 m",
  );
  assert.equal(
    inLanguage("si", () => distanceLabel(i18n, 1500)),
    "කි.මී. 1.5",
  );
  assert.equal(
    inLanguage("ta", () => distanceLabel(i18n, 420)),
    "420 மீ",
  );
});

test("the browser's language is used until one is chosen", () => {
  assert.equal(preferredLanguage(["si-LK", "en-US"]), "si");
  assert.equal(preferredLanguage(["xx-XX"]), undefined);
  assert.equal(preferredLanguage(["zh-CN"]), "zh");
  assert.equal(preferredLanguage(["zh-Hans", "en"]), "zh");
  assert.equal(preferredLanguage(["hi-IN"]), "hi");
  assert.equal(preferredLanguage(["fr-FR", "ta-IN"]), "fr");
  for (const language of LANGUAGES) {
    assert.equal(preferredLanguage([language]), language);
  }
});

test("names without upstream data show in English, with Sinhala beneath", () => {
  const stop = {
    stop_name_en: "Fort",
    stop_name_si: "කොටුව",
    stop_name_tm: "கோட்டை",
  } as Stop;
  const place = { name: "Fort", name_si: "කොටුව", name_ta: "கோட்டை" } as Place;
  assert.equal(nameLanguage("si"), "si");
  assert.equal(nameLanguage("ta"), "ta");
  for (const language of [
    "en",
    "hi",
    "ru",
    "zh",
    "de",
    "fr",
    "ja",
    "la",
  ] as const) {
    assert.equal(stopName(stop, language), "Fort");
    assert.equal(placeTitle(place, language), "Fort");
    assert.equal(secondaryStopName(stop, language), "කොටුව");
  }
  assert.equal(stopName(stop, "ta"), "கோட்டை");
  assert.equal(secondaryStopName(stop, "si"), "Fort");
});

test("each added language shows its own dates and times, never message ids", () => {
  const afternoon = "2026-10-09T09:35:00Z";
  for (const language of ["hi", "ru", "zh", "de", "fr", "ja"] as const) {
    const date = inLanguage(language, () => dateLabel(i18n, "2026-10-10"));
    const time = inLanguage(language, () => timeLabel(i18n, afternoon));
    assert.notEqual(date, "Sat, 10 Oct", language);
    assert.match(date, /10/);
    assert.doesNotMatch(date, /[{}]/);
    assert.match(time, /3|15/);
    assert.doesNotMatch(time, /[{}]/);
  }
});

test("Latin uses Latin month and weekday names and Roman a.m. and p.m.", () => {
  // 2026-01-05 is a Monday.
  assert.equal(
    inLanguage("la", () => dateLabel(i18n, "2026-01-05")),
    "Lun, 5 Ian",
  );
  assert.equal(
    inLanguage("la", () => timeLabel(i18n, "2026-10-09T09:35:00Z")),
    "3:05 p.m.",
  );
});

test("a saved Sinhala choice renders the journey in Sinhala word order", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => "si",
    setItem: () => {},
  });
  const option: JourneyOption = JSON.parse(
    readFileSync(
      new URL("./fixtures/transfer-option.json", import.meta.url),
      "utf8",
    ),
  );
  const ride = option.legs[0];
  assert.ok(ride.kind === "ride");
  const html = renderToStaticMarkup(
    createElement(LanguageProvider, {
      children: createElement(JourneyResults, {
        plan: {
          from_stop: ride.ride.board,
          to_stop: ride.ride.alight,
          date: "2999-01-01",
          queried_at: "2026-10-07T06:00:00Z",
          is_now: false,
          options: [option],
        },
        selected: option,
        liveBuses: [],
        onShowBus: () => {},
        loading: false,
        error: null,
        language: "si",
        onSelect: () => {},
        onRetry: () => {},
        onNextDay: () => {},
        routeColors: new Map(),
      }),
    }),
  );
  assert.match(html, /පානදුර <strong>හිදී නගින්න<\/strong>/);
  assert.match(html, /ගමන් 1ක්/);
  assert.doesNotMatch(html, /Get on at/);
});

function entries(po: string): [string, string][] {
  const field = String.raw`"(?:[^"\\]|\\.)*"(?:\n"(?:[^"\\]|\\.)*")*`;
  const join = (quoted: string) =>
    quoted
      .split("\n")
      .map((line) => JSON.parse(line) as string)
      .join("");
  return [
    ...po.matchAll(new RegExp(`^msgid (${field})\nmsgstr (${field})$`, "gm")),
  ].map(([, id, str]) => [join(id), join(str)]);
}

// A translation that drops or renames a placeholder would show a raw `{name}`, which the build's missing-translation check cannot see.
test("every translation keeps the source message's placeholders and tags", () => {
  const placeholders = (message: string) =>
    [...message.matchAll(/\{(\w+)[,}]|<\/?(\d+)>/g)]
      .map((match) => match[1] ?? `<${match[2]}>`)
      .sort();
  // Languages differ in plural categories, so only the shape must match:
  // which variable is pluralised and that it keeps an `other` branch.
  const plurals = (message: string) =>
    [...message.matchAll(/\{(\w+), (plural|select|selectordinal),/g)]
      .map((match) => `${match[1]}:${match[2]}`)
      .sort();
  for (const locale of LANGUAGES.filter((language) => language !== "en")) {
    const po = readFileSync(
      new URL(`../src/locales/${locale}/messages.po`, import.meta.url),
      "utf8",
    );
    const pairs = entries(po).filter(([id]) => id);
    assert.equal(pairs.length, (po.match(/^msgid /gm) ?? []).length - 1);
    for (const [id, str] of pairs) {
      if (!str) continue;
      assert.deepEqual(placeholders(str), placeholders(id), `${locale}: ${id}`);
      assert.deepEqual(plurals(str), plurals(id), `${locale}: ${id}`);
      if (plurals(id).length) {
        assert.match(str, /other \{/, `${locale}: ${id} lacks "other"`);
      }
    }
  }
});
