# Main session model/effort, and ultracode

## Main session effort

Suggest, don't switch silently. If a long stretch of simple work is ahead and the session runs at `high` or above, suggest dropping to `medium`/`low`; if hard work starts at `low`, suggest raising it. In the Claude desktop app this can be done with the session effort tool (user approves); in the CLI the user changes it themselves.

## Main session model

The main session's model is the biggest lever but switching it mid-session drops the prompt cache, so do it rarely:

- If the main session runs on Opus and the remaining work is clearly Standard/Light for a long stretch (e.g. "now implement these 10 straightforward screens"), **suggest** switching the session to Sonnet — say why in one line and let the user decide. In the Claude desktop app this can be done with the session model tool (user approves); in the CLI the user runs `/model sonnet`.
- If the session runs on Sonnet/Haiku and you hit Heavy work, either delegate that piece to `tokenwise-architect` or suggest switching up.
- Never switch the main model silently, and never switch back and forth for small pieces.

## When ultracode (or another max-effort mode) is on

If the session runs with `/effort ultracode` (xhigh effort + automatic multi-agent orchestration) or the user picked `max`, the user has deliberately chosen depth over savings. Then:

- **Don't fight it:** never suggest lowering the main session's model or effort, and don't refuse to orchestrate.
- **Still route the workers:** when the orchestration spawns subagents, give purely mechanical pieces (search, log reading, listing usages, boilerplate, running tests) to `haiku`/`sonnet` at `low`/`medium`. Keep design, root-cause and review pieces on Opus at the orchestration's effort.
- **External workers still apply:** images always go to Codex; second opinions on high-stakes decisions can go to `codex sol/high`.
- Mention once, briefly, that ultracode is the most expensive mode, only if the user asks about limits.
