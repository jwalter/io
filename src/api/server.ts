import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express, { type Request, type Response } from "express";
import { config } from "../config.js";
import { listSkills } from "../copilot/skills.js";
import { listSquads, createSquad, listSquadAgents } from "../store/squads.js";
import { getAgentInfo, cancelAgentTask, getTaskEvents, subscribeToTaskEvents } from "../copilot/agents.js";
import { abortOrchestrator } from "../copilot/orchestrator.js";
import { getActiveTasks, getTask, listRecentTasks } from "../store/tasks.js";
import { IO_VERSION } from "../paths.js";
import { requireAuth } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, "../../web-dist");

export type ApiMessageHandler = (
  text: string,
  connectionId: string,
  callback: (text: string, done: boolean) => void,
) => Promise<void>;

let messageHandler: ApiMessageHandler | undefined;

const sseConnections = new Set<Response>();

export function setMessageHandler(handler: ApiMessageHandler): void {
  messageHandler = handler;
}

export function broadcastToSSE(text: string): void {
  const payload = JSON.stringify({ type: "delta", text });
  for (const res of sseConnections) {
    res.write(`data: ${payload}\n\n`);
  }
}

export async function startApiServer(): Promise<void> {
  const app = express();

  app.use(express.json());

  app.use((_req: Request, res: Response, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  // Build API router
  const api = express.Router();

  // Public endpoints (no auth required)
  api.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  api.get("/auth/config", (_req: Request, res: Response) => {
    const authEnabled = !!(config.supabaseUrl && config.supabaseAnonKey);
    res.json({
      authEnabled,
      supabaseUrl: config.supabaseUrl ?? null,
      supabaseAnonKey: config.supabaseAnonKey ?? null,
    });
  });

  // Apply auth middleware to all subsequent routes
  api.use(requireAuth);

  api.get("/status", (_req: Request, res: Response) => {
    res.json({ version: IO_VERSION, uptime: process.uptime() });
  });

  // Skills endpoints
  api.get("/skills", (_req: Request, res: Response) => {
    try {
      const skills = listSkills();
      res.json({ skills });
    } catch (e) {
      console.error("Error listing skills:", e);
      res.status(500).json({ error: "Failed to list skills" });
    }
  });

  // Squads endpoints
  api.get("/squads", (_req: Request, res: Response) => {
    try {
      const squads = listSquads();
      res.json({ squads });
    } catch (e) {
      console.error("Error listing squads:", e);
      res.status(500).json({ error: "Failed to list squads" });
    }
  });

  api.post("/squads", (req: Request, res: Response) => {
    try {
      const { slug, name, projectPath } = req.body as {
        slug?: string;
        name?: string;
        projectPath?: string;
      };

      if (!slug || !name || !projectPath) {
        res.status(400).json({ error: "Missing required fields: slug, name, projectPath" });
        return;
      }

      const squad = createSquad(slug, name, projectPath);
      res.json({ squad });
    } catch (e) {
      console.error("Error creating squad:", e);
      res.status(500).json({ error: "Failed to create squad" });
    }
  });

  api.get("/squads/:slug/agents", (req: Request, res: Response) => {
    try {
      const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
      const agents = listSquadAgents(slug);
      const activeTasks = getActiveTasks();
      const taskByKey = new Map<string, { task_id: string; description: string }>();
      for (const t of activeTasks) {
        taskByKey.set(t.agent_slug, { task_id: t.task_id, description: t.description });
      }
      const enriched = agents.map((a) => {
        const key = `${slug}:${a.character_name}`;
        const task = taskByKey.get(key) ?? taskByKey.get(slug);
        return {
          ...a,
          currentTaskId: task?.task_id ?? null,
          currentTask: task?.description ?? null,
        };
      });
      res.json({ agents: enriched });
    } catch (e) {
      console.error("Error listing squad agents:", e);
      res.status(500).json({ error: "Failed to list squad agents" });
    }
  });

  // Agents endpoints
  api.get("/agents", (_req: Request, res: Response) => {
    try {
      const agents = getAgentInfo();
      res.json({ agents });
    } catch (e) {
      console.error("Error listing agents:", e);
      res.status(500).json({ error: "Failed to list agents" });
    }
  });

  // Task history endpoints
  api.get("/tasks", (req: Request, res: Response) => {
    try {
      const limitRaw = req.query.limit;
      const parsed = typeof limitRaw === "string" ? parseInt(limitRaw, 10) : NaN;
      const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
      const tasks = listRecentTasks(limit);
      res.json({ tasks });
    } catch (e) {
      console.error("Error listing tasks:", e);
      res.status(500).json({ error: "Failed to list tasks" });
    }
  });

  api.get("/tasks/:taskId", (req: Request, res: Response) => {
    try {
      const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
      const task = getTask(taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      res.json({ task });
    } catch (e) {
      console.error("Error fetching task:", e);
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  api.get("/tasks/:taskId/events", (req: Request, res: Response) => {
    const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (ev: { ts: number; type: string; data: unknown }) => {
      try {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {
        // client likely disconnected; cleanup happens on req.close
      }
    };

    // Replay buffered events first so a late subscriber sees the full thread
    for (const ev of getTaskEvents(taskId)) send(ev);

    // Subscribe to live events
    const unsubscribe = subscribeToTaskEvents(taskId, send);

    // Heartbeat to keep proxies / browsers from closing the connection
    const heartbeat = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* ignore */ }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Stop / cancel endpoints
  api.post("/orchestrator/abort", async (_req: Request, res: Response) => {
    try {
      const aborted = await abortOrchestrator();
      res.json({ aborted });
    } catch (e) {
      console.error("Error aborting orchestrator:", e);
      res.status(500).json({ error: "Failed to abort orchestrator" });
    }
  });

  api.post("/tasks/:taskId/cancel", async (req: Request, res: Response) => {
    try {
      const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
      const cancelled = await cancelAgentTask(taskId);
      if (!cancelled) {
        res.status(404).json({ error: "Task not found or not running" });
        return;
      }
      res.json({ cancelled: true });
    } catch (e) {
      console.error("Error cancelling task:", e);
      res.status(500).json({ error: "Failed to cancel task" });
    }
  });

  // Chat endpoints
  api.post("/message", async (req: Request, res: Response) => {
    const { text } = req.body as { text?: string };

    if (!text) {
      res.status(400).json({ error: "Missing 'text' in request body" });
      return;
    }

    if (!messageHandler) {
      res.status(503).json({ error: "No message handler registered" });
      return;
    }

    const connectionId = crypto.randomUUID();
    let fullResponse = "";

    await messageHandler(text, connectionId, (chunk, done) => {
      fullResponse += chunk;

      const ssePayload = JSON.stringify({
        type: done ? "done" : "delta",
        text: chunk,
      });
      for (const conn of sseConnections) {
        conn.write(`data: ${ssePayload}\n\n`);
      }
    });

    res.json({ response: fullResponse });
  });

  api.get("/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    sseConnections.add(res);

    req.on("close", () => {
      sseConnections.delete(res);
    });
  });

  // Mount API at /api (for frontend)
  app.use("/api", api);

  // Serve Vue frontend if built assets exist (before backward-compat API mount)
  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    console.log("[io] Web frontend enabled");
  }

  // SPA fallback for browser navigation: when the web frontend is built,
  // serve index.html for any GET request that accepts HTML and isn't an API
  // call. This lets vue-router handle client-side routes like /chat, /skills,
  // /squads, etc. on direct URL access and page refresh. Programmatic clients
  // (curl, fetch without Accept: text/html) fall through to the backward-compat
  // API mount below.
  if (existsSync(WEB_DIST)) {
    app.get(/.*/, (req: Request, res: Response, next) => {
      if (req.path.startsWith("/api/")) return next();
      const accept = req.headers.accept ?? "";
      if (!accept.includes("text/html")) return next();
      res.sendFile(path.join(WEB_DIST, "index.html"));
    });
  }

  // Backward-compat: mount API at / for non-browser clients (after static files
  // and SPA fallback so frontend routes are not intercepted).
  app.use("/", api);

  return new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      console.log(`[io] Server listening on port ${config.port}`);
      resolve();
    });
  });
}
