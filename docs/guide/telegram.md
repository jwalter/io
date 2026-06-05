# Telegram

IO integrates with Telegram via the [grammY](https://grammy.dev/) bot framework, giving you remote access to Io from anywhere.

## Setup

1. Create a bot with [@BotFather](https://t.me/botfather) on Telegram
2. Copy the bot token
3. Get your Telegram user ID (send `/start` to [@userinfobot](https://t.me/userinfobot))
4. Add to your config:

```json
{
  "telegramToken": "123456:ABC-DEF...",
  "telegramUserId": "your_user_id"
}
```

5. Restart IO

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/status` | Daemon and squad status |
| `/squads` | List active squads |

## Chatting

Just send any message to your bot — it goes directly to Io:

```
You: "What's the status of the my-app squad?"
Io:  "The my-app squad is idle. Last activity: PR #42 merged 2 hours ago."
```

## Notifications

IO sends proactive notifications to Telegram when `telegramUserId` is configured:

- **Inbox items** — Squad deliverables and blocking questions
- **Squad completions** — When a squad finishes an objective
- **QA escalations** — When QA rejects work 3 times

Notifications are rate-limited to avoid spam.

## Security

- The `telegramUserId` config tells IO where to send notifications
- The bot itself responds to any user who messages it — keep your bot token secret
- The bot token should never be committed to source control
