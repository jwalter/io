import { CopilotClient } from "@github/copilot-sdk";

let client: CopilotClient | undefined;

export async function getClient(): Promise<CopilotClient> {
  if (!client) {
    client = new CopilotClient({
      autoStart: true,
      autoRestart: true,
    });
    await client.start();
  }
  return client;
}

export async function resetClient(): Promise<CopilotClient> {
  if (client) {
    try { await client.stop(); } catch { /* best-effort */ }
    client = undefined;
  }
  return getClient();
}

export async function stopClient(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
