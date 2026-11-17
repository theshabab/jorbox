# Plan: give each game a real card shape

Status: proposal. Nothing here is built yet.

## The problem

Every card is three text fields: `name`, `description`, `category`. Each game
uses them to mean something different, and the app works out the meaning by
pattern-matching the text (`src/utils/cardText.js`: `|` lists, `<--->` scales,
`____` blanks). A game has only two settings that affect this: `card_format`
(which of name and description are required) and `reveal_description`.

What the 16 seed decks actually store today:

| Deck                                                  | Cards | `name`                     | `description`           | `category`                |
| ----------------------------------------------------- | ----- | -------------------------- | ----------------------- | ------------------------- |
| Main                                                  | 1,368 | the word                   | a hint                  | topic                     |
| Charades (Banned Words)                               | 1,368 | the word                   | banned words, `\|` list | topic                     |
| Jasoosi Club                                          | 1,206 | the real prompt or a topic | decoys or words, `\|`   | round type (5)            |
| Daal men Kaala                                        | 1,099 | the answer                 | sentence with `____`    | topic                     |
| Haiwani Pattay                                        | 6,442 | mostly empty               | prompt, often `____`    | pack (36)                 |
| Categories Game, NaqshNigar, Phansna Nahi             | 3,505 | empty                      | the prompt              | none or 2                 |
| Dilchasp Haqaiq                                       | 880   | empty                      | the question            | answer kind (Number, 0-100) |
| Dil ki Sun                                            | 1,076 | scale, `A <---> B`         | the task                | Drawing or Writing        |
| Trivia                                                | 1,251 | the question               | the answer (hidden)     | none                      |
| Aik Rangi Soch, Nouns, GupShup                        | 3,317 | the prompt or word         | empty                   | none or 4                 |
| Karobari                                              | 971   | "Problem" or "Customer"    | the card text           | same as name              |
| Tareekhi                                              | 1,610 | the item                   | value or position       | the ordered set (192)     |

Consequences we have already hit:

- Karobari's type lived in `name`, so it read as noise and looked "removed".
- Tareekhi needed a per-game switch to hide the answer, and the order direction
  is buried in the category title ("Low to High").
- A wrong separator or a missing `____` breaks a card silently. Nothing
  validates that a Charades card has banned words or that a scale has two ends.
- Admin forms and CSV columns say "Name" and "Description" for every game.
- The review tooling had to carry per-deck rules in prose because the data
  could not express them.

## The proposal

Add a **game kind**. A kind names the fields a card has, validates them on the
server, and picks the renderer. Nine kinds cover every seed deck:

| Kind            | Fields                                             | Decks                                                                 |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `prompt`        | `text`                                             | Categories Game, NaqshNigar, Phansna Nahi, Aik Rangi Soch, Nouns, GupShup, Dilchasp Haqaiq, Haiwani Pattay |
| `hinted-word`   | `word`, `hint`                                     | Main                                                                  |
| `banned-words`  | `word`, `banned[]`                                 | Charades                                                              |
| `question`      | `question`, `answer` (hidden until revealed)       | Trivia                                                                |
| `fill-blank`    | `sentence` (must contain a blank), `answer`        | Daal men Kaala                                                        |
| `ordered-item`  | `item`, `value`, `sortKey` (number)                | Tareekhi                                                              |
| `scale`         | `low`, `high`, `task`                              | Dil ki Sun                                                            |
| `decoys`        | `real`, `decoys[]`                                 | Jasoosi Club                                                          |
| `typed-prompt`  | `type` (from a per-game list), `text`              | Karobari                                                              |

`category` stays a separate, optional grouping for every kind. For
`ordered-item` the category becomes a real **set** with its own direction
(ascending, descending, chronological) instead of text in the title.

Rules that fall out of this:

- "Hidden until flipped" is a property of the kind (`question`, `ordered-item`),
  so `reveal_description` goes away.
