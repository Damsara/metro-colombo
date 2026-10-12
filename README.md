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
- **Track your trip:** a bus card shows the stops ahead of the bus you're
  riding and notices when the operator swaps in another bus. A shared link
  restores the tracking.
- **Browse routes:** each route's two directions, its stops in order, its
  path, and live buses placed at their nearest stop.
- **Live map:** buses are 3D models moving along their route between GPS
  fixes, bouncing more the fuller they are. The map tilts as you zoom in and
  shows 3D buildings on capable devices; a 2D/3D switch turns that off. Tap a
  bus to follow it, or switch to the **driver view** to ride behind it.
- **Festive touches:** on Sri Lankan holidays the map greets riders and
  decorates the stops, from Vesak lanterns on bamboo poles to Christmas
  trees. Riders can turn the touches off.
- **Fleet archive:** every live position is recorded and published as a
  public DuckDB database; the **Data** page shows how to query it. See
  [Fleet archive](#fleet-archive).
- **Ten languages:** English, Sinhala, Tamil, Hindi, Russian, Chinese,
  Japanese, German, French and (as a joke) Latin, starting in the browser's
  language. Stop search matches names in English, Sinhala and Tamil and stop
  codes. Route names stay in English, because the available translations are
  unreliable.
- On phones the map opens full screen, and the Back button steps back
  through map, results and form.
- Add `?crowding=roomy`, `filling`, `crowded` or `mixed` to the URL to preview
  the bus bounce.

## Quick start

Requires Node.js **22.19+** and a phone number that can receive an SMS OTP
from the LMT GO service.

```bash
npm install
npm --prefix web install
npm --prefix web run build             # the API server also serves the built UI
node scripts/otp-login.mjs 0712345678  # one-time login; see "The token"
npm start                              # -> http://127.0.0.1:8788
```

For frontend development, run the API with `npm run dev` and, in a second
terminal, `npm --prefix web run dev` (http://localhost:5173). Vite forwards
`/api/*` to the API on port 8788. To test on a phone on the same network, start
Vite with `npm --prefix web run dev -- --host`.

### The token

The operator's API needs a signed-in account for everything this app uses:
routes, stops, journeys and the live feed. The server signs in with one
account on behalf of every visitor, so visitors never log in.

`scripts/otp-login.mjs` does the one-time sign-in. It sends an OTP to the
phone number, asks for the code (and, for a new account, a name and NIC) and
saves the resulting refresh token as `METRO_REFRESH_TOKEN` in `.env`. It
never prints the token.

```bash
node scripts/otp-login.mjs <phone>                  # 07XXXXXXXX, 94XXXXXXXXX or +94XXXXXXXXX
node scripts/otp-login.mjs --send <phone>           # or in two steps: text the code…
node scripts/otp-login.mjs --verify <code>          # …then sign in with it
node scripts/otp-login.mjs --token <refresh_token>  # save a refresh token you already have
node scripts/otp-login.mjs --refresh                # swap the token in .env for a new one
```

The two-step form suits shells that can't answer a prompt. `--send` keeps the
code's reference in `.otp-reference` (gitignored) until `--verify` uses it.
New accounts have to register with the interactive form.

From then on the server renews its own access. A refresh token works once, so
after each renewal the server saves the new one to `.auth-state` (or
`AUTH_STATE_PATH`) and reads it from there on restart, ignoring the spent one
in `.env`. If the saved token stops working, for example after the server was
off for more than about 7 days, run the login again: the server falls back to
the new token in `.env`.

Treat `.env` and `.auth-state` like a password: they act as the account that
signed in. Both are gitignored.

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

Translate each new entry in every catalog under `web/src/locales/`, one per
language (any gettext editor works). Keep every
`{placeholder}` and `<0>tag</0>`; the order may change to suit the language.
Plurals use ICU syntax, e.g. `{count, plural, one {# stop} other {# stops}}`.

The production build fails if a catalog entry is untranslated, and the
frontend tests fail if a translation drops or renames a placeholder. Neither
notices English text that hasn't been extracted yet, so run `i18n:extract`
before building. Stop and place names come translated from the API, not from
the catalogs.

## Configuration

| Variable                 | Default                              | Purpose                                                     |
| ------------------------ | ------------------------------------ | ----------------------------------------------------------- |
| `METRO_REFRESH_TOKEN`    | none (required)                      | upstream refresh token from `scripts/otp-login.mjs`         |
| `AUTH_STATE_PATH`        | `.auth-state`                        | where the renewed refresh token is saved                    |
| `EIMSKY_BASE`            | `https://metrobusapiprod.eimsky.com` | MetroBus backend                                            |
| `LANKAMETRO_BASE`        | `https://lankametro.lk`              | route colours, landmarks, geometry fallback                 |
| `HOST` / `PORT`          | `127.0.0.1` / `8788`                 | listen address; set `HOST=0.0.0.0` to accept other machines |
| `WEB_DIST`               | `web/dist`                           | built UI served next to the API                             |
| `VITE_GA_MEASUREMENT_ID` | unset (no analytics)                 | GA4 id baked into the UI at build time                      |
| `OCCASIONS_ICS_URL`      | calendarlabs Sri Lanka holidays      | holiday calendar for the festive touches                    |
| `ARCHIVE_R2_*`           | unset (archive off)                  | Cloudflare R2 bucket for the fleet archive; see below       |
| `OTEL_*`                 | unset (no telemetry)                 | traces, logs and metrics over OTLP; see `.env.example`      |

`npm start` and `npm run dev` load `.env` when present; `.env.example` lists
the variables.

### Analytics

Analytics are off unless the UI is built with `VITE_GA_MEASUREMENT_ID`
(`VITE_GA_MEASUREMENT_ID=G-… npm --prefix web run build`, or
`docker build --build-arg VITE_GA_MEASUREMENT_ID=G-… .`). With an id, the UI
asks each visitor once, on first load, whether usage may be counted to help
decide what to improve; "Allow" and "No thanks" are equal choices, the app
works the same either way, and "Privacy choices" in the footer changes it
later. Nothing is loaded from Google until a visitor allows it. Once allowed,
the UI loads Google Analytics 4 and sends page views plus a few product events:
trip searches and results, the next-day search, tracking a bus and its
milestones, following a bus, opening a route, using your location, and
changing language. Events carry route and stop codes and day offsets, never
stop names, places, coordinates or anything typed. Visitors with Do Not Track
on are never asked or tracked. In the GA property, turn off Enhanced measurement's
"page changes based on browser history events", since the app sends its own
page views and its `?trip=1`-style flags aren't pages.

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
| `/api/occasions`               | 24 h → 30 d           | upcoming Sri Lankan holidays and the festive theme for each                     |

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

## Fleet archive

Every live position is kept and published so anyone can study how the buses
really run. The server records the feed into gzipped five-minute chunks on
Cloudflare R2, plus a rolling `today/live.ndjson.gz`, and never reads them
back. An hourly job (`ops/archive/`, Python and DuckDB) compacts finished days
into zstd Parquet, writes today's earlier hours to one file, and publishes a
small DuckDB catalog of views over all of it. Readers fetch Parquet straight
from R2's public domain, so queries cost the API server almost nothing.

```sql
ATTACH 'https://metro.manasa.ai/' AS metro;  -- the site root serves the catalog to DuckDB
SELECT route_code, count(DISTINCT bus_id) FROM metro.fixes_today GROUP BY ALL;
```

The **Data** page (`/data`) lists the tables and columns, links each example
to the DuckDB web shell, and suggests things to try, such as bus bunching and
real gaps between buses at a stop.

To run your own, set `ARCHIVE_R2_ACCOUNT_ID`, `ARCHIVE_R2_ACCESS_KEY_ID`,
`ARCHIVE_R2_SECRET_ACCESS_KEY`, `ARCHIVE_R2_BUCKET` (default `metro-data`)
and `ARCHIVE_PUBLIC_URL` (the bucket's public domain) for the server, and run
`ops/archive/compact.py` hourly (its `Dockerfile` builds an image) with the
same variables and `ARCHIVE_ROOT=r2://<bucket>`. Without the R2 variables the
recorder stays off. Give the bucket a CORS rule allowing `GET` and `HEAD` with
`Range` from any origin so the browser shell can read it, and don't let your
CDN cache 404s for `.parquet` files.

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
docker run -p 8788:8788 --env-file .env -v metro-state:/data metro
```

The `/data` volume keeps the renewed token; without it, every new container
starts from the token in `.env`, which is spent after the first run.

`deploy/k8s/` has Kustomize manifests, with `example.com` placeholders for
the image registry and hostname:

- `base/` is the app itself: a namespace that enforces the restricted Pod
  Security Standard, the Deployment, its Service and ServiceAccount, a small
  PersistentVolumeClaim for the renewed token, and a NetworkPolicy that only
  lets in the ingress controller and only lets out DNS and HTTPS to the public
  internet.
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

- After the first `kubectl apply`, create the token Secret from a `.env` made
  by `scripts/otp-login.mjs` (never commit it), then restart the pod:

  ```bash
  kubectl -n metro create secret generic metro-secrets \
    --from-literal=METRO_REFRESH_TOKEN="$(grep '^METRO_REFRESH_TOKEN=' .env | cut -d= -f2-)"
  kubectl -n metro rollout restart deployment/metro
  ```

- Run one replica. Two pods would share one account and spend each other's
  refresh tokens, so rollouts use `Recreate`: a few seconds of downtime.
- The liveness probe only checks the port is open, because `/api/health`
  calls the upstream and would restart a healthy pod during an upstream
  slowdown. Readiness uses `/api/health`, which stays 200 while the API serves
  its stale cache.
- The NetworkPolicy assumes the ingress controller runs in `kube-system` (as
  k3s's Traefik does) and needs a CNI that enforces policies. `preStop.sleep`
  needs Kubernetes 1.30 or newer.

## Project layout

```
src/                 Effect API server
  server.ts          routes, static UI hosting, entry point
  upstream.ts        UpstreamApi service: upstream clients + stale-on-error caches
  live-fleet.ts      LiveFleet service: persistent GPS feed connection
  auth.ts            Auth service: renews and saves the upstream token
  occasions.ts       holiday feed and /api/occasions
  archive/           fleet archive: R2 store, recorder, catalog serving
  config.ts          environment configuration
  params.ts          request parameter parsing
  schemas.ts         domain schemas
tests/               API tests
scripts/otp-login.mjs  one-time phone-OTP sign-in
ops/archive/         hourly compactor: daily Parquet and the DuckDB catalog
deploy/k8s/          Kustomize manifests: base, an example overlay, a Cloudflare Tunnel rule
web/                 React + Vite UI (TanStack Router/Query, MapLibre, three.js, Tailwind CSS v4, Lingui)
  src/App.tsx        page layout: side panel and map
  src/state/         app state: transit data context, trip, live buses, bus selection, routes, map layers
  src/components/    panels, journey results, stop picker, map (MapView, BusModelLayer)
  src/components/ui/ shared primitives: Button, IconButton, Badge, Notice, Field, Tabs, …
  src/busMotion.ts   smooth bus movement along route lines between GPS fixes
  src/occasions/     festive themes, moments and stop decorations
  src/DataDocs.tsx   the /data page for the fleet archive
  src/api.ts         API client and queries
  src/i18n.ts        Lingui setup, dates, times and units
  src/locales/       translation catalogs (English source and nine translations)
  src/styles.css     design tokens (colours, type scale, radii) and base styles
  tests/             frontend tests
```

## Caveats

- Upstream APIs are unofficial and may change or rate-limit without notice.
- Location is used only when you press a location control; nearest-stop
  distance is straight-line, not walking distance.
- The basemap is OpenFreeMap's Positron style. Keep the OpenFreeMap,
  OpenMapTiles and OpenStreetMap attribution when hosting the UI.

## License

[MIT](LICENSE). Transit data belongs to its operators; the basemap is
© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.
