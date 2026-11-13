# model-router

A Claude Code skill + three subagents that route each piece of work to the right model — **Haiku**, **Sonnet** or **Opus** — so your usage limits last longer without making the work worse.

*Türkçe özet aşağıda.*

## What it does

- **Classifies work** into Light / Standard / Heavy tiers and picks the model and the reasoning effort **independently** — e.g. Opus/low for a quick design check, Sonnet/high for a big but routine refactor.
- **Delegates** self-contained pieces to cheaper subagents only when that actually saves tokens (subagents start cold, so tiny tasks stay inline).
- **Suggests** switching the main session's model when a long stretch of simpler work is ahead — never silently.
- Adds a one-line routing summary to replies, e.g. `Model routing: haiku/low (search), opus/low (quick design check), sonnet/high (6-file refactor); main: opus/medium.`

| Agent | Model (default effort) | Used for |
|-------|-------|----------|
| `router-scout` | Haiku (low) | search, grep, reading/summarizing logs and big files (read-only) |
| `router-builder` | Sonnet (medium) | implementing from a plan, tests, medium refactors, known-cause bug fixes |
| `router-architect` | Opus (high) | design decisions, unknown-cause debugging, security, final review |

## Install

**Option A — as a plugin (recommended):**

```
/plugin marketplace add OnurSamett/model-router
/plugin install model-router@model-router
```

**Option B — copy into `~/.claude`:**

```bash
git clone https://github.com/OnurSamett/model-router.git && ./model-router/install.sh
```

Restart Claude Code sessions after installing.

## Use

It triggers automatically on multi-step tasks or when you mention limits/usage. You can also call it directly: `/model-router`.

## Limits (honest ones)

- It's guidance for the model, not a hard enforcement layer.
- It doesn't read your remaining quota; it routes by task type.
- `fork` subagents always use the parent model, so the skill avoids them for saving.

## Türkçe özet

Bu skill, işleri türüne göre Haiku / Sonnet / Opus'a dağıtır: arama ve özetleme Haiku'ya, normal kodlama Sonnet'e, mimari ve zor hata ayıklama Opus'a gider. Küçük işler için alt ajan açmaz, çünkü alt ajan sıfırdan başlar ve o da token harcar. Ana oturumun modelini değiştirmeyi yalnızca önerir, sessizce değiştirmez. Kurulum için yukarıdaki iki seçenekten birini kullan.

## License

MIT
