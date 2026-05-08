import { getClient, stopClient } from "./copilot/client.js";
import { initOrchestrator, sendToOrchestrator, shutdownOrchestrator } from "./copilot/orchestrator.js";
import { startApiServer, setMessageHandler as setApiHandler, broadcastToSSE } from "./api/server.js";
import { createBot, startBot, stopBot, sendProactiveMessage, setMessageHandler as setTelegramHandler } from "./telegram/bot.js";
import { getDb, closeDb } from "./store/db.js";
import { clearStaleTasks } from "./store/tasks.js";
import { config } from "./config.js";
import { ensureWikiStructure } from "./wiki/fs.js";
import { checkForUpdate } from "./update.js";
import { readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { SESSIONS_DIR } from "./paths.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function pruneOldSessions(): void {
  try {
    const sessionDir = join(SESSIONS_DIR, "session-state");
    let entries: string[];
    try {
      entries = readdirSync(sessionDir);
    } catch {
      return;
    }

    const cutoff = Date.now() - SEVEN_DAYS_MS;
    let pruned = 0;

    for (const entry of entries) {
      const fullPath = join(sessionDir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) {
          rmSync(fullPath, { recursive: true, force: true });
          pruned++;
        }
      } catch { /* skip */ }
    }

    if (pruned > 0) {
      console.log(`[io] Pruned ${pruned} orphaned session folder(s)`);
    }
  } catch (err) {
    console.error("[io] Session pruning failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

export async function startDaemon(): Promise<void> {
  console.log("[io] Starting IO daemon...");
  if (config.selfEditEnabled) {
    console.log("[io] ⚠ Self-edit mode enabled");
  }

  // Initialize database
  getDb();
  console.log("[io] Database initialized");

  // Initialize wiki
  const wikiIsNew = ensureWikiStructure();
  if (wikiIsNew) {
    console.log("[io] Created wiki at ~/.io/wiki/");
  }

  // Clear stale tasks from previous run
  clearStaleTasks();

  // Prune old sessions
  pruneOldSessions();

  // Start Copilot SDK client
  console.log("[io] Starting Copilot SDK client...");
  const client = await getClient();
  console.log("[io] Copilot SDK client ready");

  // Initialize orchestrator
  console.log("[io] Creating orchestrator session...");
  await initOrchestrator(client);
  console.log("[io] Orchestrator session ready");

  // Wire up API message handler
  setApiHandler(async (text, connectionId, callback) => {
    await sendToOrchestrator(
      text,
      { type: "tui", connectionId },
      callback,
    );
  });

  // Start HTTP API
  await startApiServer();

  // Wire up Telegram handler
  if (config.telegramEnabled) {
    setTelegramHandler(async (text, chatId, messageId, callback) => {
      await sendToOrchestrator(
        text,
        { type: "telegram", chatId, messageId },
        callback,
      );
    });
    createBot();
    await startBot();
  } else {
    console.log("[io] Telegram not configured — skipping bot. Set telegramBotToken in ~/.io/config.json");
  }

  console.log("[io] IO is fully operational.");

  // Non-blocking update check
  checkForUpdate()
    .then(({ updateAvailable, current, latest }) => {
      if (updateAvailable) {
        console.log(`[io] ⬆ Update available: v${current} → v${latest}`);
      }
    })
    .catch(() => {});

  // Notify Telegram if restarting
  if (config.telegramEnabled && process.env.IO_RESTARTED === "1") {
    await sendProactiveMessage("I'm back online 🟢").catch(() => {});
    delete process.env.IO_RESTARTED;
  }
}

// Graceful shutdown
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    console.log("\n[io] Forced exit.");
    process.exit(1);
  }
  shuttingDown = true;
  console.log("\n[io] Shutting down... (Ctrl+C again to force)");

  const forceTimer = setTimeout(() => {
    console.log("[io] Shutdown timed out — forcing exit.");
    process.exit(1);
  }, 5000);
  forceTimer.unref();

  if (config.telegramEnabled) {
    try { await stopBot(); } catch { /* best effort */ }
  }

  await shutdownOrchestrator();
  try { await stopClient(); } catch { /* best effort */ }
  closeDb();
  console.log("[io] Goodbye.");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  console.error("[io] Unhandled rejection (kept alive):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[io] Uncaught exception — shutting down:", err);
  process.exit(1);
});
