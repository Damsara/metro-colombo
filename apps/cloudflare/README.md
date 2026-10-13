# apps/cloudflare

Install with npm 11 (`npx npm@11.21.0 install` from this folder): npm 10.9.8 crashes in arborist (`Cannot read properties of null (reading 'edgesOut')`) on vite 8's optional peer dependencies.

Staging (`metro-staging`) is deployed only for a check and deleted after it, because a second Fleet doubles the Durable Object duration (spec §9). Build the web app first (`npm --prefix web run build`): the Worker serves `web/dist` as static assets.

## Production env

`--env production` deploys the Worker `metro` on `metro.manasa.ai/*` (zone `manasa.ai`), with no `workers.dev` URL. Compared with staging, it:

- binds `ARCHIVE` to `metro-data`, the production bucket, instead of `metro-data-staging`;
- sets `LIVE_FEED=lankametro`, so the Fleet logs in and records the live feed instead of replaying a day, and has no `REPLAY_DATE` or `REPLAY_SPEED`;
- sets `UPSTREAM=lankametro` and has no `UPSTREAM_PROXY_URL`, because proxying to `https://metro.manasa.ai` from the Worker that serves it would call itself.

The Durable Object binding, the migrations, the assets, the cron and `PUBLIC_DATA_URL` stay the same. Wrangler warns that `REPLAY_DATE`, `REPLAY_SPEED` and `UPSTREAM_PROXY_URL` are missing from `env.production.vars`. They are left out on purpose.

Secrets never go in the config. Set them before the first production deploy:

```sh
./node_modules/.bin/wrangler secret put OTP_SECRET --env production
./node_modules/.bin/wrangler secret put METRO_PHONE --env production
./node_modules/.bin/wrangler secret put ALERT_WEBHOOK_URL --env production
```

With two environments, wrangler warns when no `--env` is given. `--env ""` targets staging explicitly.
