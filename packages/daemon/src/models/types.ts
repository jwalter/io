export type ModelTier = "trivial" | "fast" | "standard" | "premium" | "ultra";

export interface ModelPricing {
	id: string;
	displayName: string;
	premiumMultiplier: number | null;
	tokenInputMultiplier: number | null;
	tokenOutputMultiplier: number | null;
	cachedInputMultiplier: number | null;
	tier: ModelTier;
	available: boolean;
	updatedAt: string;
}

export interface CatalogModel {
	id: string;
	displayName: string;
}

export interface TokenUnitMultipliers {
	modelName: string;
	inputMultiplier: number;
	cachedInputMultiplier: number | null;
	outputMultiplier: number;
}

export interface PremiumRequestMultiplier {
	modelName: string;
	multiplier: number;
}

export interface PricingRefreshResult {
	modelsUpdated: number;
	catalogFetched: boolean;
	tokenPricingScraped: boolean;
	premiumPricingScraped: boolean;
	errors: string[];
}

export const TIER_RANGES: Record<ModelTier, { min: number; max: number }> = {
	trivial: { min: 0, max: 0.33 },
	fast: { min: 0.34, max: 1.0 },
	standard: { min: 1.1, max: 5.0 },
	premium: { min: 5.1, max: 15.0 },
	ultra: { min: 15.1, max: Number.POSITIVE_INFINITY },
};

export function computeTierFromMultiplier(premiumMultiplier: number | null): ModelTier {
	if (premiumMultiplier === null) {
		return "standard";
	}

	for (const [tier, range] of Object.entries(TIER_RANGES) as [
		ModelTier,
		{ min: number; max: number },
	][]) {
		if (premiumMultiplier >= range.min && premiumMultiplier <= range.max) {
			return tier;
		}
	}

	return "ultra";
}

/** Fixed price per token unit (USD) */
export const TOKEN_UNIT_PRICE = 0.00001;
