import { readFileSync } from 'node:fs';
import { Router } from 'express';
import { getHealthStatus } from '../../copilot/health-monitor.js';

function getAppVersion(): string {
	const packageJsonPath = new URL('../../../../../package.json', import.meta.url);
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
	return packageJson.version ?? '0.0.0';
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
