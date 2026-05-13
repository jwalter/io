// Tiered activity log normalizer.
//
// Converts raw TaskStreamEvent records (forwarded from the Copilot SDK
// session) into "activity entries" that present a clean human-readable
// summary. Each entry preserves the underlying raw payload for drill-down so
// no information is lost.
//
// Used by:
//   - GET /tasks/:taskId/activity (full collapsed list)
//   - the SSE per-event payload (single-event summary attached alongside raw)
//   - the TUI /activity command

import type { TaskStreamEvent } from "./agents.js";

export type ActivityKind = "message" | "reasoning" | "tool" | "outcome" | "system";

export interface ActivityEntry {
  ts: number;
  kind: ActivityKind;
  icon: string;
  summary: string;
  /** Optional longer prose for inline expansion (still summarized, not raw). */
  detail?: string;
  /** Original event type (e.g. "tool.execution_start"). */
  rawType: string;
  /** Original event.data — full fidelity for the "raw" drill-down view. */
  raw: unknown;
  /** Tool calls share an ID across start/complete; UI uses this to merge. */
  toolCallId?: string;
  /** For tool entries after completion. */
  status?: "pending" | "success" | "error";
}

const TOOL_VERBS: Record<string, string> = {
  bash: "Ran shell command",
  shell: "Ran shell command",
  read_file: "Read file",
  view: "Read file",
  create: "Created file",
  edit: "Edited file",
  str_replace_editor: "Edited file",
  grep: "Searched code",
  glob: "Searched filenames",
  web_fetch: "Fetched URL",
  github: "Called GitHub API",
  delegate_to_teammate: "Delegated to teammate",
  squad_delegate: "Delegated to squad",
  squad_status: "Listed squads",
  squad_agents: "Listed squad agents",
  squad_set_lead: "Set squad lead",
  squad_set_qa: "Set squad QA",
  squad_task_status: "Checked task status",
  squad_task_reviews: "Read task reviews",
  squad_log_decision: "Logged squad decision",
  squad_schedule_create: "Created squad schedule",
  squad_schedule_list: "Listed squad schedules",
  squad_schedule_run_now: "Fired squad schedule",
  wiki_read: "Read wiki page",
  wiki_write: "Wrote wiki page",
  wiki_search: "Searched wiki",
  wiki_list: "Listed wiki pages",
  skill_list: "Listed skills",
  skill_install: "Installed skill",
  skill_remove: "Removed skill",
  skill_search: "Searched skills registry",
  config_update: "Updated config",
  check_update: "Checked for IO update",
  file_ops: "File operation",
};

