import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { IOConfig } from '../../config.js';
import { createChildLogger } from '../../logging/logger.js';

const logger = () => createChildLogger('auth');

// Routes that don't require authentication (paths relative to /api mount)
const EXEMPT_ROUTES: Array<{ method: string; path: string }> = [
	{ method: 'GET', path: '/health' },
	{ method: 'GET', path: '/config' },
	{ method: 'GET', path: '/version' },
];

function isExempt(method: string, path: string): boolean {
	return EXEMPT_ROUTES.some((r) => r.method === method.toUpperCase() && path.startsWith(r.path));
}

// Cached JWKS fetcher
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(projectUrl: string): ReturnType<typeof createRemoteJWKSet> {
	if (!jwks) {
		const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', projectUrl);
		jwks = createRemoteJWKSet(jwksUrl);
	}
	return jwks;
}

/**
 * Verify a Supabase JWT token using multiple strategies:
 * 1. JWKS (asymmetric RS256/ES256) if projectUrl is available
 * 2. Shared secret (HS256) if jwtSecret is available
 * 3. Supabase Auth server introspection as final fallback
 */
async function verifyToken(config: IOConfig, token: string): Promise<boolean> {
	const errors: string[] = [];

	// Strategy 1: Try JWKS verification (asymmetric signing)
	if (config.supabase.projectUrl) {
		try {
			const keySet = getJwks(config.supabase.projectUrl);
			await jwtVerify(token, keySet, { clockTolerance: 30 });
			return true;
		} catch (err) {
			errors.push(`JWKS: ${err instanceof Error ? err.message : 'unknown'}`);
		}
	}

	// Strategy 2: Try shared secret (HS256)
	if (config.supabase.jwtSecret) {
		try {
			const secret = new TextEncoder().encode(config.supabase.jwtSecret);
			await jwtVerify(token, secret, { clockTolerance: 30 });
			return true;
		} catch (err) {
			errors.push(`HS256: ${err instanceof Error ? err.message : 'unknown'}`);
		}
	}

	// Strategy 3: Verify via Supabase Auth server (introspection)
	if (config.supabase.projectUrl && config.supabase.anonKey) {
		try {
			const res = await fetch(`${config.supabase.projectUrl}/auth/v1/user`, {
				headers: {
					apikey: config.supabase.anonKey,
					Authorization: `Bearer ${token}`,
				},
			});
			if (res.ok) {
				return true;
			}
			errors.push(`Auth server: HTTP ${res.status}`);
		} catch (err) {
			errors.push(`Auth server: ${err instanceof Error ? err.message : 'unknown'}`);
		}
	}

	logger().debug({ strategies: errors.join('; ') }, 'All JWT verification strategies failed');
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
			.then((valid) => {
				if (valid) {
					next();
				} else {
					res.status(401).json({ error: 'Invalid or expired token' });
				}
			})
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
