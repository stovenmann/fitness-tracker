# Moving Fitness Tracker to Cloudflare

**Status: approved by Steve on 2026-11-08. Steps 1 to 4 are done. Step 5, Steve's dashboard
setup, is next (below). Nothing is deployed, and the live artifact is unchanged.**
- **Step 1, the data check (2026-11-08):** Claude read the artifact's data read-only, counts
  only, and threw that copy away. The sessions, weigh-ins, lifting and swim documents can all
  be read, so the move's export works as planned.
- **Step 1, the Worker:** `worker/index.js`, its settings (`wrangler.jsonc`, with the database
  id still to come from Part 1 of the setup) and 12 checks in `tools/worker-tests.js`, run from
  `/tools/tests.html`. One check was broken on purpose to be sure it fails; it did.
- **Step 2, the page:** `artifact/fitness-tracker.html` moved to `public/index.html` and talks to
  the API through `makeCloud()`, with the outbox, the kept copy, and the signed-out and
  server-problem notices. `tools/mock-api.js` replaces the old claude.ai stand-in, and
  `tools/app-tests.js` adds 13 checks; all 25 pass, the 135 swim checks among them. The
  offline check was broken on purpose (failed saves dropped) and failed, as it should.
- **Step 3, the Home Screen:** the page has a real `<head>` with the manifest
  (`public/manifest.webmanifest`: "Fitness Tracker", short name "Fitness", full screen), the
  dumbbell in `public/icons/` (180, 192 and 512, drawn by `tools/app-icon.ps1`), and a status
  bar that follows the theme in use. 3 more checks, 28 in all, passing; the name check was
  broken on purpose and failed. Only the iPhone can show the real thing, at step 5.
- **Step 4, the move's tools:** `public/import.html`, disc golf's import page changed for this
  app (sessions, weigh-ins, goals, lift templates, swim plans; never the swim in progress), and
  `tools/build-backup.py`, which bundles the export into the one file the page reads and prints
  counts only. 5 more checks, 33 in all, passing; the "never overwrites" check was broken on
  purpose and failed. Rehearsed end to end on a made-up export (no real data read): the bundled
  file imported and all of it matched on the server.
- **Found at step 4:** logging a swim from the Log tab saves the comeback start date into the
  swim plans document. A test swim logged before the import would leave a different swim
  document on the server, and the import, which never overwrites, would skip the real one. So
  step 5 says to log a test run, and to leave templates and settings alone until the data
  has moved.
- **Not known yet:** without a service worker, iOS may not open the page at all with no signal
  (the kept copy helps when the page loads but the API doesn't answer, as on a weak signal).
  Disc golf is the same. Step 5's iPhone checks now include trying it in Airplane Mode.

This copies the disc golf scorecard's move (`disc-golf-scorecard/CLOUDFLARE.md`, live since
2026-11-08, its basket icon confirmed on Steve's iPhone). The method is the same. **The setup is
not shared:** every Cloudflare part below is new, made by Steve for this app, and nothing points
at disc golf's database, Worker, sign-in app or settings. The disc golf repo is only read.

## Why

The app runs inside claude.ai, so iOS takes the Home Screen icon and name from claude.ai's page.
As its own site on Cloudflare it gets:
- its own web address;
- the dumbbell icon on the Home Screen;
- full screen when opened from the icon, like an installed app.

## Decisions

Made by Steve on 2026-11-07 and 2026-11-08:
- **Same Cloudflare login, every part new.** A new database, a new Worker, a new sign-in
  (Access) app with its own rule, and its own three settings. Two things come with the account
  and are shared with disc golf: the login itself, and the account's team name (the
  `….cloudflareaccess.com` address every sign-in app on one account uses).
- **The data comes over.** Sessions, weigh-ins, goals, lift templates and swim plans move from
  the artifact. Steps under "Moving the data".
- **Coach: no API key.** A coaching export to drop into a Claude chat, and an Import screen
  that previews plan changes and applies them only on a tap, with undo. Changes cover workouts
  only (lift and swim templates and rules), not a weekly schedule.

Approved with the plan on 2026-11-08:
- **The name under the icon: "Fitness".**
- **Offline saving is copied from disc golf** (see "How it's built").
- **Sign-in: Steve only**, by email, like disc golf.
- **Address: the free Cloudflare one**, `fitness-tracker.<account>.workers.dev`. It isn't
  written in this repo: it contains the account's name, and the repo is public.
