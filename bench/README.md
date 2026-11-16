# Measuring tokenwise

The benchmark in this directory is a starting point for comparing **the same task** in Claude Code with and without the tokenwise skill. It is not a general performance guarantee, and it does not measure Studio or other providers.

## Method

`run.sh` creates a fresh fixture for each run, alternates baseline and tokenwise order, invokes the selected Claude model, and runs the fixture's checks. `summarize.py` reports mean API-equivalent cost, token counts for reported model families, time and checks passed. The script sums input, output, cache-read and cache-creation tokens; these categories can have different prices. Counts and costs depend on what the CLI reports, and any external workers not represented in its `modelUsage` may be missing. Subscription usage or invoices are not the same as API-equivalent cost.

Run only if you understand the effects: **the benchmark consumes Claude usage and temporarily moves your installed tokenwise skill and agent files out of `CLAUDE_HOME` during baseline runs.** Do not run it concurrently with another Claude session or another benchmark using the same configuration. Review `run.sh` first and use an isolated configuration where possible. Results and CLI output are saved locally under `bench/results/`, which is gitignored; inspect and remove sensitive content before sharing.

```sh
# From the repository root; runs per condition, model, suite (small or large)
./bench/run.sh 3 sonnet large
```

Compare completed runs and their checks, not just prices. Keep the fixture, model version, environment, run count, token categories and baseline with any published result. Small samples have high variance; results for one fixture cannot predict another task. A cheaper model may lower cost without lowering total tokens. Routing overhead can make either metric worse.

## Evidence and limitations

Earlier local experiments are not included as raw results in this repository. We have not yet published a complete, reproducible dataset for the reported ~61% and up-to-73% figures, so those figures should not be treated as verified general token reductions. We intend to publish the baseline, per-run token totals and cost, checks, model versions, and automatic-effort configuration together before promoting a numerical claim.
