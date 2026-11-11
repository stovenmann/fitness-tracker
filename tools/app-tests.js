/* Checks for the app on its Cloudflare footing, run from tools/tests.html after the Worker's.
   Each one opens the app (public/index.html, served by dev_server.py with the stand-in API
   tools/mock-api.js) in a phone-sized frame, acts on it, and checks the result. Written after
   the disc golf scorecard's checks of the same things. All data is made up. */
"use strict";
(function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Wait until fn() is true, checking often, and fail after ms. Fixed waits break when the
  // browser slows timers: with the Claude window hidden, a 10 ms timer takes a second.
  async function until(fn, label, ms) {
    const end = performance.now() + (ms || 20000);
    for (;;) {
      let v = false;
      try { v = fn(); } catch (e) { v = false; }
      if (v) return v;
      if (performance.now() > end) throw new Error("waited too long for " + label);
      await wait(50);
    }
  }
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
      const giveUp = setTimeout(() => { clearInterval(retry); reject(new Error("the app didn't open: " + query)); }, 60000);
      f.onload = async () => {
        clearInterval(retry);
        const win = f.contentWindow, doc = f.contentDocument;
        // ready once the sessions list has its first real answer (or the page has no server)
        await until(() => {
          const st = win.__DL && win.__DL.state();
          return st && (st.S.sessReady || !doc.getElementById("signinNote").hidden);
        }, "the app to load", 20000).catch(() => { /* the check itself says what's missing */ });
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
    await until(() => storedRuns(a).length && a.text("#saveMsg") === "Run logged.", "the run to be sent");
    same("stored runs", storedRuns(a).map((s) => s.minutes), [24]);
    same("message", a.text("#saveMsg"), "Run logged.");
    same("on screen", a.st().S.sessions.length, 1);
    same("nothing waiting", a.st().cloud.pending, 0);
  });

  check("a session logged with no signal is kept on the phone and sent once back", async () => {
    const a = await openApp("clear=1");
    a.mock.setFail(true);
    a.logRun();
    await until(() => /Kept on this phone/.test(a.text("#saveMsg")) && a.sync(), "the save to fail");
    truly("the message says it's kept: " + a.text("#saveMsg"), /Kept on this phone/.test(a.text("#saveMsg")));
    same("on screen straight away", a.st().S.sessions.length, 1);
    same("stored while there's no signal", storedRuns(a).length, 0);
    same("top bar", a.sync(), "no connection — kept on this phone");
    a.mock.setFail(false);
    a.online();
    await until(() => storedRuns(a).length && a.sync() === "", "the run to be sent once back");
    same("stored once back", storedRuns(a).map((s) => s.minutes), [24]);
    same("top bar once sent", a.sync(), "");
    same("still one on screen (no copy)", a.st().S.sessions.length, 1);
  });

  check("a change that never got sent survives closing the app", async () => {
    let a = await openApp("clear=1");
    a.mock.setFail(true);
    a.logWeight(190.2);
    await until(() => a.st().cloud.trouble && a.st().cloud.pending === 1, "the save to fail");
    same("stored while there's no signal", a.mock.count("weights"), 0);
    a = await openApp("");                       // closed and opened again, with signal
    await until(() => a.mock.count("weights") === 1 && a.st().cloud.pending === 0, "the weigh-in to be sent");
    same("stored after reopening", a.mock.ids("weights").map((id) => a.mock.peek("weights", id).lbs), [190.2]);
    same("on screen once", a.st().S.weights.length, 1);
  });

  check("a failed save is retried without another tap", async () => {
    const a = await openApp("clear=1");
    a.mock.setFail(true);
    a.logRun();
    await until(() => a.st().cloud.trouble, "the save to fail");
    a.mock.setFail(false);                       // the signal comes back, with no event to say so
    await until(() => storedRuns(a).length === 1, "the retry, about 2 s after the failure");
    same("stored by the retry", storedRuns(a).length, 1);
  });

  check("signed out mid-workout: changes wait, and send after signing in", async () => {
    const a = await openApp("clear=1");
    a.mock.setSignedOut("401");                  // Cloudflare's sign-in has run out
    a.logWeight(191.6);
    await until(() => a.sync() === "signed out — kept on this phone", "the signed-out note");
    same("top bar", a.sync(), "signed out — kept on this phone");
    truly("a Sign in button is offered", a.$("#cloudBanner:not([hidden]) #cloudSignin"));
    same("stored while signed out", a.mock.count("weights"), 0);
    same("on screen", a.st().S.weights.length, 1);
    a.mock.setSignedOut("");                     // signed in again
    a.online();
    await until(() => a.mock.count("weights") === 1 && a.sync() === "", "the weigh-in to be sent once signed in");
    same("stored once signed in", a.mock.count("weights"), 1);
    same("top bar once signed in", a.sync(), "");
    truly("the banner is gone", a.$("#cloudBanner").hidden);
  });

  check("Cloudflare's redirect to its sign-in page counts as signed out, not as no signal", async () => {
    const a = await openApp("clear=1");
    a.mock.setSignedOut("redirect");
    a.logRun();
    await until(() => a.sync() === "signed out — kept on this phone", "the signed-out note");
    same("top bar", a.sync(), "signed out — kept on this phone");
    same("stored", storedRuns(a).length, 0);
  });

  check("a server with a problem says so, in its own words, not \"no connection\"", async () => {
    const a = await openApp("clear=1");
    a.mock.setServer("503");
    a.logRun();
    await until(() => a.sync() === "server problem — kept on this phone", "the server-problem note");
    same("top bar", a.sync(), "server problem — kept on this phone");
    truly("the banner gives the server's words", /Sign-in isn't set up on the server yet/.test(a.text("#cloudBanner")));
    truly("the message doesn't blame the signal: " + a.text("#saveMsg"), !/no connection/i.test(a.text("#saveMsg")));
    a.mock.setServer("");                        // fixed in the dashboard
    await until(() => storedRuns(a).length === 1 && a.sync() === "", "the retry once the server is fixed");
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
    await until(() => a.st().S.sessions.length === 0, "the new database's empty list");
    same("sessions from the new database", a.st().S.sessions.length, 0);
  });

  check("a session deleted with no signal stays deleted, and is deleted on the server later", async () => {
    let a = await openApp("clear=1");
    a.logRun();
    await until(() => storedRuns(a).length === 1 && a.$('#sessList li button[aria-label="Delete entry"]'), "the run to be sent and listed");
    same("stored", storedRuns(a).length, 1);
    a.mock.setFail(true);
    a.click('#sessList li button[aria-label="Delete entry"]');
    a.click('#sessList li button[aria-label="Delete entry"]');   // the second tap confirms
    await until(() => a.st().cloud.trouble && a.st().S.sessions.length === 0, "the delete to fail");
    same("gone from the screen", a.st().S.sessions.length, 0);
    same("still on the server for now", storedRuns(a).length, 1);
    a = await openApp("");                       // reopened, with signal
    await until(() => storedRuns(a).length === 0, "the delete to be sent");
    same("deleted on the server", storedRuns(a).length, 0);
    same("still gone from the screen", a.st().S.sessions.length, 0);
  });

  check("a swim in progress is saved after each tap, and kept when there's no signal", async () => {
    const a = await openApp("clear=1");
    a.click("#homeStart");                       // "Start Reacclimation"
    await until(() => !a.$("#swimRun").hidden && a.mock.peek("state", "live"), "the runner to open and save");
    truly("the runner is open", !a.$("#swimRun").hidden);
    same("starting it saved it, ready to go", (a.mock.peek("state", "live") || {}).phase, "ready");
    a.mock.setFail(true);
    await wait(1300);                            // a tap right after the screen changes is ignored
    a.click("#rnGo");
    await until(() => /Saved on this phone/.test(a.text("#rnSaveNote")), "the tap's save to fail");
    truly("the note says it's kept: " + a.text("#rnSaveNote"), /Saved on this phone — it sends when there's signal/.test(a.text("#rnSaveNote")));
    same("the tap isn't on the server yet", a.mock.peek("state", "live").phase, "ready");
    a.mock.setFail(false);
    a.online();
    await until(() => (a.mock.peek("state", "live") || {}).phase === "swim" && /^Saved as you go/.test(a.text("#rnSaveNote")), "the tap to be sent");
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
    for (const id of ["sessMin", "sfTime", "lfTime"]) {
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

  check("the keyboard's done key in a time box keeps what's typed and logs nothing", async () => {
    const a = await openApp("clear=1");
    a.click('#typeChips [data-type="run"]');
    for (const id of ["sessMin", "sfTime", "lfTime"]) {
      const el = a.$("#" + id);
      el.focus();
      el.value = "9:52";
      // what a press of the key does: a keydown for Enter, and unless the page stops it, the
      // browser then sends the form the box is in (a script's keydown can't do that part itself)
      const ev = new a.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      const sent = el.dispatchEvent(ev);
      if (sent && el.form) el.form.requestSubmit();
      await wait(500);
      truly(id + ": the page stops the key", ev.defaultPrevented);
      same(id + ": what's typed stays", el.value, "9:52");
      truly(id + ": the keyboard closes", a.doc.activeElement !== el);
    }
    same("nothing logged", a.mock.count("sessions"), 0);
    same("no message", a.text("#saveMsg"), "");
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

  /* ---------- the lift screen on a phone, and dates for Train sessions (2026-11-11) ---------- */
  const dayStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const noon = (s) => Date.parse(s + "T12:00:00");
  const setVal = (a, sel, v) => { const el = a.$(sel); el.value = v; el.dispatchEvent(new a.win.Event("input", { bubbles: true })); el.dispatchEvent(new a.win.Event("change", { bubbles: true })); };
  // on the screen now: laid out, not just present (a tab switches a moment after its address)
  const seen = (a, sel) => { const el = a.$(sel); return !!el && el.getClientRects().length > 0; };
  const startFirstLift = async (a) => {
    a.win.location.hash = "#train";
    await until(() => seen(a, "#panel-train"), "the Train tab to show");
    const go = await until(() => [...a.doc.querySelectorAll("#tplList button")].find((x) => x.textContent.trim() === "Start"), "a lift workout to start");
    go.click();
    await until(() => seen(a, "#liftWo .ctrl"), "the lift workout to show");
  };
  // what sticks out past the screen's right or left edge, unless a box it's in scrolls or clips it
  const spill = (a, where) => {
    const W = a.win.innerWidth, out = [];
    for (const el of a.doc.body.querySelectorAll("*")) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || (r.right <= W + 1 && r.left >= -1)) continue;
      let q = el.parentElement, clipped = false;
      while (q && q !== a.doc.body) { if (a.win.getComputedStyle(q).overflowX !== "visible") { clipped = true; break; } q = q.parentElement; }
      if (!clipped) out.push(where + ": " + (el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className ? "." + el.className : "")) + " at " + Math.round(r.left) + " to " + Math.round(r.right));
    }
    if (a.doc.documentElement.scrollWidth > W + 1) out.push(where + ": the page scrolls sideways, " + a.doc.documentElement.scrollWidth + "px for " + W);
    return out;
  };

  check("nothing on a phone's screen is wider than the phone: every tab, a lift and a swim, and their finish screens", async () => {
    const a = await openApp("clear=1&seed=1");
    const found = [];
    for (const tab of ["home", "log", "train", "trends", "coach"]) {
      a.win.location.hash = "#" + tab;
      await until(() => seen(a, "#panel-" + tab), "the " + tab + " tab to show");
      found.push(...spill(a, tab));
    }
    await startFirstLift(a);
    found.push(...spill(a, "lift"));
    // the weight box holds a weight like 137.5 whole, and every − and + is on the screen to tap
    a.$("#lwW").value = "137.5";
    truly("137.5 fits in the weight box", a.$("#lwW").scrollWidth <= a.$("#lwW").clientWidth + 1);
    for (const btn of a.doc.querySelectorAll("#liftWo .stepb")) {
      const r = btn.getBoundingClientRect();
      same("the " + btn.dataset.stp + " " + btn.textContent + " button is what's under a tap on it", a.doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), btn);
    }
    a.click("#lwLog");
    a.click("#lwFinish");
    await until(() => seen(a, "#lfDate"), "the lift finish screen to show");
    found.push(...spill(a, "lift finish"));
    const b = await openApp("clear=1");
    b.click("#homeStart");
    await until(() => seen(b, "#rnGo"), "the swim to show");
    found.push(...spill(b, "swim"));
    await wait(1300);                            // a tap right after the screen changes is ignored
    b.click("#rnEnd"); await wait(300); b.click("#rnEnd");
    await until(() => seen(b, "#sfDate"), "the swim finish screen to show");
    found.push(...spill(b, "swim finish"));
    same("things past the screen's edge", found, []);
  });

  check("a lift can be saved for an earlier day, with how long it took", async () => {
    const a = await openApp("clear=1&seed=1");
    const before = a.mock.count("sessions");
    await startFirstLift(a);
    const w0 = Number(a.$("#lwW").value);
    a.$('#liftWo .stepb[data-stp="lwW"][data-d="5"]').click();
    same("+ adds 5 lb", Number(a.$("#lwW").value), w0 + 5);
    a.click("#lwLog");
    a.click("#lwFinish");
    await until(() => !a.$("#liftFinish").hidden, "the lift finish screen");
    same("the date starts as today", a.$("#lfDate").value, dayStr(0));
    truly("the time starts as the time since Start: " + a.$("#lfTime").value, /^\d+:\d\d$/.test(a.$("#lfTime").value));
    setVal(a, "#lfDate", dayStr(1));
    setVal(a, "#lfTime", "52:00");
    a.click("#lfBack");                          // back to the sets and out again: what's set here stays
    a.click("#lwFinish");
    same("the date stays as set", a.$("#lfDate").value, dayStr(1));
    same("the time stays as set", a.$("#lfTime").value, "52:00");
    setVal(a, "#lfDate", "");
    a.click("#lfSave");
    await wait(300);
    same("with no date, nothing is saved", a.mock.count("sessions"), before);
    truly("and it says why: " + a.text("#lfMsg"), /Pick the day/.test(a.text("#lfMsg")));
    setVal(a, "#lfDate", dayStr(1));
    a.click("#lfSave");
    await until(() => a.mock.count("sessions") === before + 1, "the lift to be saved");
    const s = a.mock.ids("sessions").map((id) => a.mock.peek("sessions", id)).find((x) => x.type === "lift" && x.date === dayStr(1));
    truly("saved for yesterday", s);
    same("filed under yesterday", s.ts, noon(dayStr(1)));
    same("52 minutes", s.minutes, 52);
    same("the set as logged", s.exercises[0].sets[0][0], w0 + 5);
    truly("the message names the day: " + a.text("#saveMsg"), /saved for /.test(a.text("#saveMsg")));
  });

  check("a swim can be saved for an earlier day", async () => {
    const a = await openApp("clear=1");
    a.click("#homeStart");
    await until(() => !a.$("#swimRun").hidden, "the swim to open");
    await wait(1300);
    a.click("#rnEnd"); await wait(300); a.click("#rnEnd");
    await until(() => !a.$("#swimFinish").hidden, "the swim finish screen");
    same("the date starts as the day of the swim", a.$("#sfDate").value, dayStr(0));
    setVal(a, "#sfDate", dayStr(2));
    setVal(a, "#sfTime", "40:00");               // ended before the first push-off: no time from the clock
    a.click("#sfSave");
    await until(() => a.mock.count("sessions") === 1, "the swim to be saved");
    const s = a.mock.peek("sessions", a.mock.ids("sessions")[0]);
    same("saved for two days ago", [s.type, s.date, s.ts, s.minutes], ["swim", dayStr(2), noon(dayStr(2)), 40]);
    await until(() => /saved for /.test(a.text("#saveMsg")), "the message to name the day");
  });

  check("a saved session can be moved to another day, with everything else kept", async () => {
    const a = await openApp("clear=1&seed=1#log");
    const id = a.mock.ids("sessions").find((k) => (a.mock.peek("sessions", k) || {}).tpl === "Lower Pull");
    const was = a.mock.peek("sessions", id);
    const row = () => [...a.doc.querySelectorAll("#sessList li")].find((li) => li.querySelector(".type").textContent === "Lower Pull");
    row().querySelector(".datebtn").click();
    truly("tapping the date opens a date box", row().querySelector(".dateedit input[type=date]"));
    [...row().querySelectorAll(".dateedit button")].find((x) => x.textContent === "cancel").click();
    truly("cancel closes it", !row().querySelector(".dateedit"));
    same("and changes nothing", a.mock.peek("sessions", id), was);
    row().querySelector(".datebtn").click();
    const box = row().querySelector(".dateedit input");
    box.value = dayStr(10);
    box.dispatchEvent(new a.win.Event("input", { bubbles: true }));
    [...row().querySelectorAll(".dateedit button")].find((x) => x.textContent === "Move").click();
    await until(() => (a.mock.peek("sessions", id) || {}).date === dayStr(10), "the session to move");
    const now = a.mock.peek("sessions", id);
    same("the day and its time stamp change", [now.date, now.ts], [dayStr(10), noon(dayStr(10))]);
    same("everything else is kept", Object.assign({}, now, { date: was.date, ts: was.ts }), was);
    same("no session added or lost", a.mock.count("sessions"), 4);
    await until(() => [...a.doc.querySelectorAll("#sessList li .type")].map((x) => x.textContent).pop() === "Lower Pull", "the list to re-sort");
    truly("it says so: " + a.text("#sessListMsg"), /Lower Pull moved to /.test(a.text("#sessListMsg")));
  });

  /* ---------- Coach: the export, and Claude's plan changes (step 7) ---------- */
  // a reply as Claude might write it: advice, then the block
  const reply = (changes, bare) => {
    const body = JSON.stringify({ format: "fitness-plan-changes", version: 1, changes }, null, 1);
    return "Good start. Shoulders look fine, so build slowly.\n\n" + (bare ? body : "```fitness-plan-changes\n" + body + "\n```") + "\n";
  };
  const upAfter = { id: "up", name: "Upper Push", ex: [
    { name: "Bench Press", s: 5, r: 5 }, { name: "Overhead Press", s: 3, r: 8 }, { name: "Incline DB Press", s: 3, r: 10 },
    { name: "Dips", s: 3, r: 10 }, { name: "Triceps Pushdown", s: 3, r: 12 }, { name: "Face Pull", s: 3, r: 15 }] };
  async function paste(a, text) {
    a.$("#planPaste").value = text;
    a.click("#planCheck");
    await wait(200);
    return [...a.doc.querySelectorAll("#planPreview .pchg")].map((c) => ({
      ok: !c.classList.contains("bad"),
      title: c.querySelector(".pc-title").textContent,
      lines: [...c.querySelectorAll("li")].map((l) => l.textContent),
      reason: (c.querySelector(".pc-reason") || {}).textContent || "",
    }));
  }

  check("the coaching export holds the log, every workout with its id, and the change format", async () => {
    const a = await openApp("clear=1&seed=1#coach");
    a.$("#goals").value = "Made-up goal: bench 200 for five.";
    a.$("#coachPeek").open = true;
    a.$("#coachPeek").dispatchEvent(new a.win.Event("toggle"));
    const text = a.$("#coachExport").value;
    for (const want of ["Every session logged", "Lower Pull", "Made-up goal: bench 200 for five.",
      '"id":"up"', '"name":"Upper Push"', '"id":"p1-reacclimation"', '"restSec":90', "```fitness-plan-changes",
      '"kind":"lift"', '"kind":"swim"', "never sessions, weigh-ins, goals or a schedule"]) {
      truly("the export has " + want, text.includes(want));
    }
    truly("Share and Copy are offered", a.$("#coachShare") && a.$("#coachCopy"));
  });

  check("the coaching export sends the whole log: every kind, every set, swim block and note, however old", async () => {
    // all made up: 45 sessions back to 300 days ago, 25 weigh-ins back to 200 days ago
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const at = (n) => Date.parse(day(n) + "T12:00:00");
    const a0 = await openApp("clear=1#coach");
    const note = "Made-up long note. " + "Easy pace, shoulders fine. ".repeat(14) + "END-OF-NOTE";
    const ex = Array.from({ length: 8 }, (_, i) => ({ name: "Made-up Lift " + (i + 1), sets: [[100 + i, 10], [110 + i, 8], [120 + i, 6], [0, 12]] }));
    a0.mock.put("sessions", "old-lift", { date: day(300), ts: at(300), type: "lift", minutes: 50, feel: 3, tpl: "Made-up Day", exercises: ex, volume: 1, notes: "oldest one" });
    a0.mock.put("sessions", "skate", { date: day(90), ts: at(90), type: "skate", minutes: 75, feel: 5, notes: "park session" });
    a0.mock.put("sessions", "stretch", { date: day(80), ts: at(80), type: "yoga", minutes: 30, feel: 4, sore: { shoulders: 2 } });
    a0.mock.put("sessions", "rest", { date: day(70), ts: at(70), type: "rest", minutes: 0, feel: 3, notes: note });
    a0.mock.put("sessions", "other", { date: day(60), ts: at(60), type: "other", minutes: 40, feel: 3, notes: "hike", heartRate: 152 });
    a0.mock.put("sessions", "swim", { date: day(58), ts: at(58), type: "swim", minutes: 40, feel: 4, effort: 6, swimDist: 900, swimUnit: "yd", yards: 900,
      pool: "25yd", stage: 1, tpl: "Made-up Swim", mainPace: 103,
      swim: { blocks: [
        { name: "Warm-up", main: false, status: "done", rounds: [{ items: [{ label: "100 kick easy (board)", what: "kick", dist: 100, target: 1, done: 1, times: [null] }] }] },
        { name: "Main", main: true, status: "cut", rounds: [{ items: [{ label: "100 free threshold", what: "swim", stroke: "free", dist: 100, target: 8, done: 6, times: [102, 104, 101, 103, 105, null] }] }] },
        { name: "Cool-down", main: false, status: "skipped", rounds: [{ items: [{ label: "100 easy", what: "swim", dist: 100, target: 1, done: 0, times: [] }] }] }] } });
    for (let i = 0; i < 39; i++) a0.mock.put("sessions", "run" + i, { date: day(50 - i), ts: at(50 - i), type: "run", minutes: 9.5, miles: 1, feel: 3 });
    for (let i = 0; i < 25; i++) a0.mock.put("weights", "w" + i, { date: day(200 - i * 8), ts: at(200 - i * 8), lbs: 210 - i / 2 });
    const a = await openApp("again=1#coach");
    const text = () => a.win.__DL.buildCoachExport();
    await until(() => text().includes("all 45") && text().includes("all 25"), "the export to count 45 sessions and 25 weigh-ins");
    const t = text();
    for (const want of [
      "- " + day(300) + " Lift (Made-up Day) 50′",               // older than 8 weeks
      "Made-up Lift 8: 107×10, 117×8, 127×6, BW×12",             // the 8th exercise, every set
      "- " + day(90) + " Skate 75′", 'notes: "park session"',
      "- " + day(80) + " Stretch 30′", "sore:[shoulders:2]",
      "- " + day(70) + " Rest feel:3/5", "END-OF-NOTE",          // a long note, whole
      "- " + day(60) + " Other 40′", "also stored: heartRate=152", // a field the export doesn't know
      "Swim (Made-up Swim) 40′ feel:4/5 effort:6/10 900yd pool:25 yd stage:Reacclimation main-set:1:43/100",
      "Warm-up: 1×100 kick easy (board)",
      "Main (main set) (cut short): 6×100 free threshold (of 8 planned) times 1:42,1:44,1:41,1:43,1:45,?",
      "Cool-down: skipped",
      "- " + day(200) + " 210lb", "- " + day(8) + " 198lb"]) {
      truly("the export has " + want, t.includes(want));
    }
    same("sessions listed", (t.match(/^- \d{4}-\d\d-\d\d (Lift|Skate|Stretch|Rest|Other|Swim|Run) /gm) || []).length, 45);
    same("weigh-ins listed", (t.match(/^- \d{4}-\d\d-\d\d [\d.]+lb$/gm) || []).length, 25);
  });

  check("Claude's changes are previewed, change nothing until Apply, and Undo puts them back", async () => {
    const a = await openApp("clear=1&seed=1#coach");
    const before = a.mock.peek("state", "lifting");
    const rows = await paste(a, reply([
      { kind: "lift", template: upAfter, why: "Top sets moved easily: go heavier." },
      { kind: "lift-settings", restSec: 120, why: "Longer rest for the heavier sets." }]));
    same("rows", rows.map((r) => [r.ok, r.title]), [[true, "Lift: Upper Push"], [true, "Lift settings"]]);
    truly("the bench change is shown: " + rows[0].lines, rows[0].lines.includes("Bench Press 4×8 → 5×5"));
    truly("the new exercise is shown", rows[0].lines.includes("+ Face Pull 3×15"));
    same("the rest change is shown", rows[1].lines, ["Rest between sets: 90 s → 120 s"]);
    truly("Claude's reason is shown", a.text("#planPreview").includes("Top sets moved easily: go heavier."));
    same("the Apply button", a.text("#planApply"), "Apply 2 changes");
    same("nothing saved by checking", a.mock.peek("state", "lifting"), before);
    a.click("#planApply");
    await until(() => /^Applied/.test(a.text("#planNote")), "the changes to be applied");
    const saved = a.mock.peek("state", "lifting");
    same("bench on the server", saved.templates.find((t) => t.id === "up").ex[0], { name: "Bench Press", s: 5, r: 5 });
    same("rest on the server", saved.restSec, 120);
    same("the other workouts untouched", saved.templates.map((t) => t.id), ["up", "upl", "lp", "lpl", "core"]);
    truly("it says so: " + a.text("#planNote"), /^Applied 2 changes\./.test(a.text("#planNote")));
    truly("Undo is offered", !a.$("#planUndoRow").hidden);
    a.click("#planUndo");
    await until(() => /^Undone/.test(a.text("#planNote")), "the undo");
    const undone = a.mock.peek("state", "lifting");
    same("bench back", undone.templates.find((t) => t.id === "up").ex[0], { name: "Bench Press", s: 4, r: 8 });
    same("rest back", undone.restSec, 90);
    truly("Undo is gone once used", a.$("#planUndoRow").hidden);
  });

  check("only workout changes can be applied; anything else, or anything wrong, is explained", async () => {
    const a = await openApp("clear=1&seed=1#coach");
    const rows = await paste(a, reply([
      { kind: "session", date: "2026-11-09", type: "run" },
      { kind: "goals", text: "new goals" },
      { kind: "lift", template: { id: "up", name: "Upper Push", ex: [{ name: "Bench Press", s: 0, r: 8 }] } },
      { kind: "lift-remove", id: "nope" },
      { kind: "swim", template: { id: "p1-reacclimation", name: "Reacclimation", blocks: [{ name: "Main", main: true, items: [{ reps: 6, dist: 100, what: "sprint" }] }] } },
      { kind: "lift", template: upAfter }, { kind: "lift", template: upAfter },
    ]));
    same("which can be used", rows.map((r) => r.ok), [false, false, false, false, false, true, false]);
    truly("not a workout: " + rows[0].reason, /^Only workouts change here/.test(rows[0].reason));
    truly("goals too: " + rows[1].reason, /^Only workouts change here/.test(rows[1].reason));
    truly("bad sets: " + rows[2].reason, /sets must be a whole number from 1 to 10/.test(rows[2].reason));
    truly("unknown workout: " + rows[3].reason, /no lift workout with the id "nope"/.test(rows[3].reason));
    truly("unknown swim word: " + rows[4].reason, /"sprint" isn't swim, kick, pull or drill/.test(rows[4].reason));
    truly("twice the same workout: " + rows[6].reason, /another change to the same thing/.test(rows[6].reason));
    same("the Apply button counts only what can be used", a.text("#planApply"), "Apply 1 change");
    // every line of the preview can be read: no text on a background of its own colour (a class
    // named like one of the app's own styles once painted the reasons red on red)
    for (const n of a.doc.querySelectorAll("#planPreview .pchg *")) {
      const cs = a.win.getComputedStyle(n);
      if (n.childNodes.length && [...n.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) {
        truly("readable: \"" + n.textContent.slice(0, 40) + "\"", cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor !== cs.color);
      }
    }
    const none = await paste(a, "Looks good, keep going. No changes this time.");
    same("no block, no rows", none.length, 0);
    truly("it says there are none: " + a.text("#planNote"), /^There are no plan changes in what you pasted/.test(a.text("#planNote")));
    truly("no Apply without changes", a.$("#planActs").hidden);
    same("nothing saved", a.mock.peek("state", "lifting"), null);
  });

  check("a swim workout change applies, the block works pasted bare, and an unticked change is left out", async () => {
    const a = await openApp("clear=1&seed=1#coach");
    const p1 = JSON.parse(JSON.stringify(a.win.__DL.coachWorkouts().swim.templates.find((t) => t.id === "p1-reacclimation")));
    const main = p1.blocks.find((b) => b.main);
    main.items[0].reps = 5;                      // a made-up change: one fewer rep in the main set
    const rows = await paste(a, reply([
      { kind: "swim", template: p1, why: "Ease in." },
      { kind: "lift-settings", barLbs: 35 }], true));
    same("both can be used", rows.map((r) => r.ok), [true, true]);
    truly("the swim change is shown: " + rows[0].lines, rows[0].lines.some((l) => /^\+ Main set \(main\): 5×100/.test(l)));
    a.$('#planPreview input[aria-label="Apply: Lift settings"]').click();   // untick the bar change
    same("the Apply button follows the ticks", a.text("#planApply"), "Apply 1 change");
    a.click("#planApply");
    await until(() => /^Applied/.test(a.text("#planNote")), "the change to be applied");
    const swim = a.mock.peek("state", "swim");
    same("the main set on the server", swim.templates.find((t) => t.id === "p1-reacclimation").blocks.find((b) => b.main).items[0].reps, 5);
    same("the unticked bar change wasn't applied", a.mock.peek("state", "lifting"), null);
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

  window.appChecks = checks;
})();
