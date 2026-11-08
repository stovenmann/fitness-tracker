# Activity model: proposal

Status: **draft, 2026-11-07.** The owner has answered every open question (below). Nothing
here is built.

The problem it solves: Deck Log stores swim and cardio as one time plus one distance, with a
swim set allowed to be only "N yards" or "reps × each". That can't hold the swim plan
(HANDOFF finding 1), and it treats a dog walk, a park session on aggressive skates and a
tempo mile as the same kind of thing. This proposal changes what a session *is*. The screens
follow from it.

Decided with the owner on 2026-11-07:

- Dog walks and disc golf count as **movement**, with their own weekly total, not as training.
- The weekend activity is **aggressive inline** (park and street). There is no skateboarding;
  the current "skate" type and the coach prompt's "skateboards" are wrong.
- Everything is **entered by hand**: no watch, heart rate or GPS.
- **Disc golf scores stay in the Disc Golf Scorecard artifact.** Deck Log logs the round as
  activity, not hole by hole.
- **The swim plan keeps its sets.** The chat's yardage labels were wrong (section 5), so the
  labels are corrected and the sets stay as written.
- **First swims are capped:** 6–8×100 on the main set for the first 4 swims, then the plan's
  8–10.
- **The pull buoy starts in weeks 3–4.** The weeks 1–2 warm-up is swim / kick / swim.
- **The comeback hasn't started.** The start date is set by the first swim logged, and can be
  changed in Settings.

## 1. Every session has a core and a detail block

**Core** (all types):

| Field | Meaning |
|---|---|
| `date`, `ts` | Local date; `ts` is local noon (unchanged) |
| `type` | One of the activity types below |
| `minutes` | Session length. Not needed for Rest. |
| `effort` | **New.** How hard, 1–10. Pre-filled from the type's default and changed with one tap. |
| `feel` | How you felt, 1–5 (unchanged). A hard session can feel great, so effort and feel stay separate. |
| `sore` | Soreness by area, 1–3 (unchanged). **Ankles** added to the areas, for skating. |
| `notes`, `tpl` | Unchanged |

**Detail**: one block per type, described in section 3.

**Effort scale** (shown as words, stored as the number):

| 1–2 | 3–4 | 5–6 | 7–8 | 9–10 |
|---|---|---|---|---|
| Easy, could chat all day | Moderate | Steady, working | Hard | All out |

## 2. Counting rules

Defined once and used by Home, Trends and the coach. No screen works these out on its own.

| Category | Types | Counts toward |
|---|---|---|
| Training | Swim, Run, Row, Lift, Aggressive inline | Training minutes, training load |
| Movement | Dog walk, Disc golf | Movement minutes, movement load |
| Recovery | Stretch, Rest | Stretch minutes; a rest day counts as a day |

- **Load** = effort × minutes for each session. This is session-RPE, the standard way to put a
  swim, a lift and a skate session on one scale. A 40-minute walk at effort 2 is 80; a
  90-minute park session at effort 7 is 630.
- **Weekly totals** shown and sent to the coach: training minutes and load by type, movement
  minutes and load, stretch minutes, rest days, and lift volume in lb (unchanged).
- **The week ledger** on Home shows each day's highest-load training session as the main line,
  with movement as a quiet suffix ("+ 2 walks"). A walk never displaces a workout.
- Old sessions without an effort get the type's default effort when load is computed.

## 3. Activity types

| Type | Category | Fast log | Can add | Ledger figure | Default effort |
|---|---|---|---|---|---|
| Swim | Training | Template, or yards + time | Full set structure, repeat times, pool | `1,700 yd · 1:52/100` (main-set pace) | 5 |
| Run | Training | Distance + time | Where, kind, intervals, treadmill incline | `1 mi · 8:42/mi` | 4 |
| Row | Training | Meters + time | Kind, intervals, stroke rate | `2,000 m · 2:01/500` | 5 |
| Lift | Training | Template workout (unchanged) | — | `12,480 lb` | 7 |
| Aggressive inline | Training | Minutes + where | Focus, tricks, slams | `Park · 2 new` | 6 |
| Disc golf | Movement | Course + holes + minutes | — | `18 holes · Course` | 3 |
| Dog walk | Movement | Minutes | Distance | `35′` | 2 |
| Stretch | Recovery | Minutes | Focus areas | `20′ · hips, t-spine` | 2 |
| Rest | Recovery | One tap | — | `Rest` | — |