- **The artifact is left untouched**, data and all. Nothing is written to it during or after
  the move.
- **Coach comes after the move** (build step 7). Until then the Coach tab keeps the goals box,
  and its Claude button stays hidden, as it already is wherever the page runs outside claude.ai.

## How it's built

Nothing gets installed on Steve's PC. Cloudflare builds and deploys from this GitHub repo.

- **One Worker** (`worker/index.js`), copied from disc golf's and changed for this app. It
  serves the page, icons and manifest, plus a small API: list, save and delete documents.
  - No map images, so no file storage (R2) and no payment card.
  - Collections: `sessions` and `weights`, one row per entry, and a `state` collection for the
    four single documents (`goals`, `lifting`, `swim`, `live`).
  - The Worker checks the sign-in itself as well as Access (signature, audience, team, expiry,
    allowed email), so the API stays closed even if Access were switched off.
  - Each list carries a version tag made from a random number per database, so a phone's kept
    copy from one database can never pass for current on another.
- **D1** (Cloudflare's database) holds every document as it is today, one row each.
- **The page** moves from `artifact/fitness-tracker.html` to `public/index.html`. The version
  last published to the artifact stays in git history.
- **A small adapter** gives the page the same calls it makes today. It needs more than disc
  golf's adapter, because this app uses more of the database:
  - single documents it reads and watches (`goals`, `lifting`, `swim`, `live`), and `get()`;
  - `collection.add()` for new sessions and weigh-ins (the page picks the new id);
  - newest-first and oldest-first lists with a limit (500 sessions, 400 weigh-ins), sorted on
    the phone from the full list;
  - one person, so the `data/users/{uid}/` part of each path is dropped, and the page's user id
    is a fixed value.
- **It picks up changes** when it opens, when it comes back to the front, every 30 seconds while
  open, and after each save. An unchanged list costs a "nothing changed" answer.
- **It keeps the last copy on the phone**, so it opens with no signal at the pool or the gym.
- **Three kinds of trouble, each named** in the top bar: no connection; signed out (with a Sign
  in button); and a server problem, in the server's own words.
- **Offline saving (new; Steve chose to copy it).** Today a session saved with no signal shows
  an error and isn't kept. As in disc golf, every change (sessions, weigh-ins, goals, lift and
  swim plans) is first kept on the phone, then sent, retried on its own, and sent at once when
  the signal returns or the app is reopened. The top bar says when something is waiting.
- **Home Screen:** `public/manifest.webmanifest` (fetched with the sign-in cookie, since Access
  turns away a request without one), the 180 px icon and 192 and 512 sizes in `public/icons/`
  (the dumbbell already drawn by `tools/app-icon.ps1`), the name under the icon, full screen,
  and a status bar that follows the light or dark theme.
- **Publishing stays in Steve's hands.** Cloudflare deploys only from a `live` branch. Work
  lands on `main`. Publishing means moving `live` up to `main`, only when Steve says so, as its
  own step after checking the commit it will publish.

## Testing

Still only Python and a browser.
- A stand-in for the new API (copied from disc golf's `test/mock-api.js`), with failures on
  demand: dropped signal, signed out, server problem.
- The Worker's checks run the real Worker file in the browser against an in-memory database and
  sign-in tokens made with a throwaway key.
- The 135 swim checks keep passing. New checks cover:
  - sign-in lapsing mid-swim and mid-lift;
  - opening with no signal;
  - a copy kept from another database;
  - the server-problem banner;
  - the manifest and icon;
  - the import page (only adds, never overwrites).

What only Cloudflare and the iPhone can show: the real database and sign-in, the icon and full
screen, the status bar in both themes, and the screen staying awake and the beep in the swim
runner when opened from the Home Screen.

## Moving the data

1. **Check first.** Before anything else is built, Claude checks, read-only, that it can read
   the artifact's data, and reports counts only. If claude.ai doesn't allow that, Claude stops
   and asks: the other ways need a change to the artifact, which this plan says won't happen.
2. **Export.** Claude reads the artifact's sessions, weigh-ins, goals, lifting and swim docs,
   read-only, into an `export/` folder on Steve's PC that git ignores (`export/raw/`, then
   `python tools/build-backup.py export/raw export/fitness-backup.json`). Reading them sends
   that data through this chat. None of it goes into the repo, a commit or a test.
   - The swim in progress (`live`) isn't moved: finish or end any swim before the switch.
