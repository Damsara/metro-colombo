import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";
import { LanguageProvider } from "../src/lib/language";
import { OccasionGreeting } from "../src/occasions/OccasionGreeting";
import type { OccasionTheme } from "../src/occasions/types";

type IconButtonProps = ComponentProps<
  typeof import("../src/components/ui/IconButton").IconButton
>;
const iconButtons = vi.hoisted(() => [] as IconButtonProps[]);
vi.mock("../src/components/ui/IconButton", async (original) => {
  const actual =
    await original<typeof import("../src/components/ui/IconButton")>();
  return {
    ...actual,
    IconButton: (props: IconButtonProps) => {
      iconButtons.push(props);
      return actual.IconButton(props);
    },
  };
});

const theme: OccasionTheme = {
  kind: "vesak",
  greeting: () => "Happy Vesak",
  note: () => "Buses may run a holiday timetable.",
};

test("shows the greeting and note, and turns festive touches off", () => {
  const onTurnOff = vi.fn();
  const html = renderToStaticMarkup(
    createElement(LanguageProvider, {
      children: createElement(OccasionGreeting, {
        theme,
        onTurnOff,
        variant: "strip",
      }),
    }),
  );
  assert.match(html, /Happy Vesak/);
  assert.match(html, /Buses may run a holiday timetable\./);
  assert.match(html, /aria-label="Turn off festive touches"/);
  const off = iconButtons.find(
    (props) => props.label === "Turn off festive touches",
  );
  assert.ok(off);
  off.onClick?.({} as never);
  assert.equal(onTurnOff.mock.calls.length, 1);
});
