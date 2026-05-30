import { createRequire } from 'node:module';
import pino from 'pino';
import type { IOConfig } from '../config.js';

let rootLogger: pino.Logger;

function hasPinoPretty(): boolean {
	try {
		const require = createRequire(import.meta.url);
		require.resolve('pino-pretty');
		return true;
	} catch {
		return false;
	}
}

export function initLogger(config: IOConfig): pino.Logger {
	const usePretty = process.env.NODE_ENV !== 'production' && hasPinoPretty();
	rootLogger = pino({
		level: config.logLevel,
		transport: usePretty
			? { target: 'pino-pretty', options: { colorize: true } }
			: undefined,
	});
	return rootLogger;
}

export function getLogger(): pino.Logger {
	if (!rootLogger) {
		throw new Error('Logger not initialized. Call initLogger() first.');
	}
	return rootLogger;
}

export function createChildLogger(name: string, meta?: Record<string, unknown>): pino.Logger {
	return getLogger().child({ component: name, ...meta });
}
