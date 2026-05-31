import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { IOConfig } from '../../config.js';
import { createChildLogger } from '../../logging/logger.js';

const logger = () => createChildLogger('auth');

// Routes that don't require authentication (paths relative to /api mount)
const EXEMPT_ROUTES: Array<{ method: string; path: string }> = [
	{ method: 'GET', path: '/health' },
	{ method: 'GET', path: '/config' },
];

function isExempt(method: string, path: string): boolean {
	return EXEMPT_ROUTES.some((r) => r.method === method.toUpperCase() && path.startsWith(r.path));
}

// Cached JWKS fetcher
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(config: IOConfig): ReturnType<typeof createRemoteJWKSet> {
	if (!jwks) {
		const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', config.supabase.projectUrl!);
		jwks = createRemoteJWKSet(jwksUrl);
	}
	return jwks;
}

/**
 * Verify a Supabase JWT token.
 * Tries jwtSecret first (HS256 — most common Supabase setup),
 * then falls back to JWKS (RS256) for projects using asymmetric signing.
 */
async function verifyToken(config: IOConfig, token: string): Promise<boolean> {
	// Try shared secret first (HS256 — default Supabase signing)
	if (config.supabase.jwtSecret) {
		const secret = new TextEncoder().encode(config.supabase.jwtSecret);
		await jwtVerify(token, secret, {
			algorithms: ['HS256', 'HS384', 'HS512'],
			clockTolerance: 30,
		});
		return true;
	}

	// Fall back to JWKS (RS256) for asymmetric signing
	if (config.supabase.projectUrl) {
		const keySet = getJwks(config);
		await jwtVerify(token, keySet, { clockTolerance: 30 });
		return true;
	}

	return false;
}

/**
 * Express middleware that verifies Supabase JWT tokens.
 * If Supabase is not configured, all requests pass through.
 * Exempt routes always pass through regardless of config.
 */
export function authMiddleware(config: IOConfig) {
	return (req: Request, res: Response, next: NextFunction): void => {
		// If no Supabase configured, skip auth entirely (local-only mode)
		if (!config.supabase.projectUrl && !config.supabase.jwtSecret) {
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

		verifyToken(config, token)
			.then(() => next())
			.catch((err) => {
				const errMessage = err instanceof Error ? err.message : 'Unknown error';
				logger().warn({ err: errMessage }, 'JWT verification failed');
				res.status(401).json({ error: 'Invalid or expired token' });
			});
	};
}

/**
 * Verify a JWT token for WebSocket connections.
 * Returns true if valid or if auth is not configured.
 */
export async function verifyWsToken(config: IOConfig, token: string | null): Promise<boolean> {
	if (!config.supabase.projectUrl && !config.supabase.jwtSecret) {
		return true; // No auth configured — allow
	}

	if (!token) {
		return false;
	}

	try {
		return await verifyToken(config, token);
	} catch {
		return false;
	}
}
