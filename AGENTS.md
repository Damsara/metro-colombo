# Working on lmt-go-ui

A rider-facing app for Lanka Metro buses: an Effect-TS API in `src/` and a React + Vite + MapLibre UI in `web/src/`. Read this before changing anything.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | Server tests |
| `npm run typecheck` | Server types |
| `npm --prefix web test` | Web tests (vitest) |
| `(cd web && npx tsc --noEmit)` | Web types |
| `(cd web && npx prettier --check <files>)` | Formatting; run from `web/` so the Tailwind plugin resolves |
| `npm --prefix web run i18n:extract` | Update the translation catalogs |

## House rules

- No code comments unless the reason can't be seen in the code, and then one plain sentence. Don't restate what code does.
- All user-facing text goes through Lingui (`t`, `Trans`, `Plural`). English is the source; Sinhala and Tamil live in `web/src/locales/*/messages.po`. Lanes don't edit `.po` files; the coordinator extracts and translates.
- Match the surrounding code. Colours come from `web/src/theme.ts` / `styles.css` tokens; route colours go through `routeColor()` in `web/src/lib/routeColor.ts`.
- Pure logic goes in `web/src/lib/` with unit tests; components stay thin.
- Respect `prefers-reduced-motion`.
- Don't add or change dependencies without asking.

## Lanes

Parallel work runs one git worktree per lane on `lane/<name>`. A lane edits only the files its brief says it owns. Brief in `.handoff/brief.md`, report out `.handoff/report.md`, with status `done`, `partial` or `blocked` and the output of each check. Stop with `blocked` rather than editing a file you don't own or changing a shared contract.

## Git

Commit after each green step with a plain subject line and trailers `Lane:` and `Task:`. Never push, never touch `main`.
