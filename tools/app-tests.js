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
