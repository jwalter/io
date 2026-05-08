import { readPage, listPages } from "./fs.js";

export interface WikiSearchResult {
  path: string;
  title: string;
  snippet: string;
}

export function searchWiki(query: string): WikiSearchResult[] {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();
  const pages = listPages();
  const results: WikiSearchResult[] = [];

  for (const pagePath of pages) {
    const content = readPage(pagePath);
    if (!content) continue;

    const lowerContent = content.toLowerCase();
    const idx = lowerContent.indexOf(lowerQuery);
    if (idx === -1) continue;

    const title = extractTitle(pagePath, content);
    const snippetStart = Math.max(0, idx - 100);
    const snippetEnd = Math.min(content.length, idx + query.length + 100);
    let snippet = content.slice(snippetStart, snippetEnd).trim();
    if (snippetStart > 0) snippet = `…${snippet}`;
    if (snippetEnd < content.length) snippet = `${snippet}…`;

    results.push({ path: pagePath, title, snippet });
  }

  return results;
}

export function getWikiSummary(): string {
  const pages = listPages();
  if (pages.length === 0) return "Wiki is empty — no pages yet.";

  const lines: string[] = ["Wiki pages:"];
  for (const pagePath of pages) {
    const content = readPage(pagePath);
    const title = content ? extractTitle(pagePath, content) : pagePath;
    lines.push(`- ${pagePath}: ${title}`);
  }
  return lines.join("\n");
}

function extractTitle(pagePath: string, content: string): string {
  const firstLine = content.split("\n").find((l) => l.trim().length > 0);
  if (firstLine) {
    const heading = firstLine.replace(/^#+\s*/, "").trim();
    if (heading) return heading;
  }
  return pagePath.replace(/.*\//, "").replace(/\.md$/, "");
}
