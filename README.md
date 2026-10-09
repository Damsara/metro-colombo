# Lanka Metro - find your next bus around Colombo

An unofficial trip planner and live bus map for Lanka Metro Transit
(LMT-GO / SmartMetro), Colombo. A React + Vite frontend talks to a small
**Effect v4** API server that proxies and caches the public transit data:
routes, stops, route geometry, journey plans and live bus positions.

**Live at [metro.manasa.ai](https://metro.manasa.ai).**

Not affiliated with Lanka Metro Transit, Smart Metro or the official LMT GO app.

## Features

- **Plan a trip:** choose two stops (or a landmark, which picks its nearest
  stop, or your location) and a date, then **Find my bus**. Results show
  times in Sri Lanka time, fares, transfers and step-by-step boarding.
- **See your bus:** when a journey's assigned bus is live and running that
  trip, show it on the map; if it's still on another run, the card says so.
- **Browse routes:** each route's two directions, its stops in order, its
  path, and live buses placed at their nearest stop.
- **Live map:** buses are 3D models on a tilted MapLibre map, moving along
  their route between GPS fixes. Tap one to follow it; drag the map to look
  around and **Follow** to pick it up again.
- **Three languages:** English, Sinhala and Tamil, starting in the browser's
  language. Stop search matches names in all three and stop codes. Route
  names stay in English, because the available translations are unreliable.
- On phones the map opens full screen, and the Back button steps back
  through map, results and form.

## Quick start

Requires Node.js **22.19+**.

```bash
npm install
npm --prefix web install
npm --prefix web run build  # the API server also serves the built UI
npm start                   # -> http://127.0.0.1:8788
```

No configuration is needed; see [the token](#the-token) for why.

For frontend development, run the API with `npm run dev` and, in a second
terminal, `npm --prefix web run dev` (http://localhost:5173). Vite forwards
`/api/*` to the API on port 8788. To test on a phone on the same network, start
Vite with `npm --prefix web run dev -- --host`.

### The token

Stops, journeys and the live fleet feed need a bearer token; routes and
geometry don't. The server has the token built in that the official tracker
(`lmtgo.eimsky.com`) hardcodes in its public client bundle.
`METRO_API_TOKEN` overrides it.

That token is in the source on purpose. It isn't a secret: every visitor to
the official tracker downloads it, it only reads public transit data, and
revoking it would break the official tracker too. Security scanners will flag
it as a hardcoded credential; that's expected.

- Use that token specifically: it's the one that receives the real fleet.
  Other tokens may be accepted but get test data, a synthetic feed of made-up
  bus positions. If the map shows buses that don't match reality, check
  whether `METRO_API_TOKEN` is set.
- If the operator rotates or expires it, stops, journeys and live buses stop
  loading until the built-in token is updated or `METRO_API_TOKEN` is set.
  `/api/health` still reports the upstream as reachable, because routes need
  no token.
- Every copy of this project shares the token, so the operator sees all of
  that traffic under it, as it does for the official tracker.

## Checks

```bash
npm run typecheck                  # API
npm test                           # API tests (node:test)
npm --prefix web test              # frontend tests (Vitest)
npm --prefix web run build         # frontend typecheck + production bundle
npm --prefix web run format:check  # Prettier, with Tailwind class ordering
```

## Translations

Interface text uses [Lingui](https://lingui.dev). Write English in the code
with the `t` or `<Trans>` macros; the English text is also the message's key.
After adding or changing any English text, update the catalogs:

```bash
npm --prefix web run i18n:extract  # syncs web/src/locales/*/messages.po
```

Translate each new entry in `web/src/locales/si/messages.po` and
`web/src/locales/ta/messages.po` (any gettext editor works). Keep every
`{placeholder}` and `<0>tag</0>`; the order may change to suit the language.
Plurals use ICU syntax, e.g. `{count, plural, one {# stop} other {# stops}}`.

The production build fails if a catalog entry is untranslated, and the
frontend tests fail if a translation drops or renames a placeholder. Neither
notices English text that hasn't been extracted yet, so run `i18n:extract`
before building. Stop and place names come translated from the API, not from
the catalogs.

## Configuration

| Variable          | Default                              | Purpose                                                     |
| ----------------- | ------------------------------------ | ----------------------------------------------------------- |
| `METRO_API_TOKEN` | the tracker's public reader token    | upstream bearer token                                       |
| `EIMSKY_BASE`     | `https://metrobusapiprod.eimsky.com` | MetroBus backend                                            |
| `LANKAMETRO_BASE` | `https://lankametro.lk`              | route colours, landmarks, geometry fallback                 |
| `HOST` / `PORT`   | `127.0.0.1` / `8788`                 | listen address; set `HOST=0.0.0.0` to accept other machines |
| `WEB_DIST`        | `web/dist`                           | built UI served next to the API                             |

`npm start` and `npm run dev` load `.env` when present; `.env.example` lists
the variables.

## API

All endpoints are `GET`, return JSON, allow public CORS and live under `/api`.
The UI documents them at `/docs`, and `/llm.txt` has a plain-text version.
Stop references accept a `stop_code` (e.g. `MMC-1`) or a stop UUID. Errors are
`{"error": "…"}` with status 400 (bad request), 404 (unknown route or path) or
502 (upstream unavailable).

| Path                           | Cache (fresh → stale) | Description                                                                     |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------- |
| `/api/health`                  | —                     | liveness and upstream reachability                                              |
| `/api/routes`                  | 12 h → 7 d            | all routes (code, English name, colour, directions)                             |
| `/api/routes/:code`            | 12 h → 7 d            | one route, e.g. `/api/routes/CM01`                                              |
| `/api/routes/:code/stops`      | 12 h → 7 d            | stops; `?direction=forward\|reverse\|0\|1\|<direction_id>`                      |
| `/api/routes/:code/geometry`   | 24 h → 30 d           | GeoJSON path; same `direction` values, defaults to the first                    |
| `/api/journey?from=&to=&date=` | 60 s → 10 min         | journey options; `date` is optional `YYYY-MM-DD` (default today)                |
| `/api/live`                    | live snapshot         | latest bus positions, and `age_ms` since the last update                        |
| `/api/places`                  | 24 h → 7 d            | landmarks with their nearest stop (`stop_code`, `stop_id`) and walking distance |

```bash
curl http://127.0.0.1:8788/api/routes
curl 'http://127.0.0.1:8788/api/routes/CM01/stops?direction=forward'
curl 'http://127.0.0.1:8788/api/journey?from=MMC-1&to=MCC5'
curl http://127.0.0.1:8788/api/live
```

### Caching and upstream resilience

Upstream data is cached in memory and served stale when a refresh fails, so the
API keeps answering through an upstream outage. Each resource is fresh for the
first duration above, then served from the last good value for up to the
second. A failed refresh is retried after 2 s rather than cached. A cold process
still needs one successful fetch per resource.

### Live positions

The server keeps one WebSocket open to the operator's ticketing-service GPS feed
(the source the official tracker uses), reconnecting with backoff. The feed
sends the whole fleet about every 5 s. `/api/live` returns each bus's latest
position; a bus silent for 60 s is dropped.

`success` reports whether the feed is connected, so an empty list from a
connected feed means no bus is reporting rather than an outage. `age_ms` is how
long ago the server received the current positions: polling `5000 − age_ms`
later picks up the next update as it lands, which is what the UI does. The
server also corrects a known upstream fault that offsets some fixes by one
degree, and adds `route_code` from `route_id`.

### Example journey response

```jsonc
{
  "from_stop": {
    "id": "4351f529-…",
    "stop_code": "MMC-1",
    "stop_name_en": "Makumbura",
    "latitude": 6.840692,
    "longitude": 79.975769,
  },
  "to_stop": {
    "id": "6d168504-…",
    "stop_code": "MCC5",
    "stop_name_en": "Pannipitiya",
    "latitude": 6.84614,
    "longitude": 79.94917,
  },
  "date": "2026-10-07",
  "options": [
    {
      "departure_time": "2026-10-07T10:30:00+05:30",
      "arrival_time": "2026-10-07T10:40:00+05:30",
      "total_minutes": 10,
      "rides": 1,
      "transfers": 0,
      "total_fare": {
        "full_amount": 85,
        "half_amount": 85,
        "complete": true,
        "category_assumed": false,
      },
      "legs": [
        {
          "kind": "ride",
          "ride": {
            "route": {
              "id": "…",
              "code": "CM03",
              "name": "Makumbura - Kadawatha",
            },
            "bus": { "id": "…", "registration_number": "WP-NE-6503" },
            "board": { "stop_code": "MMC-1", "stop_name_en": "Makumbura" },
            "alight": { "stop_code": "MCC5", "stop_name_en": "Pannipitiya" },
          },
        },
      ],
    },
  ],
}
```

Responses carry more upstream fields than shown (for example `leave_at`,
`time_basis`, per-ride `fare` and every intermediate stop with scheduled and
live times). Journey payloads are passed through from the operator and may
gain fields.

## Data model

- **Routes** (CM01–CM06, CM08) each have two directions, each with its own
  ordered stop list and GeoJSON path.
- **Stops** carry `stop_code`, trilingual names (`stop_name_en` / `_si` /
  `_tm`), `sequence_number` and coordinates. The same physical stop has a
  separate id and code for each direction.
- **Live buses** report `id`, `lat`, `lng` and, when known, route, direction,
  registration, heading and occupancy.
- **Fares** are stop-pair based and come with each journey option
  (`full_amount` / `half_amount`, LKR).
- **Journey options** list `ride` legs (route, direction, assigned bus,
  board/alight stops) and `move` legs for the walk between transfer stops.
  The assigned bus covers a whole day of departures, so it may be live on an
  earlier run.

## Deployment

The server is a single process that serves the API and the built UI. The
`Dockerfile` builds it into one image:

```bash
docker build -t metro .
docker run -p 8788:8788 metro
```

`deploy/k8s/` has Kustomize manifests, with `example.com` placeholders for
the image registry and hostname:

- `base/` is the app itself: a namespace that enforces the restricted Pod
  Security Standard, the Deployment, its Service and ServiceAccount, and a
  NetworkPolicy that only lets in the ingress controller and only lets out DNS
  and HTTPS to the public internet.
- `overlays/example/` adds an Ingress (Traefik with cert-manager) and pins the
  image tag. Copy it, set your image, tag and hostname, then:

  ```bash
  kubectl kustomize deploy/k8s/overlays/example   # preview
  kubectl apply -k deploy/k8s/overlays/example
  ```

- `cloudflared/` has an optional rule for publishing through a Cloudflare
  Tunnel instead of an open port. Add it to your cloudflared config's
  `ingress` list, before the catch-all rule.

Things to know:

- Run one replica. Each instance holds its own connection to the live feed
  and its own caches; rollouts briefly run a second pod, so there's no gap.
- The liveness probe only checks the port is open, because `/api/health`
  calls the upstream and would restart a healthy pod during an upstream
  slowdown. Readiness uses `/api/health`, which stays 200 while the API serves
  its stale cache.
- To replace the built-in token, create the optional `metro-secrets` Secret
  with a `METRO_API_TOKEN` key; never commit it.
- The NetworkPolicy assumes the ingress controller runs in `kube-system` (as
  k3s's Traefik does) and needs a CNI that enforces policies. `preStop.sleep`
  needs Kubernetes 1.30 or newer.

## Project layout

```
src/                 Effect API server
  server.ts          routes, static UI hosting, entry point
  upstream.ts        UpstreamApi service: upstream clients + stale-on-error caches
  live-fleet.ts      LiveFleet service: persistent GPS feed connection
  config.ts          environment configuration and the built-in token
  params.ts          request parameter parsing
  schemas.ts         domain schemas
tests/               API tests
deploy/k8s/          Kustomize manifests: base, an example overlay, a Cloudflare Tunnel rule
web/                 React + Vite UI (TanStack Router/Query, MapLibre, three.js, Tailwind CSS v4, Lingui)
  src/App.tsx        page layout: side panel and map
  src/state/         app state: transit data context, trip, live buses, bus selection, routes, map layers
  src/components/    panels, journey results, stop picker, map (MapView, BusModelLayer)
  src/components/ui/ shared primitives: Button, IconButton, Badge, Notice, Field, Tabs, …
  src/busMotion.ts   smooth bus movement along route lines between GPS fixes
  src/api.ts         API client and queries
  src/i18n.ts        Lingui setup, dates, times and units
  src/locales/       translation catalogs (English source, Sinhala, Tamil)
  src/styles.css     design tokens (colours, type scale, radii) and base styles
  tests/             frontend tests
skill/               Python client for the same upstream APIs (agent skill)
```

## Caveats

- Upstream APIs are unofficial and may change or rate-limit without notice.
- Location is used only when you press a location control; nearest-stop
  distance is straight-line, not walking distance.
- The basemap is OpenFreeMap's Positron style. Keep the OpenFreeMap,
  OpenMapTiles and OpenStreetMap attribution when hosting the UI.
