import type { PremiumRequestMultiplier, TokenUnitMultipliers } from "./types.js";

const TOKEN_UNIT_COSTS_URL = "https://docs.github.com/en/billing/reference/costs-for-github-models";
const PREMIUM_MULTIPLIERS_URL =
	"https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans";

/**
 * Scrape the GitHub Models token-unit costs page.
 * Parses the markdown table for input/output/cached multipliers.
 */
export async function scrapeTokenUnitPricing(): Promise<TokenUnitMultipliers[]> {
	const html = await fetchPage(TOKEN_UNIT_COSTS_URL);
	return parseTokenUnitTable(html);
}

/**
 * Scrape the Copilot premium request multipliers page.
 * Parses the markdown table for per-model multipliers.
 */
export async function scrapePremiumRequestPricing(): Promise<PremiumRequestMultiplier[]> {
	const html = await fetchPage(PREMIUM_MULTIPLIERS_URL);
	return parsePremiumMultiplierTable(html);
}

async function fetchPage(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			Accept: "text/html",
			"User-Agent": "IO-Daemon/4.0 (pricing-refresh)",
		},
		redirect: "follow",
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}

	return response.text();
}

function parseTokenUnitTable(html: string): TokenUnitMultipliers[] {
	const results: TokenUnitMultipliers[] = [];

	// Look for table rows in the HTML: <tr> with <td> cells
	// Pattern: model name | input multiplier | cached input | output multiplier | ...
	const tableRowPattern =
		/<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]+)<\/td>/gi;

	for (const match of html.matchAll(tableRowPattern)) {
		const modelName = cleanCellText(match[1]);
		const inputMultiplier = Number.parseFloat(match[2]);
		const cachedInput = match[3].trim().toLowerCase();
		const outputMultiplier = Number.parseFloat(match[4]);

		if (modelName && !Number.isNaN(inputMultiplier) && !Number.isNaN(outputMultiplier)) {
			results.push({
				modelName,
				inputMultiplier,
				cachedInputMultiplier:
					cachedInput === "n/a" || cachedInput === ""
						? null
						: Number.parseFloat(cachedInput) || null,
				outputMultiplier,
			});
		}
	}

	return results;
}

function parsePremiumMultiplierTable(html: string): PremiumRequestMultiplier[] {
	const results: PremiumRequestMultiplier[] = [];

	// Look for two-column table rows: model name | multiplier
	const tableRowPattern = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/gi;

	for (const match of html.matchAll(tableRowPattern)) {
		const modelName = cleanCellText(match[1]);
		const multiplier = Number.parseFloat(match[2]);

		if (modelName && !Number.isNaN(multiplier) && multiplier > 0) {
			results.push({ modelName, multiplier });
		}
	}

	return results;
}

function cleanCellText(text: string): string {
	return text
		.replace(/<[^>]*>/g, "")
		.replace(/&[^;]+;/g, " ")
		.trim();
}
