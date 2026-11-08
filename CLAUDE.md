# Fitness Tracker: working rules

A personal training log, used on the owner's phone at the pool and gym. It is moving from a
private claude.ai artifact to its own Cloudflare site: `CLOUDFLARE.md` has the approved plan and
where it stands. Read `HANDOFF.md` first: layout, data model, known issues, open questions.

- The app is called **Fitness Tracker**. The chat named it "Deck Log"; the owner doesn't want
  that name used anywhere (UI, docs, artifact titles, replies).
- The app is one file: `public/index.html`, served with its API by `worker/index.js` on
  Cloudflare. Every Cloudflare part (Worker, D1 database, Access app and rule, settings) is this
  app's own, set up fresh by the owner: never point at the disc golf scorecard's.
- Until the owner switches over, the live app is still the artifact
  https://claude.ai/artifact/PksoZZKoZCzwCRq54zUDtZ, with his data in its claude.ai database.
  It is left untouched: never republish it or write to its data. Its last version is
  `artifact/fitness-tracker.html` at commit `2fd6140`.
- Never put real sessions, weights or goals in the repo. Data read from the artifact for the
  move goes only into the git-ignored `export/` folder.
- Publishing means moving the `live` branch up to `main`, only when the owner says so, as its
  own step after checking the commit it will publish. Work lands on `main`.
- `design/` holds static prototypes with sample data. They are references, not the app.
- Test locally with `preview_start` (config `fitness-tracker`): `/?seed=1` or `/?clear=1` opens
  the app on a stand-in API, `/tools/tests.html` runs every check, and `await runSwimTests()`
  in the app's console runs the swim checks. HANDOFF "Testing locally" has the details.
- The repo is **public**: https://github.com/stovenmann/fitness-tracker. On 2026-11-07 the
  owner chose to publish the chat history and the coach profile as they are. Logged data
  still never goes in.
- `docs/activity-model.md` is the agreed direction for swim and cardio. After editing
  `docs/swim-plan-templates.json`, run `python tools/check-swim-templates.py
  docs/swim-plan-templates.json`.
- The swim plan in `docs/chat-history.md` is the coaching basis: shoulders first, slow ramp,
  rest-based intervals before fixed send-offs.
