import { config } from "../config.js";

export type Tier = "high" | "medium" | "low";

const DEFAULT_TIERS: Record<Tier, string[]> = {
  high: ["claude-opus-4.7", "claude-opus-4.6"],
  medium: ["claude-sonnet-4.6", "gpt-5.5", "claude-opus-4.5"],
  low: ["claude-haiku-4.5", "gpt-5.4-mini"],
};

// Resolved model for each tier (populated at startup)
let resolvedTiers: Record<Tier, string> | null = null;

const HIGH_KEYWORDS = [
  "architect", "refactor", "redesign", "debug", "design",
  "complex", "migration", "security", "performance", "optimize",
  "rewrite", "overhaul", "investigate", "diagnose", "plan",
];

const LOW_KEYWORDS = [
  "read", "list", "format", "lookup", "check", "status",
  "simple", "rename", "typo", "log", "print", "echo",
  "delete file", "remove file", "copy file", "move file",
];

/**
 * Resolve each tier to the first available model from its preference list.
 * Call once at startup with the result of `client.listModels()`.
 */
export function resolveModelTiers(availableModelIds: string[]): Record<Tier, string> {
  const available = new Set(availableModelIds);
  const tiers = config.modelTiers ?? {};
  const result = {} as Record<Tier, string>;

  for (const tier of ["high", "medium", "low"] as Tier[]) {
    const candidates = tiers[tier] ?? DEFAULT_TIERS[tier];
    const match = candidates.find((m) => available.has(m));
    if (match) {
      result[tier] = match;
    } else {
      // Fallback: use defaultModel, then first candidate regardless of availability
      result[tier] = config.defaultModel || candidates[0];
    }
    console.error(`[io] Model tier "${tier}" resolved to: ${result[tier]}`);
  }

  resolvedTiers = result;
  return result;
}

/**
 * Classify a task description into a complexity tier.
 */
export function classifyComplexity(taskDescription: string): Tier {
  const lower = taskDescription.toLowerCase();

  const highScore = HIGH_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  const lowScore = LOW_KEYWORDS.filter((kw) => lower.includes(kw)).length;

  // Strong signals
  if (highScore >= 2) return "high";
  if (lowScore >= 2) return "low";

  // Weak signals
  if (highScore > lowScore) return "high";
  if (lowScore > highScore) return "low";

  // Default to medium for ambiguous tasks
  return "medium";
}

/**
 * Get the resolved model for a tier.
 */
export function getModelForTier(tier: Tier): string {
  if (!resolvedTiers) {
    console.error("[io] Warning: model tiers not yet resolved, using defaults");
    return config.defaultModel || DEFAULT_TIERS[tier][0];
  }
  return resolvedTiers[tier];
}

/**
 * Get the best model for a task based on its description.
 * If squadModel is provided, it always takes priority.
 */
export function getModelForTask(taskDescription: string, squadModel?: string | null): string {
  if (squadModel) return squadModel;
  const tier = classifyComplexity(taskDescription);
  const model = getModelForTier(tier);
  console.error(`[io] Task classified as "${tier}" → model: ${model}`);
  return model;
}
