# Deck Log: working rules

A personal training log that runs as a private claude.ai artifact, used on the owner's phone at
the pool and gym. Read `HANDOFF.md` first: layout, data model, known issues, open questions.

- The app is one file: `artifact/deck-log.html`. Live at https://claude.ai/artifact/PksoZZKoZCzwCRq54zUDtZ
- Data lives in the artifact's claude.ai database (`db` capability), not in the HTML.
  Republishing to the same URL keeps it. Never put real sessions, weights or goals in the repo.
- Before publishing, read the live artifact and merge: it may have been edited in claude.ai
  since the local copy.
- Outside the claude.ai viewer the page runs signed-out (no db, user or sample), so check
  data flows in the viewer.
- `design/` holds static prototypes with sample data. They are references, not the app.
- The repo is **public**: https://github.com/stovenmann/fitness-tracker. On 2026-11-07 the
  owner chose to publish the chat history and the coach profile as they are. Logged data
  still never goes in.
- `docs/activity-model.md` is the agreed direction for swim and cardio. After editing
  `docs/swim-plan-templates.json`, run `python tools/check-swim-templates.py
  docs/swim-plan-templates.json`.
- The swim plan in `docs/chat-history.md` is the coaching basis: shoulders first, slow ramp,
  rest-based intervals before fixed send-offs.
