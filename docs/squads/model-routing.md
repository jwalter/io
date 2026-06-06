# Model Routing

IO uses dynamic model routing to balance cost and capability. There are two contexts: the orchestrator and squad agents.

## Orchestrator

The orchestrator always uses the model specified in your config (`defaultModel`). It does not dynamically switch models per message.

```json
{
  "defaultModel": "gpt-4o"
}
```

If not set, it defaults to `gpt-4o`.

## Squad Model Selection

When a Team Lead assigns tasks to agents, it uses an LLM call to classify task complexity and select the cheapest capable model.

### How It Works

1. The task description is sent to the cheapest available model (trivial tier)
2. That model classifies the task into one of 5 tiers
3. The cheapest available model in the classified tier is selected
4. If the selected model fails, it automatically retries with the next tier up (max 1 escalation)

### Tiers

Models are automatically assigned to tiers based on their Copilot premium request multiplier:

| Tier | Multiplier Range | Example Models |
|------|-----------------|----------------|
| **Trivial** | ≤0.33x | gpt-4o-mini, gpt-4o, gpt-5-mini |
| **Fast** | 0.34x–1x | Gemini 2.5 Pro |
| **Standard** | 1.1x–5x | GPT-5.1, GPT-5.2 |
| **Premium** | 5.1x–15x | GPT-5.4, Claude Sonnet 4.5/4.6 |
| **Ultra** | 15x+ | Claude Opus 4.6/4.7/4.8, GPT-5.5 |

### Dynamic Model Catalog

IO fetches available models from GitHub's Models API and scrapes pricing from GitHub's documentation. This happens:

- **At startup** (blocks until complete — ensures models are always available)
- **Periodically** on the configured `pricingRefreshHours` interval (default: 24 hours)

If all sources fail, IO falls back to hardcoded seed data for known models.

## Cost Tracking

Every LLM call records two cost metrics (point-in-time pricing):

- **Premium Request Cost** — the model's Copilot premium request multiplier at time of use
- **Token Unit Cost** — computed as `(input_tokens × input_multiplier + output_tokens × output_multiplier) × $0.00001`

Both are stored per usage record and never recalculated when pricing changes. Historical costs reflect the rates when the call was made.

## Configuration

```json
{
  "defaultModel": "gpt-4o",
  "pricingRefreshHours": 24
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `defaultModel` | `gpt-4o` | Model used by the orchestrator for all messages |
| `pricingRefreshHours` | `24` | How often to refresh the model catalog and pricing data |

