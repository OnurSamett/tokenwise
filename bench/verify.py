"""Hidden checks for a finished benchmark run. Usage: python3 verify.py <workdir>
Prints JSON: {"tests_pass": bool, "discount_once": bool, "csv_ok": bool, "readme": bool}"""
import csv, json, os, subprocess, sys, tempfile
from decimal import Decimal

work = os.path.abspath(sys.argv[1])
sys.path.insert(0, work)
res = {}

r = subprocess.run([sys.executable, "-m", "unittest"], cwd=work, capture_output=True, text=True)
res["tests_pass"] = r.returncode == 0

from shop.models import Order, Product

def order(code, oid="o1"):
    o = Order(id=oid, customer="ada", discount_code=code)
    o.add(Product("B1", "Novel", Decimal("20.00"), "books"), 2)
    o.add(Product("M1", "Mug", Decimal("10.00"), "kitchen"), 1)
    return o

try:
    from shop.checkout import checkout
    from shop.reports import daily_summary
    o = order("WELCOME10")
    charged = checkout(o, {"B1": 5, "M1": 5})
    res["discount_once"] = (charged == Decimal("54.00") and o.discount_applied == Decimal("5.00")
                            and daily_summary([o])["discounts"] == Decimal("5.00"))
except Exception as e:  # noqa
    res["discount_once"] = False
    res["error_discount"] = repr(e)

try:
    from shop.reports import export_orders_csv

    o2 = order("FLAT5", "o2")
    before = o2.discount_applied
    path = os.path.join(tempfile.mkdtemp(), "out.csv")
    export_orders_csv([o2], path)
    rows = list(csv.reader(open(path)))
    res["csv_ok"] = (rows[0] == ["id", "customer", "items", "total"] and rows[1][0] == "o2"
                     and rows[1][2] == "3" and Decimal(rows[1][3]) == Decimal("54.00")
                     and o2.discount_applied == before)
except Exception as e:  # noqa
    res["csv_ok"] = False
    res["error_csv"] = repr(e)

readme = open(os.path.join(work, "README.md")).read().lower()
res["readme"] = "report" in readme and "export_orders_csv" in readme
print(json.dumps(res))
