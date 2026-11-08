# Deck Log: handoff from the claude.ai chat

Brought over 2026-11-07. Deck Log is a personal training log (swim, lift, run, row, skate,
stretch, rest, bodyweight) with a Claude "coach". It was built in a claude.ai chat and lives
as a private claude.ai artifact, which is how it gets used on the phone at the pool and gym.

## Where things are

| Path | What |
|---|---|
| `artifact/deck-log.html` | The live app, snapshot of artifact version `1793842210-54bf` (v3 + theme toggle). 2,053 lines, one file. |
| `design/proto-*.html` | The three static design prototypes (Dispatch, Editorial Sport, Mission Control). Sample data only, no script. Editorial Sport is the one v3 was rebuilt around. |
| `docs/activity-model.md` | **The proposed new session model** for swim, run, row, aggressive inline, disc golf, dog walks and stretch, plus counting rules. The owner's answers are recorded in it; not built yet. |
| `docs/swim-plan-templates.json` | The swim plan's three phases (five workouts) in that model. `tools/check-swim-templates.py` totals them. |
| `docs/chat-history.md` | The chat, nearly whole: swim plan, lingo, scope, v1, v2 (lifting), recovery, run/row, the design bake-off, v3, theme toggle. Two short owner messages are missing. |

Artifact links:

- Live app: https://claude.ai/artifact/PksoZZKoZCzwCRq54zUDtZ
- Prototypes: Dispatch https://claude.ai/artifact/8edtMzsXW72wMXq2zgQb8t ·
  Editorial Sport https://claude.ai/artifact/SdSMmGjh1QvQLFw2gNUQer ·
  Mission Control https://claude.ai/artifact/Soqwjuq9oPzVH9S89PkR9w

## How the app works

One HTML file. All markup and CSS come first; the script starts at `artifact/deck-log.html:767`.

**Runtime.** It runs inside the claude.ai artifact viewer and uses three viewer capabilities
(`artifact/deck-log.html:2004`):

- `db`: a Firestore-like document store hosted by claude.ai. **All the owner's data lives
  here, not in the HTML.** Republishing the HTML to the same artifact URL keeps it.
- `user`: the signed-in user id, used to key the data.
- `sample`: calls Claude from the page (the Coach tab).

Opened anywhere else (a local file, a dev server) none of these exist, so the page shows its
signed-out state: nothing loads or saves, and Coach is hidden.

**Data layout** (all under `data/users/{uid}/`):

| Path | Holds |
|---|---|
| `log/sessions` (collection) | One doc per session: `date`, `ts` (local noon), `type`, `minutes`, `feel` 1–5, `notes`, optional `yards` / `miles` / `meters` / `kind` / `spm` / `sore` {area: 1–3}, and for template workouts `tpl`, `exercises` [{name, sets:[[lb, reps]]}], `volume`, `swimSets` |
| `log/weights` (collection) | `date`, `ts`, `lbs` |
| `goals` (doc) | `text`, `updatedAt` |
| `lifting` (doc) | `barLbs`, `restSec`, `templates` [{id, name, ex:[{name, s, r}]}] |
| `swim` (doc) | `templates` [{id, name, sets:[{n, d, y} or {n, d, reps, each}]}] |

Theme and beep preferences are in `localStorage` per device (`dl-theme`, `dl-beep`).

**Tabs** (`#home #log #train #trends #coach`):

- **Home** (`renderHome`, :1571): masthead with ISO week, today's session or a suggested next
  one, the week as a ledger, and a stat band (weekly lift load, weight with 30-day change,
  most-sore area over 2 weeks).
- **Log** (:970): quick log for any activity with mm:ss time, distance presets, live pace,
  feel and soreness; bodyweight entry; the last 60 sessions with delete.
- **Train**: lift templates (Upper/Lower × Push/Pull + Core) and swim templates (Base 1,700),
  both editable; a live lift workout (:1322) with steppers, plate math, a rest timer, a beep and
  a screen wake lock; a live swim workout (:1450) that walks the sets with an elapsed clock;
  exercise history; plate calculator; settings.
- **Trends** (:1788): tiles, minutes per week stacked by activity (8 weeks), bodyweight,
  swim pace per 100 and run pace per mile (6 months). Hand-built SVG.
- **Coach** (:1922): goals text, then sends the last 8 weeks to Claude with a fixed trainer
  prompt (:1956). The owner's profile is written into that prompt.

## How it got here

From `docs/chat-history.md`:

1. **Swim plan.** A 3-phase return to lap swimming: weeks 1–2 at ~1,500–1,800 yd, weeks 3–4
   at ~2,000–2,200, weeks 5+ rotating threshold, speed and IM days. Shoulders first,
   2–3 mornings a week, rest-based intervals before fixed send-offs.
2. **Scope.** Owner: track "lifing sessions, how I feel, any progress I see, my weight", all
   fitness, and eventually goals with AI feedback. Claude chose an artifact over git/Cloudflare
   "until it outgrows this", then "we move to Claude Code … and migrate the data". That move is
   what's starting now.
3. **v1.** Log, Swim plan, Trends and Coach tabs.
4. **v2.** Lifting: Upper/Lower/Core × Push/Pull templates, workout mode, rest timer, plate math,
   PRs, e1RM. On progression the owner picked "Just show last time" (no auto-progression).
5. **Recovery.** Rest and Stretch types, the soreness journal, a Trends soreness tile, and
   soreness passed to the coach.
6. **Run/row**, and the owner's complaint: *"everything youve given me so far has been
   mediocre, cobbled-on … I want something WOW."* Three design prototypes followed; the owner
   picked Editorial Sport.
