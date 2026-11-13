"""Summarize a bench/results/<stamp> folder into a Markdown table."""
import glob, json, os, sys
from collections import defaultdict

d = sys.argv[1]


def family(model_id: str) -> str:
    m = model_id.lower()
    for f in ("opus", "sonnet", "haiku", "fable"):
        if f in m:
            return f
    return m


rows = defaultdict(list)
for f in sorted(glob.glob(os.path.join(d, "*-[0-9]*.json"))):
    name = os.path.basename(f)
    if name.endswith(".verify.json"):
        continue
    cond, idx = name[:-5].rsplit("-", 1)
    try:
        data = json.load(open(f))
    except Exception:
        continue
    usage = defaultdict(lambda: {"tokens": 0, "cost": 0.0})
    for mid, u in (data.get("modelUsage") or {}).items():
        fam = family(mid)
        usage[fam]["tokens"] += sum(u.get(k, 0) or 0 for k in
                                    ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"))
        usage[fam]["cost"] += u.get("costUSD", 0) or 0
    vf = os.path.join(d, f"{cond}-{idx}.verify.json")
    verify = json.load(open(vf)) if os.path.exists(vf) else {}
    secs = open(os.path.join(d, f"{cond}-{idx}.secs")).read().strip() if os.path.exists(os.path.join(d, f"{cond}-{idx}.secs")) else "?"
    rows[cond].append({"usage": usage, "cost": data.get("total_cost_usd", 0) or 0,
                       "turns": data.get("num_turns"), "secs": secs, "verify": verify})


def avg(xs):
    return sum(xs) / len(xs) if xs else 0


print("| condition | runs | total cost (API-equiv. $) | Opus cost | Opus tokens | Sonnet tokens | Haiku tokens | time (s) | checks passed |")
print("|---|---|---|---|---|---|---|---|---|")
summary = {}
for cond in ("baseline", "tokenwise"):
    rs = rows.get(cond, [])
    if not rs:
        continue
    tot = avg([r["cost"] for r in rs])
    oc = avg([r["usage"]["opus"]["cost"] for r in rs])
    ot = avg([r["usage"]["opus"]["tokens"] for r in rs])
    st = avg([r["usage"]["sonnet"]["tokens"] for r in rs])
    ht = avg([r["usage"]["haiku"]["tokens"] for r in rs])
    secs = avg([float(r["secs"]) for r in rs if r["secs"] != "?"])
    checks = [sum(1 for v in r["verify"].values() if v is True) for r in rs]
    nchecks = max((sum(1 for v in r["verify"].values() if isinstance(v, bool)) for r in rs), default=0)
    summary[cond] = (tot, oc)
    print(f"| {cond} | {len(rs)} | {tot:.2f} | {oc:.2f} | {ot:,.0f} | {st:,.0f} | {ht:,.0f} | {secs:.0f} | {avg(checks):.1f}/{nchecks} |")

if "baseline" in summary and "tokenwise" in summary and summary["baseline"][0] > 0:
    b, t = summary["baseline"], summary["tokenwise"]
    print()
    print(f"**Total cost change:** {100 * (t[0] - b[0]) / b[0]:+.0f}%  ")
    if b[1] > 0:
        print(f"**Opus cost change:** {100 * (t[1] - b[1]) / b[1]:+.0f}%")
