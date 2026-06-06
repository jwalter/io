import { DEFAULT_MODEL } from "@io/shared";

import { CopilotClient, approveAll } from "@github/copilot-sdk";
import { getCheapestAvailableModel, getCheapestInTier, getNextTierUp } from "../models/registry.js";
import type { ModelTier } from "../models/types.js";

const VALID_TIERS: ModelTier[] = ["trivial", "fast", "standard", "premium", "ultra"];

const CLASSIFICATION_PROMPT = `You are a task complexity classifier. Given a task description, classify its complexity into exactly one tier.

Tiers (from simplest to most complex):
- trivial: Typos, renames, comment changes, config tweaks, formatting
- fast: Simple bug fixes, small features, documentation updates, single-file changes
- standard: Feature implementation, multi-file changes, moderate refactoring
- premium: Architecture changes, complex refactoring, security work, performance optimization
- ultra: System-wide redesigns, critical infrastructure, cross-cutting concerns

Reply with ONLY the tier name (one word, lowercase). Nothing else.`;

/**
 * Use an LLM call to classify task complexity and select the cheapest capable model.
 * Falls back to DEFAULT_MODEL if classification or model lookup fails.
 */
export async function selectModelForTask(taskDescription: string): Promise<string> {
	const classifierModel = await getCheapestAvailableModel();
	if (!classifierModel) {
		return DEFAULT_MODEL;
	}

	let tier: ModelTier;
	try {
		tier = await classifyTaskComplexity(taskDescription, classifierModel.id);
	} catch {
		return DEFAULT_MODEL;
	}

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

	return DEFAULT_MODEL;
}

/**
 * Send the task description to the cheapest model for complexity classification.
 * Returns the classified tier.
 */
async function classifyTaskComplexity(
	taskDescription: string,
	modelId: string,
): Promise<ModelTier> {
	let client: CopilotClient | null = null;
	try {
		client = new CopilotClient();
		await client.start();
		const session = await client.createSession({
			model: modelId,
			onPermissionRequest: approveAll,
			systemMessage: { content: CLASSIFICATION_PROMPT },
		});

		try {
			const response = await session.sendAndWait({ prompt: `Task: ${taskDescription}` }, 15_000);

			const raw = (response.text ?? "").trim().toLowerCase();
			const tier = VALID_TIERS.find((t) => raw.includes(t));
			return tier ?? "standard";
		} finally {
			await session.disconnect().catch(() => undefined);
		}
	} finally {
		if (client) {
			await client.stop().catch(() => undefined);
		}
	}
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
	const { getModelPricing } = await import("../models/registry.js");
	const failedPricing = await getModelPricing(failedModel);
	if (!failedPricing) {
		return DEFAULT_MODEL;
	}

	const nextTier = getNextTierUp(failedPricing.tier);
	if (!nextTier) {
		return DEFAULT_MODEL;
	}

	const escalatedModel = await getCheapestInTier(nextTier);
	return escalatedModel?.id ?? DEFAULT_MODEL;
}
