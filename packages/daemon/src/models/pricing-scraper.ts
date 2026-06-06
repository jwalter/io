import type { PremiumRequestMultiplier, TokenUnitMultipliers } from "./types.js";

const TOKEN_UNIT_COSTS_URL = "https://docs.github.com/en/billing/reference/costs-for-github-models";
const PREMIUM_MULTIPLIERS_URL =
	"https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans";
const COPILOT_PRICING_URL =
	"https://docs.github.com/api/article/body?pathname=/en/copilot/reference/copilot-billing/models-and-pricing";

/** Multiplier per dollar per 1M tokens: price_per_1M / 10 = multiplier */
const PRICE_TO_MULTIPLIER = 0.1;

/**
 * Scrape the GitHub Models token-unit costs page.
 * Parses the markdown table for input/output/cached multipliers.
 */
export async function scrapeTokenUnitPricing(): Promise<TokenUnitMultipliers[]> {
	const html = await fetchPage(TOKEN_UNIT_COSTS_URL);
	return parseTokenUnitTable(html);
}

/**
 * Scrape the Copilot model pricing page (markdown API).
 * Parses per-token pricing tables and converts $/1M to multipliers.
 */
export async function scrapeCopilotPricing(): Promise<TokenUnitMultipliers[]> {
	const markdown = await fetchMarkdown(COPILOT_PRICING_URL);
	return parseCopilotPricingMarkdown(markdown);
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

async function fetchMarkdown(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			Accept: "text/markdown, text/plain, */*",
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

/**
 * Parse the Copilot pricing page markdown tables.
 * Tables have varying column counts but always include Model, Input, Cached input, and Output columns.
 * Prices are in $/1M tokens (e.g. "$5.00") and we convert to multipliers.
 */
function parseCopilotPricingMarkdown(markdown: string): TokenUnitMultipliers[] {
	const results: TokenUnitMultipliers[] = [];
	const seenModels = new Set<string>();
	const lines = markdown.split("\n");

	let columnIndices: { model: number; input: number; cached: number; output: number } | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) continue;

		if (/\|\s*Model\s/i.test(trimmed)) {
			columnIndices = parseHeaderColumns(trimmed);
			continue;
		}

		if (/^[\s|:-]+$/.test(trimmed) || !columnIndices) continue;

		const entry = parseDataRow(trimmed, columnIndices);
		if (entry && !seenModels.has(entry.modelName.toLowerCase())) {
			seenModels.add(entry.modelName.toLowerCase());
			results.push(entry);
		}
	}

	return results;
}

function parseDataRow(
	line: string,
	columnIndices: { model: number; input: number; cached: number; output: number },
): TokenUnitMultipliers | null {
	const cells = splitMarkdownRow(line);
	if (cells.length <= columnIndices.output) return null;

	const modelName = cells[columnIndices.model].trim();
	const inputPrice = parseDollarValue(cells[columnIndices.input]);
	const cachedPrice =
		columnIndices.cached >= 0 ? parseDollarValue(cells[columnIndices.cached]) : null;
	const outputPrice = parseDollarValue(cells[columnIndices.output]);

	if (!modelName || inputPrice === null || outputPrice === null) return null;

	return {
		modelName,
		inputMultiplier: inputPrice * PRICE_TO_MULTIPLIER,
		cachedInputMultiplier: cachedPrice !== null ? cachedPrice * PRICE_TO_MULTIPLIER : null,
		outputMultiplier: outputPrice * PRICE_TO_MULTIPLIER,
	};
}

function parseHeaderColumns(
	headerLine: string,
): { model: number; input: number; cached: number; output: number } | null {
	const cells = splitMarkdownRow(headerLine).map((c) => c.trim().toLowerCase());

	const model = cells.findIndex((c) => c === "model" || c === "model name");
	// Find the "Input" column (but not "Cached input")
	const input = cells.findIndex(
		(c) => (c === "input" || c === "input multiplier") && !c.includes("cached"),
	);
	const cached = cells.findIndex(
		(c) => c.includes("cached input") || c === "cached input multiplier",
	);
	const output = cells.findIndex(
		(c) => (c === "output" || c === "output multiplier") && !c.includes("cached"),
	);

	if (model < 0 || input < 0 || output < 0) {
		return null;
	}

	return { model, input, cached: cached >= 0 ? cached : -1, output };
}

function splitMarkdownRow(line: string): string[] {
	// Split by | and remove first/last empty elements from leading/trailing |
	const parts = line.split("|");
	if (parts[0].trim() === "") parts.shift();
	if (parts[parts.length - 1]?.trim() === "") parts.pop();
	return parts;
}

function parseDollarValue(cell: string): number | null {
	if (!cell) return null;
	const cleaned = cell.trim().replace(/[$,]/g, "");
	if (cleaned.toLowerCase() === "n/a" || cleaned === "" || cleaned === "-") {
		return null;
	}
	const value = Number.parseFloat(cleaned);
	return Number.isNaN(value) ? null : value;
}
