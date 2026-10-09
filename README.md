# Shabab JorBox

React companion app backed by Cloudflare Workers and D1. The Worker serves both the Vite frontend and `/api/*` on one origin. GitHub stores source, migrations, and the original CSV seed; D1 stores live cards, feedback, sessions, and the audit trail.

Production URL: https://jorbox.haseebshah.workers.dev

## Features

- All 16 original games and 19,420 cards, including name-only and description-only formats.
- Persistent likes/dislikes, one vote per signed visitor cookie or signed-in GitHub account; click again to clear a vote. Anonymous feedback uses browser identity, not a verified person. Clearing cookies or using another browser can create another identity; per-IP rate limits reduce repeated abuse.
- GitHub OAuth with PKCE and expiring, HttpOnly server sessions. OAuth access tokens are used to verify identity and are not stored.
- Card management restricted to `thehaseebshah` (GitHub ID `48080916`), checked on every write. Signing in alone does not grant editing access.
- Add/edit cards and categories; search, category filters, feedback counts, CSV export, import previews, edits by exported ID/version, bulk category moves, bulk removals, and restores.
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
| GET | `/api/games/:id/cards` | Public |
| GET | `/api/games/:id/cards?removed=true` | Administrator |
| POST | `/api/cards/:id/vote` | Public by default; `{value: 1, -1, or 0}` |
| GET | `/api/auth/github` | Starts sign-in |
| GET | `/api/auth/github/callback` | Validated OAuth callback |
| POST | `/api/auth/logout` | Same-origin |
| POST | `/api/games/:id/cards/bulk` | Administrator |

Bulk requests use `{action: "import" | "edit" | "remove" | "restore", cards: [...]}`. Each edited row has `id`, `version`, `Name`, `Description`, and `Category`. Removed/restored rows require `id` and `version`. New rows use content fields without IDs. Each card needs a name or description; category-enabled games also require a category. All SQL values are parameterized. API responses are never cached; writes require a matching Origin header. Requests and errors never log OAuth tokens or cookies.
