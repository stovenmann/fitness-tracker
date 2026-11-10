/* Checks for the app on its Cloudflare footing, run from tools/tests.html after the Worker's.
   Each one opens the app (public/index.html, served by dev_server.py with the stand-in API
   tools/mock-api.js) in a phone-sized frame, acts on it, and checks the result. Written after
   the disc golf scorecard's checks of the same things. All data is made up. */
"use strict";
(function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const same = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  };
  const truly = (label, v) => { if (!v) throw new Error(label); };

  function openApp(query) {
    return new Promise((resolve, reject) => {
      const old = document.getElementById("app-frame");
      if (old) old.remove();
      const f = document.createElement("iframe");
      f.id = "app-frame";
      f.width = 375;
      f.height = 667;
      f.src = "/?" + query;
      // Python's test server now and then resets a connection mid-page, and a half-loaded frame
      // never fires onload: load it again rather than hang (the disc golf checks do the same)
      let tries = 0;
      const retry = setInterval(() => {
        if (++tries > 3) { clearInterval(retry); return; }
        f.src = "/?" + query + "&reload=" + tries;
      }, 8000);
      const giveUp = setTimeout(() => { clearInterval(retry); reject(new Error("the app didn't open: " + query)); }, 34000);
      f.onload = async () => {
        clearInterval(retry);
        const win = f.contentWindow, doc = f.contentDocument;
        // ready once the sessions list has its first real answer (or the page has no server)
        for (let i = 0; i < 80; i++) {
          const st = win.__DL && win.__DL.state();
          if (st && (st.S.sessReady || !doc.getElementById("signinNote").hidden)) break;
          await wait(50);
        }
        await wait(200);
        clearTimeout(giveUp);
        resolve({
          win, doc,
          mock: win.__mock,
          $: (s) => doc.querySelector(s),
          st: () => win.__DL.state(),
          click(s) {
            const el = doc.querySelector(s);
            if (!el) throw new Error("nothing on screen matches " + s);
            el.click();
          },
          text: (s) => { const el = doc.querySelector(s); return el ? el.textContent.trim() : null; },
          sync: () => { const n = doc.getElementById("syncNote"); return n.hidden ? "" : n.textContent; },
          online: () => win.dispatchEvent(new win.Event("online")),
          // log a 24-minute run from the Log tab
          logRun() {
            doc.querySelector('#typeChips [data-type="run"]').click();
            doc.getElementById("sessMin").value = "24:00";
            doc.getElementById("sessForm").requestSubmit();
          },
          logWeight(lbs) {
            doc.getElementById("wtLbs").value = String(lbs);
            doc.getElementById("wtForm").requestSubmit();
          },
        });
      };
      document.getElementById("stage").appendChild(f);
    });
  }
  const storedRuns = (a) => a.mock.ids("sessions").map((id) => a.mock.peek("sessions", id)).filter((s) => s.type === "run");

  const checks = [];
  const check = (name, fn) => checks.push({ name: "App: " + name, fn });

  check("it opens on the new server, and the 135 swim checks still pass", async () => {
    const a = await openApp("clear=1&seed=1");
    same("sessions on screen", a.st().S.sessions.length, 4);
    same("weigh-ins on screen", a.st().S.weights.length, 2);
    same("top bar", a.sync(), "");
    const t = await a.win.runSwimTests();
    same("swim checks failing", t.failed, 0);
    truly("swim checks run: " + t.passed, t.passed >= 135);
  });

  check("a session logged with signal is sent at once", async () => {
    const a = await openApp("clear=1");
    a.logRun();
    await wait(600);
    same("stored runs", storedRuns(a).map((s) => s.minutes), [24]);
    same("message", a.text("#saveMsg"), "Run logged.");
    same("on screen", a.st().S.sessions.length, 1);
    same("nothing waiting", a.st().cloud.pending, 0);
  });

  check("a session logged with no signal is kept on the phone and sent once back", async () => {
    const a = await openApp("clear=1");
    a.mock.setFail(true);
    a.logRun();
    await wait(600);
    truly("the message says it's kept: " + a.text("#saveMsg"), /Kept on this phone/.test(a.text("#saveMsg")));
    same("on screen straight away", a.st().S.sessions.length, 1);
    same("stored while there's no signal", storedRuns(a).length, 0);
    same("top bar", a.sync(), "no connection — kept on this phone");
    a.mock.setFail(false);
    a.online();
    await wait(800);
    same("stored once back", storedRuns(a).map((s) => s.minutes), [24]);
    same("top bar once sent", a.sync(), "");
    same("still one on screen (no copy)", a.st().S.sessions.length, 1);
  });

  check("a change that never got sent survives closing the app", async () => {
    let a = await openApp("clear=1");
    a.mock.setFail(true);
    a.logWeight(190.2);
    await wait(500);
    same("stored while there's no signal", a.mock.count("weights"), 0);
    a = await openApp("");                       // closed and opened again, with signal
    await wait(800);
    same("stored after reopening", a.mock.ids("weights").map((id) => a.mock.peek("weights", id).lbs), [190.2]);
    same("on screen once", a.st().S.weights.length, 1);
  });

  check("a failed save is retried without another tap", async () => {
    const a = await openApp("clear=1");
    a.mock.setFail(true);
    a.logRun();
    await wait(400);
    a.mock.setFail(false);                       // the signal comes back, with no event to say so
    await wait(3500);                            // the first retry comes about 2 s after the failure
    same("stored by the retry", storedRuns(a).length, 1);
  });

  check("signed out mid-workout: changes wait, and send after signing in", async () => {
    const a = await openApp("clear=1");
    a.mock.setSignedOut("401");                  // Cloudflare's sign-in has run out
    a.logWeight(191.6);
    await wait(600);
    same("top bar", a.sync(), "signed out — kept on this phone");
    truly("a Sign in button is offered", a.$("#cloudBanner:not([hidden]) #cloudSignin"));
    same("stored while signed out", a.mock.count("weights"), 0);
    same("on screen", a.st().S.weights.length, 1);
    a.mock.setSignedOut("");                     // signed in again
    a.online();
    await wait(800);
    same("stored once signed in", a.mock.count("weights"), 1);
    same("top bar once signed in", a.sync(), "");
    truly("the banner is gone", a.$("#cloudBanner").hidden);
  });

  check("Cloudflare's redirect to its sign-in page counts as signed out, not as no signal", async () => {
    const a = await openApp("clear=1");
    a.mock.setSignedOut("redirect");
    a.logRun();
    await wait(600);
    same("top bar", a.sync(), "signed out — kept on this phone");
    same("stored", storedRuns(a).length, 0);
  });

  check("a server with a problem says so, in its own words, not \"no connection\"", async () => {
    const a = await openApp("clear=1");
    a.mock.setServer("503");
    a.logRun();
    await wait(600);
    same("top bar", a.sync(), "server problem — kept on this phone");
    truly("the banner gives the server's words", /Sign-in isn't set up on the server yet/.test(a.text("#cloudBanner")));
    truly("the message doesn't blame the signal: " + a.text("#saveMsg"), !/no connection/i.test(a.text("#saveMsg")));
    a.mock.setServer("");                        // fixed in the dashboard
    await wait(3500);
    same("stored once fixed", storedRuns(a).length, 1);
    same("top bar once fixed", a.sync(), "");
    truly("the banner is gone", a.$("#cloudBanner").hidden);
    const b = await openApp("server=500");       // opened while the server has a problem
    truly("the banner on opening", /Something went wrong on the server/.test(b.text("#cloudBanner")));
  });

  check("opened with no signal, it shows what this phone last saw", async () => {
    let a = await openApp("clear=1&seed=1");     // a normal visit keeps a copy on the phone
    same("sessions on the first visit", a.st().S.sessions.length, 4);
    a = await openApp("offline=1");              // reopened with no signal at all
    same("sessions with no signal", a.st().S.sessions.length, 4);
    same("weigh-ins with no signal", a.st().S.weights.length, 2);
  });

  check("a copy kept from another database is never shown as current", async () => {
    let a = await openApp("clear=1&seed=1");     // this phone keeps a copy with four sessions
    same("sessions on the first database", a.st().S.sessions.length, 4);
    a = await openApp("newdb=1");                // the database recreated, empty
    await wait(400);
    same("sessions from the new database", a.st().S.sessions.length, 0);
  });

  check("a session deleted with no signal stays deleted, and is deleted on the server later", async () => {
    let a = await openApp("clear=1");
    a.logRun();
    await wait(600);
    same("stored", storedRuns(a).length, 1);
    a.mock.setFail(true);
    a.click('#sessList li button[aria-label="Delete entry"]');
    a.click('#sessList li button[aria-label="Delete entry"]');   // the second tap confirms
    await wait(500);
    same("gone from the screen", a.st().S.sessions.length, 0);
    same("still on the server for now", storedRuns(a).length, 1);
    a = await openApp("");                       // reopened, with signal
    await wait(800);
    same("deleted on the server", storedRuns(a).length, 0);
    same("still gone from the screen", a.st().S.sessions.length, 0);
  });

  check("a swim in progress is saved after each tap, and kept when there's no signal", async () => {
    const a = await openApp("clear=1");
    a.click("#homeStart");                       // "Start Reacclimation"
    await wait(400);
    truly("the runner is open", !a.$("#swimRun").hidden);
    await wait(300);
    same("starting it saved it, ready to go", (a.mock.peek("state", "live") || {}).phase, "ready");
    a.mock.setFail(true);
    await wait(1300);                            // a tap right after the screen changes is ignored
    a.click("#rnGo");
    await wait(500);
    truly("the note says it's kept: " + a.text("#rnSaveNote"), /Saved on this phone — it sends when there's signal/.test(a.text("#rnSaveNote")));
    same("the tap isn't on the server yet", a.mock.peek("state", "live").phase, "ready");
    a.mock.setFail(false);
    a.online();
    await wait(800);
    const live = a.mock.peek("state", "live");
    truly("on the server once back", live && live.phase === "swim");
    same("the note once sent", a.text("#rnSaveNote"), "Saved as you go — a reload picks up where you are.");
  });

  check("a page with no server behind it says nothing saves", async () => {
    const a = await openApp("clear=1&nomock=1");
    truly("the Log banner shows", !a.$("#signinNote").hidden);
    truly("it doesn't mention claude.ai", !/claude/i.test(a.text("#signinNote")));
  });

  check("the time boxes open the full keyboard, so mm:ss can be typed on an iPhone", async () => {
    const a = await openApp("clear=1");
    for (const id of ["sessMin", "sfTime"]) {
      const el = a.$("#" + id);
      // an iPhone's number pad (numeric, decimal, tel) has no ":" key
      truly(id + " doesn't ask for a number pad: " + el.getAttribute("inputmode"), !/numeric|decimal|tel/.test(el.getAttribute("inputmode") || ""));
      same(id + " is a text box", el.type, "text");
      same(id + " isn't autocorrected", [el.getAttribute("autocorrect"), el.getAttribute("autocapitalize"), el.getAttribute("spellcheck")], ["off", "off", "false"]);
    }
    a.click('#typeChips [data-type="run"]');
    a.$("#sessMin").value = "9:52";
    a.$("#sessMiles").value = "1";
    a.$("#sessMiles").dispatchEvent(new a.win.Event("input", { bubbles: true }));
    a.$("#sessMin").dispatchEvent(new a.win.Event("input", { bubbles: true }));
    same("9:52 over a mile", a.text("#paceHint"), "Pace works out to 9:52/mi");
  });

  check("every place to type is at least 16px, so the iPhone doesn't zoom in on a tap", async () => {
    const a = await openApp("clear=1&seed=1");
    // the boxes on the page now (each tab's, hidden ones too)
    const typed = (el) => el.tagName !== "INPUT" || !/^(checkbox|radio|range|button|submit|reset|file|hidden|color)$/.test(el.type);
    const boxes = [...a.doc.querySelectorAll("input,select,textarea")].filter(typed);
    truly("there are boxes to measure", boxes.length >= 15);
    const small = boxes.filter((el) => parseFloat(a.win.getComputedStyle(el).fontSize) < 16)
      .map((el) => (el.id || el.className || el.tagName) + " " + a.win.getComputedStyle(el).fontSize);
    same("boxes under 16px", small, []);
    // and the ones built later (the swim and lift editors): no style may set a box under 16px
    const rules = [...a.doc.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } })
      .filter((r) => r.selectorText && /(^|[\s,>+~(])(input|select|textarea)\b/.test(r.selectorText) && r.style.fontSize);
    const shrink = rules.filter((r) => /px$/.test(r.style.fontSize) && parseFloat(r.style.fontSize) < 16)
      .map((r) => r.selectorText + " → " + r.style.fontSize);
    same("styles that make a box smaller than 16px", shrink, []);
  });

  /* ---------- the Home Screen and full screen (step 3) ---------- */
  // dev_server.py serves public/'s manifest and icons at the same addresses Cloudflare will
  function loadImage(url) {
    return new Promise((ok, bad) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => bad(new Error("no image at " + url));
      img.src = url;
    });
  }
  function cornerColour(img) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(2, 2, 1, 1).data;
    return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const metaOf = (a, name) => { const m = a.$(`meta[name="${name}"]`); return m ? m.getAttribute("content") : null; };
  const INK = "#131D24"; // the icon's background

  check("added to the Home Screen, it shows the dumbbell and the name Fitness", async () => {
    const a = await openApp("clear=1");
    const link = a.$('head link[rel="apple-touch-icon"]');
    truly("the page's head names a Home Screen icon", link);
    const img = await loadImage(new URL(link.getAttribute("href"), a.doc.baseURI).href);
    same("icon size", [img.naturalWidth, img.naturalHeight], [180, 180]);
    same("icon background (ink)", cornerColour(img), INK);
    same("name under the icon", metaOf(a, "apple-mobile-web-app-title"), "Fitness");
    truly("the name is in the head", a.$('head meta[name="apple-mobile-web-app-title"]'));
    const tab = a.$('head link[rel="icon"]');
    truly("the browser tab shows the dumbbell too", tab);
    await loadImage(new URL(tab.getAttribute("href"), a.doc.baseURI).href);
    same("the tab's title", a.doc.title, "Fitness Tracker");
  });

  check("opened from the Home Screen, it runs full screen like an app", async () => {
    const a = await openApp("clear=1");
    same("full screen on an iPhone", metaOf(a, "apple-mobile-web-app-capable"), "yes");
    same("full screen on other phones", metaOf(a, "mobile-web-app-capable"), "yes");
    truly("the page reaches under the notch and the home bar", /viewport-fit=cover/.test(metaOf(a, "viewport") || ""));
    const link = a.$('head link[rel="manifest"]');
    truly("the page names a web-app manifest", link);
    // Cloudflare's sign-in turns away a manifest fetched without the sign-in cookie
    same("the manifest is fetched signed in", link.getAttribute("crossorigin"), "use-credentials");
    const at = new URL(link.getAttribute("href"), a.doc.baseURI);
    const res = await fetch(at.href, { credentials: "include" });
    truly("the manifest is served", res.ok);
    const m = await res.json();
    same("display", m.display, "standalone");
    same("name", m.name, "Fitness Tracker");
    same("short name", m.short_name, "Fitness");
    const home = new URL("./", at).href;
    same("opens on the app's own page", new URL(m.start_url, at).href, home);
    same("stays inside the app", new URL(m.scope, at).href, home);
    same("splash colour (the light background)", String(m.background_color).toUpperCase(), "#E7EDEA");
    const sizes = [];
    for (const i of m.icons || []) {
      const img = await loadImage(new URL(i.src, at).href);
      same(i.src + " size", img.naturalWidth + "x" + img.naturalHeight, i.sizes);
      same(i.src + " background (ink)", cornerColour(img), INK);
      sizes.push(i.sizes);
    }
    same("icon sizes in the manifest", sizes.sort(), ["192x192", "512x512"]);
    // with the page under the notch, the page and the tab bar pad themselves clear of it
    const rules = [...a.doc.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } });
    const css = (sel) => rules.filter((x) => x.selectorText === sel).map((r) => r.style.cssText).join(" ");
    truly("the page clears the notch", /safe-area-inset-top/.test(css(":root")));
    truly("the tab bar clears the home bar", /safe-area-inset-bottom/.test(css("nav.bottom")));
  });

  check("the phone's status bar takes the background of the theme in use", async () => {
    const bar = (a) => metaOf(a, "theme-color");
    const page = (a) => a.win.getComputedStyle(a.doc.body).backgroundColor;
    const rgb = (a, colour) => {
      const s = a.doc.createElement("i");
      s.style.color = colour;
      a.doc.body.appendChild(s);
      const c = a.win.getComputedStyle(s).color;
      s.remove();
      return c;
    };
    const light = "rgb(231, 237, 234)", dark = "rgb(13, 19, 23)";
    // iOS draws its own bar, tinted with this colour, so the clock stays readable in both themes
    let a = await openApp("clear=1");
    try { a.win.localStorage.removeItem("dl-theme"); } catch (e) { /* no storage */ }
    a = await openApp("clear=1");                // Auto: the phone's own setting decides
    same("status bar style", metaOf(a, "apple-mobile-web-app-status-bar-style"), "default");
    same("status bar matches the page on Auto", rgb(a, bar(a)), page(a));
    a.click("#themeToggle");                     // Auto → Light
    same("page on Light", page(a), light);
    same("status bar on Light", rgb(a, bar(a)), light);
    a.click("#themeToggle");                     // Light → Dark
    same("page on Dark", page(a), dark);
    same("status bar on Dark", rgb(a, bar(a)), dark);
    a = await openApp("");                       // the choice is kept on this phone
    same("page on reopening", page(a), dark);
    same("status bar on reopening, before the app's script runs too", rgb(a, bar(a)), dark);
    a.click("#themeToggle");                     // Dark → Auto, as the phone had it
    same("status bar back on Auto", rgb(a, bar(a)), page(a));
  });

  /* ---------- the one-time import page (step 4) ---------- */
  function openImport(query) {
    return new Promise((resolve, reject) => {
      const old = document.getElementById("app-frame");
      if (old) old.remove();
      const f = document.createElement("iframe");
      f.id = "app-frame";
      f.width = 375;
      f.height = 667;
      f.src = "/import.html?" + query;
      let tries = 0;
      const retry = setInterval(() => {
        if (++tries > 3) { clearInterval(retry); return; }
        f.src = "/import.html?" + query + "&reload=" + tries;
      }, 8000);
      const giveUp = setTimeout(() => { clearInterval(retry); reject(new Error("the import page didn't open")); }, 34000);
      f.onload = async () => {
        clearInterval(retry);
        const win = f.contentWindow, doc = f.contentDocument;
        for (let i = 0; i < 60 && !win.importReady; i++) await wait(50);
        clearTimeout(giveUp);
        const text = (s) => doc.querySelector(s).textContent.trim();
        resolve({
          win, doc, mock: win.__mock, text,
          async choose(content) {
            const dt = new win.DataTransfer();
            const body = typeof content === "string" ? content : JSON.stringify(content);
            dt.items.add(new win.File([body], "fitness-backup.json", { type: "application/json" }));
            const input = doc.getElementById("file");
            input.files = dt.files;
            win.importChosen = false;
            input.dispatchEvent(new win.Event("change"));
            for (let i = 0; i < 60 && !win.importChosen; i++) await wait(50);
            return text("#summary");
          },
          async run() {
            win.importDone = false;
            doc.getElementById("go").click();
            for (let i = 0; i < 100 && !win.importDone; i++) await wait(50);
            return text("#result");
          },
        });
      };
      document.getElementById("stage").appendChild(f);
    });
  }
  // a made-up backup in the shape tools/build-backup.py writes; ids in the old 20-character shape
  const backupFile = () => ({
    format: "fitness-tracker-backup", version: 1, exportedAt: "2026-11-08T15:00:00+00:00",
    sessions: [
      { id: "a1b2c3d4e5f6g7h8i9j0", data: { date: "2026-10-27", ts: 1793203200000, type: "lift", minutes: 50, feel: 4, tpl: "Upper Pull", volume: 8400, exercises: [{ name: "Row", sets: [[135, 10], [135, 9]] }] } },
      { id: "k1l2m3n4o5p6q7r8s9t0", data: { date: "2026-10-29", ts: 1793376000000, type: "run", minutes: 22.5, miles: 2, kind: "easy", feel: 3 } },
      { id: "u1v2w3x4y5z6a7b8c9d0", data: { date: "2026-11-01", ts: 1793635200000, type: "swim", minutes: 35, feel: 4, yards: 1400, swimDist: 1400, swimUnit: "yd", sore: { shoulders: 1 } } },
    ],
    weights: [
      { id: "e1f2g3h4i5j6k7l8m9n0", data: { date: "2026-10-26", ts: 1793116800000, lbs: 203.8 } },
      { id: "o1p2q3r4s5t6u7v8w9x0", data: { date: "2026-11-02", ts: 1793721600000, lbs: 202.9 } },
    ],
    state: [
      { id: "goals", data: { text: "Made-up goals for the import check.", updatedAt: "2026-10-20" } },
      { id: "lifting", data: { barLbs: 45, restSec: 120, templates: [{ id: "t_x", name: "Check Day", ex: [{ name: "Row", s: 3, r: 10 }] }] } },
      { id: "swim", data: { pool: "25m", startDate: "2026-10-30", seeded: ["p1-reacclimation"], templates: [] } },
    ],
  });
  const ALL = "In this file: 3 sessions, 2 weigh-ins, your goals, your lift templates and your swim plans and settings";

  check("the import page adds a whole backup and checks it on the server", async () => {
    const a = await openImport("clear=1");
    truly("the summary counts the file: " + (await a.choose(backupFile())), a.text("#summary").startsWith(ALL));
    const out = await a.run();
    truly("it says what it added: " + out, out.startsWith("Added 3 sessions, 2 weigh-ins, your goals, your lift templates and your swim plans and settings."));
    truly("it checked everything on the server: " + out, /All 8 match the file\./.test(out));
    same("sessions stored, ids kept", a.mock.ids("sessions"), backupFile().sessions.map((d) => d.id).sort());
    same("the lifting doc stored exactly", a.mock.peek("state", "lifting"), backupFile().state[1].data);
    const app = await openApp("");               // the app then shows it all
    same("sessions in the app", app.st().S.sessions.length, 3);
    same("weigh-ins in the app", app.st().S.weights.length, 2);
    same("lift templates in the app", app.st().S.lift.templates.map((t) => t.name), ["Check Day"]);
    same("the pool in the app", app.st().swim.pool, "25m");
  });

  check("run again, the import adds only what's missing and changes nothing else", async () => {
    let a = await openImport("clear=1");
    await a.choose(backupFile());
    await a.run();
    a.mock.del("sessions", "k1l2m3n4o5p6q7r8s9t0");
    a = await openImport("");
    await a.choose(backupFile());
    const out = await a.run();
    truly("it adds the one missing: " + out, out.startsWith("Added 1 session."));
    truly("and says the rest were there: " + out, /Already here, the same: 2 sessions, 2 weigh-ins, your goals, your lift templates and your swim plans and settings\./.test(out));
    same("sessions stored", a.mock.count("sessions"), 3);
  });

  check("the import never overwrites: a different version already here is left alone, and it says so", async () => {
    const a = await openImport("clear=1");
    const tested = { pool: "25yd", startDate: "2026-11-08", seeded: [], templates: [] }; // e.g. from a test swim
    a.mock.put("state", "swim", tested);
    await a.choose(backupFile());
    const out = await a.run();
    truly("it names what it left alone: " + out, /Left alone, as a different version is already here: your swim plans and settings \(swim\)/.test(out));
    same("the swim doc on the server is untouched", a.mock.peek("state", "swim"), tested);
    same("everything else came over", [a.mock.count("sessions"), a.mock.count("weights"), a.mock.ids("state")], [3, 2, ["goals", "lifting", "swim"]]);
  });

  check("the import turns away a file that isn't a backup, or holds a swim in progress, and sends nothing", async () => {
    const a = await openImport("clear=1");
    truly("not JSON", /isn't a Fitness Tracker backup/.test(await a.choose("{oops")));
    truly("the disc golf backup", /doesn't say it is one/.test(await a.choose({ format: "disc-golf-backup", version: 1, courses: [], rounds: [] })));
    const withLive = backupFile();
    withLive.state.push({ id: "live", data: { v: 1, phase: "swim" } });
    truly("a swim in progress", /doesn't know \(live\)/.test(await a.choose(withLive)));
    const twice = backupFile();
    twice.weights.push(twice.weights[0]);
    truly("an id twice", /twice/.test(await a.choose(twice)));
    truly("no Import button for a refused file", a.doc.getElementById("go").hidden);
    same("nothing was sent", a.mock.log.filter((e) => e.method !== "GET").length, 0);
  });

  check("on the import page, signed out, no signal and a server problem each say so, and a rerun finishes", async () => {
    const a = await openImport("clear=1");
    await a.choose(backupFile());
    a.mock.setSignedOut("401");
    truly("signed out: " + (await a.run()), /^Signed out\. Reload this page to sign in again/.test(a.text("#result")));
    a.mock.setSignedOut("");
    a.mock.setServer("503");
    truly("server problem: " + (await a.run()), /Sign-in isn't set up on the server yet/.test(a.text("#result")));
    a.mock.setServer("");
    a.mock.setOffline(true);
    truly("no signal: " + (await a.run()), /Couldn't reach the server/.test(a.text("#result")));
    a.mock.setOffline(false);
    truly("then it finishes: " + (await a.run()), /All 8 match the file\./.test(a.text("#result")));
  });

  window.appChecks = checks;
})();