### Swim, run and row share one structure

A workout is **blocks**; a block has **rounds** and **items**; an item is a group of repeats.
The same shape covers a 1,700 yd swim, a 6 × 400 m run and a 2,000 m row.

```
Block   name · rounds (default 1) · items[]
Item    reps · dist (or dur) · what · stroke · gear · effort or pattern · interval · note
```

| Field | Values | Why |
|---|---|---|
| `reps`, `rounds` | a number, or a range `[8, 10]` | The plan says "8–10×100" and "3 rounds". The range is the target; you log what you did. |
| `ramp` | `{swims: 4, reps: [6, 8]}` | Use these reps instead for the first N swims of the comeback. Holds the 6–8 cap. |
| `dist` / `dur` | in the activity's units: yd or m (swim), mi, km or m (run), m (row); or seconds | Time-based intervals ("5 × 3 min") use `dur`. |
| `what` | swim · kick · pull · drill (swim); run · walk (run); row | |
| `stroke` | free · back · breast · fly · IM · choice | Swim only |
| `gear` | board · buoy · fins · paddles · snorkel | **Paddles get flagged**: the plan rules them out for the first month, so a template with paddles shows a warning until a month after the comeback start date. |
| `effort` | easy · moderate · steady · strong · threshold · fast · sprint · build | For every rep |
| `pattern` | `odds/evens`, `groups`, `descend N`, `parts` | Covers the plan's harder sets; see below |
| `interval` | `rest` (seconds, or a range) **or** `sendoff` (seconds) | "@ :20 rest" vs "on 1:40". Moving from rest-based to send-offs is the plan's stated next step. |

Patterns:

- **odds/evens**: `6×50 odds drill, evens build`. Odd reps take one setting, even reps another.
- **groups**: `16×50 (4 easy, 4 build, 4 fast, 4 easy)`. The reps split evenly across the
  groups, so 12 gives groups of 3.
- **descend N**: `6×100 descend 1–3, 4–6`. Each rep faster than the last, resetting every N.
- **parts**: `4×50 drill/swim by 25`. One rep is split into pieces: 25 drill, then 25 swim.

**What gets logged**, per item: reps done (pre-filled with the target), rounds done, and,
optionally, **a time for each rep**. A block or item can be marked skipped or shortened, so
yardage and pace stay honest (fixes finding 6).

**Pace, two numbers instead of one** (fixes finding 4):

- **Swim pace**: average per 100 from the rep times on the main set. This is the number
  Trends charts, and the one that tells you when to move to send-offs.
- **Session pace**: total time over total yards, rest included. This is today's only figure.
  It's kept, but labelled as what it is.

**Pool** (25 yd, 25 m or 50 m) is set once in Settings and can be changed per swim. Yardage
converts when the pool changes.

**Run** detail adds `where` (treadmill / outdoor / track), `kind` (easy / tempo / intervals /
long), and treadmill `incline` and `speed` if wanted. **Row** keeps `kind` and stroke rate, and
its intervals use the same items.

### Aggressive inline

Built to track skill progress the way Lift tracks strength.

| Field | Meaning |
|---|---|
| `spot` | Park name or street spot, picked from recent ones |
| `focus` | Park · Street · Bowl · Vert · Mini ramp (any of them) |
| `tricks[]` | Each: `name` (from your own trick library, like the exercise library), `result`: tried · landed · dialed, and how many landed |
| `slams` | A count, plus the areas that took the hit (same chips as soreness). A bad slam is flagged so the coach sees it. |

- **New trick**: the first time a trick is landed it gets a badge in the log, the way a lift
  PR does.
