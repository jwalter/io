import type { AutonomyConfig } from './types/squads.js';

/**
 * Squad color palette — complementary to the dark UI with pink (#E43A9C) accent.
 * Each squad gets a unique color from this list at creation time.
 */
export const SQUAD_COLORS = [
	'#38bdf8', // sky blue
	'#a78bfa', // violet
	'#34d399', // emerald
	'#f59e0b', // amber
	'#f87171', // red
	'#06b6d4', // cyan
	'#fb923c', // orange
	'#4ade80', // green
	'#c084fc', // purple
	'#facc15', // yellow
] as const;

export const AUTONOMY_TIERS: Record<string, AutonomyConfig> = {
	low: {
		canMergePrs: false,
		canCreateReleases: false,
		canCloseIssues: false,
		canSelfReview: false,
		requiresUserApprovalFor: ['merge', 'release', 'close', 'review'],
	},
	medium: {
		canMergePrs: false,
		canCreateReleases: false,
		canCloseIssues: true,
		canSelfReview: true,
		requiresUserApprovalFor: ['merge', 'release'],
	},
	high: {
		canMergePrs: true,
		canCreateReleases: true,
		canCloseIssues: true,
		canSelfReview: true,
		requiresUserApprovalFor: [],
	},
};

export const DEFAULT_CONFIG = {
	apiPort: 7777,
	logLevel: 'info' as const,
	defaultModel: 'claude-opus-4.6',
	maxInstancesPerSquad: 3,
	dataDir: '~/.io',
	timezone: 'UTC',
	pricing: {
		refreshIntervalHours: 24,
	},
};
