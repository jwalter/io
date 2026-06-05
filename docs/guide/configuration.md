# Configuration

IO is configured via `~/.io/config.json` and environment variables. Environment variables take precedence over the config file.

## Config File

```json
{
  "port": 7777,
  "logLevel": "info",
  "defaultModel": "gpt-4o",
  "telegramToken": "YOUR_BOT_TOKEN",
  "telegramUserId": "123456789",
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseAnonKey": "your-anon-key",
  "sessionResetThreshold": 50,
  "pricingRefreshHours": 24
}
```

All fields are optional — IO runs with sensible defaults if no config file exists.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `IO_PORT` | HTTP/WS server port | `7777` |
| `IO_LOG_LEVEL` | Log level (trace/debug/info/warn/error) | `info` |
| `IO_DEFAULT_MODEL` | Default LLM model for the orchestrator | `gpt-4o` |
| `IO_TELEGRAM_TOKEN` | Telegram bot token | — |
| `IO_TELEGRAM_USER_ID` | Allowed Telegram user ID | — |
| `IO_SUPABASE_URL` | Supabase project URL | — |
| `IO_SUPABASE_ANON_KEY` | Supabase anonymous key | — |
| `IO_SESSION_RESET_THRESHOLD` | Message count before session reset | `50` |
| `IO_PRICING_REFRESH_HOURS` | How often to refresh model pricing (hours) | `24` |

## Model Routing

The **orchestrator** always uses the configured `defaultModel` (fallback: `gpt-4o`). It does not dynamically switch models.

**Squad agents** use dynamic model routing — an LLM classifies each task's complexity and selects the cheapest capable model from 5 tiers (trivial through ultra). See the [Model Routing guide](/squads/model-routing) for details.

The model catalog is refreshed from GitHub's APIs every `pricingRefreshHours` hours.

## Authentication

### Telegram

Authentication is by Telegram user ID. Set your numeric user ID in `telegramUserId` (config) or `IO_TELEGRAM_USER_ID` (env). Messages from other users are ignored.

### Web Dashboard

If Supabase is configured, the web dashboard requires login. Without Supabase config, the dashboard is open (suitable for local-only use).

## Data Directory

All IO data lives in `~/.io/`:

| Path | Purpose |
|------|---------|
| `config.json` | Configuration |
| `io.db` | libSQL database (squads, conversations, tokens, etc.) |
| `wiki/pages/` | Knowledge base markdown pages |
| `skills/` | Installed SKILL.md skill files |
| `logs/io.log` | Application logs (rotated) |
