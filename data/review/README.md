# Card review

One file per reviewed game (`gameN.json`). Each lists every card from the seed at
commit `3f43360` by its original ID, plus new cards (`id: null`):

- `action`: `keep`, `edit`, `remove` or `add`.
- `original`: the card's seed content before review, used to skip cards that
  were already edited by hand in production.

The seed CSVs are rebuilt from these files. Production is updated separately,
through the administrator CSV edit/import and review/removal flows, never by
reseeding. Open questions for the deck owner are in `QUESTIONS.md`.
