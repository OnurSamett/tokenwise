---
name: tokenwise
description: Use at the start of any multi-step task (coding, debugging, research, refactoring, reviews) to decide which Claude model (Haiku, Sonnet or Opus) and which reasoning effort (low, medium, high, xhigh) each piece needs, and whether to delegate it to a subagent, so usage limits last longer without losing quality. Also use when the user mentions limits, usage, cost, tokens, "save quota", "cheaper model", or asks which model to use.
---

# tokenwise

Goal: spend expensive model capacity (Opus) only where it changes the outcome, and push mechanical work to cheaper models (Haiku, Sonnet) — without making the work worse or slower.

## 1. Classify each piece of work

| Tier | Model | Typical work |
|------|-------|--------------|
| **Light** | `haiku` | Finding files/symbols, grepping, listing usages, reading and summarizing logs or long files, extracting data, renaming, formatting, boilerplate, simple one-file edits with a clear spec, running a command and reporting the result |
| **Standard** | `sonnet` | Implementing a feature from a clear plan, writing tests, medium refactors, fixing a bug whose cause is already known, writing docs, routine code review |
| **Heavy** | `opus` | Architecture and design decisions, ambiguous requirements, debugging an unknown root cause, security-sensitive code, tricky concurrency/data-integrity work, final review of a large change, anything that failed once on a cheaper model |

When unsure between two tiers, choose the cheaper one **unless** a mistake would be costly to undo (data loss, security, production deploys) — then choose the heavier one.

## 2. Decide: do it inline or delegate?

A subagent starts cold: it re-reads files and re-derives context. That costs tokens too. Delegate only when it pays off:

**Delegate to a subagent when ALL of these hold:**
- The piece is self-contained (can be described in a short brief with file paths and a clear "done" condition).
- It would take roughly 5+ tool calls or read a lot of content (big files, many files, long logs).
- You only need the conclusion back, not every file's contents in your own context.

**Do it inline when:**
- It takes only a few tool calls, or
- It depends heavily on the current conversation, or
- You'd have to re-explain a lot of context in the brief.

## 3. How to delegate

Use the Agent tool with an explicit `model` (or a `tokenwise-*` agent) **and** an explicit `effort` (see section 4):

- Light → `subagent_type: "tokenwise-scout"` (Haiku, read-only) or `model: "haiku"`
- Standard → `subagent_type: "tokenwise-builder"` (Sonnet) or `model: "sonnet"`
- Heavy → `subagent_type: "tokenwise-architect"` (Opus) or `model: "opus"`

Notes:
- A `fork` subagent always runs on the parent's model and ignores `model` — don't fork when the point is to save capacity.
- Independent light tasks (e.g. three separate searches) can be dispatched in parallel in one message.
- Every brief must name: the files/area, what to do, what "done" looks like, and what to return (keep the return short — a summary, a list of paths, a diff description).
- If a cheaper agent's result looks wrong or thin, verify it yourself or escalate one tier. Never escalate more than once for the same piece without telling the user.

## 4. Reasoning effort

Model and effort are **two independent decisions**. This skill explicitly authorizes setting `effort` on every subagent call.

- **Model = what kind of intelligence the task needs** (step 1: Light / Standard / Heavy).
- **Effort = how long that model should think.** Decide it from four signals:
  1. **Steps** — how many files/parts interact?
  2. **Ambiguity** — is the answer clear, or must it be investigated?
  3. **Prior failure** — did an earlier attempt fail?
  4. **Cost of a mistake** — is a wrong answer hard to undo?

  Start at `low`. Go to `medium` if one signal is present, `high` if two or more are (or prior failure + anything else). `xhigh` only for Heavy work where `high` already failed, or security/data-integrity stakes with an unknown cause.

| | `low` | `medium` | `high` |
|---|---|---|---|
| **haiku** | find files, grep, list usages | read a long log and find the error pattern | — (if Haiku needs `high`, the task isn't Light: move to Sonnet) |
| **sonnet** | rename, small single-file fix | implement a feature from a plan, write tests | multi-file refactor, or a task that failed at `medium` |
| **opus** | short design question with a clear answer, review of a small diff | choose between 2–3 architecture options, normal code review | unknown-root-cause bug, large architecture decision |

Opus at `low` is a valid choice: the question needs judgment but not long thinking. Sonnet at `high` is too: routine work with many moving parts.

Rules:
- **Always pass `effort` explicitly** on every Agent call, chosen from the signals above. The `effort` in the `tokenwise-*` agent files is only a fallback default.
- Never use `max` unless the user explicitly asks — it is the most expensive level.
- **Raise effort before raising the model:** a Sonnet task that fails at `medium` goes to Sonnet/`high` before it goes to Opus. Exception: if the failure shows the task needs judgment Sonnet lacks (design, unclear requirements), go straight to Opus.
- Don't over-think cheap work: Haiku stays at `low`/`medium`.
- For ~50 more task → model/effort examples (by category: search, coding, debugging, review, design, docs, data, DevOps), see `references/effort-guide.md`.

**Main session effort:** same rule as the model below — suggest, don't switch silently. If a long stretch of simple work is ahead and the session runs at `high` or above, suggest dropping to `medium`/`low`; if hard work starts at `low`, suggest raising it. In the Claude desktop app this can be done with the session effort tool (user approves); in the CLI the user changes it themselves.

## 5. The main session's model

The main session's model is the biggest lever but switching it mid-session drops the prompt cache, so do it rarely:

- If the main session runs on Opus and the remaining work is clearly Standard/Light for a long stretch (e.g. "now implement these 10 straightforward screens"), **suggest** switching the session to Sonnet — say why in one line and let the user decide. In the Claude desktop app this can be done with the session model tool (user approves); in the CLI the user runs `/model sonnet`.
- If the session runs on Sonnet/Haiku and you hit Heavy work, either delegate that piece to `tokenwise-architect` or suggest switching up.
- Never switch the main model silently, and never switch back and forth for small pieces.

## 6. Report briefly

When you delegated work in a turn, add one short line to your reply, e.g.:
`Model routing: haiku/low (search), opus/low (quick design check), sonnet/high (6-file refactor); main: opus/medium.`
No long explanations unless the user asks.

## Red flags

- Opening a subagent for a 2-step task → do it inline.
- Using Opus to grep or summarize logs → that's Haiku work.
- Using Haiku for a design decision or an unknown bug → that's Opus work.
- Forking to "save" usage → forks inherit the parent model.
- Accepting a cheap agent's answer on a high-stakes change without checking it.
