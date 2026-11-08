/* Swim logic tests for the fitness tracker. Loaded only by tools/dev_server.py, which also sets
   window.__DL_TEST__ so the app exposes its pure swim functions on window.__DL.
   Run from the browser console:  await runSwimTests()
   Resolves { passed, failed, failures } and prints a table. The published artifact never loads this. */
window.runSwimTests = async function runSwimTests() {
  "use strict";
  const D = window.__DL;
  if (!D) throw new Error("window.__DL is missing: open the page through tools/dev_server.py");
  const rows = [];
  let passed = 0, failed = 0;
  const same = (a, b) => D.stableStr(a) === D.stableStr(b);
  function check(name, got, want) {
    const ok = same(got, want);
    if (ok) passed++; else failed++;
    rows.push(ok ? { ok, name } : { ok, name, got: D.stableStr(got), want: D.stableStr(want) });
  }
  const isNaNv = (v) => typeof v === "number" && Number.isNaN(v);

  // ---- 1. the five plan templates: embedded copy = JSON, and the sets add up to the labels ----
  const json = await (await fetch("/docs/swim-plan-templates.json", { cache: "no-store" })).json();
  check("five plan templates embedded", D.PLAN_SWIM.map((p) => p.id), json.templates.map((t) => t.id));
  for (const t of json.templates) {
    const emb = D.PLAN_SWIM.find((p) => p.id === t.id) || {};
    check(t.name + ": embedded copy matches the JSON", { id: emb.id, name: emb.name, stage: emb.stage, blocks: emb.blocks },
      { id: t.id, name: t.name, stage: t.stage, blocks: t.blocks });
    check(t.name + ": normalizing keeps every field", D.normTpl(emb).blocks, t.blocks);
    check(t.name + ": total = label " + t.yards.join("–"), D.tplRange(D.normTpl(emb)), t.yards);
    check(t.name + ": one main set", t.blocks.filter((b) => b.main).length, 1);
  }
  const plan = D.mergeSwimDoc(null, D.PLAN_SWIM).templates;
  const [reac, build, thr, speed, im] = plan;
  check("stages 1, 2, 3, 3, 3", plan.map((t) => t.stage), [1, 2, 3, 3, 3]);

  // ---- 2. the ramp ----
  const mainItem = reac.blocks[2].items[0];
  check("Reacclimation today, ramp on", D.tplRange(reac, true), [1300, 1500]);
  check("Reacclimation after the ramp", D.tplRange(reac, false), [1500, 1700]);
  check("ramp on for swims 1–4", [0, 1, 2, 3].map((n) => D.rampOn(mainItem, n)), [true, true, true, true]);
  check("ramp off from swim 5", D.rampOn(mainItem, 4), false);
  const ctx = (n, pool) => ({ now: 0, pool: pool || "25yd", swimsSoFar: n, uid: "t", stage: 1 });
  check("runner: ramp main set starts at 6 (range low end)", D.newLive(reac, ctx(0)).blocks[2].rounds[0].items[0].reps, 6);
  check("runner: ramp target kept", D.newLive(reac, ctx(0)).blocks[2].defs[0].target, [6, 8]);
  check("runner: after the ramp it starts at 8", D.newLive(reac, ctx(4)).blocks[2].rounds[0].items[0].reps, 8);
  check("Speed main set starts at 12", D.newLive(speed, ctx(9)).blocks[2].rounds[0].items[0].reps, 12);

  // ---- 3. pattern labels, rep by rep ----
  const labels = (it, reps) => Array.from({ length: reps }, (_, k) => D.repSpec(it, k, reps).label);
  check("odds/evens, 6×50", labels(build.blocks[1].items[0], 6),
    ["drill", "build · free", "drill", "build · free", "drill", "build · free"]);
  check("odds/evens, 8×25", labels(thr.blocks[1].items[0], 8).filter((x, k) => k % 2), Array(4).fill("fast · free"));
  check("even rep detail", D.repSpec(build.blocks[1].items[0], 1, 6).detail, "even rep · build to fast");
  const g = (n) => labels(speed.blocks[2].items[0], n).map((x) => x.split(" ")[0]);
  const runOf = (w, n) => Array(n).fill(w);
  check("groups, 12 reps go 3/3/3/3", g(12), [...runOf("easy", 3), ...runOf("build", 3), ...runOf("fast", 3), ...runOf("easy", 3)]);
  check("groups, 16 reps go 4/4/4/4", g(16), [...runOf("easy", 4), ...runOf("build", 4), ...runOf("fast", 4), ...runOf("easy", 4)]);
  check("groups, 14 reps split as evenly as they can", Array.from({ length: 14 }, (_, k) => D.groupIndex(k, 14, 4)),
    [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
  check("group detail", D.repSpec(speed.blocks[2].items[0], 4, 12).detail, "group 2 of 4 · reps 4–6");
  check("descend 1–3, 4–6", labels(im.blocks[2].items[1], 6).map((x) => x.split(" ")[1]), ["1", "2", "3", "1", "2", "3"]);
  check("parts: drill/swim by 25", D.repSpec(reac.blocks[1].items[0], 0, 4).label, "25 drill, then 25 free");
  check("parts detail names the drills", D.repSpec(reac.blocks[1].items[0], 0, 4).detail, "pick two: catch-up, fingertip drag, 6-kick switch");
  check("plain item", D.repSpec(mainItem, 2, 6).label, "moderate · free");
  check("rep label", D.repLabel(build.blocks[1].items[0], 2, 6), "Rep 3 of 6: drill");
  check("item text: odds/evens", D.itemText(build.blocks[1].items[0]), "6×50 odds drill, evens build @ :15");
  check("item text: ramp", D.itemText(mainItem, { ramp: true }), "6–8×100 free moderate @ :20–:30");
  check("item text: descend", D.itemText(im.blocks[2].items[1]), "6×100 free descend 1–3, 4–6");
  check("item text: groups", D.itemText(speed.blocks[2].items[0]), "12–16×50 free easy/build/fast/easy @ :20");
  check("block text: rounds", D.blockText(build.blocks[2]), "3 × [200 free steady + 2×50 free strong] @ :20–:30");
  check("send-off text", D.intervalText({ sendoff: 100 }), "on 1:40");

  // ---- 4. phase from the comeback start date ----
  const st = "2026-11-01";
  const ph = (d) => { const p = D.phaseOf(st, D.dateAdd(st, d)); return [p.started, p.day, p.stage]; };
  check("day 0 is weeks 1–2", ph(0), [true, 0, 1]);
  check("day 13 is weeks 1–2", ph(13), [true, 13, 1]);
  check("day 14 is weeks 3–4", ph(14), [true, 14, 2]);
  check("day 27 is weeks 3–4", ph(27), [true, 27, 2]);
  check("day 28 is weeks 5+", ph(28), [true, 28, 3]);
  check("day 200 is weeks 5+", ph(200), [true, 200, 3]);
  check("blank start: not started, weeks 1–2", [D.phaseOf("", st).started, D.phaseOf("", st).stage], [false, 1]);
  check("start in the future: not started", D.phaseOf("2026-12-01", st).started, false);
  check("day count across the DST change", D.daysBetween("2026-10-31", "2026-11-02"), 2);
  check("swims since the start", D.swimsSince([{ type: "swim", date: "2026-10-30" }, { type: "swim", date: st },
    { type: "lift", date: "2026-11-02" }, { type: "swim", date: "2026-11-03" }], st), 2);
  check("no start date: no swims counted", D.swimsSince([{ type: "swim", date: st }], ""), 0);
  const paddleT = D.normTpl({ id: "x", blocks: [{ items: [{ reps: 4, dist: 100, what: "pull", gear: ["buoy", "paddles"] }] }] });
  check("paddles flagged on day 29", D.paddlesWarn(paddleT, st, D.dateAdd(st, 29)), true);
  check("paddles fine from day 30", D.paddlesWarn(paddleT, st, D.dateAdd(st, 30)), false);
  check("paddles flagged before the comeback starts", D.paddlesWarn(paddleT, "", st), true);
  check("no paddles, no flag", D.paddlesWarn(reac, "", st), false);

  // ---- 5. rep-time parsing ----
  const p = D.parseRepTime;
  check("1:38", p("1:38"), 98);
  check("0:42.5", p("0:42.5"), 42.5);
  check("138 reads as 1:38", p("138"), 98);
  check("42 reads as seconds", p("42"), 42);
  check(" 1:05 with spaces", p(" 1:05 "), 65);
  check("blank is no time", p(""), null);
  check("1:75 is invalid", isNaNv(p("1:75")), true);
  check("175 is invalid", isNaNv(p("175")), true);
  check("abc is invalid", isNaNv(p("abc")), true);
  check("0 is invalid", isNaNv(p("0")), true);
  check("format rounds to the second", [D.fmtRepTime(98.4), D.fmtRepTime(59.6), D.fmtRepTime(null)], ["1:38", "1:00", ""]);

  // ---- 6. main-set pace ----
  check("main pace skips untimed reps and other blocks", D.mainPaceOf([
    { main: true, rounds: [{ items: [{ dist: 100, times: [98, 100, null, 102] }] }] },
    { main: false, rounds: [{ items: [{ dist: 300, times: [300] }] }] }]), 100);
  check("main pace over mixed distances", D.mainPaceOf([{ main: true, rounds: [
    { items: [{ dist: 200, times: [200] }, { dist: 50, times: [40, 40] }] }] }]), 93.3);
  check("no times, no main pace", D.mainPaceOf([{ main: true, rounds: [{ items: [{ dist: 100, times: [null] }] }] }]), null);

  // ---- 7. old (v3) templates and sessions ----
  const base = { id: "base", name: "Base 1,700", sets: [
    { n: "Warm-up", d: "300 easy — 100 swim / 100 kick / 100 swim", y: 300 },
    { n: "Drills", d: "4×50 drill/swim by 25 @ :20", y: 200 },
    { n: "Main set", d: "100s free @ :20–:30 rest", reps: 10, each: 100 },
    { n: "Cool-down", d: "200 easy, mixed strokes", y: 200 }] };
  const nb = D.normTpl(base);
  check("old template: one block per set", nb.blocks.map((b) => b.name), ["Warm-up", "Drills", "Main set", "Cool-down"]);
  check("old template: the repeat set is the main set", nb.blocks.map((b) => !!b.main), [false, false, true, false]);
  check("old template: 10×100 kept", [nb.blocks[2].items[0].reps, nb.blocks[2].items[0].dist], [10, 100]);
  check("old template: detail kept as a note", nb.blocks[0].items[0].note, "300 easy — 100 swim / 100 kick / 100 swim");
  check("old template: total 1,700", D.tplRange(nb), [1700, 1700]);
  check("old template: input left alone", [Object.keys(base).sort(), base.sets.length], [["id", "name", "sets"], 4]);
  const old = { type: "swim", minutes: 40, yards: 1700, tpl: "Base 1,700",
    swimSets: [{ n: "Main set", y: 1000, reps: 10, each: 100 }, { n: "Cool-down", y: 200, reps: 0, each: 0 }] };
  const ov = D.swimOf(old);
  check("old session: distance and unit", [ov.dist, ov.unit], [1700, "yd"]);
  check("old session: session pace only", [ov.sessionPace, ov.mainPace], [141.2, null]);
  check("old session: sets read as blocks", ov.blocks.map((b) => [b.name, b.main, b.rounds[0].items[0].done, b.rounds[0].items[0].dist]),
    [["Main set", true, 10, 100], ["Cool-down", false, 1, 200]]);
  check("quick-logged swim without sets", D.swimOf({ type: "swim", minutes: 30, yards: 1500 }).blocks, null);

  // ---- 8. merging the plan into the stored doc ----
  check("empty doc gets the five", D.mergeSwimDoc(null, D.PLAN_SWIM).templates.map((t) => t.id), D.PLAN_SWIM.map((x) => x.id));
  check("stored templates stay first", D.mergeSwimDoc({ templates: [base] }, D.PLAN_SWIM).templates.map((t) => t.id),
    ["base", ...D.PLAN_SWIM.map((x) => x.id)]);
  const m0 = D.mergeSwimDoc(null, D.PLAN_SWIM);
  const afterDelete = JSON.parse(JSON.stringify(Object.assign({}, m0, { templates: m0.templates.filter((t) => t.id !== "p3-speed") })));
  check("a deleted plan template stays deleted", D.mergeSwimDoc(afterDelete, D.PLAN_SWIM).templates.some((t) => t.id === "p3-speed"), false);
  check("seeded lists the plan ids", m0.seeded, D.PLAN_SWIM.map((x) => x.id));
  check("defaults: 25 yd pool, no start date", [m0.pool, m0.startDate], ["25yd", ""]);
  const edited = JSON.parse(JSON.stringify(m0)); edited.templates[0].name = "Reacc (mine)";
  check("an edited plan template keeps the edit", D.mergeSwimDoc(edited, D.PLAN_SWIM).templates[0].name, "Reacc (mine)");

  // ---- 9. the next swim ----
  check("stage 1 → Reacclimation", D.nextSwim(plan, 1, []).t.id, "p1-reacclimation");
  check("stage 2 → Build", D.nextSwim(plan, 2, []).t.id, "p2-build");
  check("stage 3, none swum → Threshold", D.nextSwim(plan, 3, []).t.id, "p3-threshold");
  check("stage 3 rotates to the one not swum", D.nextSwim(plan, 3,
    [{ type: "swim", tplId: "p3-threshold", ts: 2 }, { type: "swim", tplId: "p3-speed", ts: 3 }]).t.id, "p3-im");
  check("stage 3 rotates by least recent", D.nextSwim(plan, 3, [{ type: "swim", tplId: "p3-threshold", ts: 5 },
    { type: "swim", tplId: "p3-speed", ts: 3 }, { type: "swim", tplId: "p3-im", ts: 4 }]).t.id, "p3-speed");

  // ---- 10. the runner, step by step ----
  let L = D.newLive(reac, ctx(0)), now = 0, res;
  const step = (type, extra, at) => { now = at; res = D.runStep(L, Object.assign({ type }, extra || {}), now); L = res.L; return res; };
  check("opens ready on the warm-up", [L.phase, L.b, L.startedAt], ["ready", 0, null]);
  step("rep", null, 1000); check("Rep done does nothing before Start", res.changed || false, false);
  step("start", null, 10000); check("Start → swim", [L.phase, L.startedAt, L.repStart], ["swim", 10000, 10000]);
  step("rep", null, 100000);
  check("no interval: next item starts at the tap", [L.phase, L.i, L.repStart], ["swim", 1, 100000]);
  step("rep", null, 220000); step("rep", null, 315000);
  check("warm-up times", L.blocks[0].rounds[0].items.map((q) => q.times), [[90], [120], [95]]);
  check("no rest between blocks: ready for Drills", [L.phase, L.b, L.blocks[0].status], ["ready", 1, "done"]);
  step("start", null, 345000);
  step("rep", null, 395000);
  check("drill rep → :20 rest", [L.phase, L.restEnd - now, L.blocks[1].rounds[0].items[0].times], ["rest", 20000, [50]]);
  step("tick", null, 414000); check("rest still counting", L.phase, "rest");
  step("plus10", null, 414500); check("+10 s", L.restEnd, 425000);
  step("tick", null, 425200);
  check("rest ends on its own, with a beep", [L.phase, !!res.beep], ["swim", true]);
  check("next rep starts at the rest's end", L.repStart, 425000);
  step("rep", null, 477000); step("go", null, 480000);
  check("Go now cuts the rest", [L.phase, L.repStart], ["swim", 480000]);
  step("undo", null, 481000);
  check("Undo puts the rest back", [L.phase, L.restEnd], ["rest", 497000]);
  step("go", null, 482000);
  step("finishBlock", null, 500000);
  check("Finish block: remaining reps done, no times", L.blocks[1].rounds[0].items[0].times, [50, 52, null, null]);
  check("…and on to the main set, ready", [L.phase, L.b], ["ready", 2]);
  const mainP = () => L.blocks[2].rounds[0].items[0];
  step("reps", { d: -10 }, 501000); check("reps can't go below 1", mainP().reps, 1);
  step("reps", { d: 40 }, 502000); check("reps can't go above 30", mainP().reps, 30);
  step("reps", { d: -24 }, 503000); check("back to 6", mainP().reps, 6);
  step("start", null, 510000);
  step("rep", null, 610000);
  check("range rest counts its long end (:30)", L.restEnd - now, 30000);
  step("tick", null, 640000); step("rep", null, 742000);
  step("tick", null, 772000);
  check("reps can't drop below the rep under way", (step("reps", { d: -5 }, 773000), mainP().reps), 3);
  const before = JSON.stringify(L.blocks[2]);
  step("skipBlock", null, 774000);
  check("Skip block keeps what was done, marks it cut", [L.blocks[2].status, mainP().done, L.b, L.phase], ["cut", 2, 3, "ready"]);
  step("undo", null, 775000);
  check("Undo brings the block back", JSON.stringify(L.blocks[2]), before);
  step("end", null, 776000);
  check("End swim now: current block cut, the rest skipped", [L.phase, L.blocks[2].status, L.blocks[3].status, L.endedAt],
    ["end", "cut", "skipped", 776000]);
  // in a rest, cutting the item to the reps already done ends it
  let L2 = D.runStep(D.runStep(D.newLive(reac, ctx(0)), { type: "finishBlock" }, 1).L, { type: "finishBlock" }, 2).L;
  L2 = D.runStep(L2, { type: "start" }, 10).L; L2 = D.runStep(L2, { type: "rep" }, 100010).L;
  L2 = D.runStep(L2, { type: "reps", d: -9 }, 100020).L;
  check("cutting reps in a rest ends the block", [L2.b, L2.phase, L2.blocks[2].rounds[0].items[0].reps], [3, "ready", 1]);
  const log = D.swimLog(L);
  check("log: target, done and times per item", log[2].rounds[0].items[0].target, [6, 8]);
  check("log: statuses", log.map((b) => b.status), ["done", "done", "cut", "skipped"]);
  check("log: distance done", D.logDist(log), 300 + 200 + 200);
  const body = D.swimSessionBody(L, { date: "2026-11-07", minutes: 12.5, effort: 5, feel: 3, notes: "", sore: {}, times: {} });
  check("saved: yards and swimDist in a yard pool", [body.type, body.swimDist, body.swimUnit, body.yards], ["swim", 700, "yd", 700]);
  check("saved: main pace from main-set rep times", body.mainPace, 101);
  check("saved: session pace", body.sessionPace, 107.1);
  check("saved: template, stage and pool", [body.tpl, body.tplId, body.stage, body.pool], ["Reacclimation", "p1-reacclimation", 1, "25yd"]);
  const fixed = D.swimSessionBody(L, { date: "2026-11-07", minutes: 12.5, effort: 6, feel: 4, times: { "2.0.0.1": 98 } });
  check("edited rep time used for main pace", [fixed.swim.blocks[2].rounds[0].items[0].times, fixed.mainPace], [[100, 98], 99]);
  const metric = D.swimSessionBody(D.newLive(reac, ctx(0, "50m")), { date: "2026-11-07", minutes: 1, effort: 5, feel: 3 });
  check("metric pool: no yards field", [metric.swimUnit, "yards" in metric], ["m", false]);

  // send-offs and rounds
  const so = D.normTpl({ id: "so", name: "Send-offs", blocks: [{ name: "Main set", main: true, rounds: 2,
    items: [{ reps: 2, dist: 100, interval: { sendoff: 100 } }, { reps: 1, dist: 50, interval: { rest: 15 } }] }] });
  L = D.newLive(so, ctx(9));
  step("start", null, 0); step("rep", null, 85000);
  check("send-off: next start = rep start + 1:40", [L.phase, L.restEnd], ["rest", 100000]);
  step("tick", null, 100100); step("rep", null, 205000);
  check("missed send-off: next rep starts at the tap", [L.phase, L.repStart, L.i], ["swim", 205000, 1]);
  step("rep", null, 245000);
  check("rest between rounds inside a block", [L.phase, L.r, L.i, L.restEnd], ["rest", 1, 0, 260000]);
  check("send-off and rest labels", [D.itemText(so.blocks[0].items[0]), D.blockText(so.blocks[0])],
    ["2×100 swim on 1:40", "2 × [2×100 swim on 1:40 + 50 swim @ :15]"]);

  const failures = rows.filter((r) => !r.ok);
  console.table(rows);
  if (failures.length) console.warn("swim tests: " + failures.length + " failed", failures);
  else console.log("swim tests: all " + passed + " passed");
  return { passed, failed, failures };
};
