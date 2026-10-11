# JorBox

React 19 + Vite frontend, served by a Cloudflare Worker with a D1 database. Production is at https://jorbox.haseebshah.workers.dev. GitHub Pages deployment has been replaced by Cloudflare.

## Structure

- `src/App.jsx`: game selection, account state, playing and administrator views.
- `src/components/GameManager.jsx`: game creation, format changes, removal and restoration.
- `src/components/CardManager.jsx`, `BulkCardEditor.jsx`, `CardFields.jsx`: card management, reviewed bulk edits, CSV workflows and personal bulk feedback.
- `src/utils/DataManager.js`: same-origin JSON API client.
- `src/utils/cardFormats.js`, `cardCsv.js`: client-side format and CSV validation.
- `src/components/DuplicateCards.jsx`, `CopyCards.jsx`, `CategoryManager.jsx`, `AdminReports.jsx`: deck organization and read-only administrator reports.
- `worker/adminTools.js`, `http.js`: copy/category transactions, report queries, and shared request validation. Activity reports expose operation summaries, not saved card payloads.
- `worker/index.js`: API, GitHub OAuth, server authorization, voting, transactional game/card writes and auditing.
- `worker/migrations/`: ordered D1 migrations. Add a migration for schema changes; do not rewrite applied migrations.
- `public/games.json`, `public/data/*.csv`, `worker/seed.sql`: original seed, not live production data.
- `tests/`: Node tests using isolated real D1 through Miniflare and mocked GitHub responses.

## Development and verification

Node.js 22 or later. Run `npm ci`, `npm run lint`, `npm test`, and `npm run build`. For changes to administrator workflows, also run `npm run test:ui` (see README for browser installation).
For a local Worker, configure ignored `.dev.vars`, then run `npm run db:migrate:local`, `npm run db:seed:local`, and `npm run dev:worker`. See README for hot reload and OAuth callbacks.

## Invariants

- Check administrator identity by immutable GitHub ID on every game/card management write. Ordinary sign-in does not grant administration.
- Require same-origin writes. Validate formats and category requirements on the server as well as in the frontend.
- Every selection-based bulk operation is atomic, limited to 100 cards and 512 KB, and must reject stale card versions and game-state races. Game writes require the current game version. A reviewed whole-category rename/merge may affect all cards in that category; guard it with the reviewed count, game version, and audit revision.
- Copies must use current server-side source content, reject stale source/destination state, get new IDs, and start without votes. Never silently discard name/description fields to fit a destination format.
- Duplicate detection only suggests candidates. Require the existing review/removal flow to remove them; do not combine their votes.
- Reports are administrator-only and read-only. Feedback summaries exclude removed cards/games; history can include removed games. Never expose sessions or raw saved payloads in reports.
- Game and card removal are recoverable. Removed games cannot accept votes or card writes. Restoring a game retains card-level trash and feedback.
- Bulk feedback changes only the administrator's own vote, never aggregate counts or another player's votes.
- Game format changes must not silently discard content. Category clearing requires an explicit flag and a reviewed warning.
- Preserve legacy name-only and description-only cards. All cards need a name or description.
- Audit administrative changes. Keep OAuth secrets, cookie secrets, sessions, votes, and production database exports out of Git and the frontend bundle.
- Production migration/deployment uses Cloudflare credentials. Never reseed production to synchronize card edits.

## Design

Preserve the dark glass UI, existing colors and Outfit/Inter typography. Provide visible loading/error states, keyboard-accessible controls, review before writes, and responsive tables with contained horizontal scrolling.
