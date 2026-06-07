import {
	getCheapestAvailableModel,
	getCheapestInTier,
	getModelPricing,
	getNextTierUp,
} from "../models/registry.js";
import type { ModelTier } from "../models/types.js";

/** Keywords that suggest higher complexity tiers */
const TIER_KEYWORDS: Record<ModelTier, RegExp[]> = {
	ultra: [/system[- ]wide/i, /redesign/i, /infrastructure/i, /cross[- ]cutting/i, /migration/i],
	premium: [/architect/i, /security/i, /performance/i, /complex refactor/i, /optimization/i],
	standard: [/implement/i, /feature/i, /multi[- ]file/i, /refactor/i, /integration/i],
	fast: [/fix/i, /bug/i, /update/i, /documentation/i, /single[- ]file/i, /small/i],
	trivial: [/typo/i, /rename/i, /comment/i, /config/i, /format/i],
};

/**
 * Classify task complexity using keyword heuristics (no LLM call needed).
 * Checks from highest tier down; defaults to "standard".
 */
function classifyTaskComplexity(taskDescription: string): ModelTier {
	const tiers: ModelTier[] = ["ultra", "premium", "standard", "fast", "trivial"];
	for (const tier of tiers) {
		if (TIER_KEYWORDS[tier].some((pattern) => pattern.test(taskDescription))) {
			return tier;
		}
	}
	return "standard";
}

/**
 * Select a model for a task based on complexity classification.
 * Throws if no models are available in the pricing database.
 */
export async function selectModelForTask(taskDescription: string): Promise<string> {
	const classifierModel = await getCheapestAvailableModel();
	if (!classifierModel) {
		throw new Error("No models available in pricing database");
	}

	const tier = classifyTaskComplexity(taskDescription);

	// Pick cheapest model in the classified tier
	const selectedModel = await getCheapestInTier(tier);
	if (selectedModel) {
		return selectedModel.id;
	}

	// Escalate one tier up if nothing available in the classified tier
	const nextTier = getNextTierUp(tier);
	if (nextTier) {
		const escalatedModel = await getCheapestInTier(nextTier);
		if (escalatedModel) {
			return escalatedModel.id;
		}
	}

	return classifierModel.id;
}

/**
 * Select a model for a task with automatic retry on failure.
 * If the selected model fails during use, call this with escalate=true
 * to get the next tier up.
 */
export async function selectModelWithEscalation(
	taskDescription: string,
	failedModel?: string,
): Promise<string> {
	if (!failedModel) {
		return selectModelForTask(taskDescription);
	}

	// Find the failed model's tier and escalate
	const failedPricing = await getModelPricing(failedModel);
	if (!failedPricing) {
		return selectModelForTask(taskDescription);
	}

	const nextTier = getNextTierUp(failedPricing.tier);
	if (!nextTier) {
		const cheapest = await getCheapestAvailableModel();
		if (!cheapest) throw new Error("No models available in pricing database");
		return cheapest.id;
	}

	const escalatedModel = await getCheapestInTier(nextTier);
	if (escalatedModel) return escalatedModel.id;

	const cheapest = await getCheapestAvailableModel();
	if (!cheapest) throw new Error("No models available in pricing database");
	return cheapest.id;
}
