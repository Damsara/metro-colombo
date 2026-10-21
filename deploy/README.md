# Deploying with Dokploy

CI builds the `Dockerfile` on every PR. A push to `main` publishes the image to
`ghcr.io/damsara/metro-colombo` (tagged with the commit and `latest`) and, once
deploys are switched on, asks Dokploy to redeploy it. Dokploy runs the container
and serves it over HTTPS with its own Traefik proxy.

## In Dokploy, once

1. Create a project, then an Application in it.
2. General → source **Docker**, image `ghcr.io/damsara/metro-colombo:latest`.
   The image is private on GHCR until you make it public (GitHub → your
   profile → Packages → metro-colombo → Package settings); otherwise add
   registry credentials in Dokploy with a token that has `read:packages`.
3. Environment, written from `apps/node/.env.example`: for the live feed set
   `LIVE_FEED=lankametro`, `UPSTREAM=lankametro`, `OTP_SECRET`
   (`openssl rand -hex 24`) and `ALERT_WEBHOOK_URL`. Leave `HOST`, `PORT`,
   `FLEET_STATE_PATH` and `DATA_DIR` out: the image sets them.
4. Advanced → Volumes: mount a volume at `/data`. The Fleet's login lives
   there; without it every redeploy needs a new SMS code.
5. Domains: add your domain on container port `8789` with HTTPS (Let's
   Encrypt), and point its DNS at the server. Keep the app HTTPS-only: the
   admin page and the code forwarding send `OTP_SECRET`.
6. Deploy once by hand, and note the application ID (in the app's URL, or
   from `GET /api/project.all`). Create an API key under your Dokploy
   profile for CI.

## In GitHub, once

Settings → Secrets and variables → Actions:

| Kind     | Name             | Value                                         |
| -------- | ---------------- | --------------------------------------------- |
| Secret   | `DOKPLOY_TOKEN`  | the Dokploy API key                           |
| Secret   | `DOKPLOY_APP_ID` | the application ID                            |
| Variable | `DOKPLOY_URL`    | e.g. `https://dokploy.example.com`            |
| Variable | `PUBLIC_URL`     | e.g. `https://metro.example.com`, for a check |
| Variable | `DOKPLOY_DEPLOY` | `true` to switch deploys on                   |

The deploy job runs in the `production` environment, so you can require your
own approval there (Settings → Environments → production).

## After the first deploy

Open `https://<your-domain>/fleet/admin`, paste `OTP_SECRET`, send a code to
your LMT-GO number and enter it. From then on the Fleet renews its session on
its own; see "Logging in" in the main README for forwarding codes
automatically.
