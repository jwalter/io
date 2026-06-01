/**
 * Model selection logic for squad agents.
 *
 * Strategy:
 * - Fixed roles (scribe, technical-pm) have predetermined tiers
 * - Dynamic roles get their tier from the team lead's task assignment
 * - On retry after failed review, tier automatically escalates
 */

import { type ModelTier, DEFAULT_MODELS } from '../models/registry.js';

export type { ModelTier } from '../models/registry.js';

/**
 * Tier escalation order: fast → standard → reasoning
 */
const TIER_ORDER: ModelTier[] = ['fast', 'standard', 'reasoning'];

/**
 * Select model for a fixed-role agent based on their role and current phase.
 */
export function selectModelForRole(
	role: string,
	phase: 'meeting' | 'task' | 'review',
): string {
	const normalizedRole = role.toLowerCase().replace(/[\s_-]+/g, '');

	// Scribe always uses fast tier
	if (normalizedRole === 'scribe') {
		return DEFAULT_MODELS.fast;
	}

	// Technical PM: standard for meetings/tasks, reasoning for final review
	if (normalizedRole === 'technicalpm' || normalizedRole === 'teamlead') {
		return phase === 'review' ? DEFAULT_MODELS.reasoning : DEFAULT_MODELS.standard;
	}

	// All other roles default to standard during meetings
	if (phase === 'meeting') {
		return DEFAULT_MODELS.standard;
	}

	// For task execution, return standard as default (team lead can override)
	return DEFAULT_MODELS.standard;
}

/**
 * Select model for task execution based on team-lead-assigned tier and retry count.
 * Each retry bumps the tier up one level (fast→standard→reasoning).
 */
export function selectModelForTask(
	tierHint: ModelTier | undefined,
	retryCount: number,
): string {
	const baseTier = tierHint ?? 'standard';
	const escalatedTier = tierForRetry(baseTier, retryCount);
	return DEFAULT_MODELS[escalatedTier];
}

/**
 * Escalate tier based on retry count.
 * Each retry bumps up one tier. Max is 'reasoning'.
 */
export function tierForRetry(baseTier: ModelTier, retries: number): ModelTier {
	const baseIndex = TIER_ORDER.indexOf(baseTier);
	const escalatedIndex = Math.min(baseIndex + retries, TIER_ORDER.length - 1);
	return TIER_ORDER[escalatedIndex] as ModelTier;
}

/**
 * Parse a MODEL_TIER string into a validated ModelTier value.
 */
export function parseTierHint(hint: string | undefined): ModelTier | undefined {
	if (!hint) return undefined;
	const normalized = hint.toLowerCase().trim();
	if (normalized === 'fast' || normalized === 'standard' || normalized === 'reasoning') {
		return normalized;
	}
	return undefined;
}
