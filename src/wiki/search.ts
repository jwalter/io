import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../paths.js";

export interface SearchResult {
  path: string;
  snippet: string;
  line: number;
}

export async function searchPages(query: string): Promise<SearchResult[]> {
  return searchInDirectory(PATHS.wikiPages, query);
}

/**
 * Search wiki pages within a specific subfolder (e.g., "squads/my-squad").
 * Results have paths relative to the subfolder.
 */
export async function searchSquadPages(query: string, subdir: string): Promise<SearchResult[]> {
  const root = join(PATHS.wikiPages, subdir);
  return searchInDirectory(root, query);
}

function searchInDirectory(root: string, query: string): SearchResult[] {
  if (!existsSync(root)) return [];

  const results: SearchResult[] = [];
  const lower = query.toLowerCase();

  const walk = (dir: string, prefix: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(fullPath, rel);
      } else if (entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(lower)) {
            results.push({
              path: rel,
              snippet: lines[i].trim().slice(0, 120),
              line: i + 1,
            });
            break; // one result per file
          }
        }
      }
    }
  };

  walk(root, "");
  return results;
}
