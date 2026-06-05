import { execFileSync } from "node:child_process";
import type { CatalogModel } from "./types.js";

const CATALOG_URL = "https://models.github.ai/catalog/models";

interface CatalogApiResponse {
	id?: string;
	name?: string;
	friendly_name?: string;
	model_version?: string;
}

function resolveGitHubToken(): string | undefined {
	const envToken = process.env.GITHUB_TOKEN?.trim();
	if (envToken && envToken.length > 0) {
		return envToken;
	}

	try {
		const token = execFileSync("gh", ["auth", "token"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		return token.length > 0 ? token : undefined;
	} catch {
		return undefined;
	}
}

export async function fetchModelCatalog(): Promise<CatalogModel[]> {
	const token = resolveGitHubToken();
	if (!token) {
		throw new Error("No GitHub token available for model catalog fetch");
	}

	const response = await fetch(CATALOG_URL, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2024-12-01",
		},
	});

	if (!response.ok) {
		throw new Error(`Model catalog fetch failed: ${response.status} ${response.statusText}`);
	}

	const data: unknown = await response.json();

	if (!Array.isArray(data)) {
		throw new Error("Model catalog response is not an array");
	}

	const models: CatalogModel[] = [];

	for (const entry of data as CatalogApiResponse[]) {
		const id = entry.id ?? entry.name;
		const displayName = entry.friendly_name ?? entry.name ?? id;

		if (id && typeof id === "string") {
			models.push({ id, displayName: displayName ?? id });
		}
	}

	return models;
}
