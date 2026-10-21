# Deploying to a VPS

CI builds the `Dockerfile` on every PR. A push to `main` publishes the image to
`ghcr.io/damsara/metro-colombo` (tagged with the commit and `latest`) and, once
deploys are switched on, restarts it on the VPS over SSH.

## On the VPS, once

1. Install Docker with the Compose plugin. Point your domain's DNS (an `A`
   record, and `AAAA` for IPv6) at the VPS, and open ports 80 and 443 (TCP,
   and UDP 443 for HTTP/3).
2. Make the folder CI deploys into, with this folder's `compose.yaml` and
   `Caddyfile` and a `.env` written from `apps/node/.env.example`:

   ```bash
   mkdir ~/metro && cd ~/metro
   # each deploy copies compose.yaml and Caddyfile here; for the first start copy them yourself, then:
   cp /path/to/apps/node/.env.example .env && chmod 600 .env
   echo "METRO_DOMAIN=metro.example.com" >> .env
   ```

   For the live feed set `LIVE_FEED=lankametro`, `UPSTREAM=lankametro`,
   `OTP_SECRET` (`openssl rand -hex 24`) and `ALERT_WEBHOOK_URL`. Leave
   `HOST`, `PORT`, `FLEET_STATE_PATH` and `DATA_DIR` out: the image sets them,
   and the Fleet's state lives in the `metro-state` volume.

3. The image is private on GHCR until you make it public (GitHub → your
   profile → Packages → metro-colombo → Package settings). Either make it
   public, or log the VPS in once with a token that has `read:packages`:
   `docker login ghcr.io -u <github-user>`.
4. HTTPS comes from the `caddy` service: it gets a Let's Encrypt certificate
   for `METRO_DOMAIN` on first start, renews it, and redirects plain HTTP.
   The app itself is not published on any host port, so only Caddy reaches
   it. The admin page and the code forwarding send `OTP_SECRET`, which is
   why there is no plain-HTTP way in.
5. Give CI its own SSH key, allowed to run Docker:

   ```bash
   ssh-keygen -t ed25519 -f metro-deploy -N ""   # on your laptop
   # append metro-deploy.pub to ~/.ssh/authorized_keys of the deploy user on the VPS
   ssh-keyscan <vps-host>                         # output goes in VPS_KNOWN_HOSTS
   ```

## In GitHub, once

Settings → Secrets and variables → Actions:

| Kind     | Name              | Value                                         |
| -------- | ----------------- | --------------------------------------------- |
| Secret   | `VPS_HOST`        | the VPS address                               |
| Secret   | `VPS_USER`        | the deploy user                               |
| Secret   | `VPS_SSH_KEY`     | the private key `metro-deploy`                |
| Secret   | `VPS_KNOWN_HOSTS` | the `ssh-keyscan` output                      |
| Variable | `PUBLIC_URL`      | e.g. `https://metro.example.com`, for a check |
| Variable | `VPS_DEPLOY`      | `true` to switch deploys on                   |

The deploy job runs in the `production` environment, so you can require your
own approval there (Settings → Environments → production).

## After the first deploy

Open `https://<your-domain>/fleet/admin`, paste `OTP_SECRET`, send a code to
your LMT-GO number and enter it. From then on the Fleet renews its session on
its own; see "Logging in" in the main README for forwarding codes
automatically.
