import { listPages } from "../wiki/wiki.js";

/**
 * Builds a wiki TOC + summaries string suitable for injection
 * into agent system prompts when executing within an instance.
 * Returns a compact summary (title + first ~100 chars of content per page).
 */
export async function buildWikiContext(_squadId: string): Promise<string> {
	const pages = await listPages().catch(() => []);

	if (pages.length === 0) {
		return "No wiki pages available.";
	}

	const entries = pages.map((page) => {
		const summary = page.content.slice(0, 150).replace(/\n/g, " ").trim();
		const truncated = summary.length < page.content.length ? `${summary}...` : summary;
		return `- **${page.title}** (${page.path}): ${truncated}`;
	});

	return `## Squad Wiki Knowledge (${pages.length} pages)\n\n${entries.join("\n")}`;
}

/**
 * Builds the system prompt suffix for an agent executing within an instance.
 * Includes wiki context and instance-specific information.
 */
export async function buildInstanceSystemPromptSuffix(
	squadId: string,
	instanceId: string,
): Promise<string> {
	const wikiContext = await buildWikiContext(squadId);

	return [
		"\n\n--- Instance Context ---",
		`Instance ID: ${instanceId}`,
		"You are working within an isolated instance. Your changes will be reviewed before merging.",
		"Wiki pages written during this instance go to a pending area and merge on successful completion.",
		"",
		wikiContext,
	].join("\n");
}
