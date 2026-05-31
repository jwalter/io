import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Router } from 'express';
import { getHealthStatus } from '../../copilot/health-monitor.js';

function getAppVersion(): string {
	try {
		const require = createRequire(import.meta.url);
		const pkg = require('../../../package.json') as { version?: string };
		return pkg.version ?? '0.0.0';
	} catch {
		try {
			// Fallback: try root package.json (monorepo dev)
			const require = createRequire(import.meta.url);
			const pkg = require('../../../../../package.json') as { version?: string };
			return pkg.version ?? '0.0.0';
		} catch {
			return '0.0.0';
		}
	}
}

export function healthRouter(): Router {
	const router = Router();

	router.get('/health', (_req, res) => {
		const health = getHealthStatus();
		res.json({
			status: health.status,
			uptime: health.uptime,
			copilotConnected: health.copilotConnected,
			lastCheck: health.lastCheck.toISOString(),
		});
	});

	router.get('/version', (_req, res) => {
		res.json({ version: getAppVersion() });
	});

	return router;
}
