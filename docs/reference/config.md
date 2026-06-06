# Configuration Reference

Complete reference for all configuration options in `~/.io/config.json`.

## Full Schema

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

All fields are optional. IO runs with sensible defaults if omitted.

## Fields

### `port`
- **Type:** `number`
- **Default:** `7777`
- **Env:** `IO_PORT`
- **Description:** HTTP and WebSocket server port

### `logLevel`
- **Type:** `"trace" | "debug" | "info" | "warn" | "error"`
- **Default:** `"info"`
- **Env:** `IO_LOG_LEVEL`
- **Description:** Minimum log level for output

### `defaultModel`
- **Type:** `string`
- **Default:** `"gpt-4o"`
- **Env:** `IO_DEFAULT_MODEL`
- **Description:** LLM model used by the orchestrator for all messages

### `telegramToken`
- **Type:** `string | null`
- **Default:** `null`
- **Env:** `IO_TELEGRAM_TOKEN`
- **Description:** Bot token from @BotFather. Required for Telegram integration.

### `telegramUserId`
- **Type:** `string | null`
- **Default:** `null`
- **Env:** `IO_TELEGRAM_USER_ID`
- **Description:** Telegram user ID allowed to interact with the bot. Messages from other users are ignored.

### `supabaseUrl`
- **Type:** `string | null`
- **Default:** `null`
- **Env:** `IO_SUPABASE_URL`
- **Description:** Supabase project URL. Required for web dashboard authentication.

### `supabaseAnonKey`
- **Type:** `string | null`
- **Default:** `null`
- **Env:** `IO_SUPABASE_ANON_KEY`
- **Description:** Supabase anonymous/public key. Required for web dashboard authentication.

### `sessionResetThreshold`
- **Type:** `number`
- **Default:** `50`
- **Env:** `IO_SESSION_RESET_THRESHOLD`
- **Description:** Number of messages before the conversation context window resets

### `pricingRefreshHours`
- **Type:** `number`
- **Default:** `24`
- **Env:** `IO_PRICING_REFRESH_HOURS`
- **Description:** How often (in hours) to refresh the model catalog and pricing data from GitHub

## Model Routing

The orchestrator always uses the configured `defaultModel`. Squad agents use dynamic model selection — see the [Model Routing guide](/squads/model-routing) for details.

## Validation

Configuration is validated at startup using Zod. Invalid config will cause a startup error with a descriptive message indicating which field is invalid.

## Environment Variable Precedence

Environment variables always override `config.json` values. This makes it easy to configure IO differently in production vs development without modifying the config file.
