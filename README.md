# Shabab JorBox

React companion app backed by Cloudflare Workers and D1. The Worker serves both the Vite frontend and `/api/*` on one origin. GitHub stores source, migrations, and the original CSV seed; D1 stores live cards, feedback, sessions, and the audit trail.

Production URL: https://jorbox.haseebshah.workers.dev

## Features

- All 16 original games and 19,420 cards, including name-only and description-only formats.
- Persistent likes/dislikes, one vote per signed visitor cookie or signed-in GitHub account; click again to clear a vote. Anonymous feedback uses browser identity, not a verified person. Clearing cookies or using another browser can create another identity; per-IP rate limits reduce repeated abuse.
- GitHub OAuth with PKCE and expiring, HttpOnly server sessions. OAuth access tokens are used to verify identity and are not stored.
- Card management restricted to `thehaseebshah` (GitHub ID `48080916`), checked on every write. Signing in alone does not grant editing access.
- Create, rename, remove, and restore games. Configure name-only, description-only, name-and-description, or flexible cards, with optional categories.
- Add/edit cards and categories; search, category filters, feedback counts, CSV export, import previews, edits by exported ID/version, bulk category moves, bulk removals, and restores.
- Edit selected cards directly, apply reviewed replacements to selected fields, sort by feedback, and like/dislike/clear your own feedback in bulk or from CSV. Other players' votes are retained.
- Detect duplicate cards, copy selected cards between games, rename or merge whole categories, browse administrator activity, and review feedback totals and leading cards.
- Up to 100 cards per atomic write, maximum request/file size 512 KB. Larger CSVs must be split. Edits replace all content fields; missing fields clear their content. New imports always create new cards, including repeated content.
- Stale versions, invalid rows, or IDs from another game reject the entire bulk change. No partial writes. Removed cards retain their content and feedback in a recoverable trash view. Every successful administrative operation records its actor and submitted rows in `audit_log`.

## Local development

Requires Node.js 22 and npm.

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Fill `COOKIE_SECRET` with a random value (`openssl rand -hex 32`). GitHub credentials are optional for playing and feedback, but required to sign in. Never commit `.dev.vars`.

```sh
npm run db:migrate:local
npm run db:seed:local
npm run dev:worker
```

Open http://localhost:8787. D1 state lives in ignored `.wrangler/`; local changes do not change production. The Worker watches backend files. After frontend edits, run `npm run build` and reload.

For frontend hot reload, keep `wrangler dev` running in another terminal and run `npm run dev`. Set local `APP_ORIGIN=http://localhost:5173` and use that origin in the browser; Vite proxies `/api` to the Worker. Add `http://localhost:5173/api/auth/github/callback` to the OAuth app for this mode.

```sh
npm run lint
npm test
npm run build
```

Tests run against isolated real local D1 through Miniflare and mocked GitHub responses. They cover authorization, CSRF, voting, bulk transactions, stale versions, soft deletion, OAuth state/PKCE/logout, rate limiting, CSV errors, and baseline seed completeness. Production GitHub login still needs a real browser check after OAuth configuration.

Run `npm run test:ui` for administrator workflows in Chromium against an ephemeral local D1 database with a test-only administrator session. It checks game/card creation, CSV import/export, bulk editing and feedback, format validation, category conversion, game removal/restoration, and mobile overflow. It uses `/usr/bin/chromium` when available; otherwise install Playwright Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Screenshots are written to ignored `.ui-artifacts/`. These checks never contact production or use your OAuth credentials.

## Administrator workflows

Sign in as the administrator, then use **Manage games & formats** to add a game or edit its name and card fields. Existing cards, including removed cards, must fit the chosen format; incompatible changes fail without saving anything. To narrow a format, first use the flexible format to edit or clear the affected fields, then select the narrower format.

When enabling categories on an existing deck, choose a default category for all uncategorized cards, including trash. When disabling categories, explicitly choose to clear category text and review the warning; export first if you need a copy. These operations advance affected card versions, so previously exported CSVs must be refreshed.

Removing a game hides the entire deck and blocks feedback and card changes. **Show removed games** lets you restore it with its cards and feedback intact. Cards individually removed before the game was removed remain in card trash afterward.