- **Trick board** in Trends: each trick's best result and the date it was first landed.
- **The coach** sees slams and soreness together, weighting knees, wrists, ankles and hips,
  alongside the shoulder watch for swimming.

### Disc golf

`course` (picked from recent ones), `holes` (9, 18 or another number), minutes, and effort
(default 3). No scores; those stay in the scorecard artifact.

### Dog walk

Minutes, and optionally distance in miles. Effort defaults to 2, and you can log several walks a day.
**"Same as last walk"** is a one-tap button on Log, because this will be the most frequent
entry by far.

### Stretch

Minutes and `focus` areas (hips, hamstrings, t-spine, shoulders, back, calves), plus a kind:
yoga · mobility · stretch.

## 4. The live workout runner (swim, run, row)

One shared screen replaces today's swim stepper:

- The current block and item in large type, with the pattern spelled out for this rep
  ("Rep 3 of 6: **drill**, catch-up").
- **A big REP DONE button** that records the rep's time since the last tap. It's sized for
  wet hands at the end of the lane.
- After each rep it counts down the rest, or the time to the next send-off, and beeps (setting
  already exists).
- Reps and rounds can be adjusted, and a block can be skipped or shortened, without leaving
  the screen.
- **A workout in progress is saved as you go**, so a dropped tab or a claude.ai reload
  resumes where you left off. The lift workout gets the same (fixes finding 2).

## 5. The swim plan as templates

All three phases are written in this model in `docs/swim-plan-templates.json`: five workouts,
every line of the plan. Adding them up showed the chat's yardage labels were wrong for four of
the five, by up to 1,000 yd. The owner chose to keep the sets and correct the labels.

| Phase | Template | Blocks | Yards | Plan said |
|---|---|---|---|---|
| Weeks 1–2 | Reacclimation | 300 warm-up (swim / kick / swim) · 4×50 drill/swim by 25 @ :20 · 100s free moderate @ :20–:30: 6–8 for the first 4 swims, then 8–10 · 200 choice easy | 1,300–1,700 | 1,500–1,800 |
| Weeks 3–4 | Build | 400 warm-up (200 / 100 kick / 100 pull: the buoy's first appearance) · 6×50 odds drill, evens build @ :15 · 3 × [200 steady + 2×50 strong] @ :20–:30 · 200 easy | 1,800 | 2,000–2,200 |
| Weeks 5+ | Threshold | 400–500 warm-up · 8×25 odds drill, evens fast @ :15 · 5×200 threshold @ :30 · 200 easy | 1,800–1,900 | 2,400–2,800 |
| Weeks 5+ | Speed | same warm-up and pre-set · 12–16×50 groups easy / build / fast / easy @ :20 · 200 easy | 1,400–1,700 | 2,400–2,800 |
| Weeks 5+ | IM | same warm-up and pre-set · 4×100 IM easy · 6×100 free descend 1–3, 4–6 (no rest given) · 200 easy | 1,800–1,900 | 2,400–2,800 |

Home suggests the next swim from the current phase, rotating through the weeks 5+ days
(fixes finding 3). The phase comes from the **comeback start date**, which is set by the first
swim logged and can be changed in Settings.

There is **no run or row program** in the chat, so none is invented here. The model handles
steady and interval sessions, and two blank-ish templates (a gym mile, a 2,000 m row) are seeded
as starting points.

## 6. Existing data

Nothing is rewritten in place. Old sessions are read through these rules:

- `type: "skate"` reads as aggressive inline.
- `yards`, `miles`, `meters`, `kind`, `spm` and `swimSets` read as one block with one item.
  They have no rep times, so they show session pace only.
- Old swim templates (`{n, d, y}` or `{n, d, reps, each}`) convert to blocks the first time
  they're opened in the editor, and are saved in the new form.
- No effort on a session means the type's default effort.

## 7. Not covered

- Disc golf scores, heart rate, GPS: decided out of scope (top of this file).
- Auto-progression for lifts: the owner chose "just show last time" in v2.
- A run or row program: none exists yet (section 5).
