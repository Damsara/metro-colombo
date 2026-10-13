# apps/cloudflare

Install with npm 11 (`npx npm@11.21.0 install` from this folder): npm 10.9.8 crashes in arborist (`Cannot read properties of null (reading 'edgesOut')`) on vite 8's optional peer dependencies.

Staging (`metro-staging`) is deployed only for a check and deleted after it, because a second Fleet doubles the Durable Object duration (spec §9). Build the web app first (`npm --prefix web run build`): the Worker serves `web/dist` as static assets.

## Production env

`--env production` deploys the Worker `metro` on `metro.manasa.ai/*` (zone `manasa.ai`), with no `workers.dev` URL. Compared with staging, it:

- binds `ARCHIVE` to `metro-data`, the production bucket, instead of `metro-data-staging`;
- sets `LIVE_FEED=lankametro`, so the Fleet logs in and records the live feed instead of replaying a day, and has no `REPLAY_DATE` or `REPLAY_SPEED`;
- sets `UPSTREAM=lankametro` and has no `UPSTREAM_PROXY_URL`, because proxying to `https://metro.manasa.ai` from the Worker that serves it would call itself.

- sets `ARCHIVE_ROOT=r2://metro-data` for the compactor instead of `r2://metro-data-staging`.

The Durable Object bindings, the migrations, the container, the assets and `PUBLIC_DATA_URL` stay the same. Wrangler warns that `REPLAY_DATE`, `REPLAY_SPEED` and `UPSTREAM_PROXY_URL` are missing from `env.production.vars`. They are left out on purpose.

Secrets never go in the config. Set them before the first production deploy:

```sh
./node_modules/.bin/wrangler secret put OTP_SECRET --env production
./node_modules/.bin/wrangler secret put METRO_PHONE --env production
./node_modules/.bin/wrangler secret put ALERT_WEBHOOK_URL --env production
```

## Scheduling

There is no cron trigger: it never fired in production. The Fleet's alarm, every few seconds, drives everything scheduled. It checks for a due reference publish every 5 minutes and starts the archive compactor once per Colombo hour, at or after minute 7. The last started hour is kept in the Fleet's storage, so a restart doesn't run it twice.

## Archive compactor

The `Compactor` Durable Object runs `ops/archive/Dockerfile` (Python and DuckDB, `compact.py`) unchanged in a Cloudflare Container: `basic` (1/4 vCPU, 1 GiB, like the old CronJob's limit), at most one instance. Wrangler builds the image with local Docker on deploy. A run starts the container, waits for it to exit, and destroys it after 25 minutes, the CronJob's `activeDeadlineSeconds`. If a run is still going, the next hour's start is skipped. The log has `compactor finished` with the exit code and duration, `compactor timed out`, or `compactor skipped` with the reason.

The container gets `ARCHIVE_ROOT` and `PUBLIC_DATA_URL` from the vars, and three secrets for R2's S3 API. Without all three, the compactor doesn't start. Set them per env:

```sh
./node_modules/.bin/wrangler secret put ARCHIVE_R2_ACCESS_KEY_ID --env production
./node_modules/.bin/wrangler secret put ARCHIVE_R2_SECRET_ACCESS_KEY --env production
./node_modules/.bin/wrangler secret put ARCHIVE_R2_ACCOUNT_ID --env production
```

Once the Worker compactor has run, suspend the k3s CronJob so the two never run together:

```sh
ssh <k3s-host> 'export KUBECONFIG=$HOME/.kube/config; kubectl -n metro patch cronjob metro-archive -p "{\"spec\":{\"suspend\":true}}"'
```

Cost: Containers bill vCPU, memory and disk while the instance runs, beyond the Workers Paid allowance (at the time of writing 375 vCPU-minutes, 25 GiB-hours and 200 GB-hours a month). At 5 minutes a run, that is about 900 vCPU-minutes and 60 GiB-hours a month, roughly $1 over the allowance; check the real run length in the log. The image is pushed to Cloudflare's registry on each deploy that changes it. Lock-in: the image is a plain Dockerfile, so it runs on any container host; only the scheduling is Cloudflare-specific.

With two environments, wrangler warns when no `--env` is given. `--env ""` targets staging explicitly.