Choose a game and open **Manage cards** for card operations:

- Filter by text, category, or your feedback; sort by name, likes, or dislikes. Select a page or up to the first 100 matching cards.
- **Edit selected cards** opens a draft for each card. Optional replacements apply only to checked fields; blank replacements clear text. Review every draft before confirming. Changes are atomic, and stale versions reject the entire operation.
- **Like selected**, **Dislike selected**, and **Clear my feedback** affect only the signed-in administrator's vote. Aggregate feedback counts cannot be imported or overwritten. Feedback changes do not advance card content versions.
- **Export** downloads the selected cards, or all matching cards when none are selected, including IDs, content versions, aggregate counts, and `myVote`.
- CSV import can add cards, edit existing content, or update your feedback. Content edits replace all content fields. Feedback mode requires `id`, `version`, and `myVote` (`1`, `-1`, or `0`); it ignores content and aggregate-count columns. Every CSV operation is limited to 100 rows and 512 KB. Split larger files into reviewed batches.

All game changes, category conversions, card changes, and bulk feedback operations record the administrator and submitted changes in `audit_log`. The game-management migration preserves the original card content and votes and infers single-field formats for existing single-field decks.

### Organization and reports

- **Find duplicates** compares active cards by name, description, and category, ignoring capitalization, compatibility characters, and repeated whitespace. It suggests extra copies to select; nothing is removed automatically. One deterministic card ID is kept by default in each group. Review feedback before choosing which copy to keep. Votes stay attached to their original card, including in trash; they are not merged.
- **Copy selected cards** creates up to 100 new cards in another active game. Source content is read on the server and both decks are checked for concurrent changes. Copies start at version 1 with no feedback; source cards remain intact. Choose a destination category when needed. Uncategorized destinations omit category text from copies. Incompatible name/description formats are rejected rather than silently dropping content.
- **Manage categories** shows active and removed card counts. A rename or merge updates every card in the source category, including trash, in one transaction. This dedicated deck-wide operation can affect more than 100 cards; it is separate from selection-based bulk editing. The reviewed count, game version, and audit revision must still match when saving. Content and feedback are preserved, card versions advance, and the old category disappears when no cards use it.
- **Admin reports → Feedback overview** shows current card counts, rated/unrated cards, likes/dislikes, and the ten most liked and disliked cards, across active games or one selected game. Card and game trash are excluded. **Review this card** opens card management focused on that card. Anonymous counts describe browser identities, not verified people.
- **Admin reports → Activity log** lists administrator operations newest first, with game, time, item count, and immutable administrator ID. Filter by active or removed game and paginate 50 entries at a time. Saved card payloads, OAuth/session records, and individual player votes are not exposed in the report. This is read-only history, not an undo tool.

These tools remain administrator-only. Migration `0003_admin_reports.sql` adds an audit-history index without changing existing data. The Chromium suite covers all five workflows and report navigation, in addition to the original administrator checks.

## GitHub sign-in

Create a dedicated GitHub OAuth app at https://github.com/settings/applications/new.

- Homepage: `https://jorbox.haseebshah.workers.dev`
- Production callback: `https://jorbox.haseebshah.workers.dev/api/auth/github/callback`
- Local callback: `http://localhost:8787/api/auth/github/callback`
- No repository or email scopes are needed: JorBox only uses GitHub identity.

JorBox uses its own OAuth app with client ID `Ov23liPg9gdZvLUbRs9n`. FamTree uses a separate app; its callback and credentials do not need to change. Generate a client secret in JorBox’s OAuth app and save it privately. Cloudflare secrets cannot be read back.

