import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Express middleware that validates Supabase JWT tokens.
 * If auth is not configured (no supabaseUrl), all requests pass through.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Auth not configured — pass through
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const token = bearerToken ?? queryToken;

  if (!token) {
    res.status(401).json({ error: "Missing or invalid authorization" });
    return;
  }

  // Verify token by calling Supabase's /auth/v1/user endpoint
  fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: config.supabaseAnonKey,
    },
  })
    .then(async (resp) => {
      if (!resp.ok) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }

      const user = (await resp.json()) as { email?: string };

      // Check authorized email if configured
      if (config.authorizedEmail && user.email !== config.authorizedEmail) {
        res.status(403).json({ error: "Unauthorized user" });
        return;
      }

      next();
    })
    .catch(() => {
      res.status(500).json({ error: "Auth verification failed" });
    });
}
