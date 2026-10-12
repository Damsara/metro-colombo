# Spikes (throwaway)

Proofs for the risks in the Cloudflare rewrite spec §10. Only the findings in
docs/superpowers/spikes/ matter; this folder is deleted in Phase 2.

Load credentials without printing them:

    set -a; . ./.cloudflare-spike.env; set +a

Deploy only Workers named metro-spike-*, and delete them when done:

    npm --prefix spikes exec wrangler -- delete --name metro-spike-<name>