Put its `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in ignored `.dev.vars`, then upload only these two credentials to Worker secrets:

```sh
npm run auth:configure
```

The helper never prints credentials and does not change the production cookie secret or origin. GitHub client secrets never enter the Vite bundle. Set production `COOKIE_SECRET` with `npx wrangler secret put COOKIE_SECRET` when provisioning a fresh Worker; at least 32 characters are required. A production cookie secret has already been generated and installed for this instance.

`APP_ORIGIN`, `ADMIN_GITHUB_IDS`, and `FEEDBACK_REQUIRE_LOGIN` are Worker variables in `wrangler.jsonc`. The administrator list uses immutable GitHub account IDs to avoid username reuse. Change `FEEDBACK_REQUIRE_LOGIN` to `"true"` and deploy to require login for votes.

## Deployment and data

`wrangler.jsonc` binds the provisioned `jorbox` D1 database. For another Cloudflare account, create a new database with `npx wrangler d1 create jorbox` and replace its ID in the config. Set `APP_ORIGIN` to that deployment's origin and configure its OAuth callback.

For a fresh database only:

```sh
npm run db:migrate:remote
npm run db:seed:remote
```

For subsequent releases:

```sh
npm run db:migrate:remote
npm run deploy
```

The checked-in seed is generated from the original `public/games.json` and `public/data/*.csv` with `npm run db:generate-seed`. It uses deterministic card IDs and `INSERT OR IGNORE`, so it does not overwrite later edits or soft removals. It is an initial baseline, not a synchronization mechanism. Live card edits happen through the app, not by editing CSVs in Git. Do not store the production database, sessions, votes, or OAuth secrets in GitHub.

Before future schema/data changes, export a backup with `npx wrangler d1 export jorbox --remote --output=<private-backup-path>`. Database exports contain private session/identity data and should stay outside the repository.

The GitHub Actions workflow verifies every PR and main push. Deployment on main is enabled only when repository variable `CLOUDFLARE_ENABLED=true`, repository variable `CLOUDFLARE_ACCOUNT_ID`, and secret `CLOUDFLARE_API_TOKEN` are configured. The Cloudflare token needs Workers Scripts Edit and D1 Edit for the target account. Runtime OAuth/cookie secrets stay in Cloudflare; CI does not need them. Automatic deployments apply schema migrations but never rerun the seed. The old GitHub Pages deployment workflow has been replaced with Cloudflare deployment.

A daily Worker cron deletes expired sessions, OAuth states, and rate-limit buckets. Cards, votes, and audit history are retained.

## API

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/session` | Public; issues visitor cookie |
| GET | `/api/games` | Public |
| GET | `/api/games?removed=true` | Administrator |
| POST | `/api/games/manage` | Administrator |
| GET | `/api/games/:id/cards` | Public |
| GET | `/api/games/:id/cards?removed=true` | Administrator |
| POST | `/api/cards/:id/vote` | Public by default; `{value: 1, -1, or 0}` |
| GET | `/api/auth/github` | Starts sign-in |
| GET | `/api/auth/github/callback` | Validated OAuth callback |
| POST | `/api/auth/logout` | Same-origin |
| POST | `/api/games/:id/cards/bulk` | Administrator |
| POST | `/api/games/:id/cards/copy` | Administrator |
| GET / POST | `/api/games/:id/categories` | Administrator |
| GET | `/api/admin/activity?game=:id&before=:cursor` | Administrator |
| GET | `/api/admin/feedback?game=:id` | Administrator |

Bulk requests use `{action: "import" | "edit" | "remove" | "restore" | "feedback", cards: [...]}`. Each edited row has `id`, `version`, `Name`, `Description`, and `Category`. Removed/restored rows require `id` and `version`. Feedback rows additionally use `value` (`1`, `-1`, or `0`), or one top-level `value` for the whole selection. New rows use content fields without IDs. Card content must fit the game's format, and category-enabled games require a category.

Game requests use `{action: "create" | "edit" | "remove" | "restore", ...fields}`. Creation/edit fields are `name`, `cardFormat` (`flexible`, `name`, `description`, or `name-description`), and boolean `hasCategories`. Editing/removing/restoring requires the game's `id` and `version`. Edits optionally take `defaultCategory` when enabling categories or boolean `clearCategories` to explicitly clear categories while disabling the field. The server assigns new game IDs.

Copy requests use `{cards: [{id, version}], targetId, targetVersion, category?}`. Category rename requests use `{from, to, expectedCount, gameVersion, revision}` from the category GET response; that response lists counts for each category and provides the game version and audit revision. Report game filters are optional. Activity returns `{entries, nextCursor}`; use the cursor as `before` for the next page.

All SQL values are parameterized. API responses are never cached; writes require a matching Origin header. Requests and errors never log OAuth tokens or cookies.
