import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";

/**
 * Creates a scoped set of tools for squad agent sessions.
 * Wiki tools are sandboxed to the squad's own wiki subfolder.
 * Feed posts are locked to the squad's source identifier.
 */
export function createSquadTools(squadSlug: string, squadId: string): Tool<any>[] {
  const wikiPrefix = `squads/${squadSlug}`;

  return [
    // --- Wiki Tools (scoped to squads/{slug}/) ---
    defineTool("wiki_read", {
      description: `Read a wiki page from the squad wiki (paths are relative to your squad's wiki folder)`,
      parameters: z.object({
        path: z.string().describe("Page path (e.g., 'decisions.md', 'notes/architecture.md')"),
      }),
      handler: async ({ path }) => {
        const { readPage } = await import("../wiki/fs.js");
        return await readPage(`${wikiPrefix}/${path}`);
      },
    }),

    defineTool("wiki_write", {
      description: "Write or update a wiki page in the squad wiki",
      parameters: z.object({
        path: z.string().describe("Page path (e.g., 'decisions.md')"),
        content: z.string().describe("Markdown content to write"),
      }),
      handler: async ({ path, content }) => {
        const { writePage } = await import("../wiki/fs.js");
        await writePage(`${wikiPrefix}/${path}`, content);
        return `Page saved: ${path}`;
      },
    }),

    defineTool("wiki_list", {
      description: "List all wiki pages in the squad wiki",
      parameters: z.object({}),
      handler: async () => {
        const { listPages } = await import("../wiki/fs.js");
        return await listPages(wikiPrefix);
      },
    }),

    defineTool("wiki_search", {
      description: "Search squad wiki pages by keyword",
      parameters: z.object({
        query: z.string().describe("Search query"),
      }),
      handler: async ({ query }) => {
        const { searchSquadPages } = await import("../wiki/search.js");
        return await searchSquadPages(query, wikiPrefix);
      },
    }),

    defineTool("wiki_delete", {
      description: "Delete a wiki page from the squad wiki",
      parameters: z.object({
        path: z.string().describe("Page path to delete"),
      }),
      handler: async ({ path }) => {
        const { deletePage } = await import("../wiki/fs.js");
        await deletePage(`${wikiPrefix}/${path}`);
        return `Page deleted: ${path}`;
      },
    }),

    defineTool("wiki_backlinks", {
      description: "Find all squad wiki pages that link to the given page",
      parameters: z.object({
        path: z.string().describe("Page path (e.g., 'decisions.md')"),
      }),
      handler: async ({ path }) => {
        const { getBacklinks } = await import("../wiki/backlinks.js");
        const allBacklinks = await getBacklinks(`${wikiPrefix}/${path}`);
        // Filter to only show backlinks within squad wiki, strip prefix for display
        return allBacklinks
          .filter((bl) => bl.startsWith(`${wikiPrefix}/`))
          .map((bl) => bl.slice(wikiPrefix.length + 1));
      },
    }),

    // --- Feed Tools ---
    defineTool("feed_post", {
      description:
        "Post a message or deliverable to the user's inbox. Use for progress updates, questions, blockers, or completed work.",
      parameters: z.object({
        title: z.string().describe("Title of the message"),
        content: z.string().describe("Full content (markdown supported)"),
      }),
      handler: async ({ title, content }) => {
        const { postFeedItem } = await import("../store/feed.js");
        const source = `squad-${squadSlug}`;
        const item = postFeedItem(source, title, content);
        return `Posted to inbox: "${title}" (ID: ${item.id})`;
      },
    }),

    // --- Task Tools ---
    defineTool("squad_task_status", {
      description: "Check the status of tasks for your squad",
      parameters: z.object({}),
      handler: async () => {
        const { getTasksForSquad } = await import("../store/tasks.js");
        return getTasksForSquad(squadId);
      },
    }),
  ];
}
