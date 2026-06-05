# Model Routing

IO uses smart model routing to balance cost and capability. There are two routing contexts: Io's orchestrator and squad agents.

## Io's Model Router

For every incoming message, a lightweight classifier determines the complexity tier:

| Tier | When Used | Default Model |
|------|-----------|---------------|
| **Fast** | Simple questions, greetings, status checks | `gpt-4.1-mini` |
| **Standard** | Moderate tasks, code questions, discussions | `claude-sonnet-4.6` |
| **Premium** | Complex analysis, architecture, multi-step reasoning | `claude-sonnet-4.6` |

### Classification Method

1. Keyword matching checked first (e.g., "hello" → fast, "architecture" → premium)
2. Word count and message structure heuristics (short simple questions → fast)
3. Cooldown prevents rapid tier switching (avoids oscillation)
4. Falls back to "standard" if no rules match

## Team Lead Model Selection

When a Team Lead assigns tasks to agents, it picks the cheapest capable model:

- **Simple file edits** → Fast-tier model
- **Feature implementation** → Standard-tier model
- **Architecture/refactoring** → Premium-tier model

This is a heuristic classification based on task description — no additional LLM call is made for routing.

## Cost Optimization

The routing system aims to minimize cost while maintaining quality:

- ~60% of messages use the fast tier (cheap)
- ~30% use standard
- ~10% require premium

All token usage is tracked per-agent and viewable in the Usage dashboard.

## Default Model Override

You can set the fallback model (used when no tier matches) in `~/.io/config.json`:

```json
{
  "defaultModel": "gpt-4.1"
}
```

The tier-specific models (`gpt-4.1-mini`, `claude-sonnet-4.6`) are currently hardcoded constants. Only the default fallback model is configurable.
