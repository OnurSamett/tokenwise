# Effort guide: task → model / effort

Defaults to start from. Adjust with the four signals (steps, ambiguity, prior failure, cost of a mistake): each extra signal present → one step up; none of them → stay or go one step down.

Format: `model/effort` — **inline** means "don't open a subagent, do it in the main session".

## Search & understanding

| Task | Pick |
|------|------|
| Find where a function/class is defined | inline, or `haiku/low` if the repo is large |
| List every usage of a symbol across the repo | `haiku/low` |
| "How does feature X work?" — trace the flow across files | `haiku/medium` → `sonnet/medium` if logic is subtle |
| Summarize a big unfamiliar codebase/module | `sonnet/medium` |
| Read a 5,000-line log and find the first error | `haiku/medium` |
| Compare two config files / two API versions | `haiku/low` |
| Explain a tricky algorithm or concurrency code | `opus/medium` |

## Writing code

| Task | Pick |
|------|------|
| Rename a variable/file, fix a typo, format | inline |
| Small single-file change with a clear spec | `sonnet/low` |
| Generate boilerplate (CRUD, DTOs, config) | `haiku/medium` or `sonnet/low` |
| Implement a feature from a written plan | `sonnet/medium` |
| Implement a feature with no plan, unclear requirements | `opus/medium` to plan → `sonnet/medium` to build |
| Refactor touching 5+ files | `sonnet/high` |
| Migrate an API / library version across the codebase | `sonnet/high`, plan with `opus/medium` first if breaking changes are unclear |
| Performance optimization of a hot path | `opus/high` |
| Concurrency, caching, transactions, money/data integrity | `opus/high` |
| UI component from a clear design | `sonnet/medium` |

## Tests

| Task | Pick |
|------|------|
| Run the tests and report failures | `haiku/low` |
| Write unit tests for an existing simple function | `sonnet/low` |
| Write tests for a module with edge cases | `sonnet/medium` |
| Design a test strategy for a system | `opus/medium` |
| Fix a flaky test | `sonnet/high` → `opus/high` if the cause is timing/concurrency |

## Debugging

| Task | Pick |
|------|------|
| Error message points straight at the bug | inline or `sonnet/low` |
| Known cause, needs a fix across a few files | `sonnet/medium` |
| Bug with unknown cause, reproducible | `opus/high` |
| Bug with unknown cause, NOT reproducible / intermittent | `opus/high` → `opus/xhigh` if `high` fails |
| Production incident, data at risk | `opus/xhigh` |
| Build/compile errors after a dependency bump | `sonnet/medium` |

## Review

| Task | Pick |
|------|------|
| Review a tiny diff (< 50 lines) | `opus/low` |
| Normal PR review | `opus/medium` |
| Large or risky PR (auth, payments, migrations) | `opus/high` |
| Security review | `opus/high` |
| Lint/style-only pass | `haiku/low` |

## Design & planning

| Task | Pick |
|------|------|
| Quick "A or B?" with an obvious answer | `opus/low` |
| Choose between 2–3 architecture options | `opus/medium` |
| Design a new system / database schema | `opus/high` |
| Break a big feature into a task plan | `opus/medium` |
| Estimate effort / list risks | `sonnet/medium` |

## Docs & writing

| Task | Pick |
|------|------|
| Fix wording, translate a README | `haiku/low` |
| Write docstrings/comments for existing code | `haiku/medium` |
| Write a README or user guide | `sonnet/medium` |
| Write an architecture doc / ADR | `opus/medium` |
| Changelog from git log | `haiku/low` |

## Data & SQL

| Task | Pick |
|------|------|
| Simple SELECT / filter | `haiku/low` |
| Multi-join query with window functions | `sonnet/medium` |
| Optimize a slow query | `opus/medium` |
| Data migration on production data | `opus/high` |
| Clean/reshape a CSV | `haiku/medium` |

## DevOps & tooling

| Task | Pick |
|------|------|
| Check CI status / read CI logs | `haiku/low` |
| Write a Dockerfile / CI config from a known pattern | `sonnet/low` |
| Fix a failing CI pipeline (unknown cause) | `sonnet/high` |
| Infrastructure changes with downtime risk | `opus/high` |
| Shell one-liners, scripts | inline or `haiku/low` |

## Escalation ladder

When a piece fails, climb one rung at a time and say so in the routing line:

```
haiku/low → haiku/medium → sonnet/medium → sonnet/high → opus/high → opus/xhigh
```

Skip rungs only when the failure clearly shows missing *judgment* (design, ambiguous requirements) rather than missing *effort* — then jump to Opus. `max` is never on the ladder; use it only when the user asks.
