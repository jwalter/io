import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { execSync } from "child_process";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { defineTool, approveAll } from "@github/copilot-sdk";
import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import { z } from "zod";

import { getClient } from "./client.js";
import { getModelForTask, getModelForTier, classifyComplexity } from "./model-router.js";
import type { Tier } from "./model-router.js";
import {
  getSquad,
  updateSquadSession,
  updateSquadStatus,
  getDecisionsSummary,
  logDecision,
  listSquadAgents,
  getSquadAgent,
  getSquadLead,
  updateAgentSession,
  updateAgentStatus,
} from "../store/squads.js";
import type { SquadAgent } from "../store/squads.js";
import {
  createTask,
  completeTask,
  createReview,
  failTask,
  getActiveTasks,
  getTask,
  cancelTask,
} from "../store/tasks.js";
import { SESSIONS_DIR } from "../paths.js";
import { getUniverse } from "./universes.js";

export interface AgentInfo {
  slug: string;
  name: string;
  characterName?: string;
  roleTitle?: string;
  universe?: string;
  status: "idle" | "working" | "error";
  currentTask?: string;
  currentTaskId?: string;
  model?: string;
}

// Key format: "squadSlug:characterName" for per-agent sessions, "squadSlug" for legacy
const agentSessions = new Map<string, CopilotSession>();
const agentSessionModels = new Map<string, string>();

function agentSessionKey(squadSlug: string, characterName?: string): string {
  return characterName ? `${squadSlug}:${characterName}` : squadSlug;
}

