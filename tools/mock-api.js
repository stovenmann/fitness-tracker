/* Stand-in for Fitness Tracker's Cloudflare API (worker/index.js), for testing in a browser.
   tools/dev_server.py loads it before the app. It answers the page's fetch() calls to /api/ the
   way the Worker does (copied from the disc golf scorecard's test/mock-api.js and changed for
   this app):
   - GET /api/docs/<collection> sends an ETag and answers 304 when nothing changed;
   - PUT and DELETE save or remove one document.
   Its database lives in this browser's localStorage, so a reload keeps it (resume-after-reload
   needs that). All data is made up.
   URL flags:
     clear=1             empty database, and the app's own copies on this phone dropped too
                         (its kept copy, outbox, swim in progress and Coach undo; theme and
                         beep stay)
     seed=1              made-up sample data, when the database is empty
     newdb=1             a new, empty database, as if it had been recreated, but the app's copies
                         on this phone are left as they are
     lat=<ms>            how long a write takes (default 60); read=<ms> for reads (default 20)
     fail=1              every save and delete fails as if the signal dropped (reads still work);
                         switch with __mock.setFail(true|false)
     offline=1           every request fails, reads included; __mock.setOffline(true|false)
     signedout=401       every request answers as Cloudflare does when sign-in has lapsed;
     signedout=redirect  "redirect" sends its redirect to the sign-in page instead;
                         switch with __mock.setSignedOut("" | "401" | "redirect")
     server=503|500      the Worker's answers when its sign-in settings are missing, or when it
                         failed; switch with __mock.setServer("" | "503" | "500")
     nomock=1            no API at all, like a saved copy of the page
   Every request is recorded in window.__mock.log. */
