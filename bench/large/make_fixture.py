"""Generate the large benchmark fixture (deterministic). Usage: python3 make_fixture.py <outdir>

A 'warehouse' package with 32 modules (~1,500 lines). Task pieces:
  - inventory every module (search/reading heavy)      -> ideal for Haiku
  - replace a deprecated helper in ~100 call sites     -> mechanical, Sonnet
  - fix a real unit bug in shipping.py                 -> needs judgment
  - write tests + docs
"""
import json, os, random, sys

out = sys.argv[1]
rng = random.Random(42)
pkg = os.path.join(out, "warehouse")
tests = os.path.join(out, "tests")
os.makedirs(pkg, exist_ok=True)
os.makedirs(tests, exist_ok=True)

DOMAINS = ["pallet", "crate", "bin", "shelf", "dock", "route", "carrier", "zone",
           "batch", "lot", "sku", "order", "pick", "pack", "label", "return",
           "invoice", "tariff", "customs", "fuel", "driver", "trailer", "yard", "slot",
           "cycle", "audit", "damage", "claim", "promo", "bundle", "season", "forecast"]

open(os.path.join(pkg, "__init__.py"), "w").write('"""Warehouse toolkit (benchmark fixture)."""\n')
open(os.path.join(pkg, "util.py"), "w").write('''"""Shared helpers."""


def legacy_round(value):
    """DEPRECATED: use round_money(). Kept for backwards compatibility."""
    return round(float(value) + 1e-9, 2)


def round_money(value):
    """Round to 2 decimals (half-up for positive values)."""
    return round(float(value) + 1e-9, 2)


def clamp(value, low, high):
    return max(low, min(high, value))
''')

manifest = {"modules": {}, "legacy_calls": 0, "samples": []}
for i, dom in enumerate(DOMAINS):
    name = f"{dom}_ops"
    n_public = rng.randint(4, 9)
    n_private = rng.randint(0, 3)
    lines = [f'"""Operations for {dom}s."""', "from .util import clamp, legacy_round", "", ""]
    for j in range(n_private):
        lines += [f"def _{dom}_factor_{j}(x):", f"    return x * {1 + (j + 1) / 10:.2f}", "", ""]
    for j in range(n_public):
        a, b = rng.randint(2, 19), rng.randint(1, 9)
        uses_legacy = rng.random() < 0.75
        expr = f"qty * unit * {a}.{b} / 10"
        body = f"legacy_round({expr})" if uses_legacy else f"round({expr}, 2)"
        if uses_legacy:
            manifest["legacy_calls"] += 1
        fn = f"{dom}_cost_{j}"
        lines += [f"def {fn}(qty, unit):",
                  f'    """Cost of {dom} job #{j}."""',
                  f"    qty = clamp(qty, 0, 10_000)",
                  f"    return {body}", "", ""]
        if j == 0:
            q, u = rng.randint(1, 50), rng.randint(1, 30) + 0.25
            raw = min(max(q, 0), 10_000) * u * float(f"{a}.{b}") / 10
            exp = round(float(raw) + 1e-9, 2) if uses_legacy else round(raw, 2)
            manifest["samples"].append([name, fn, q, u, exp])
    manifest["modules"][name] = n_public
    open(os.path.join(pkg, f"{name}.py"), "w").write("\n".join(lines).rstrip() + "\n")

# The real bug: weights are grams, but the heavy branch forgets to convert to kg.
open(os.path.join(pkg, "shipping.py"), "w").write('''"""Shipping cost. Weights are in GRAMS, rates are per KILOGRAM."""
from .util import legacy_round

BASE_FEE = 4.0
LIGHT_RATE_PER_KG = 2.5
HEAVY_RATE_PER_KG = 1.8
HEAVY_THRESHOLD_G = 5_000


def shipping_cost(weight_g, express=False):
    if weight_g <= 0:
        raise ValueError("weight must be positive")
    if weight_g <= HEAVY_THRESHOLD_G:
        cost = BASE_FEE + (weight_g / 1000) * LIGHT_RATE_PER_KG
    else:
        cost = BASE_FEE + weight_g * HEAVY_RATE_PER_KG
    if express:
        cost *= 1.5
    return legacy_round(cost)
''')
manifest["modules"]["shipping"] = 1
manifest["legacy_calls"] += 1

open(os.path.join(tests, "__init__.py"), "w").write("")
open(os.path.join(tests, "test_shipping.py"), "w").write('''import unittest

from warehouse.shipping import shipping_cost


class ShippingTests(unittest.TestCase):
    def test_light(self):
        self.assertEqual(shipping_cost(2000), 9.0)

    def test_heavy(self):
        # 10 kg at 1.8/kg + 4.0 base
        self.assertEqual(shipping_cost(10_000), 22.0)
''')
samples = "\n".join(f"        ({m!r}, {f!r}, {q}, {u}, {e})," for m, f, q, u, e in manifest["samples"])
open(os.path.join(tests, "test_modules.py"), "w").write(f'''import importlib
import unittest

SAMPLES = [
{samples}
]


class ModuleTests(unittest.TestCase):
    def test_samples(self):
        for mod, fn, q, u, exp in SAMPLES:
            f = getattr(importlib.import_module("warehouse." + mod), fn)
            self.assertAlmostEqual(f(q, u), exp, places=2, msg=f"{{mod}}.{{fn}}")
''')
open(os.path.join(out, "README.md"), "w").write("# warehouse\n\nWarehouse cost toolkit. Run tests with `python3 -m unittest`.\n")
json.dump(manifest, open(os.path.join(out, ".bench_manifest.json"), "w"), indent=1)
print(f"{len(manifest['modules'])} modules, {manifest['legacy_calls']} legacy_round calls")
