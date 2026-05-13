import { createInterface, type Interface } from "readline";
import { listRecentTasks, getTask } from "../store/tasks.js";
import { getTaskEvents } from "../copilot/agents.js";
import { summarize } from "../copilot/event-summary.js";

export type TuiMessageHandler = (
  text: string,
  callback: (text: string, done: boolean) => void,
) => Promise<void>;

let messageHandler: TuiMessageHandler | undefined;

export function setMessageHandler(handler: TuiMessageHandler): void {
  messageHandler = handler;
}

const WELCOME_BANNER = `
╔══════════════════════════════════════╗
║          IO — AI Assistant           ║
╚══════════════════════════════════════╝
Type a message to chat. Commands:
  /status              — show status
  /activity [id|N]     — show summarized activity for a task (default: most recent)
  /verbose             — toggle verbose mode (raw event detail in /activity)
  /quit                — exit
`;

let verbose = false;

function renderActivity(taskIdArg: string | undefined): void {
  const recent = listRecentTasks(20);
  let task = undefined;
  if (!taskIdArg) {
    task = recent[0];
  } else if (/^\d+$/.test(taskIdArg)) {
    task = recent[parseInt(taskIdArg, 10) - 1];
  } else {
    task = getTask(taskIdArg);
  }
  if (!task) {
    console.log("[io] No task found for activity view.");
    return;
  }
  const events = getTaskEvents(task.task_id);
  if (events.length === 0) {
    console.log(`[io] No buffered activity for task ${task.task_id} (${task.status}).`);
    return;
  }
  const activity = summarize(events);
  console.log(`[io] Activity for task ${task.task_id} (${task.agent_slug}, ${task.status}) — ${activity.length} entries${verbose ? " (verbose)" : ""}`);
  for (const e of activity) {
    const ts = new Date(e.ts).toISOString().slice(11, 19);
    console.log(`  ${ts} ${e.icon} ${e.summary}`);
    if (verbose) {
      if (e.detail) {
        for (const line of e.detail.split(/\r?\n/)) console.log(`        ${line}`);
      } else if (e.raw && typeof e.raw === "object") {
        console.log("        " + JSON.stringify(e.raw).slice(0, 400));
      }
    }
  }
}

function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}

export async function startTui(): Promise<void> {
  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(WELCOME_BANNER);
  rl.setPrompt("io> ");
  rl.prompt();

  rl.on("line", async (input: string) => {
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === "/quit") {
      console.log("[io] Goodbye!");
      rl.close();
      process.exit(0);
    }

    if (trimmed === "/status") {
      console.log(`[io] Uptime: ${Math.floor(process.uptime())}s`);
      rl.prompt();
      return;
    }

    if (trimmed === "/verbose") {
      verbose = !verbose;
      console.log(`[io] Verbose mode ${verbose ? "ON" : "OFF"}`);
      rl.prompt();
      return;
    }

    if (trimmed === "/activity" || trimmed.startsWith("/activity ")) {
      const arg = trimmed.slice("/activity".length).trim() || undefined;
      try { renderActivity(arg); } catch (err) {
        console.error(`[io] /activity failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      rl.prompt();
      return;
    }

    if (!messageHandler) {
      console.log("[io] No message handler registered.");
      rl.prompt();
      return;
    }

    // Show typing indicator
    process.stdout.write("...");

    let accumulated = "";
    let firstChunk = true;

    try {
      await messageHandler(trimmed, (text: string, done: boolean) => {
        if (firstChunk) {
          clearLine();
          firstChunk = false;
        }

        if (done) {
          clearLine();
          process.stdout.write(accumulated + "\n");
          rl.prompt();
        } else {
          accumulated += text;
          clearLine();
          process.stdout.write(accumulated);
        }
      });
    } catch (err) {
      clearLine();
      console.error(
        `[io] Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log("\n[io] Goodbye!");
    process.exit(0);
  });
}