(function () {
  "use strict";
  const KEY = "fitness-tracker-mock-api";
  const APP_KEYS = ["ft-cache-v1", "ft-outbox-v1", "dl-live", "ft-coach-undo"];
  const q = new URLSearchParams(location.search);
  const LAT = Number(q.get("lat") || 60);
  const READ = Number(q.get("read") || 20);
  let FAIL = q.get("fail") === "1";
  let OFFLINE = q.get("offline") === "1";
  let SIGNED_OUT = q.get("signedout") || "";
  let SERVER = q.get("server") || "";
  // the Worker's own words for each (worker/index.js)
  const SERVER_SAYS = {
    503: { code: "not_configured", message: "Sign-in isn't set up on the server yet." },
    500: { code: "server_error", message: "Something went wrong on the server. Try again." },
  };
  const COLLS = ["sessions", "weights", "state"];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fresh = () => ({ epoch: Math.floor(Math.random() * 1e12), versions: { sessions: 0, weights: 0, state: 0 }, docs: { sessions: {}, weights: {}, state: {} } });

  if (q.has("clear")) {
    try { localStorage.removeItem(KEY); APP_KEYS.forEach((k) => localStorage.removeItem(k)); } catch (e) { /* no storage */ }
  }
  let db = null;
  try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { db = null; }
  if (!db || !db.docs || q.has("newdb")) db = fresh();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* no storage */ } };

  const empty = () => COLLS.every((c) => !Object.keys(db.docs[c]).length);
  if (q.has("seed") && empty()) {
    // Synthetic data only. Not the owner's figures.
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    let n = 0;
    const add = (c, body) => { db.docs[c]["seed" + (++n) + "x" + Math.random().toString(36).slice(2, 8)] = Object.assign({ ts: Date.parse(body.date + "T12:00:00") }, body); };
    add("sessions", { date: day(6), type: "lift", minutes: 48, feel: 4, tpl: "Upper Push", volume: 9120,
      exercises: [{ name: "Bench Press", sets: [[155, 8], [155, 8], [155, 7]] }, { name: "Overhead Press", sets: [[95, 8], [95, 8]] }] });
    add("sessions", { date: day(4), type: "lift", minutes: 52, feel: 3, tpl: "Lower Pull", volume: 10350,
      exercises: [{ name: "Deadlift", sets: [[245, 5], [245, 5], [245, 5]] }] });
    add("sessions", { date: day(3), type: "run", minutes: 9.6, miles: 1, kind: "easy", feel: 3 });
    add("sessions", { date: day(2), type: "rest", minutes: 0, feel: 4 });
    add("weights", { date: day(9), lbs: 201.4 });
    add("weights", { date: day(2), lbs: 200.6 });
    COLLS.forEach((c) => { db.versions[c]++; });
  }
  persist();

  const log = [];
  const t0 = performance.now();
  const stamp = () => Math.round(performance.now() - t0);
  window.__mock = {
    log, installed: false,
    peek: (coll, id) => (db.docs[coll] && Object.prototype.hasOwnProperty.call(db.docs[coll], id) ? clone(db.docs[coll][id]) : null),
    count: (coll) => Object.keys(db.docs[coll] || {}).length,
    ids: (coll) => Object.keys(db.docs[coll] || {}).sort(),
    put: (coll, id, data) => { db.docs[coll][id] = clone(data); db.versions[coll]++; persist(); },
    del: (coll, id) => { delete db.docs[coll][id]; db.versions[coll]++; persist(); },
    setFail: (v) => { FAIL = !!v; },
    setOffline: (v) => { OFFLINE = !!v; },
    setSignedOut: (v) => { SIGNED_OUT = v ? String(v) : ""; },
    setServer: (v) => { SERVER = v ? String(v) : ""; },
  };
  if (q.get("nomock") === "1") return; // behave like a page with no server behind it
  window.__mock.installed = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    return answer(url, init || {});
  };
  const json = (status, body, headers) =>
    new Response(JSON.stringify(body), { status, headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, headers || {}) });
  function header(init, name) {
    const h = init.headers;
    if (!h) return null;
    if (h instanceof Headers) return h.get(name);
    for (const k in h) if (k.toLowerCase() === name) return h[k];
    return null;
  }
  function answer(url, init) {
    const method = String(init.method || "GET").toUpperCase();
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "docs", coll, id]
    const delay = method === "GET" ? READ : LAT;
    return new Promise((resolve, reject) => setTimeout(() => {
      const entry = { t: stamp(), method, path: url.pathname };
      log.push(entry);
      if (OFFLINE || (FAIL && method !== "GET")) { entry.ev = "dropped"; reject(new TypeError("mock: network dropped")); return; }
      if (SIGNED_OUT === "redirect") {
        entry.ev = "redirect";
        resolve(new Response(null, { status: 302, headers: { location: "https://example.cloudflareaccess.com/cdn-cgi/access/login" } }));
        return;
      }
      if (SIGNED_OUT) { entry.ev = "signed_out"; resolve(json(401, { code: "signed_out", message: "Sign in again to save." })); return; }
      if (SERVER) { entry.ev = "server_" + SERVER; resolve(json(Number(SERVER), SERVER_SAYS[SERVER])); return; }
      const coll = parts[2];
      if (parts[1] !== "docs" || !db.docs[coll] || parts.length > 4) { resolve(json(404, { code: "not_found", message: "No such collection." })); return; }
      if (parts.length === 3) {
        if (method !== "GET") { resolve(json(405, { code: "bad_method", message: "Not allowed here." })); return; }
        const tag = '"' + db.epoch + "-v" + db.versions[coll] + '"';
        if (header(init, "if-none-match") === tag) { entry.ev = "unchanged"; resolve(new Response(null, { status: 304, headers: { etag: tag } })); return; }
        entry.ev = "snapshot";
        const docs = Object.keys(db.docs[coll]).sort().map((id) => ({ id, data: clone(db.docs[coll][id]) }));
        resolve(json(200, { docs, version: db.versions[coll] }, { etag: tag }));
        return;
      }
      const id = decodeURIComponent(parts[3]);
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) { resolve(json(400, { code: "bad_id", message: "That id isn't valid." })); return; }
      if (method === "PUT") {
        let data;
        try { data = JSON.parse(init.body); } catch (e) { data = null; }
        if (!data || typeof data !== "object" || Array.isArray(data)) { resolve(json(400, { code: "bad_json", message: "That wasn't valid data." })); return; }
        db.docs[coll][id] = data;
        db.versions[coll]++;
        persist();
        entry.ev = "set"; entry.id = id;
        resolve(json(200, { ok: true }));
        return;
      }
      if (method === "DELETE") {
        delete db.docs[coll][id];
        db.versions[coll]++;
        persist();
        entry.ev = "delete"; entry.id = id;
        resolve(json(200, { ok: true }));
        return;
      }
      resolve(json(405, { code: "bad_method", message: "Not allowed here." }));
    }, delay));
  }
})();
