# Handoff — JorBox Data Cleanup & JSON Migration

**Date:** 2026-08-05
**Repo state:** All changes are **uncommitted** in the working tree. Run `git status` / `git diff` to review. Nothing has been committed or pushed.

## What happened this session

Full data-quality overhaul of the card CSVs (details visible in `git diff -- public/`):

1. **Corruption fixes (game5 Haiwani Pattay):** rejoined a comma-split description, split two merged Quiplash cards, un-glued `The Fifth Expansion` from a description, merged `90s Nostalgia` into `90s Nostalgia Pack`. Also moved 76 prompts from `Name`→`Description` where Description was empty.
2. **247 exact duplicate cards removed** across 11 games (biggest: game5 152, game15 Tareekhi 69, game11 11).
3. **48 low-quality cards dropped:** 43 game5 typo-variant near-dupes (kept correct spelling), `Test` placeholder in Nouns, `Knife` dupe + `Scissor` typo in Main, typo variants in game8/game16. 2 game5 cards spell-fixed (`distant`, `billionaire`).
4. **Column cleanup:** dropped dead columns from game6, 9, 10, 11, 12, 13, 14, 16; renamed game15 `Title`→`Name` (this was a live bug — Tareekhi cards rendered without titles); moved `game16.csv` from `public/` root into `public/data/`.
5. **`games.json` registry:** `hasCategories` flipped — game3 → **true** (470 rows have real categories), game4/6/11/12 → **false**; game16 path → `/data/game16.csv`.
6. **`AGENTS.md`** updated with the per-game column shapes.

Key decisions (user said "fix all" without ruling per-game): game4 keeps its 340 topic labels as on-card pills but loses the filter dropdown; game5 keeps `hasCategories: true` (pack names are useful filters).

## Verified / not verified

- ✅ All CSVs pass a structural sweep: correct field counts, no dups, no encoding artifacts, no embedded headers, mechanic checks per game (game2 uniform 4 banned words, etc.). Scripts used are in `/tmp/opencode/fix_data.py` (may be gone — they're reproducible).
- ❌ **App not run** — this environment has **no Node toolchain** (`npm`/`node` not found). User must run `npm run dev` and click through, especially: GupShup (moved file), Tareekhi (new titles), Jasoosi Club (new category dropdown), and the single-column games (game6/10/12/13).

## Open questions for the user (asked, unanswered)

1. **Nouns plural pairs:** 11 singular/plural pairs (Banana/Bananas, Carrot/Carrots, Key/Keys…) — drop the plurals or keep?
2. **Commit:** user was asked whether to commit the cleanup or leave the diff for review — no answer yet. Do not commit without explicit confirmation (repo rule: ask before every git mutation).

## Agreed direction (not started)

User wants to migrate from **runtime CSV parsing → build-time JSON** ("Before making the switch, let's first fix the CSVs" — CSVs are now fixed). The agreed 3-phase plan:

- **Phase 1 — `scripts/build-data.js`** (papaparse as devDependency, runs prebuild): parse CSVs → validate (required columns, no empty categories, flag 1-card categories, malformed rows) → normalize (`a | b` pipe strings → arrays, e.g. game2 banned words and game3 lists) → emit `public/data/gameN.json`.
- **Phase 2 — done** (this session's data fixes).
- **Phase 3 — app switch:** drop runtime papaparse, `fetch` + `.json()`; update CardViewer to render banned-word arrays. Consider `import()` code-splitting per game.
- Explicitly avoid: SQLite, one combined JSON, any backend.

## Suggested skills

- `implement` — for building the Phase 1 validation/build script and Phase 3 app switch.
- `tdd` — the validator is a natural test-first candidate (fixtures of broken CSVs → build failures).
- `code-review` — to review the current uncommitted diff before committing.

## Gotchas

- CSV line-endings/BOM vary per file — the fix scripts preserved them; any future writer should too (check with `git diff --stat`: whole-file diffs = line-ending flip).
- CardViewer tolerates missing `Name`/`Description`/`Category`, so single-column CSVs are safe.
- game15 legitimately repeats items across ranked lists — not dups.
- game13 has ~18 objective cards not starting with "Get a player" — intentional variety, not corruption.
