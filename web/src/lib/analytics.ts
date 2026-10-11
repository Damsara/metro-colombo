// Events carry route and stop codes, never names, places or coordinates.

type Events = {
  search_trip: {
    from_stop: string;
    to_stop: string;
    days_ahead: number;
    source: "form" | "recent" | "return" | "stop";
  };
  search_next_day: { days_ahead: number };
  trip_results: { options: number; days_ahead: number };
  track_bus_start: { route: string };
  track_bus_milestone: {
    milestone: "head_out" | "next_stop" | "arrived" | "lost";
  };
  follow_bus: { route: string };
  bus_card_expand: { route: string };
  bus_card_all_stops: { route: string };
  open_route: { route: string };
  use_location: { result: "found" | "failed" | "unsupported" };
  change_language: { language: string };
};

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const MEASUREMENT_ID = /^G-[A-Z0-9]+$/;
let enabled = false;

export function analyticsAvailable(id: string | undefined): id is string {
  return !!id && MEASUREMENT_ID.test(id) && navigator.doNotTrack !== "1";
}

export function initAnalytics(id: string | undefined): boolean {
  if (enabled || !analyticsAvailable(id)) return false;
  (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = false;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js reads the arguments object, not an array.
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  // Page views are sent by hand: the URL's flags (?trip=1) aren't pages.
  window.gtag("config", id, { send_page_view: false });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.append(script);
  enabled = true;
  return true;
}

export function stopAnalytics(id: string | undefined): void {
  if (id)
    (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = true;
  enabled = false;
}

let lastPath: string | null = null;

export function trackPage(path: string): void {
  if (!enabled || path === lastPath) return;
  lastPath = path;
  window.gtag?.("event", "page_view", {
    page_path: path,
    page_location: window.location.origin + path,
    page_title: document.title,
  });
}

export function track<E extends keyof Events>(event: E, params: Events[E]) {
  if (!enabled) return;
  window.gtag?.("event", event, params);
}

export function daysAhead(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

/** For tests. */
export function resetAnalytics(): void {
  enabled = false;
  lastPath = null;
}
