# Contributing to metro-colombo

A trip planner and live bus map for Lanka Metro Transit. The domain lives in Effect-TS packages under `packages/`, run by `apps/cloudflare` (production, metro.manasa.ai) and `apps/node` (one Node process). The UI is React, Vite and MapLibre in `web/`.

## Checks

Run these before sending a pull request.

| Command                                    | Does                                                        |
| ------------------------------------------ | ----------------------------------------------------------- |
| `npm test`                                 | Package and Node app tests                                  |
| `npm run typecheck`                        | Package and Node app types                                  |
| `(cd apps/cloudflare && npm test)`         | Worker tests                                                |
| `npm --prefix web test`                    | Web tests (Vitest)                                          |
| `(cd web && npx tsc --noEmit)`             | Web types                                                   |
| `(cd web && npx prettier --check <files>)` | Formatting; run from `web/` so the Tailwind plugin resolves |
| `npm --prefix web run i18n:extract`        | Update the translation catalogs                             |

## Code

- Shared packages import nothing runtime-specific: no `node:*`, Cloudflare or platform imports. `tests/boundaries.test.ts` enforces it.
- Comment only what the code can't say, in one plain sentence.
- Pure logic goes in `web/src/lib/` with unit tests; components stay thin.
- Colours come from the `web/src/theme.ts` and `styles.css` tokens; route colours go through `routeColor()` in `web/src/lib/routeColor.ts`.
- Respect `prefers-reduced-motion`.
- Open an issue before adding or changing a dependency.

## Text and translations

All user-facing text goes through Lingui (`t`, `Trans`, `Plural`), with English as the source. After changing English text, run `i18n:extract` and translate the new entries in every catalog under `web/src/locales/`; the production build fails on an untranslated entry.

## Commits

Small commits with a plain subject line that says what changed, e.g. "Show the next stop on the bus card".
