# Spikes (throwaway)

Proofs for the risks in the Cloudflare rewrite spec §10. Only the findings in
docs/superpowers/spikes/ matter; this folder is deleted in Phase 2.

Load credentials without printing them:

    set -a; . ./.cloudflare-spike.env; set +a

The container, socket and upstream spikes answer only requests carrying an
`x-spike-key` header that matches their `SPIKE_KEY` secret, so a found URL
can't start paid container runs or call the upstream. Keep the key in the
shell so you can send it:

    SPIKE_KEY=$(openssl rand -hex 16)
    printf %s "$SPIKE_KEY" | npm --prefix spikes exec wrangler -- secret put SPIKE_KEY --name metro-spike-<name>
    curl -s -H "x-spike-key: $SPIKE_KEY" https://metro-spike-<name>.<subdomain>.workers.dev/

Under `wrangler dev`, put `SPIKE_KEY=<key>` in the spike's `.dev.vars`
(gitignored) instead.

Deploy only Workers named metro-spike-*, and delete them when done:

    npm --prefix spikes exec wrangler -- delete --name metro-spike-<name>
