/* Checks for Fitness Tracker's Cloudflare Worker (worker/index.js), run in the browser from
   tools/tests.html, which dev_server.py serves. Copied from the disc golf scorecard's Worker
   checks and changed for this app. Each check imports a fresh copy of the Worker, so its cached
   sign-in keys never leak between checks. D1 is an in-memory stand-in that answers exactly the
   statements the Worker sends. Sign-in tokens are made here with a throwaway key, the way
   Cloudflare Access signs them. All names, addresses and data are made up. */
"use strict";
(function () {
  const TEAM = "fitness-test.cloudflareaccess.com";
  const AUD = "aud-fitness-test";
  const ME = "lifter@example.com";
  const BASE = "https://fitness-tracker.example.workers.dev";
  const NOW = Date.UTC(2026, 10, 8, 15, 0, 0);
  const sec = () => Math.floor(NOW / 1000);

  const same = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  };
  const truly = (label, v) => { if (!v) throw new Error(label); };
  let n = 0;
  const loadWorker = () => import("/worker/index.js?fresh=" + Date.now() + "-" + (++n));

  function b64url(bytes) {
    let s = "";
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  /* a stand-in for Cloudflare Access: a signing key, its published certs, and tokens */
  async function accessKit() {
    const kit = { keys: [], fetches: 0 };
    kit.addKey = async () => {
      const pair = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["sign", "verify"]);
      const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      const key = { kid: "k" + Math.random().toString(36).slice(2, 10), pair, jwk };
      kit.keys.push(key);
      return key;
    };
    kit.fetch = async (url) => {
      kit.fetches++;
      if (url !== "https://" + TEAM + "/cdn-cgi/access/certs") return new Response("not found", { status: 404 });
      const keys = kit.keys.map((k) => ({ kid: k.kid, kty: "RSA", alg: "RS256", use: "sig", n: k.jwk.n, e: k.jwk.e }));
      return new Response(JSON.stringify({ keys }), { headers: { "content-type": "application/json" } });
    };
    kit.token = async (over, opts) => {
      const o = opts || {};
      const key = o.key || kit.keys[0];
      const claims = Object.assign({ aud: [AUD], iss: "https://" + TEAM, email: ME, sub: "user-1", type: "app",
        iat: sec() - 60, nbf: sec() - 60, exp: sec() + 3600 }, over || {});
      const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
      const input = enc({ alg: "RS256", kid: o.kid || key.kid, typ: "JWT" }) + "." + enc(claims);
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", (o.signWith || key).pair.privateKey, new TextEncoder().encode(input));
      return input + "." + b64url(new Uint8Array(sig));
    };
    await kit.addKey();
    return kit;
  }
  /* D1 stand-in: recognises exactly the Worker's statements (W.SQL) and nothing else */
  function fakeD1(W) {
    const docs = new Map(), meta = new Map();
    const key = (c, id) => c + "\u0000" + id;
    const run = (sql, a) => {
      if (W.SQL.init.indexOf(sql) >= 0) return { results: [] };
      if (sql === W.SQL.epoch) { if (!meta.has("#epoch")) meta.set("#epoch", a[0]); return { results: [] }; }
      if (sql === W.SQL.version) return { results: meta.has(a[0]) ? [{ version: meta.get(a[0]) }] : [] };
      if (sql === W.SQL.list) {
        const rows = [];
        docs.forEach((v, k) => { const [c, id] = k.split("\u0000"); if (c === a[0]) rows.push({ id, data: v.data }); });
        return { results: rows.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) };
      }
      if (sql === W.SQL.save) { docs.set(key(a[0], a[1]), { data: a[2], updated_at: a[3] }); return { results: [] }; }
      if (sql === W.SQL.remove) { docs.delete(key(a[0], a[1])); return { results: [] }; }
      if (sql === W.SQL.bump) { meta.set(a[0], (meta.get(a[0]) || 0) + 1); return { results: [] }; }
      throw new Error("D1 stand-in: unexpected statement " + sql);
    };
    const stmt = (sql, a) => ({
      sql, a: a || [],
      bind: (...args) => stmt(sql, args),
      first: async () => run(sql, a || []).results[0] || null,
      all: async () => run(sql, a || []),
      run: async () => run(sql, a || []),
    });
    return { docs, prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => run(s.sql, s.a)) };
  }
  async function setup(over) {
    const W = await loadWorker();
    const kit = await accessKit();
    const env = Object.assign({
      DB: fakeD1(W),
      ASSETS: { fetch: async (req) => new Response("app file " + new URL(req.url).pathname) },
      ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: ME,
    }, over || {});
    const deps = { now: () => NOW, fetch: kit.fetch };
    const token = await kit.token();
    const call = async (method, path, o) => {
      const opts = o || {};
      const headers = new Headers(opts.headers || {});
      const t = opts.token === undefined ? token : opts.token;
      if (t) headers.set("cf-access-jwt-assertion", t);
      const init = { method, headers };
      if (opts.body !== undefined) init.body = opts.body;
      const res = await W.handle(new Request(BASE + path, init), env, deps);
      let body = null;
      const type = res.headers.get("content-type") || "";
      if (type.indexOf("json") >= 0) body = await res.json();
      return { res, status: res.status, body };
    };
    /* a request-like object, for headers a browser won't let a script set (Cookie, Sec-Fetch-Site) */
    const callRaw = async (method, path, headerObj) =>
      W.handle({ url: BASE + path, method, headers: new Headers(headerObj) }, env, deps);
    return { W, kit, env, deps, token, call, callRaw };
  }
  const putJSON = (data) => ({ body: JSON.stringify(data), headers: { "content-type": "application/json" } });
  // made-up entries in the app's own shapes
  const sampleSession = {
    date: "2026-11-02", ts: 1793962800000, type: "swim", minutes: 31, feel: 4, notes: "",
    swimDist: 1250, swimUnit: "yd", yards: 1250, pool: "25yd", effort: 6, stage: 1,
    mainPace: 112, sessionPace: 149, sore: { shoulders: 1 },
    swim: { blocks: [{ name: "Main", main: true, status: "done", rounds: [{ items: [{ label: "6 x 50", what: "swim", stroke: "free", dist: 50, target: 6, done: 6, times: [56, 55, null, 57, 56, 58] }] }] }] },
  };
  const sampleWeight = { date: "2026-11-03", ts: 1794049200000, lbs: 187.4 };
  const sampleLifting = { barLbs: 45, restSec: 90, templates: [{ id: "t_a", name: "Upper Push", ex: [{ name: "Bench", s: 3, r: 8 }] }] };

  const checks = [];
  const check = (name, fn) => checks.push({ name: "Worker: " + name, fn });

  check("the API refuses anyone who isn't signed in", async () => {
    const t = await setup();
    const none = await t.call("GET", "/api/docs/sessions", { token: "" });
    same("status with no sign-in", [none.status, none.body.code], [401, "signed_out"]);
    const junk = await t.call("GET", "/api/docs/sessions", { token: "not.a.token" });
    same("status with a junk token", [junk.status, junk.body.code], [401, "signed_out"]);
    const page = await t.call("GET", "/", { token: "" });
    same("the app's own page is served (Access guards it)", await page.res.text(), "app file /");
  });

  check("an expired, forged or other-app sign-in is refused", async () => {
    const t = await setup();
    const expired = await t.call("GET", "/api/docs/sessions", { token: await t.kit.token({ exp: sec() - 120 }) });
    same("expired", [expired.status, expired.body.code], [401, "signed_out"]);
    truly("an expired sign-in says it ran out, got " + expired.body.message, /run out/.test(expired.body.message));
    const stranger = await t.kit.addKey();
    t.kit.keys.pop(); // a key Cloudflare never published, posing as the real one
    const forged = await t.call("GET", "/api/docs/sessions", { token: await t.kit.token({}, { signWith: stranger }) });
    same("signed with the wrong key", forged.status, 401);
    // another Access app on the same account (the disc golf scorecard, say) has its own audience
    const otherApp = await t.call("GET", "/api/docs/sessions", { token: await t.kit.token({ aud: ["aud-another-app"] }) });
    same("another Access app's sign-in", otherApp.status, 401);
    const otherTeam = await t.call("GET", "/api/docs/sessions", { token: await t.kit.token({ iss: "https://elsewhere.cloudflareaccess.com" }) });
    same("another team's sign-in", otherTeam.status, 401);
  });

  check("only the allowed account gets in", async () => {
    const t = await setup();
    const other = await t.call("GET", "/api/docs/sessions", { token: await t.kit.token({ email: "someone@example.com" }) });
    same("another account", [other.status, other.body.code], [403, "not_granted"]);
    const caps = await t.call("GET", "/api/docs/sessions", { token: await t.kit.token({ email: ME.toUpperCase() }) });
    same("the allowed account, in capitals", caps.status, 200);
  });

  check("with sign-in not set up, the API stays closed", async () => {
    for (const missing of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ALLOWED_EMAILS"]) {
      const t = await setup({ [missing]: "" });
      const r = await t.call("GET", "/api/docs/sessions");
      same("status without " + missing, [r.status, r.body.code], [503, "not_configured"]);
    }
  });

  check("the sign-in cookie works too, and other sites are turned away", async () => {
    const t = await setup();
    const viaCookie = await t.callRaw("GET", "/api/docs/weights", { cookie: "theme=dark; CF_Authorization=" + t.token });
    same("signed in by cookie", viaCookie.status, 200);
    const cross = await t.callRaw("GET", "/api/docs/weights", { "cf-access-jwt-assertion": t.token, "sec-fetch-site": "cross-site" });
    same("a request from another site", cross.status, 403);
  });

  check("sessions, weigh-ins and the single documents save, list and delete", async () => {
    const t = await setup();
    same("empty at first", (await t.call("GET", "/api/docs/sessions")).body.docs, []);
    same("save a session", (await t.call("PUT", "/api/docs/sessions/s_one", putJSON(sampleSession))).status, 200);
    same("save a weigh-in", (await t.call("PUT", "/api/docs/weights/w_one", putJSON(sampleWeight))).status, 200);
    same("save the lifting doc", (await t.call("PUT", "/api/docs/state/lifting", putJSON(sampleLifting))).status, 200);
    same("the session comes back exactly, nulls and all", (await t.call("GET", "/api/docs/sessions")).body.docs, [{ id: "s_one", data: sampleSession }]);
    same("the lifting doc comes back exactly", (await t.call("GET", "/api/docs/state")).body.docs, [{ id: "lifting", data: sampleLifting }]);
    const changed = Object.assign({}, sampleSession, { feel: 2 });
    await t.call("PUT", "/api/docs/sessions/s_one", putJSON(changed));
    same("a second save replaces the first", (await t.call("GET", "/api/docs/sessions")).body.docs, [{ id: "s_one", data: changed }]);
    same("delete", (await t.call("DELETE", "/api/docs/sessions/s_one")).status, 200);
    same("gone after delete", (await t.call("GET", "/api/docs/sessions")).body.docs, []);
    same("weigh-ins kept apart from sessions", (await t.call("GET", "/api/docs/weights")).body.docs.length, 1);
    same("delete a single document (a swim in progress ends)", (await t.call("DELETE", "/api/docs/state/lifting")).status, 200);
    same("no single documents left", (await t.call("GET", "/api/docs/state")).body.docs, []);
  });

  check("ids from the claude.ai version are kept as they are", async () => {
    const t = await setup();
    const oldId = "dlvq3m0xk2pe7tw9ab4c"; // made up, in the old ids' shape: 20 lowercase letters and digits
    same("save under an old id", (await t.call("PUT", "/api/docs/sessions/" + oldId, putJSON(sampleSession))).status, 200);
    same("listed under the same id", (await t.call("GET", "/api/docs/sessions")).body.docs.map((d) => d.id), [oldId]);
  });

  check("bad saves are refused and change nothing", async () => {
    const t = await setup();
    same("unknown collection", (await t.call("GET", "/api/docs/secrets")).status, 404);
    same("disc golf's collections aren't here", (await t.call("GET", "/api/docs/rounds")).status, 404);
    same("no map images here", (await t.call("POST", "/api/maps", { body: "x" })).status, 404);
    same("bad id", (await t.call("PUT", "/api/docs/sessions/" + encodeURIComponent("../x"), putJSON(sampleSession))).status, 400);
    same("not JSON", (await t.call("PUT", "/api/docs/sessions/s_two", { body: "{oops", headers: { "content-type": "application/json" } })).status, 400);
    same("a list instead of an object", (await t.call("PUT", "/api/docs/sessions/s_two", putJSON([1, 2]))).status, 400);
    const huge = { notes: "x".repeat(t.W.LIMITS.doc) };
    same("too big", (await t.call("PUT", "/api/docs/sessions/s_two", putJSON(huge))).status, 413);
    same("a list can't be replaced whole", (await t.call("PUT", "/api/docs/sessions", putJSON(sampleSession))).status, 405);
    same("nothing was stored", (await t.call("GET", "/api/docs/sessions")).body.docs, []);
  });

  check("an unchanged list costs almost nothing", async () => {
    const t = await setup();
    await t.call("PUT", "/api/docs/sessions/s_one", putJSON(sampleSession));
    const first = await t.call("GET", "/api/docs/sessions");
    const tag = first.res.headers.get("etag");
    truly("the list has an ETag", tag);
    const again = await t.call("GET", "/api/docs/sessions", { headers: { "if-none-match": tag } });
    same("asking again with no change", again.status, 304);
    await t.call("PUT", "/api/docs/weights/w_one", putJSON(sampleWeight));
    same("a weigh-in doesn't change the sessions list", (await t.call("GET", "/api/docs/sessions", { headers: { "if-none-match": tag } })).status, 304);
    await t.call("PUT", "/api/docs/sessions/s_two", putJSON(sampleSession));
    const after = await t.call("GET", "/api/docs/sessions", { headers: { "if-none-match": tag } });
    same("after a save", [after.status, after.body.docs.length], [200, 2]);
    const tag2 = after.res.headers.get("etag");
    await t.call("DELETE", "/api/docs/sessions/s_one");
    same("after a delete", (await t.call("GET", "/api/docs/sessions", { headers: { "if-none-match": tag2 } })).status, 200);
  });

  check("a phone's copy from another database is never taken as current", async () => {
    const one = await setup(), two = await setup(); // e.g. the database recreated from scratch
    await one.call("PUT", "/api/docs/sessions/s_one", putJSON(sampleSession));
    await two.call("PUT", "/api/docs/sessions/s_other", putJSON(sampleSession));
    const tagOne = (await one.call("GET", "/api/docs/sessions")).res.headers.get("etag");
    const fromTwo = await two.call("GET", "/api/docs/sessions", { headers: { "if-none-match": tagOne } });
    same("same version number, different database", [fromTwo.status, fromTwo.body.docs[0].id], [200, "s_other"]);
    const tagAgain = (await one.call("GET", "/api/docs/sessions")).res.headers.get("etag");
    same("a database keeps its own tag between calls", tagAgain, tagOne);
  });

  check("a new Cloudflare signing key is picked up by itself", async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) same("call " + (i + 1), (await t.call("GET", "/api/docs/sessions")).status, 200);
    same("keys fetched once for three calls", t.kit.fetches, 1);
    const fresh = await t.kit.addKey(); // Cloudflare rotates its keys every few weeks
    let later = NOW + 60 * 1000;
    t.deps.now = () => later;
    const rotated = await t.call("GET", "/api/docs/sessions", { token: await t.kit.token({ iat: sec(), exp: sec() + 3600 }, { key: fresh }) });
    same("a token signed with the new key", rotated.status, 200);
    same("keys fetched again once", t.kit.fetches, 2);
    same("the old key still works meanwhile", (await t.call("GET", "/api/docs/sessions")).status, 200);
  });

  check("a failure on the server is reported as one, not as signed out", async () => {
    const t = await setup();
    t.deps.fetch = async () => { throw new TypeError("network down"); };
    const r = await t.call("GET", "/api/docs/sessions");
    same("Cloudflare's keys unreachable", [r.status, r.body.code], [500, "server_error"]);
  });

  window.workerChecks = checks;
})();
