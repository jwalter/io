import { CopilotClient } from "@github/copilot-sdk";
import { config } from "../config.js";

let client: CopilotClient | undefined;

export async function getClient(): Promise<CopilotClient> {
  if (!client) {
    const opts: ConstructorParameters<typeof CopilotClient>[0] = {
      autoStart: true,
    };

    // Pass explicit token if available (env vars are also auto-detected by the SDK)
    const token = process.env.COPILOT_GITHUB_TOKEN
      || process.env.GH_TOKEN
      || process.env.GITHUB_TOKEN;

    if (token) {
      opts.githubToken = token;
    }

    client = new CopilotClient(opts);
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
