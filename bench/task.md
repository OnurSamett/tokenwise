You are working in a small Python repo (package `shop/`, tests in `tests/`). Do all of the following:

1. List every function in the repo that computes or changes a money amount, as `file:function` lines.
2. `python3 -m unittest` has a failing test in `tests/test_checkout.py`. Find the root cause and fix it in the source code. Do not change that test.
3. Add `export_orders_csv(orders, path)` to `shop/reports.py`. It writes a CSV with header `id,customer,items,total` (items = total quantity of all line items, total = the order's total from `shop.pricing.total`, computed without changing the order). Add unit tests for it in `tests/test_reports.py`.
4. Add a short "Reports" section to `README.md` describing `daily_summary` and `export_orders_csv`.

Run `python3 -m unittest` at the end and make sure all tests pass. Finish with a short summary of what you changed.
