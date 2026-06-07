import type { CopilotSession } from "@github/copilot-sdk";
import { loadConfig } from "../config.js";
import { recordTokenUsage } from "../store/token-usage.js";
import { postFeedItem } from "../store/feed.js";

interface UsageAccumulator {
  [model: string]: { inputTokens: number; outputTokens: number };
}

/**
 * Attach a token usage listener to a CopilotSession.
 * Returns a `flush` function that, when called, persists accumulated
 * token usage to the database and returns the totals.
 *
 * Call `flush` after the session ends (in a finally block).
 */
export function attachTokenTracker(
  session: CopilotSession,
  context: {
    squadId?: string;
    agentId?: string;
    taskId?: string;
  }
): () => { totalInputTokens: number; totalOutputTokens: number } {
  const accumulator: UsageAccumulator = {};

  const unsubscribe = session.on("assistant.usage" as any, (event: any) => {
    const data = event?.data;
    if (!data?.model) return;
    const model: string = data.model;
    const input: number = data.inputTokens ?? 0;
    const output: number = data.outputTokens ?? 0;
    if (!accumulator[model]) accumulator[model] = { inputTokens: 0, outputTokens: 0 };
    accumulator[model].inputTokens += input;
    accumulator[model].outputTokens += output;
  });

  return () => {
    unsubscribe();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const [model, usage] of Object.entries(accumulator)) {
      if (usage.inputTokens === 0 && usage.outputTokens === 0) continue;
      recordTokenUsage({
        squadId: context.squadId,
        agentId: context.agentId,
        taskId: context.taskId,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
    }

    // Alert on runaway agents
    const config = loadConfig();
    const threshold = config.tokenAlertThreshold;
    if (threshold && (totalInputTokens + totalOutputTokens) > threshold) {
      const source = context.squadId ? `squad-${context.squadId}` : "system";
      postFeedItem(
        source,
        "⚠️ Token usage alert",
        `A task consumed ${totalInputTokens + totalOutputTokens} tokens (threshold: ${threshold}). ` +
          (context.taskId ? `Task ID: ${context.taskId}` : "")
      );
    }

    return { totalInputTokens, totalOutputTokens };
  };
}