7. **Last real ask:** *"swimming tracking, and cardio tracking … fully overhauled to be as
   detailed to track at least what are the reccomended programs."* v3 was the answer.
8. **Theme toggle.** The last change made.

The v3 notes claim Home suggests "your least-recently-run template", swim and cardio get
"program-grade tracking", and "every control [is] wired". Findings 1, 3 and 4 below show
those claims don't hold.

## First-pass findings (from reading the code, not yet run)

Ranked by how much they would hurt in real use. Line numbers are in `artifact/deck-log.html`.

1. **v3 can't track the recommended swim program, which was the last thing the owner asked
   for.** Only Base 1,700 (the weeks 1–2 workout) is seeded (:803). The plan's Build and
   Structured phases aren't in the app at all, and v1's full swim-plan card was dropped in v3:
   only the ramp notes and lingo survive (Train → "Swim plan notes & lingo"). Worse, a swim set
   can only be "N yards" or "reps × each" (:1194–1214), so the template model can't express
   much of the plan:
   - `3 rounds of [200 free steady + 2×50 strong]` (nested rounds)
   - `6×50 odds drill, evens build` and `8×25 odds drill, evens fast` (alternating repeats)
   - `12–16×50 (4 easy, 4 build, 4 fast, 4 easy)` and `6×100 descend 1–3, 4–6` (effort per repeat)
   - `100s on 1:40` (fixed send-offs, the plan's stated next step)
   - rest per set (`@ :20`) as data rather than free text

   Cardio has the same gap: a run or row tagged "intervals" stores one time and one distance,
   with no reps, splits or rest. The cause is the data model, not the screens.
2. **A workout in progress is held only in memory.** The live lift and swim workouts (`LW`,
   `SW`, :1309 and :1449) are never saved until the finish screen. If the phone discards the
   tab, claude.ai reloads the artifact, or he switches apps for too long, every set logged so
   far is lost. The wake lock (:1285) keeps the screen on but doesn't stop that. This is the
   biggest risk for a gym app running inside a chat client.
3. **Home only ever suggests a lift.** The "Up next" pick is built from lift templates alone
   (:1603). Swim templates are never suggested, though swimming is why the app exists and the
   v3 notes say "your least-recently-run template".
4. **Swim pace counts the rest, so the pace chart tracks rest, not speed.** Pace is total
   session time over total yards (:1513, :1896), including warm-up, drills and every rest
   interval. Change the rest from :20 to :30 and "pace" gets worse while the swimming
   doesn't. No repeat times are captured on the main set, which is the number a former
   competitive swimmer would actually watch (and what the plan needs before switching to fixed
   send-offs).
5. **The soreness tile from the recovery release was lost in v3.** The Trends tile that
   counted sore-or-worse flags over 2 weeks and "goes red at three-plus flags" is gone
   (`renderTiles`, :1789). Home's stat band shows only the most-sore area, with no count and no
   alarm (:1676–1691).
6. **Only the main set's repeats can be changed mid-swim.** Warm-up, drills and cool-down are
   always counted as swum in full (:1463). Cut the cool-down and yardage and pace are
   overstated. The `done` flag set at :1453 is never used.
7. **The swim stepper caps at 20, the editor allows 30.** `swRepChange` clamps to 20 (:1485)
   while the template editor allows up to 30 repeats (:1201). On a 24×50 set, tapping **+**
   drops it to 20.
8. **Weigh-ins stop updating after 400.** Weights are loaded `orderBy("ts","asc").limit(400)`
   (:2026), so it returns the *oldest* 400. After about a year of daily weigh-ins, new ones
   never appear on Home or Trends. Sessions are loaded newest-first, so they don't have this
   problem.
9. **The default swim template contradicts its own coaching.** Base 1,700's main set is 10×100
   (:808), but its own note says "First month: cap at 6–8", and the Train notes say to cap the
   first 3–4 sessions at 6–8. The 1,700 total assumes 10.
10. **Switching back to Auto may break following claude.ai's theme.** Going to Auto removes
   `data-theme` from the page root (:862). If the viewer is what sets that attribute (the
   comment at :870 implies it is), Auto then follows the OS setting instead of claude.ai until
   a reload. Not confirmed; needs checking in the viewer.
11. Smaller things:
   - Feel stays on the last value after a quick log (:894); every other field resets.
   - The Trends "This week" tile has no end date, so future-dated sessions count (:1792).
   - A lift template's "last run" matches on any shared exercise name (:1071), so templates
     that share Bench Press borrow each other's dates. That skews the Home suggestion.
   - The coach prompt hard-codes "swims about once a week" (:1980), but the plan calls for
     2–3, so the coach is told the wrong baseline.

## Open questions for the owner

- On record, the frustration is UX quality ("mediocre, cobbled-on") and, by implication,
  v3 not delivering program-grade swim and cardio tracking. Does v3 still feel cobbled-on, and
  where? Nothing in the paste reports how v3 felt in use.
- Fix finding 1 by redesigning the swim/cardio data model (rounds, alternating and per-repeat
  effort, send-offs, repeat times), then seed the plan's three phases as templates?
- Keep it as a claude.ai artifact (phone access, data stays put, edit here and republish to
  the same URL), or make the move the chat itself proposed: a real codebase with its own host
  and data store (needs a data export from the artifact database)?

## Working on it from Claude Code

- Edit `artifact/deck-log.html`, then publish it to the live URL above. The artifact may
  have been edited in claude.ai since this snapshot, so read the live version first and
  merge before publishing.
- The page can't load or save anything outside the claude.ai viewer, so check data flows
  there. Layout and pure functions (time parsing, pace, plates, e1RM, week math) can be
  checked anywhere.
- Don't put real session data in the repo. It lives in the artifact database; read it only
  when the owner asks.
