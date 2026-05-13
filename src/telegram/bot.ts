import { Bot } from "grammy";
import { config } from "../config.js";

const TELEGRAM_MAX_LENGTH = 4096;
const EDIT_DEBOUNCE_MS = 500;

export type TelegramMessageHandler = (
  text: string,
  chatId: number,
  messageId: number,
  callback: (text: string, done: boolean) => void,
) => Promise<void>;

let bot: Bot | undefined;
let messageHandler: TelegramMessageHandler | undefined;

export function setMessageHandler(handler: TelegramMessageHandler): void {
  messageHandler = handler;
}

export function createBot(): void {
  if (!config.telegramBotToken) {
    console.error("[io] Telegram bot token not configured");
    return;
  }

  bot = new Bot(config.telegramBotToken);

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id;

    if (config.authorizedUserId && userId !== config.authorizedUserId) {
      return;
    }

    if (!messageHandler) {
      console.error("[io] No message handler registered");
      return;
    }

    const text = ctx.message.text;
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    await ctx.replyWithChatAction("typing");

    const placeholder = await ctx.reply("…");
    let accumulated = "";
    let lastEditTime = 0;
    let pendingEdit: ReturnType<typeof setTimeout> | undefined;

    const editReply = async (content: string) => {
      try {
        const truncated = content.length > TELEGRAM_MAX_LENGTH
          ? content.slice(0, TELEGRAM_MAX_LENGTH - 20) + "\n\n[…truncated]"
          : content;
        await ctx.api.editMessageText(
          chatId,
          placeholder.message_id,
          truncated,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("message is not modified")) {
          console.error("[io] Failed to edit message:", message);
        }
      }
    };

    try {
      await messageHandler(text, chatId, messageId, (chunk, done) => {
        accumulated += chunk;

        if (done) {
          if (pendingEdit) {
            clearTimeout(pendingEdit);
            pendingEdit = undefined;
          }
          return;
        }

        const now = Date.now();
        const timeSinceLastEdit = now - lastEditTime;

        if (timeSinceLastEdit >= EDIT_DEBOUNCE_MS) {
          lastEditTime = now;
          void editReply(accumulated);
        } else if (!pendingEdit) {
          pendingEdit = setTimeout(() => {
            pendingEdit = undefined;
            lastEditTime = Date.now();
            void editReply(accumulated);
          }, EDIT_DEBOUNCE_MS - timeSinceLastEdit);
        }
      });

      if (pendingEdit) {
        clearTimeout(pendingEdit);
      }

      // Send final message
      if (accumulated.length > 0) {
        await editReply(accumulated);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[io] Error handling message:", message);
      await editReply("An error occurred while processing your message.");
    }
  });

  bot.catch((err) => {
    console.error("[io] Grammy bot error:", err.message);
  });

  console.log("[io] Telegram bot created");
}

export async function startBot(): Promise<void> {
  if (!bot) {
    console.error("[io] Bot not created — call createBot() first");
    return;
  }

  try {
    console.log("[io] Starting Telegram bot polling…");
    void bot.start({
      onStart: () => console.log("[io] Telegram bot polling started"),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[io] Failed to start Telegram bot:", message);
  }
}

export async function stopBot(): Promise<void> {
  if (!bot) {
    return;
  }

  try {
    await bot.stop();
    console.log("[io] Telegram bot stopped");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[io] Error stopping Telegram bot:", message);
  }
}

export async function sendProactiveMessage(text: string): Promise<void> {
  if (!bot) {
    console.error("[io] Bot not created — cannot send proactive message");
    return;
  }

  if (!config.authorizedUserId) {
    console.error("[io] No authorized user ID configured");
    return;
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, TELEGRAM_MAX_LENGTH));
    remaining = remaining.slice(TELEGRAM_MAX_LENGTH);
  }

  for (const chunk of chunks) {
    try {
      await bot.api.sendMessage(config.authorizedUserId, chunk);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[io] Failed to send proactive message:", message);
    }
  }
}

/**
 * Send a background schedule result as a Telegram notification.
 * Delegates to sendProactiveMessage for chunking, bot-not-configured guards,
 * and authorized-user checks — no extra logic needed here.
 *
 * Format (plain text, no parse_mode):
 *   🔔 Background update — <title>
 *
 *   <text>
 */
export async function sendBackgroundNotification(opts: {
  title: string;
  text: string;
}): Promise<void> {
  const formatted = `\ud83d\udd14 Background update \u2014 ${opts.title}\n\n${opts.text}`;
  await sendProactiveMessage(formatted);
}
