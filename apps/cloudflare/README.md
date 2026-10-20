# apps/cloudflare

The production home of metro.manasa.ai: one Worker that serves the site and the API, the **Fleet** Durable Object that holds the upstream login and the live feed, and the **Compactor** Durable Object that runs the archive compactor in a container. The domain code lives in `packages/`; this folder wires it to Workers, Durable Objects and R2.

## Setup

Install with npm 11 from this folder: `npx npm@11.21.0 install`. npm 10.9.8 crashes in arborist (`Cannot read properties of null (reading 'edgesOut')`) on vite 8's optional peer dependencies.

The Worker serves `web/dist` as static assets, so build the web app first with `npm --prefix web run build`.

```sh
npm run dev                 # wrangler dev
npm test                    # Worker tests (vitest on workerd)
npm run typecheck
npm run deploy:staging
npm run deploy:production
```

Wrangler warns when no `--env` is given, because there are two environments; `--env ""` targets staging explicitly.

## Environments

|                     | Staging (default)                      | Production (`--env production`)   |
| ------------------- | -------------------------------------- | --------------------------------- |
| Worker              | `metro-staging`, on `workers.dev`      | `metro`, on `metro.manasa.ai/*`   |
| `ARCHIVE` bucket    | `metro-data-staging`                   | `metro-data`                      |
| Live feed           | replays a recorded day (`REPLAY_DATE`) | logs in and records the real feed |
| Routes and journeys | proxied from `https://metro.manasa.ai` | read from Lanka Metro directly    |
| `ARCHIVE_ROOT`      | `r2://metro-data-staging`              | `r2://metro-data`                 |

Production can't proxy to `https://metro.manasa.ai`, because that's itself. Wrangler warns that `REPLAY_DATE`, `REPLAY_SPEED` and `UPSTREAM_PROXY_URL` are missing from `env.production.vars`; they are left out on purpose. Everything else (the Durable Object bindings and migrations, the container, the assets and `PUBLIC_DATA_URL`) is the same in both.

Deploy staging only for a check and delete it afterwards: a second Fleet doubles the Durable Object duration you pay for.

## Secrets

Secrets never go in the config. Set them per environment with `./node_modules/.bin/wrangler secret put <NAME> --env production`.

| Secret                         | Used by   | Without it                                        |
| ------------------------------ | --------- | ------------------------------------------------- |
| `METRO_PHONE`                  | Fleet     | no login code can be texted when the session dies |
| `OTP_SECRET`                   | Fleet     | `POST /fleet/otp` is off                          |
| `ALERT_WEBHOOK_URL`            | Fleet     | login alerts are only logged                      |
| `ARCHIVE_R2_ACCESS_KEY_ID`     | Compactor | the compactor doesn't start (it needs all three)  |
| `ARCHIVE_R2_SECRET_ACCESS_KEY` | Compactor |                                                   |
| `ARCHIVE_R2_ACCOUNT_ID`        | Compactor |                                                   |

## Scheduling

There is no cron trigger. The Fleet's alarm fires every few seconds and drives everything scheduled: it checks for a due reference publish every 5 minutes, and starts the compactor once per Colombo hour, at or after minute 7. The last started hour is kept in the Fleet's storage, so a restart doesn't run it twice.

## Archive compactor

The `Compactor` Durable Object runs the unchanged `ops/archive/Dockerfile` (Python and DuckDB, `compact.py`) in a Cloudflare Container: `basic` (1/4 vCPU, 1 GiB), at most one instance. Wrangler builds the image with local Docker on deploy and pushes it to Cloudflare's registry when it changes.

A run starts the container, waits for it to exit, and destroys it after 25 minutes. If a run is still going, the next hour's start is skipped. The container gets `ARCHIVE_ROOT` and `PUBLIC_DATA_URL` from the vars and the three R2 secrets above. Look for these in the log:

- `compactor finished`, with the exit code and duration
- `compactor timed out`
- `compactor skipped`, with the reason

**Cost.** Containers bill vCPU, memory and disk while the instance runs, beyond the Workers Paid allowance (at the time of writing 375 vCPU-minutes, 25 GiB-hours and 200 GB-hours a month). At 5 minutes a run, that's about 900 vCPU-minutes and 60 GiB-hours a month, roughly $1 over the allowance; check the real run length in the log.

**Lock-in.** The image is a plain Dockerfile and runs on any container host; only the scheduling is Cloudflare-specific.
