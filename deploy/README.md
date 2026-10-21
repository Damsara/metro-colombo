# Deploying to a VPS

CI builds the `Dockerfile` on every PR. A push to `main` publishes the image to
`ghcr.io/damsara/metro-colombo` (tagged with the commit and `latest`) and, once
deploys are switched on, restarts it on the VPS over SSH.

## On the VPS, once

1. Install Docker with the Compose plugin.
2. Make the folder CI deploys into, with this folder's `compose.yaml` and a
   `.env` written from `apps/node/.env.example`:

   ```bash
   mkdir ~/metro && cd ~/metro
   # copy compose.yaml here, then:
   cp /path/to/apps/node/.env.example .env && chmod 600 .env
   ```

   For the live feed set `LIVE_FEED=lankametro`, `UPSTREAM=lankametro`,
   `OTP_SECRET` (`openssl rand -hex 24`) and `ALERT_WEBHOOK_URL`. Leave
   `HOST`, `PORT`, `FLEET_STATE_PATH` and `DATA_DIR` out: the image sets them,
   and the Fleet's state lives in the `metro-state` volume.

3. The image is private on GHCR until you make it public (GitHub → your
   profile → Packages → metro-colombo → Package settings). Either make it
   public, or log the VPS in once with a token that has `read:packages`:
   `docker login ghcr.io -u <github-user>`.
4. Put a reverse proxy with HTTPS in front of `127.0.0.1:8789` (the compose
   file only listens there). The admin page and the code forwarding send
   `OTP_SECRET`, so never serve the site over plain HTTP.
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