function trunc(s: string, n: number): string {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

function pickArgSummary(toolName: string, args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const a = args as Record<string, unknown>;
  switch (toolName) {
    case "bash":
    case "shell": {
      const cmd = typeof a.command === "string" ? a.command : "";
      return trunc(cmd, 80);
    }
    case "read_file":
    case "view":
    case "create":
    case "edit":
    case "str_replace_editor": {
      const p = typeof a.path === "string" ? a.path : (typeof a.file_path === "string" ? a.file_path : "");
      return p;
    }
    case "grep": {
      const pat = typeof a.pattern === "string" ? `"${trunc(a.pattern, 40)}"` : "";
      const paths = Array.isArray(a.paths) ? a.paths.join(", ") : (typeof a.paths === "string" ? a.paths : "");
      return [pat, paths].filter(Boolean).join(" in ");
    }
    case "glob": {
      return typeof a.pattern === "string" ? a.pattern : "";
    }
    case "web_fetch": {
      return typeof a.url === "string" ? a.url : "";
    }
    case "delegate_to_teammate": {
      const teammate = typeof a.teammate === "string" ? a.teammate : "";
      const task = typeof a.task === "string" ? trunc(a.task, 60) : "";
      return [teammate, task].filter(Boolean).join(": ");
    }
    case "squad_delegate": {
      const slug = typeof a.slug === "string" ? a.slug : "";
      const agent = typeof a.agent === "string" ? ` → ${a.agent}` : "";
      const task = typeof a.task === "string" ? trunc(a.task, 50) : "";
      return `${slug}${agent}${task ? `: ${task}` : ""}`;
    }
    case "wiki_read":
    case "wiki_write":
    case "wiki_delete": {
      return typeof a.path === "string" ? a.path : "";
    }
    case "wiki_search":
    case "skill_search": {
      return typeof a.query === "string" ? `"${trunc(a.query, 40)}"` : "";
    }
    case "github": {
      const ep = typeof a.endpoint === "string" ? a.endpoint : "";
      const method = typeof a.method === "string" ? a.method : "";
      return [method, ep].filter(Boolean).join(" ");
    }
    case "file_ops": {
      const op = typeof a.operation === "string" ? a.operation : "";
      const p = typeof a.path === "string" ? a.path : "";
      return [op, p].filter(Boolean).join(" ");
    }
    default: {
      // Best-effort: stringify the first arg value.
      const k = Object.keys(a)[0];
      if (!k) return "";
      const v = a[k];
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${trunc(s ?? "", 50)}`;
    }
  }
}

/** Summarize a single TaskStreamEvent. */
export function summarizeEvent(ev: TaskStreamEvent): ActivityEntry {
  const data = (ev.data ?? {}) as Record<string, unknown>;
  const base = { ts: ev.ts, rawType: ev.type, raw: ev.data };

  switch (ev.type) {
    case "assistant.intent": {
      const intent = typeof data.intent === "string" ? data.intent : "";
      return { ...base, kind: "reasoning", icon: "🧠", summary: intent || "(intent)" };
    }
    case "assistant.reasoning": {
      const content = typeof data.content === "string" ? data.content : "";
      return {
        ...base,
        kind: "reasoning",
        icon: "🧠",
        summary: trunc(content, 140) || "(reasoning)",
        detail: content,
      };
    }
    case "assistant.message": {
      const content = typeof data.content === "string" ? data.content : "";
      return {
        ...base,
        kind: "message",
        icon: "💬",
        summary: trunc(content, 200) || "(empty message)",
        detail: content,
      };
    }
    case "assistant.turn_start":
      return { ...base, kind: "system", icon: "▶️", summary: "Turn started" };
    case "assistant.turn_end":
      return { ...base, kind: "system", icon: "⏹️", summary: "Turn ended" };
    case "tool.execution_start": {
      const name = typeof data.toolName === "string" ? data.toolName : "tool";
      const verb = TOOL_VERBS[name] ?? `Used ${name}`;
      const args = pickArgSummary(name, data.arguments as Record<string, unknown> | undefined);
      return {
        ...base,
        kind: "tool",
        icon: "🔧",
        summary: args ? `${verb} — ${args}` : verb,
        toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : undefined,
        status: "pending",
      };
    }
    case "tool.execution_complete": {
      const success = data.success === true;
      const result = (data.result ?? {}) as { content?: string };
      const content = typeof result.content === "string" ? result.content : "";
      return {
        ...base,
        kind: "tool",
        icon: success ? "✅" : "❌",
        summary: success ? "Tool completed" : "Tool failed",
        detail: trunc(content, 300),
        toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : undefined,
        status: success ? "success" : "error",
      };
    }
    case "tool.execution_progress": {
      const message = typeof data.message === "string" ? data.message : "";
      return {
        ...base,
        kind: "tool",
        icon: "⏳",
        summary: trunc(message, 140) || "Tool progress",
        toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : undefined,
        status: "pending",
      };
    }
    case "session.error": {
      const msg = typeof data.message === "string" ? data.message : (typeof data.error === "string" ? data.error : "");
      return { ...base, kind: "outcome", icon: "❌", summary: `Error: ${trunc(msg, 160) || "session error"}` };
    }
    case "session.warning": {
      const msg = typeof data.message === "string" ? data.message : "";
      return { ...base, kind: "outcome", icon: "⚠️", summary: `Warning: ${trunc(msg, 160) || "session warning"}` };
    }
    case "task.done": {
      const r = typeof data.result === "string" ? data.result : "";
      return { ...base, kind: "outcome", icon: "✅", summary: "Task completed", detail: trunc(r, 300) };
    }
    case "task.failed": {
      const e = typeof data.error === "string" ? data.error : "";
      return { ...base, kind: "outcome", icon: "❌", summary: `Task failed: ${trunc(e, 160)}` };
    }
    case "task.cancelled":
      return { ...base, kind: "outcome", icon: "🛑", summary: "Task cancelled" };
    case "task.review":
      return {
        ...base,
        kind: "outcome",
        icon: data.approved ? "👍" : "👎",
        summary: `Review by ${data.reviewer ?? "?"}: ${data.approved ? "APPROVED" : "REJECTED"}${data.is_qa ? " (QA)" : ""}`,
        detail: typeof data.comments === "string" ? data.comments : undefined,
      };
    case "task.review_complete":
      return {
        ...base,
        kind: "outcome",
        icon: data.promoted ? "🚀" : "ℹ️",
        summary: data.promoted
          ? `Promoted PR: ${data.prUrl ?? ""}`
          : `Review complete: ${typeof data.reason === "string" ? data.reason : ""}`,
      };
    case "task.review_advisory":
      return {
        ...base,
        kind: "outcome",
        icon: "ℹ️",
        summary: typeof data.reason === "string" ? data.reason : "Advisory review note",
      };
    case "task.review_error": {
      const e = typeof data.error === "string" ? data.error : "";
      return { ...base, kind: "outcome", icon: "❌", summary: `Review error: ${trunc(e, 160)}` };
    }
    default:
      return { ...base, kind: "system", icon: "•", summary: ev.type };
  }
}

/**
 * Collapse a stream of events into the activity log. Tool start + complete
 * pairs are merged into one entry (success/error and detail attached).
 * Streaming deltas (assistant.message_delta, assistant.reasoning_delta,
 * tool.execution_partial_result) are dropped — the "complete" sibling event
 * is what we summarize.
 */
export function summarize(events: TaskStreamEvent[]): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const toolIndex = new Map<string, number>(); // toolCallId → index into out

  for (const ev of events) {
    if (
      ev.type === "assistant.message_delta" ||
      ev.type === "assistant.reasoning_delta" ||
      ev.type === "tool.execution_partial_result"
    ) {
      continue;
    }
    const entry = summarizeEvent(ev);
    if (entry.kind === "tool" && entry.toolCallId) {
      const existing = toolIndex.get(entry.toolCallId);
      if (existing != null && entry.status && entry.status !== "pending") {
        // Merge: keep the verb from the start event, add status/detail/icon from completion.
        const prior = out[existing];
        out[existing] = {
          ...prior,
          icon: entry.icon,
          status: entry.status,
          detail: entry.detail ?? prior.detail,
          // Append a brief outcome marker if the start summary is the only descriptor.
          summary: prior.summary,
          // Keep the completion event raw available for drill-down by stashing on detail when no detail present
          raw: { start: prior.raw, complete: entry.raw },
          rawType: `${prior.rawType}+${entry.rawType}`,
        };
        continue;
      }
      toolIndex.set(entry.toolCallId, out.length);
    }
    out.push(entry);
  }
  return out;
}
