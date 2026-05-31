import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { IOConfig } from '../../config.js';
import { createChildLogger } from '../../logging/logger.js';

const logger = () => createChildLogger('auth');

// Accepted algorithms for symmetric (HMAC) JWT verification
const ALLOWED_ALGORITHMS: jwt.Algorithm[] = ['HS256', 'HS384', 'HS512'];

// Routes that don't require authentication (paths relative to /api mount)
const EXEMPT_ROUTES: Array<{ method: string; path: string }> = [
	{ method: 'GET', path: '/health' },
	{ method: 'GET', path: '/config' },
];

function isExempt(method: string, path: string): boolean {
	return EXEMPT_ROUTES.some((r) => r.method === method.toUpperCase() && path.startsWith(r.path));
}

/**
 * Express middleware that verifies Supabase JWT tokens.
 * If Supabase is not configured (no jwtSecret), all requests pass through.
 * Exempt routes always pass through regardless of config.
 */
export function authMiddleware(config: IOConfig) {
	return (req: Request, res: Response, next: NextFunction): void => {
		// If no Supabase JWT secret configured, skip auth entirely (local-only mode)
		if (!config.supabase.jwtSecret) {
			next();
			return;
		}

		// Exempt routes don't require auth
		if (isExempt(req.method, req.path)) {
			next();
			return;
		}

		const authHeader = req.headers.authorization;
		if (!authHeader?.startsWith('Bearer ')) {
			res.status(401).json({ error: 'Missing or invalid Authorization header' });
			return;
		}

		const token = authHeader.slice(7);

		try {
			jwt.verify(token, config.supabase.jwtSecret, {
				algorithms: ALLOWED_ALGORITHMS,
				clockTolerance: 30,
			});
			next();
		} catch (err) {
			const errMessage = err instanceof Error ? err.message : 'Unknown error';
			logger().warn({ err: errMessage }, 'JWT verification failed');
			res.status(401).json({ error: 'Invalid or expired token' });
		}
	};
}

/**
 * Verify a JWT token for WebSocket connections.
 * Returns true if valid or if auth is not configured.
 */
export function verifyWsToken(config: IOConfig, token: string | null): boolean {
	if (!config.supabase.jwtSecret) {
		return true; // No auth configured — allow
	}

	if (!token) {
		return false;
	}

	try {
		jwt.verify(token, config.supabase.jwtSecret, {
			algorithms: ALLOWED_ALGORITHMS,
			clockTolerance: 30,
		});
		return true;
	} catch {
		return false;
	}
}
