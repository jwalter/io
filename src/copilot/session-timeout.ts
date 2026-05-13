import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";

/**
 * Idle timeout helper for agent task execution (issue #53).
 *
 * The Copilot SDK's `sendAndWait(prompt, timeout)` enforces a wall-clock
 * timeout. Long-running squad tasks were silently killed at 600s even when
 * the agent was actively making progress (#42, #45). This helper replaces
 * the wall-clock timeout with an **idle-reset** timeout: every progress
 * event (tool execution, assistant message, turn boundary) resets the
 * timer. The agent is only killed if it stops emitting events for `idleMs`
 * — i.e. it is actually stuck, not just slow.
 *
 * On graceful timeout we capture the partial content emitted so far and
 * surface it to the caller instead of throwing.
 */

const PROGRESS_EVENT_TYPES = new Set<string>([
  "assistant.turn_start",
  "assistant.message_delta",
  "assistant.message",
  "assistant.turn_end",
  "assistant.reasoning",
  "assistant.reasoning_delta",
  "tool.execution_start",
  "tool.execution_progress",
  "tool.execution_partial_result",
  "tool.execution_complete",
]);

export interface IdleSendOptions {
  /** Reset on every progress event; abort when nothing has happened for this long. */
  idleMs: number;
  /** Absolute upper bound passed to the underlying sendAndWait. */
  hardCapMs: number;
  onProgress?: (eventType: string) => void;
  onIdleTimeout?: (info: {
    lastEventType: string | undefined;
    idleMs: number;
  }) => void;
  onHardCap?: () => void;
}

export interface IdleSendResult {
  content: string;
  timedOut: boolean;
  timeoutReason?: "idle" | "hard_cap";
  lastEventType?: string;
}

export async function sendWithIdleTimeout(
  session: CopilotSession,
  prompt: string,
  opts: IdleSendOptions,
): Promise<IdleSendResult> {
  let accumulated = "";
  let lastEventType: string | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let aborted = false;
  let abortReason: "idle" | "hard_cap" | undefined;

  const triggerIdleAbort = () => {
    if (aborted) return;
    aborted = true;
    abortReason = "idle";
    opts.onIdleTimeout?.({ lastEventType, idleMs: opts.idleMs });
    void session.abort().catch(() => {
      /* best-effort */
    });
  };

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(triggerIdleAbort, opts.idleMs);
  };

  const unsubDelta = session.on(
    "assistant.message_delta",
    (event: { data: { deltaContent?: string } }) => {
      const delta = event?.data?.deltaContent;
      if (typeof delta === "string") accumulated += delta;
    },
  );

  const unsubAll = session.on((event: SessionEvent) => {
    if (PROGRESS_EVENT_TYPES.has(event.type)) {
      lastEventType = event.type;
      opts.onProgress?.(event.type);
      resetIdle();
    }
  });

  resetIdle();
  try {
    const response = await session.sendAndWait({ prompt }, opts.hardCapMs);
    if (aborted) {
      return {
        content: response?.data?.content ?? accumulated,
        timedOut: true,
        timeoutReason: abortReason,
        lastEventType,
      };
    }
    return {
      content: response?.data?.content ?? accumulated,
      timedOut: false,
      lastEventType,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const looksLikeTimeout = /timeout/i.test(message);
    if (aborted || looksLikeTimeout) {
      if (!aborted && looksLikeTimeout) {
        abortReason = "hard_cap";
        opts.onHardCap?.();
      }
      return {
        content:
          accumulated ||
          `(no output captured before timeout; last event: ${lastEventType ?? "none"})`,
        timedOut: true,
        timeoutReason: abortReason ?? "hard_cap",
        lastEventType,
      };
    }
    throw err;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    try {
      unsubDelta();
    } catch {
      /* ignore */
    }
    try {
      unsubAll();
    } catch {
      /* ignore */
    }
  }
}
