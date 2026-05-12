import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express, { type Request, type Response } from "express";
import { config } from "../config.js";
import { listSkills } from "../copilot/skills.js";
import { listSquads, createSquad } from "../store/squads.js";
import { getAgentInfo } from "../copilot/agents.js";
import { IO_VERSION } from "../paths.js";

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

  api.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

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

  // Mount API at /api (for frontend) and / (backward compat)
  app.use("/api", api);
  app.use("/", api);

  // Serve Vue frontend if built assets exist
  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    // SPA fallback — serve index.html for any non-API route
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(WEB_DIST, "index.html"));
    });
    console.log("[io] Web frontend enabled");
  }

  return new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      console.log(`[io] Server listening on port ${config.port}`);
      resolve();
    });
  });
}
