You are working in a Python repo: package `warehouse/` (about 33 modules), tests in `tests/`. Do all of the following:

1. Create `AUDIT.md` with a Markdown table that has one row per module in `warehouse/` (excluding `__init__.py` and `util.py`): columns `module` (file name without `.py`) and `public_functions` (number of top-level functions whose name does not start with `_`). Sort rows by module name.
2. `legacy_round` in `warehouse/util.py` is deprecated. Replace every call to `legacy_round(...)` across the package with `round_money(...)` (same behaviour) and fix the imports. Keep `legacy_round` defined in `util.py`, but nothing else may use it.
3. `python3 -m unittest` has a failing test in `tests/test_shipping.py`. Find the root cause and fix it in the source. Do not change that test.
4. Add `tests/test_util.py` with unit tests for `round_money` and `clamp`.
5. Add a "Modules" section to `README.md` that lists the modules grouped into a few sensible categories (e.g. storage, transport, finance, operations), one line each.

Run `python3 -m unittest` at the end and make sure all tests pass. Finish with a short summary.