export function getAgentInfo(): AgentInfo[] {
  const activeTasks = getActiveTasks();
  const tasksByAgent = new Map<string, string>();
  const taskIdsByAgent = new Map<string, string>();
  for (const task of activeTasks) {
    tasksByAgent.set(task.agent_slug, task.description);
    taskIdsByAgent.set(task.agent_slug, task.task_id);
  }

  const agents: AgentInfo[] = [];
  const seenSquads = new Set<string>();

  // Collect info from squad agents (named agents)
  for (const [key, _session] of agentSessions) {
    const parts = key.split(":");
    const squadSlug = parts[0];
    const characterName = parts[1];
    seenSquads.add(squadSlug);

    const squad = getSquad(squadSlug);

    if (characterName) {
      const agent = getSquadAgent(squadSlug, characterName);
      const currentTask = tasksByAgent.get(key) ?? tasksByAgent.get(squadSlug);
      const currentTaskId = taskIdsByAgent.get(key) ?? taskIdsByAgent.get(squadSlug);
      agents.push({
        slug: squadSlug,
        name: agent ? `${agent.character_name} (${agent.role_title})` : characterName,
        characterName,
        roleTitle: agent?.role_title,
        universe: squad?.universe ?? undefined,
        status: agent?.status === "working" ? "working" : currentTask ? "working" : "idle",
        currentTask,
        currentTaskId,
        model: agentSessionModels.get(key),
      });
    } else {
      // Legacy generic agent
      const currentTask = tasksByAgent.get(squadSlug);
      const currentTaskId = taskIdsByAgent.get(squadSlug);
      agents.push({
        slug: squadSlug,
        name: squad?.name ?? squadSlug,
        status: currentTask ? "working" : squad?.status === "error" ? "error" : "idle",
        currentTask,
        currentTaskId,
        model: agentSessionModels.get(key),
      });
    }
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Live task event streaming — captures relevant events emitted by an agent's
// session while it processes a task. Buffers per task so late subscribers can
// replay the conversation up to the live edge, and emits events for current
// SSE subscribers.
// ---------------------------------------------------------------------------

export interface TaskStreamEvent {
  ts: number;
  type: string;
  data: unknown;
}

const STREAM_EVENT_TYPES = new Set<string>([
  "assistant.turn_start",
  "assistant.intent",
  "assistant.reasoning",
  "assistant.reasoning_delta",
  "assistant.message_delta",
  "assistant.message",
  "assistant.turn_end",
  "tool.execution_start",
  "tool.execution_progress",
  "tool.execution_partial_result",
  "tool.execution_complete",
  "session.error",
  "session.warning",
]);

const MAX_TASK_EVENTS = 1000;
const taskEventBuffers = new Map<string, TaskStreamEvent[]>();
const taskEventEmitter = new EventEmitter();
taskEventEmitter.setMaxListeners(0);

function recordTaskEvent(taskId: string, ev: TaskStreamEvent): void {
  let buf = taskEventBuffers.get(taskId);
  if (!buf) {
    buf = [];
    taskEventBuffers.set(taskId, buf);
  }
  buf.push(ev);
  if (buf.length > MAX_TASK_EVENTS) buf.splice(0, buf.length - MAX_TASK_EVENTS);
  taskEventEmitter.emit(taskId, ev);
}

export function getTaskEvents(taskId: string): TaskStreamEvent[] {
  return taskEventBuffers.get(taskId) ?? [];
}

export function subscribeToTaskEvents(
  taskId: string,
  listener: (ev: TaskStreamEvent) => void,
): () => void {
  taskEventEmitter.on(taskId, listener);
  return () => taskEventEmitter.off(taskId, listener);
}

export async function delegateToAgent(
  squadSlug: string,
  task: string,
  onComplete: (taskId: string, result: string) => void,
  targetAgent?: string,
): Promise<string> {
  const squad = getSquad(squadSlug);
  if (!squad) {
    throw new Error(`Squad not found: ${squadSlug}`);
  }

  // Determine which agent session to use
  let agent: SquadAgent | undefined;
  if (targetAgent) {
    agent = getSquadAgent(squadSlug, targetAgent);
    if (!agent) {
      throw new Error(
        `Agent "${targetAgent}" not found in squad "${squadSlug}". Use squad_agents to list the roster.`,
      );
    }
  } else {
    // Prefer the designated team lead if one exists; otherwise fall back to
    // the first idle agent (or just the first agent on the roster).
    const lead = getSquadLead(squadSlug);
    if (lead) {
      agent = lead;
    } else {
      const agents = listSquadAgents(squadSlug);
      if (agents.length > 0) {
        agent = agents.find((a) => a.status === "idle") ?? agents[0];
      }
    }
  }

  const session = agent
    ? await getOrCreateAgentSession(squadSlug, agent, task)
    : await getOrCreateSession(squadSlug, task);

  const taskId = randomUUID();
  const agentKey = agent
    ? agentSessionKey(squadSlug, agent.character_name)
    : squadSlug;

  createTask(taskId, agentKey, task);
  updateSquadStatus(squadSlug, "working");
  if (agent) updateAgentStatus(squadSlug, agent.character_name, "working");

  // Subscribe to the agent session's events for the duration of this task so
  // the web UI can preview the agent's "thread of consciousness" live.
  recordTaskEvent(taskId, {
    ts: Date.now(),
    type: "task.start",
    data: { taskId, agentKey, description: task },
  });
  const unsubscribe = session.on((event: SessionEvent) => {
    if (!STREAM_EVENT_TYPES.has(event.type)) return;
    recordTaskEvent(taskId, {
      ts: Date.now(),
      type: event.type,
      data: (event as { data?: unknown }).data ?? null,
    });
  });

  // Run the task in the background — return taskId immediately
  void (async () => {
    try {
      const response = await session.sendAndWait({ prompt: task }, 600_000);
      const result = response?.data?.content ?? "Task completed (no output)";
      completeTask(taskId, result);
      updateSquadStatus(squadSlug, "idle");
      if (agent) updateAgentStatus(squadSlug, agent.character_name, "idle");
      recordTaskEvent(taskId, { ts: Date.now(), type: "task.done", data: { result } });
      try {
        await runPeerReview(
          squadSlug,
          agent?.character_name ?? "",
          taskId,
          task,
          result,
        );
      } catch (reviewErr) {
        console.error(
          "[io] Peer review error:",
          reviewErr instanceof Error ? reviewErr.message : reviewErr,
        );
        recordTaskEvent(taskId, {
          ts: Date.now(),
          type: "task.review_error",
          data: {
            error:
              reviewErr instanceof Error ? reviewErr.message : String(reviewErr),
          },
        });
      }
      onComplete(taskId, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failTask(taskId, message);
      updateSquadStatus(squadSlug, "error");
      if (agent) updateAgentStatus(squadSlug, agent.character_name, "error");
      recordTaskEvent(taskId, { ts: Date.now(), type: "task.failed", data: { error: message } });
    } finally {
      try { unsubscribe(); } catch { /* ignore */ }
    }
  })();

  const agentLabel = agent
    ? `${agent.character_name} (${agent.role_title})`
    : `squad "${squadSlug}"`;
  return taskId;
}

export async function shutdownAgents(): Promise<void> {
  for (const [key, session] of agentSessions) {
    try {
      await session.destroy();
    } catch {
      // best-effort cleanup
    }
    agentSessions.delete(key);
    agentSessionModels.delete(key);
  }
}

export function getActiveAgentTasks(): Array<{
  taskId: string;
  agentSlug: string;
  description: string;
  status: string;
}> {
  return getActiveTasks().map((t) => ({
    taskId: t.task_id,
    agentSlug: t.agent_slug,
    description: t.description,
    status: t.status,
  }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create or resume a Copilot session for a specific named agent.
 * Model is selected per-task: uses the higher of the agent's default tier
 * and the task's classified complexity. This means an agent never gets a
 * model worse than their baseline, but can be upgraded for complex tasks.
 */
async function getOrCreateAgentSession(
  squadSlug: string,
  agent: SquadAgent,
  taskDescription?: string,
): Promise<CopilotSession> {
  const key = agentSessionKey(squadSlug, agent.character_name);

  // Determine model based on task complexity vs agent's default tier
  const agentTier = agent.model_tier as Tier;
  const taskTier = taskDescription ? classifyComplexity(taskDescription) : agentTier;
  const tierRank: Record<Tier, number> = { high: 3, medium: 2, low: 1 };
  const effectiveTier = tierRank[taskTier] >= tierRank[agentTier] ? taskTier : agentTier;
  const model = getModelForTier(effectiveTier);

  // If we have a cached session, check if the model matches; if not, destroy and recreate
  const existing = agentSessions.get(key);
  if (existing) {
    // Sessions don't expose their model, so track it separately
    const cachedModel = agentSessionModels.get(key);
    if (cachedModel === model) return existing;

    // Model changed — destroy old session for the upgraded model
    console.error(`[io] Agent ${agent.character_name}: upgrading model ${cachedModel} → ${model} for task complexity`);
    try { await existing.destroy(); } catch { /* best-effort */ }
    agentSessions.delete(key);
    agentSessionModels.delete(key);
  }

  const squad = getSquad(squadSlug)!;
  const client = await getClient();
  const decisions = getDecisionsSummary(squadSlug);

  console.error(`[io] Agent ${agent.character_name}: using model "${model}" (agent tier: ${agentTier}, task tier: ${taskTier}, effective: ${effectiveTier})`);

  const universeName = squad.universe
    ? getUniverse(squad.universe)?.name ?? squad.universe
    : "Unknown";

  const isLead = agent.is_lead === 1;
  const agentTools = buildAgentTools(squadSlug, isLead);

  let leadSection = "";
  if (isLead) {
    const teammates = listSquadAgents(squadSlug).filter(
      (a) => a.character_name !== agent.character_name,
    );
    const roster = teammates.length > 0
      ? teammates
          .map((t) => {
            const charter = t.charter
              ? t.charter.length > 200
                ? t.charter.slice(0, 200) + "…"
                : t.charter
              : "(no charter)";
            return `- **${t.character_name}** — ${t.role_title}: ${charter}`;
          })
          .join("\n")
      : "_(no other agents on this squad yet — ask IO to add some)_";

    leadSection = `

## Team Lead Role
You are the team lead for this squad. When you receive a task, your job is to:
1. Break it down into concrete subtasks
2. Assign each subtask to the most appropriate teammate using the \`delegate_to_teammate\` tool
3. Collect results and synthesize a final summary

## Your Team
${roster}`;
  }

  const systemMessage = `You are ${agent.character_name}, a specialist agent on the "${squad.name}" project team (${universeName} universe).

## Your Identity
- **Name**: ${agent.character_name}
- **Role**: ${agent.role_title}
- **Personality**: ${agent.personality ?? "Professional and focused."}

## Your Charter
${agent.charter ?? "General-purpose agent. Handle tasks as they come."}

## Project
- **Path**: ${squad.project_path}

## Past Decisions
${decisions}${leadSection}

## Instructions
You are a coding agent. Use the shell tool to run commands and file_ops to read/write files.
Log important decisions with squad_log_decision so they persist.
Stay in character — let your personality color your work style and communication, but always deliver quality results.`;

  const commonConfig = {
    model,
    configDir: SESSIONS_DIR,
    streaming: false,
    systemMessage: { content: systemMessage },
    tools: agentTools,
    onPermissionRequest: approveAll,
    infiniteSessions: {
      enabled: true,
      backgroundCompactionThreshold: 0.8,
      bufferExhaustionThreshold: 0.95,
    },
  } as const;

  let session: CopilotSession;

  if (agent.copilot_session_id) {
    try {
      session = await client.resumeSession(agent.copilot_session_id, commonConfig);
    } catch {
      session = await client.createSession(commonConfig);
    }
  } else {
    session = await client.createSession(commonConfig);
  }

  updateAgentSession(squadSlug, agent.character_name, session.sessionId);
  agentSessions.set(key, session);
  agentSessionModels.set(key, model);

  return session;
}

/**
 * Legacy: create a generic squad session (for squads without named agents).
 */

async function getOrCreateSession(
  squadSlug: string,
  taskDescription?: string,
): Promise<CopilotSession> {
  const existing = agentSessions.get(squadSlug);
  if (existing) return existing;

  const squad = getSquad(squadSlug)!;
  const client = await getClient();
  const decisions = getDecisionsSummary(squadSlug);
  const agentTools = buildAgentTools(squadSlug);
  const model = getModelForTask(taskDescription ?? "", squad.model);

  const commonConfig = {
    model,
    configDir: SESSIONS_DIR,
    streaming: false,
    systemMessage: {
      content: `You are a specialist agent working on the "${squad.name}" project at ${squad.project_path}.

## Past Decisions
${decisions}

## Your Role
You are a coding agent. Use the shell tool to run commands and file_ops to read/write files.
Log important decisions with squad_log_decision so they persist.`,
    },
    tools: agentTools,
    onPermissionRequest: approveAll,
    infiniteSessions: {
      enabled: true,
      backgroundCompactionThreshold: 0.8,
      bufferExhaustionThreshold: 0.95,
    },
  } as const;

  let session: CopilotSession;

  // Try to resume an existing session if we have a saved session ID
  if (squad.copilot_session_id) {
    try {
      session = await client.resumeSession(squad.copilot_session_id, commonConfig);
    } catch {
      session = await client.createSession(commonConfig);
    }
  } else {
    session = await client.createSession(commonConfig);
  }
  updateSquadSession(squadSlug, session.sessionId);
  agentSessions.set(squadSlug, session);

  return session;
}

function buildAgentTools(squadSlug: string, isLead = false) {
  const shell = defineTool("shell", {
    description:
      "Run a shell command. Use for git, build tools, file operations, etc.",
    skipPermission: true,
    parameters: z.object({
      command: z.string().describe("The command to run"),
      timeout_secs: z
        .number()
        .optional()
        .describe("Timeout in seconds (default: 60)"),
      working_dir: z
        .string()
        .optional()
        .describe("Working directory for the command"),
    }),
    handler: async ({ command, timeout_secs, working_dir }) => {
      try {
        const result = execSync(command, {
          encoding: "utf-8",
          timeout: (timeout_secs ?? 60) * 1000,
          maxBuffer: 1024 * 1024,
          cwd: working_dir,
          env: { ...process.env, HOME: process.env.HOME || homedir() },
        });
        const output = result.trim();
        if (output.length > 8000) {
          return output.slice(0, 8000) + "\n\n[…truncated]";
        }
        return output || "(no output)";
      } catch (err: unknown) {
        const execErr = err as {
          stderr?: string;
          stdout?: string;
          message?: string;
        };
        const stderr = execErr.stderr?.trim() ?? "";
        const stdout = execErr.stdout?.trim() ?? "";
        const msg = stderr || stdout || execErr.message || "Command failed";
        if (msg.length > 4000) {
          return `Error:\n${msg.slice(0, 4000)}\n[…truncated]`;
        }
        return `Error:\n${msg}`;
      }
    },
  });

  const fileOps = defineTool("file_ops", {
    description: "Read, write, or list files on the local filesystem.",
    skipPermission: true,
    parameters: z.object({
      operation: z
        .enum(["read", "write", "list"])
        .describe("Operation to perform"),
      path: z.string().describe("File or directory path"),
      content: z
        .string()
        .optional()
        .describe("Content to write (for write operation)"),
      recursive: z
        .boolean()
        .optional()
        .describe("Recurse into subdirectories (for list)"),
    }),
    handler: async ({ operation, path: filePath, content, recursive }) => {
      try {
        const resolved = resolve(filePath);

        if (operation === "read") {
          if (!existsSync(resolved)) return `File not found: ${filePath}`;
          const text = readFileSync(resolved, "utf-8");
          if (text.length > 8000) {
            return text.slice(0, 8000) + "\n\n[…truncated]";
          }
          return text;
        }

        if (operation === "write") {
          if (!content)
            return "Error: content is required for write operation";
          mkdirSync(dirname(resolved), { recursive: true });
          writeFileSync(resolved, content, "utf-8");
          return `Written: ${filePath}`;
        }

        if (operation === "list") {
          if (!existsSync(resolved))
            return `Directory not found: ${filePath}`;
          if (recursive) {
            const files = walkDirectory(resolved);
            return files.join("\n") || "(empty directory)";
          }
          const entries = readdirSync(resolved);
          return (
            entries
              .map((e) => {
                const full = join(resolved, e);
                const isDir = statSync(full).isDirectory();
                return isDir ? `${e}/` : e;
              })
              .join("\n") || "(empty directory)"
          );
        }

        return `Unknown operation: ${operation}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  const squadLogDecision = defineTool("squad_log_decision", {
    description:
      "Log an important decision for this squad so it persists across sessions.",
    skipPermission: true,
    parameters: z.object({
      decision: z.string().describe("The decision made"),
      context: z.string().optional().describe("Context or reasoning"),
    }),
    handler: async ({ decision, context }) => {
      try {
        logDecision(squadSlug, decision, context);
        return `Decision logged for squad ${squadSlug}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  const tools: any[] = [shell, fileOps, squadLogDecision];

  if (isLead) {
    const delegateToTeammate = defineTool("delegate_to_teammate", {
      description:
        "Delegate a subtask to a teammate on this squad. The teammate runs the task synchronously and returns its result. Use this to divvy work as the team lead.",
      skipPermission: true,
      parameters: z.object({
        teammate: z
          .string()
          .describe("The teammate's character_name (e.g., 'Optimus Prime')"),
        task: z
          .string()
          .describe("The concrete task or subtask the teammate should perform"),
      }),
      handler: async ({ teammate, task }) => {
        try {
          const teammateAgent = getSquadAgent(squadSlug, teammate);
          if (!teammateAgent) {
            return `Error: teammate "${teammate}" not found in squad "${squadSlug}". Use squad_agents to list the roster.`;
          }
          if (teammateAgent.is_lead === 1) {
            return `Error: "${teammate}" is the team lead. Delegate to a non-lead teammate.`;
          }

          updateAgentStatus(squadSlug, teammateAgent.character_name, "working");
          try {
            const session = await getOrCreateAgentSession(
              squadSlug,
              teammateAgent,
              task,
            );
            const response = await session.sendAndWait({ prompt: task }, 300_000);
            const result =
              response?.data?.content ?? "(teammate returned no output)";
            updateAgentStatus(squadSlug, teammateAgent.character_name, "idle");
            return result;
          } catch (err) {
            updateAgentStatus(squadSlug, teammateAgent.character_name, "error");
            const message = err instanceof Error ? err.message : String(err);
            return `Error from teammate "${teammate}": ${message}`;
          }
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    });
    tools.push(delegateToTeammate);
  }

  return tools;
}

function walkDirectory(dir: string, maxDepth = 3, depth = 0): string[] {
  if (depth >= maxDepth) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(`${entry.name}/`);
      results.push(
        ...walkDirectory(full, maxDepth, depth + 1).map(
          (f) => `  ${entry.name}/${f}`,
        ),
      );
    } else {
      results.push(entry.name);
    }
  }
  return results;
}


/**
 * Run a peer review phase after a task completes. Every other agent on the
 * squad reviews the work and votes APPROVED / REJECTED. QA agents
 * (is_qa === 1) have veto power: if any QA agent rejects, the PR is left as
 * draft. Otherwise, any GitHub PR URL found in the task result is promoted
 * from draft to ready via `gh pr ready`.
 */
async function runPeerReview(
  squadSlug: string,
  originalAgentCharacter: string,
  taskId: string,
  taskDescription: string,
  taskResult: string,
): Promise<void> {
  const reviewers = listSquadAgents(squadSlug).filter(
    (a) => a.character_name !== originalAgentCharacter,
  );

  if (reviewers.length === 0) {
    recordTaskEvent(taskId, {
      ts: Date.now(),
      type: "task.review_complete",
      data: { promoted: false, reason: "No other agents to review" },
    });
    return;
  }

  const reviewPrompt = `You are reviewing the following completed task:

## Task
${taskDescription}

## Work Done
${taskResult}

Review the work. Respond with:
- First line: APPROVED or REJECTED
- Remaining lines: your review comments`;

  const reviews: Array<{
    reviewer: string;
    is_qa: boolean;
    approved: boolean;
    comments: string;
  }> = [];

  for (const reviewer of reviewers) {
    try {
      const session = await getOrCreateAgentSession(
        squadSlug,
        reviewer,
        `Peer review of task ${taskId}`,
      );
      const response = await session.sendAndWait(
        { prompt: reviewPrompt },
        300_000,
      );
      const content = response?.data?.content ?? "";
      const lines = content.split(/\r?\n/);
      const firstLine = (lines[0] ?? "").trim().toUpperCase();
      const approved =
        firstLine.includes("APPROVED") && !firstLine.includes("REJECTED");
      const comments = lines.slice(1).join("\n").trim() || null;

      createReview(
        taskId,
        squadSlug,
        reviewer.character_name,
        approved,
        comments ?? undefined,
      );
      recordTaskEvent(taskId, {
        ts: Date.now(),
        type: "task.review",
        data: {
          reviewer: reviewer.character_name,
          is_qa: reviewer.is_qa === 1,
          approved,
          comments,
        },
      });
      reviews.push({
        reviewer: reviewer.character_name,
        is_qa: reviewer.is_qa === 1,
        approved,
        comments: comments ?? "",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[io] Reviewer ${reviewer.character_name} failed:`,
        message,
      );
      recordTaskEvent(taskId, {
        ts: Date.now(),
        type: "task.review_error",
        data: { reviewer: reviewer.character_name, error: message },
      });
    }
  }

  const qaRejection = reviews.find((r) => r.is_qa && !r.approved);
  const prMatch = taskResult.match(
    /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/,
  );

  if (qaRejection) {
    recordTaskEvent(taskId, {
      ts: Date.now(),
      type: "task.review_complete",
      data: {
        promoted: false,
        reason: `QA veto from ${qaRejection.reviewer}`,
        prUrl: prMatch ? prMatch[0] : null,
      },
    });
    return;
  }

  if (!prMatch) {
    recordTaskEvent(taskId, {
      ts: Date.now(),
      type: "task.review_complete",
      data: { promoted: false, reason: "No PR URL found in task result" },
    });
    return;
  }

  const [prUrl, owner, repo, prNumber] = prMatch;
  try {
    execSync(`gh pr ready ${prNumber} --repo ${owner}/${repo}`, {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, HOME: process.env.HOME || homedir() },
    });
    recordTaskEvent(taskId, {
      ts: Date.now(),
      type: "task.review_complete",
      data: { promoted: true, prUrl },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordTaskEvent(taskId, {
      ts: Date.now(),
      type: "task.review_complete",
      data: { promoted: false, reason: `gh pr ready failed: ${message}`, prUrl },
    });
  }
}


/**
 * Cancel a running agent task by aborting its session and marking the task
 * cancelled. Returns true if the task existed and was running.
 */
export async function cancelAgentTask(taskId: string): Promise<boolean> {
  const task = getTask(taskId);
  if (!task || task.status !== "running") return false;

  const sessionKey = task.agent_slug;
  const session = agentSessions.get(sessionKey);
  if (session) {
    try {
      await session.abort();
    } catch (err) {
      console.error("[io] Error aborting agent session:", err instanceof Error ? err.message : err);
    }
  }

  cancelTask(taskId);
  recordTaskEvent(taskId, { ts: Date.now(), type: "task.cancelled", data: { reason: "Cancelled by user" } });

  // sessionKey is "squadSlug" or "squadSlug:characterName"
  const [squadSlug, characterName] = sessionKey.split(":");
  if (squadSlug) {
    try { updateSquadStatus(squadSlug, "idle"); } catch { /* ignore */ }
  }
  if (squadSlug && characterName) {
    try { updateAgentStatus(squadSlug, characterName, "idle"); } catch { /* ignore */ }
  }

  return true;
}