3. **Import.** A one-time import page on the new site, behind the sign-in (`public/import.html`,
   disc golf's from commit `b0b27fa`, changed for this app). Steve opens
   `<address>/import.html` in a browser on his PC, signs in the same way, and chooses
   `export/fitness-backup.json`. It only adds: anything already there is left alone, and it
   says so. Run again, it adds only what's missing.
4. **Check.** Count sessions and weigh-ins on both sides, compare the goals, lifting and swim
   docs, and open a few sessions and Trends on the phone. Then Steve logs only on the new
   address. The import page is taken out afterwards.
5. **Do it last.** Export right before switching. Anything logged in the artifact after the
   export can be brought over by exporting and importing again.

Per-phone settings (theme, beep) start fresh on the new address, because each address keeps its
own storage on the phone.

## Steve's one-time setup (about 15 minutes, in the Cloudflare dashboard)

Every name here is new. Sign in at dash.cloudflare.com with the usual login. Cloudflare moves
its screens around, so a label may differ a little; the names to type are exact.

**Part 1: the database (about 3 minutes)**
1. Storage & databases → D1 SQL database → Create database. Name it `fitness-tracker`. Copy
   its **Database ID** and send it to Claude; it isn't a secret. (There is no file storage to
   set up this time.)

Claude puts the ID into `wrangler.jsonc`. The first publish (`live` at the same commit as
`main`) waits for Steve's go-ahead.

**Part 2: the app and its sign-in (about 12 minutes, after the first publish)**
2. **The app.** Workers & Pages → Create application → import a repository from GitHub → pick
   `stovenmann/fitness-tracker`.
   - Project name: `fitness-tracker`. Build command: empty. Deploy command: `npx wrangler deploy`.
   - Deploy. Then check the Worker's **Settings → Build → Branch control**: production branch
     `live`, and builds for non-production branches **off**. The import form may set `main`;
     at disc golf it did, and every push to `main` deployed.
3. **Sign-in.** In the new Worker: the Access tab → Protect this Worker behind Access → All
   traffic. This makes a **new** Access app for Fitness Tracker.
   - Copy the new **AUD tag**. It is not disc golf's.
   - The **team domain** is the account's, the same one disc golf uses. It's the address ending
     `cloudflareaccess.com`, also the start of the certs address in the box.
   - Zero Trust → Access controls → Policies → the new one, named `fitness-tracker - Production`
     → its Include rule is **Emails**, with only your email. Never "Everyone".
4. **The Worker's settings.** In the Worker: **Settings → Variables and Secrets** → Add, three
   times, type Text. **Not** "Build variables and secrets": the running app never sees those.
   This panel has a Deploy button; the build one only has Save.
   - `ACCESS_TEAM_DOMAIN`: the team domain;
   - `ACCESS_AUD`: the new AUD tag;
   - `ALLOWED_EMAILS`: your email.
   Then deploy.
5. **On the iPhone.**
   - Open the address in Safari and sign in with the code Cloudflare emails you.
   - Share → Add to Home Screen. Check the dumbbell and the name "Fitness".
   - Open it from the Home Screen: full screen, no Safari bar. Try light and dark and look at
     the top of the screen.
   - Log a test **run** (not a swim: a first swim saves the comeback start date, and the
     import would then leave your real swim plans alone). Check it on Home, then delete it.
   - Start a short test swim from Train, check the screen stays awake and the beep plays, then
     **Exit without saving**.
   - Turn on Airplane Mode, close the app fully, and open it from the Home Screen. Note whether
     it opens. If it does, log a test run, turn Airplane Mode off, and check it arrives; delete
     it.
   - Don't change templates, the pool, the comeback start or goals until your data has moved.
     Keep using the artifact until then.

## Build order

1. Check that the artifact's data can be read (counts only). Then the Worker, database and API,
   with browser checks.
2. The page talks to the new API through the adapter; the harness uses the new stand-in; all
   checks pass.
3. Manifest, icons and full-screen settings.
4. The export (read-only) and the one-time import page, rehearsed locally with the stand-in.
5. Steve's dashboard setup and the first publish. Then, on his iPhone: sign in, add it to the
   Home Screen, open it from there.
6. Export, import, compare. Steve checks his data on the phone and switches over.
7. Coach: the coaching export and the Import screen for plan changes.
