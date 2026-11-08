"""Total each swim template's yardage (min and max) and check it equals the template's 'yards' label."""
import json
import sys


def rng(v):
    return (v[0], v[1]) if isinstance(v, list) else (v, v)


def item_total(it):
    rmin, rmax = rng(it["reps"])
    if "ramp" in it:
        rmin = min(rmin, rng(it["ramp"]["reps"])[0])
    if "parts" in it.get("pattern", {}):
        parts = sum(p["dist"] for p in it["pattern"]["parts"])
        assert parts == it["dist"], f"parts {parts} != dist {it['dist']}"
    dmin, dmax = rng(it["dist"])
    return rmin * dmin, rmax * dmax


def tpl_total(t):
    lo = hi = 0
    for b in t["blocks"]:
        bmin, bmax = rng(b.get("rounds", 1))
        lo += bmin * sum(item_total(i)[0] for i in b["items"])
        hi += bmax * sum(item_total(i)[1] for i in b["items"])
    return lo, hi


data = json.load(open(sys.argv[1], encoding="utf-8"))
bad = 0
for t in data["templates"]:
    lo, hi = tpl_total(t)
    y0, y1 = t["yards"]
    p0, p1 = t["planSaid"]
    ok = (lo, hi) == (y0, y1)
    bad += not ok
    print(f"{t['phase']:<10} {t['name']:<14} sets {lo:>5,}-{hi:<5,} label {y0:,}-{y1:<6,} "
          f"(plan said {p0:,}-{p1:,})  {'ok' if ok else 'MISMATCH'}")
sys.exit(1 if bad else 0)