- `card_format` goes away. Each kind states its own required fields.
- `sortKey` lets the app check a Tareekhi guess and reject two cards in one set
  with the same value, which the review had to police by hand.
- `typed-prompt` removes the duplicated "Problem"/"Customer" text.

## Storage

Keep one `cards` table. Add:

- `games.kind TEXT NOT NULL` with a `CHECK` on the nine values.
- `games.options TEXT` (JSON) for per-game settings, such as Karobari's type
  list.
- `cards.fields TEXT NOT NULL` (JSON), validated against the game's kind by the
  Worker on every write.
- A `card_sets` table for `ordered-item` games: `id`, `game_id`, `title`,
  `direction`.

`name`, `description` and `category` stay during the transition and are
dropped at the end. One table with a JSON column keeps votes, audit, soft
delete, versions, bulk edits, copies and duplicates working unchanged, which
nine tables would not.

## Phases

Each phase ships on its own and leaves the app working.

1. **Kinds, read-only.** Add `games.kind`, set it for the 16 decks in a
   migration, and have the viewer choose its renderer from the kind instead of
   from text patterns. No data moves. `cardText.js` stays as the fallback for
   admin-created games of kind `prompt`.
2. **Typed fields.** Add `cards.fields` and fill it in a migration from the
   existing columns (split `|`, split `<--->`, parse Tareekhi values into
   `sortKey`). The API returns `fields`; the old columns are still written.
   Cards that fail to convert are listed in a report rather than dropped.
3. **Typed writes.** Server validation per kind. Admin card form, bulk editor
   and CSV import/export use the kind's field names. Suggestions use the same
   form. Copy between games is allowed only between the same kind, or through
   an explicit mapping screen.
4. **Sets for Tareekhi.** Add `card_sets`, move the 192 categories into it with
   a direction, and build the guess-and-flip check.
5. **Clean up.** Drop `name`, `description`, `card_format`,
   `reveal_description`, and the pattern guessing.

Add types (TypeScript or checked JSDoc) to `cardFormats.js` and the API client
as part of phase 2, since that file is shared by the browser and the Worker.

## What changes for the project rules

`AGENTS.md` says game format changes must not silently discard content and
that legacy name-only and description-only cards are preserved. Under this
plan:

- Changing a game's kind is a reviewed admin action with a preview of how each
  card maps, and it refuses if any card would lose a field.
- "Name-only" and "description-only" games become kind `prompt`.

Both rules need rewording when phase 3 lands.

## Risks

- **Conversion errors.** About 24,000 cards convert in phase 2. Mitigation: the
  migration is tested against the full seed, and the old columns stay until
  phase 5.
- **Tareekhi `sortKey`.** Values are free text ("About 1.2 m (shoulder)",
  "c. 794 CE", "2 AH (Shawwal)"). Dates in two calendars and approximate values
  will not all parse. Expect a hand-fix list, probably a few hundred cards.
- **Admin-created games.** Any game an admin has added keeps working as
  `prompt` and can be changed later.
- **Offline cache.** The service worker caches deck responses. The response
  shape changes in phase 2, so the cache name must change with it.
- **Tests.** `tests/backend.test.js` (1,894 lines) asserts the current format
  rules. Phases 3 and 5 rewrite a good part of it.

## Decisions needed before starting

1. Is Jasoosi Club one kind? It holds five round types in one deck (rating,
   morality, drawing, writing, and topic-with-word-list). The word-list rounds
   are a different shape from the decoy rounds. The clean answer is to split it
   into two kinds or two games.
2. Should Haiwani Pattay's 36 packs stay as categories, or become a pack
   setting players can switch on and off?
3. Should `ordered-item` check guesses in the app, or only reveal the value and
   leave the checking to the players as now?
4. Do this before or after the production reseed? After is simpler: the reseed
   needs the current shape, and there are no votes to protect yet either way.

## Size

Phase 1 is small: one migration, the viewer, and tests. Phases 2 and 3 are the
bulk of the work. Phase 4 is self-contained. Phase 5 is deletion.
