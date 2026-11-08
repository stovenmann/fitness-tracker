/* Local stand-in for the claude.ai artifact runtime, for testing Deck Log outside the viewer.
   Implements the parts of `db`, `user` and `sample` the app uses. Data lives in this browser's
   localStorage, so a reload keeps it (that is what resume-after-reload tests need).
   URL flags: ?clear=1 empties the store, ?seed=1 loads synthetic sample data first.
   Never loaded by the published artifact. */
(function () {
  "use strict";
  const KEY = "deck-log-mock-db";
  const qs = new URLSearchParams(location.search);
  if (qs.has("clear")) { try { localStorage.removeItem(KEY); } catch (e) {} }
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { store = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };
  const listeners = new Set();
  const notify = () => { for (const l of [...listeners]) setTimeout(l, 0); };
  let idc = 0;
  const newId = () => Date.now().toString(36) + (idc++).toString(36) + Math.random().toString(36).slice(2, 6);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const meta = Object.freeze({ fromCache: false, hasPendingWrites: false });
  const has = (p) => Object.prototype.hasOwnProperty.call(store, p);
  const writes = [];

  function docSnap(path) {
    const ex = has(path);
    const body = ex ? Object.freeze(clone(store[path])) : undefined;
    return { id: path.split("/").pop(), exists: ex, data: () => body, metadata: meta };
  }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      get: async () => docSnap(path),
      set: async (data) => { store[path] = clone(data); writes.push(["set", path]); persist(); notify(); },
      update: async (data) => {
        if (!has(path)) throw { code: "invalid_argument", message: "document does not exist" };
        Object.assign(store[path], clone(data)); writes.push(["update", path]); persist(); notify();
      },
      delete: async () => { delete store[path]; writes.push(["delete", path]); persist(); notify(); },
      onSnapshot(next) {
        let last = null;
        const fire = () => { const s = JSON.stringify(has(path) ? store[path] : null); if (s === last) return; last = s; next(docSnap(path)); };
        listeners.add(fire); setTimeout(fire, 0);
        return () => listeners.delete(fire);
      },
      collection: (sub) => colRef(path + "/" + sub),
    };
  }
  function colRef(path, q) {
    q = q || {};
    const run = () => {
      const pre = path + "/";
      let docs = Object.keys(store).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(docSnap);
      if (q.order) {
        const [f, dir] = q.order;
        docs.sort((a, b) => {
          const av = a.data()[f], bv = b.data()[f];
          if (av === undefined) return 1; if (bv === undefined) return -1;
          return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === "desc" ? -1 : 1);
        });
      } else docs.sort((a, b) => (a.id < b.id ? -1 : 1));
      if (q.lim) docs = docs.slice(0, q.lim);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta };
    };
    return {
      path,
      doc: (id) => docRef(path + "/" + (id || newId())),
      add: async (data) => { const r = docRef(path + "/" + newId()); await r.set(data); return r; },
      where: () => colRef(path, q),
      orderBy: (f, dir) => colRef(path, Object.assign({}, q, { order: [f, dir || "asc"] })),
      limit: (n) => colRef(path, Object.assign({}, q, { lim: n })),
      get: async () => run(),
      onSnapshot(next) {
        let last = null;
        const fire = () => { const r = run(); const s = JSON.stringify(r.docs.map((d) => [d.id, d.data()])); if (s === last) return; last = s; next(r); };
        listeners.add(fire); setTimeout(fire, 0);
        return () => listeners.delete(fire);
      },
    };
  }

  const UID = "tester";
  if (qs.has("seed") && !Object.keys(store).length) {
    // Synthetic data only. Not the owner's figures.
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const base = "data/users/" + UID + "/log/";
    const add = (col, body) => { store[base + col + "/" + newId()] = Object.assign({ ts: Date.parse(body.date + "T12:00:00") }, body); };
    add("sessions", { date: day(6), type: "lift", minutes: 48, feel: 4, tpl: "Upper Push", volume: 9120,
      exercises: [{ name: "Bench Press", sets: [[155, 8], [155, 8], [155, 7]] }, { name: "Overhead Press", sets: [[95, 8], [95, 8]] }] });
    add("sessions", { date: day(4), type: "lift", minutes: 52, feel: 3, tpl: "Lower Pull", volume: 10350,
      exercises: [{ name: "Deadlift", sets: [[245, 5], [245, 5], [245, 5]] }] });
    add("sessions", { date: day(3), type: "run", minutes: 9.6, miles: 1, kind: "easy", feel: 3 });
    add("sessions", { date: day(2), type: "rest", minutes: 0, feel: 4 });
    add("weights", { date: day(9), lbs: 201.4 });
    add("weights", { date: day(2), lbs: 200.6 });
    persist();
  }

  const db = { doc: docRef, collection: (p) => colRef(p) };
  const user = { id: async () => UID, me: async () => ({ id: UID }), isOwner: () => true, canEdit: () => true, can: () => true };
  let lastPrompt = "";
  const sample = async (input, opts) => {
    lastPrompt = String(input);
    const text = "(Mock coach: the prompt was " + lastPrompt.length + " characters.)";
    if (opts && opts.onText) opts.onText({ text, delta: text });
    return { text, truncated: false };
  };
  window.claude = { use: async (name) => ({ db, user, sample })[name] || null };
  window.__mock = {
    store: () => store,
    writes: () => writes.slice(),
    lastPrompt: () => lastPrompt,
    reset: () => { store = {}; persist(); notify(); },
  };
})();
