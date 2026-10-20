import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DOCS_MAIN, DOCS_TITLE, HEADER_LINK } from "./classNames";
import { AppHeader } from "./components/AppHeader";
import { Badge } from "./components/ui/Badge";
import { Eyebrow } from "./components/ui/Eyebrow";

const apiPath = "/api";

function Endpoint({ path, children }: { path: string; children: ReactNode }) {
  return (
    <section
      className="mt-9 border-t border-line pt-2"
      id={path.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}
    >
      <h2 className="mt-4.5 mb-3 flex items-center gap-2.5 text-lg leading-snug max-md:flex-col max-md:items-start max-md:gap-1.5">
        <Badge>GET</Badge>
        <code>{path}</code>
      </h2>
      {children}
    </section>
  );
}

export default function ApiDocs() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Metro API: timetable and live buses";
    return () => {
      document.title = previous;
    };
  }, []);

  const origin = window.location.origin;
  const api = `${origin}${apiPath}`;

  return (
    <div className="min-h-dvh bg-paper">
      <AppHeader homeLabel="Metro home" suffix="API">
        <Link className={HEADER_LINK} to="/">
          Back to the map
        </Link>
      </AppHeader>
      <main className={DOCS_MAIN}>
        <Eyebrow>TIMETABLE AND LIVE BUSES</Eyebrow>
        <h1 className={DOCS_TITLE}>Use the same data as this site</h1>
        <p className="text-xl max-md:text-lg">
          These are the calls the Metro site makes to list routes, look up
          stops, draw a route line, plan a trip, and follow buses.
        </p>
        <p>
          Every path below is on this host, under <code>{apiPath}</code>. From
          here that is <code>{api}</code>. Responses are JSON. A failed call
          looks like <code>{`{ "error": "route not found: CM99" }`}</code> with
          status 400 (bad request), 404 (unknown route or path), or 502
          (upstream unavailable).
        </p>
        <p>
          This same reference is available as a plain-text file agents, LLMs,
          and scripts can pull at{" "}
          <a className={HEADER_LINK} href="/llm.txt">
            /llm.txt
          </a>
          .
        </p>

        <Endpoint path="/api/routes">
          <p>
            All routes. The site loads this once and keeps it for about 10
            minutes.
          </p>
          <pre tabIndex={0}>{`curl ${api}/routes`}</pre>
          <pre tabIndex={0}>{`{
  "routes": [
    {
      "id": "…",
      "code": "CM01",
      "name": "Makumbura - Battaramulla",
      "color_hex": "#147d57",
      "directions": [
        {
          "id": "…",
          "start_location": "Makumbura",
          "end_location": "Battaramulla",
          "geojson_url": "https://…"
        }
      ]
    }
  ]
}`}</pre>
          <p>
            Use <code>code</code> (for example <code>CM01</code>) in the paths
            below. <code>color_hex</code> is the line colour on the map. Each
            direction has its own stop list and path. Route names are in
            English; stop names come in all three languages. A few extra fields
            (<code>status</code>, <code>is_favorite</code>) may also be present;
            the site ignores them.
          </p>
        </Endpoint>

        <Endpoint path="/api/routes/:code">
          <p>
            One route by code, in the same shape as an entry of the list above.
          </p>
          <pre tabIndex={0}>{`curl ${api}/routes/CM01`}</pre>
        </Endpoint>

        <Endpoint path="/api/routes/:code/stops">
          <p>
            Ordered stops for one route. Omit <code>direction</code> to get
            every direction. The site does that when it builds the stop search.
          </p>
          <pre tabIndex={0}>{`curl ${api}/routes/CM01/stops
curl '${api}/routes/CM01/stops?direction=DIRECTION_ID'`}</pre>
          <p>
            <code>direction</code> may be a direction id from{" "}
            <code>/routes</code>, <code>0</code> or <code>1</code>,{" "}
            <code>forward</code> or <code>reverse</code>, or the direction’s{" "}
            <code>start_location</code>. One match returns a single object.
            Several matches return <code>{`{ "directions": [ … ] }`}</code>.
          </p>
          <pre tabIndex={0}>{`{
  "route_code": "CM01",
  "route_name": "Makumbura - Battaramulla",
  "direction_id": "…",
  "direction_label": "Makumbura -> Battaramulla",
  "stops": [
    {
      "id": "…",
      "stop_code": "MMC-1",
      "stop_name_en": "Makumbura",
      "stop_name_si": "…",
      "stop_name_tm": "…",
      "sequence_number": 1,
      "latitude": 6.840692,
      "longitude": 79.975769
    }
  ]
}`}</pre>
          <p>
            Stops are in <code>sequence_number</code> order. Tamil stop names
            are <code>stop_name_tm</code>, not <code>name_ta</code>. Pass{" "}
            <code>id</code> or <code>stop_code</code> to the journey call.
          </p>
        </Endpoint>

        <Endpoint path="/api/routes/:code/geometry">
          <p>
            The route line as a GeoJSON <code>FeatureCollection</code>. The map
            draws one of these per direction.
          </p>
          <pre
            tabIndex={0}
          >{`curl '${api}/routes/CM01/geometry?direction=DIRECTION_ID'`}</pre>
          <p>
            <code>direction</code> takes the same values as for stops. If you
            leave it off, the first direction is returned.
          </p>
        </Endpoint>

        <Endpoint path="/api/journey">
          <p>
            Scheduled trips between two stops for one Colombo date. This is the
            timetable: departure, arrival, fare, and each ride or walk.
          </p>
          <pre
            tabIndex={0}
          >{`curl '${api}/journey?from=MMC-1&to=MCC5&date=2026-10-08'`}</pre>
          <ul>
            <li>
              <code>from</code> and <code>to</code> are required. Each is a{" "}
              <code>stop_code</code> such as <code>MMC-1</code>, or the stop{" "}
              <code>id</code>. The site sends the id.
            </li>
            <li>
              <code>date</code> is <code>YYYY-MM-DD</code> in Asia/Colombo. If
              you omit it, the server uses today in Colombo.
            </li>
          </ul>
          <pre tabIndex={0}>{`{
  "from_stop": { "id": "…", "stop_code": "MMC-1", "stop_name_en": "Makumbura" },
  "to_stop": { "id": "…", "stop_code": "MCC5", "stop_name_en": "Pannipitiya" },
  "date": "2026-10-08",
  "queried_at": "2026-10-08T08:15:00.000Z",
  "is_now": true,
  "options": [
    {
      "departure_time": "2026-10-08T10:30:00+05:30",
      "arrival_time": "2026-10-08T10:40:00+05:30",
      "total_minutes": 10,
      "rides": 1,
      "transfers": 0,
      "total_fare": { "full_amount": 85, "half_amount": 85, "complete": true },
      "legs": [
        {
          "kind": "ride",
          "ride": {
            "route": { "code": "CM03", "name": "Makumbura - Kadawatha" },
            "direction_id": "…",
            "end_location": "Kadawatha",
            "bus": { "registration_number": "WP-NE-6503" },
            "board": { "stop_code": "MMC-1", "stop_name_en": "Makumbura", "scheduled_time": "2026-10-08T10:30:00+05:30" },
            "alight": { "stop_code": "MCC5", "stop_name_en": "Pannipitiya", "scheduled_time": "2026-10-08T10:40:00+05:30" },
            "travel_minutes": 10
          }
        }
      ]
    }
  ]
}`}</pre>
          <p>
            Fares are in rupees. <code>complete: false</code> means a fare for
            that trip could not be fully priced. A change of bus is a{" "}
            <code>move</code> leg between two stops:
          </p>
          <pre tabIndex={0}>{`{
  "kind": "move",
  "move": {
    "from_stop": { "stop_code": "MCC68-2", "stop_name_en": "Borella 02 - YMBA" },
    "to_stop": { "stop_code": "MCC68", "stop_name_en": "Borella 02 - YMBA" },
    "distance_meters": 14,
    "estimated_minutes": 3,
    "depart_time": "2026-10-08T06:45:00+05:30",
    "arrive_time": "2026-10-08T06:48:00+05:30"
  }
}`}</pre>
          <p>
            Times are ISO strings with the Colombo offset (<code>+05:30</code>).
            An unknown stop returns 400. An empty <code>options</code> array
            means nothing is scheduled for that pair on that date.
          </p>
        </Endpoint>

        <Endpoint path="/api/live">
          <p>
            Live bus positions, served from a single persistent connection to
            Metro's ticketing-service WebSocket. The map polls this every 5
            seconds, and the feed itself updates on that same cadence.{" "}
            <code>success</code> is <code>true</code> while that feed is
            connected; an empty <code>buses</code> array then means no bus is
            reporting right now, not that the service has stopped.
          </p>
          <pre tabIndex={0}>{`curl ${api}/live`}</pre>
          <pre tabIndex={0}>{`{
  "success": true,
  "count": 1,
  "timestamp": 1759900000000,
  "age_ms": 1200,
  "buses": [
    {
      "id": "…",
      "lat": 6.927,
      "lng": 79.861,
      "route_code": "CM01",
      "route_id": "…",
      "direction_id": "…",
      "registration_number": "WP-NE-6503",
      "current_capacity": 12,
      "total_capacity": 40,
      "heading": 42
    }
  ]
}`}</pre>
          <p>
            <code>age_ms</code> is how long ago the server received that update;
            new positions arrive about every 5 seconds, so polling{" "}
            <code>5000 − age_ms</code> milliseconds later picks up the next one
            as soon as it lands. Positions are already corrected for a known
            upstream fault that puts some fixes one degree north and east of
            Colombo, and <code>route_code</code> is filled in from{" "}
            <code>route_id</code>. Heading is often missing; the site derives it
            from the bus's movement along its route. Occupancy, when present, is{" "}
            <code>current_capacity / total_capacity</code> and is not a promise
            of a free seat.
          </p>
        </Endpoint>

        <Endpoint path="/api/places">
          <p>
            Landmarks with trilingual names (<code>name</code>,{" "}
            <code>name_si</code>, <code>name_ta</code>), a free-text{" "}
            <code>category</code>, and the nearest stop as{" "}
            <code>stop_code</code> and <code>stop_id</code> with the{" "}
            <code>walk_meters</code> to it. Either stop reference works with the
            journey call.
          </p>
          <pre tabIndex={0}>{`curl ${api}/places`}</pre>
          <pre tabIndex={0}>{`{
  "places": [
    {
      "id": 1,
      "name": "Lotus Tower Colombo",
      "name_si": "…",
      "name_ta": "…",
      "category": "Landmark",
      "walk_meters": 657,
      "stop_code": "MCC48",
      "stop_id": "…"
    }
  ]
}`}</pre>
        </Endpoint>

        <Endpoint path="/api/health">
          <p>
            Whether route data is available (<code>ok</code>), whether the
            upstream transit API has answered recently, and how old the live
            positions and the routes and stops are.
          </p>
          <pre tabIndex={0}>{`{
  "ok": true,
  "routes_count": 7,
  "upstream": "reachable",
  "live": { "stale": false, "age_ms": 1153 },
  "reference_age_ms": 2403861
}`}</pre>
        </Endpoint>

        <p>Every call can be made from any origin (public CORS).</p>
      </main>
    </div>
  );
}
