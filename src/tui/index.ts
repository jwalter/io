import { createInterface, type Interface } from "readline";

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
  /status  — show status
  /quit    — exit
`;

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
