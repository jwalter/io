import { randomUUID } from "crypto";
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
import type { CopilotSession } from "@github/copilot-sdk";
import { z } from "zod";

import { getClient } from "./client.js";
import { getModelForTask } from "./model-router.js";
import {
  getSquad,
  updateSquadSession,
  updateSquadStatus,
  getDecisionsSummary,
  logDecision,
} from "../store/squads.js";
import {
  createTask,
  completeTask,
  failTask,
  getActiveTasks,
  getTask,
} from "../store/tasks.js";
import { SESSIONS_DIR } from "../paths.js";

export interface AgentInfo {
  slug: string;
  name: string;
  status: "idle" | "working" | "error";
  currentTask?: string;
}

const agentSessions = new Map<string, CopilotSession>();

export function getAgentInfo(): AgentInfo[] {
  const activeTasks = getActiveTasks();
  const tasksByAgent = new Map<string, string>();
  for (const task of activeTasks) {
    tasksByAgent.set(task.agent_slug, task.description);
  }

  const agents: AgentInfo[] = [];
  for (const [slug, _session] of agentSessions) {
    const squad = getSquad(slug);
    const currentTask = tasksByAgent.get(slug);
    let status: AgentInfo["status"] = "idle";
    if (currentTask) {
      status = "working";
    }
    if (squad?.status === "error") {
      status = "error";
    }
    agents.push({
      slug,
      name: squad?.name ?? slug,
      status,
      currentTask,
    });
  }

  return agents;
}

export async function delegateToAgent(
  squadSlug: string,
  task: string,
  onComplete: (taskId: string, result: string) => void,
): Promise<string> {
  const squad = getSquad(squadSlug);
  if (!squad) {
    throw new Error(`Squad not found: ${squadSlug}`);
  }

  const session = await getOrCreateSession(squadSlug, task);
  const taskId = randomUUID();

  createTask(taskId, squadSlug, task);
  updateSquadStatus(squadSlug, "working");

  // Run the task in the background — return taskId immediately
  void (async () => {
    try {
      const response = await session.sendAndWait({ prompt: task }, 600_000);
      const result = response?.data?.content ?? "Task completed (no output)";
      completeTask(taskId, result);
      updateSquadStatus(squadSlug, "idle");
      onComplete(taskId, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failTask(taskId, message);
      updateSquadStatus(squadSlug, "error");
    }
  })();

  return taskId;
}

export async function shutdownAgents(): Promise<void> {
  for (const [slug, session] of agentSessions) {
    try {
      await session.destroy();
    } catch {
      // best-effort cleanup
    }
    agentSessions.delete(slug);
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

function buildAgentTools(squadSlug: string) {
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

  return [shell, fileOps, squadLogDecision];
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
