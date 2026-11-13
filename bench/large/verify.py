"""Hidden checks for the large task. Usage: python3 verify.py <workdir>"""
import glob, json, os, re, subprocess, sys

work = os.path.abspath(sys.argv[1])
man = json.load(open(os.path.join(work, ".bench_manifest.json")))
res = {}

r = subprocess.run([sys.executable, "-m", "unittest"], cwd=work, capture_output=True, text=True)
res["tests_pass"] = r.returncode == 0

# 1. audit table exact
try:
    txt = open(os.path.join(work, "AUDIT.md")).read()
    found = {}
    for m, n in re.findall(r"^\|\s*`?([a-z_]+)`?\s*\|\s*(\d+)\s*\|", txt, re.M):
        found[m] = int(n)
    res["audit_ok"] = found == man["modules"]
    res["audit_wrong"] = sorted(k for k in set(found) | set(man["modules"]) if found.get(k) != man["modules"].get(k))[:10]
except FileNotFoundError:
    res["audit_ok"] = False

# 2. no legacy_round usage outside its definition
left = 0
for f in glob.glob(os.path.join(work, "warehouse", "*.py")):
    src = open(f).read()
    if f.endswith("util.py"):
        src = src.replace("def legacy_round(", "")
    left += len(re.findall(r"legacy_round\b", src))
res["legacy_removed"] = left == 0 and "def legacy_round(" in open(os.path.join(work, "warehouse", "util.py")).read()

# 3. shipping fixed (hidden extra case too)
sys.path.insert(0, work)
try:
    from warehouse.shipping import shipping_cost
    res["shipping_ok"] = shipping_cost(10_000) == 22.0 and shipping_cost(20_000, express=True) == 60.0 and shipping_cost(2000) == 9.0
except Exception:
    res["shipping_ok"] = False

# 4/5. tests + readme
res["util_tests"] = os.path.exists(os.path.join(work, "tests", "test_util.py"))
readme = open(os.path.join(work, "README.md")).read()
res["readme"] = "## Modules" in readme or "## modules" in readme.lower()
print(json.dumps(res))
