import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createChildLogger } from '../logging/logger.js';

const logger = () => createChildLogger('wiki');

export type WikiScope = 'io' | 'shared' | string; // string = squad name

export interface WikiPage {
	scope: string;
	name: string;
	content: string;
}

export interface WikiPageSummary {
	name: string;
	path: string;
}

export interface WikiSearchResult {
	scope: string;
	name: string;
	matches: string[];
}

let wikiRoot = '';

const DEFAULT_RULES = `# Squad Rules

These rules are automatically enforced for all squad members.

## Git Workflow
- Always pull the latest main branch before starting work
- Create feature branches from main (never commit directly to main)
- Run tests before committing changes
- Never force-push to shared branches

## Code Quality
- Run the project's linter before submitting changes
- Ensure all existing tests pass after your changes
- Add tests for new functionality

## Communication
- Document significant decisions in the wiki
- Update the wiki when you discover important project context
`;

/**
 * Initialize the wiki directory structure.
 */
export function initWiki(dataDir: string): void {
	wikiRoot = join(dataDir, 'wiki');
	mkdirSync(join(wikiRoot, 'io'), { recursive: true });
	mkdirSync(join(wikiRoot, 'shared'), { recursive: true });
	mkdirSync(join(wikiRoot, 'squads'), { recursive: true });
	mkdirSync(join(wikiRoot, 'templates'), { recursive: true });

	// Seed default _rules.md template if not present
	const rulesTemplate = join(wikiRoot, 'templates', '_rules.md');
	if (!existsSync(rulesTemplate)) {
		writeFileSync(rulesTemplate, DEFAULT_RULES, 'utf-8');
	}

	logger().info({ wikiRoot }, 'Wiki initialized');
}

/**
 * Ensure a squad wiki folder exists. Seeds from templates/ on first creation.
 */
export function ensureSquadWiki(squadName: string): void {
	const dir = join(wikiRoot, 'squads', squadName);
	const isNew = !existsSync(dir);
	mkdirSync(dir, { recursive: true });

	// Seed from templates on first creation
	if (isNew) {
		const templatesDir = join(wikiRoot, 'templates');
		if (existsSync(templatesDir)) {
			seedFromTemplates(templatesDir, dir);
		}
	}
}

/**
 * Recursively copy files from templates directory into target.
 */
function seedFromTemplates(src: string, dest: string): void {
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);
		if (entry.isDirectory()) {
			mkdirSync(destPath, { recursive: true });
			seedFromTemplates(srcPath, destPath);
		} else if (entry.isFile()) {
			if (!existsSync(destPath)) {
				copyFileSync(srcPath, destPath);
			}
		}
	}
}

/**
 * List all available wiki scopes (io, shared, + all squads with wiki folders).
 */
export function listWikiScopes(): string[] {
	const scopes = ['io', 'shared'];
	const squadsDir = join(wikiRoot, 'squads');
	if (existsSync(squadsDir)) {
		for (const entry of readdirSync(squadsDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				scopes.push(entry.name);
			}
		}
	}
	return scopes;
}

/**
 * List all pages across all scopes, with scope prefix in the path.
 * Simply walks the wiki directory recursively — directories and .md files.
 */
export function listAllWikiPages(): Array<{ name: string; path: string; isDir?: boolean }> {
	if (!wikiRoot || !existsSync(wikiRoot)) return [];

	const results: Array<{ name: string; path: string; isDir?: boolean }> = [];

	function walk(dir: string, prefix: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				results.push({ name: entry.name, path: entryPath, isDir: true });
				walk(join(dir, entry.name), entryPath);
			} else if (entry.name.endsWith('.md')) {
				results.push({ name: entry.name.replace(/\.md$/, ''), path: entryPath.replace(/\.md$/, '') });
			}
		}
	}

	walk(wikiRoot, '');
	return results;
}

function scopeDir(scope: WikiScope): string {
	if (scope === 'io') return join(wikiRoot, 'io');
	if (scope === 'shared') return join(wikiRoot, 'shared');
	if (scope === 'templates') return join(wikiRoot, 'templates');
	return join(wikiRoot, 'squads', scope);
}

/**
 * List all pages in a scope, including nested directories.
 */
export function listWikiPages(scope: WikiScope): WikiPageSummary[] {
	const dir = scopeDir(scope);
	if (!existsSync(dir)) return [];

	const pages = collectWikiPages(dir);
	return pages.sort((a, b) => a.path.localeCompare(b.path));
}

function collectWikiPages(dir: string, prefix = ''): WikiPageSummary[] {
	const pages: WikiPageSummary[] = [];

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const entryPath = join(dir, entry.name);
		const pagePath = prefix ? `${prefix}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			pages.push(...collectWikiPages(entryPath, pagePath));
			continue;
		}

		if (!entry.isFile() || !entry.name.endsWith('.md')) {
			continue;
		}

		const normalizedPath = pagePath.replace(/\.md$/, '');
		pages.push({
			name: entry.name,
			path: normalizedPath,
		});
	}

	return pages;
}

/**
 * Read a wiki page. Returns null if it doesn't exist.
 */
export function readWikiPage(scope: WikiScope, pageName: string): WikiPage | null {
	const filePath = join(scopeDir(scope), `${pageName}.md`);
	if (!existsSync(filePath)) return null;
	const content = readFileSync(filePath, 'utf-8');
	return { scope, name: pageName, content };
}

/**
 * Write (create or overwrite) a wiki page.
 */
export function writeWikiPage(scope: WikiScope, pageName: string, content: string): WikiPage {
	const dir = scopeDir(scope);
	const filePath = join(dir, `${pageName}.md`);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, 'utf-8');
	logger().info({ scope, pageName }, 'Wiki page written');
	return { scope, name: pageName, content };
}

/**
 * Delete a wiki page.
 */
export function deleteWikiPage(scope: WikiScope, pageName: string): boolean {
	const filePath = join(scopeDir(scope), `${pageName}.md`);
	if (!existsSync(filePath)) return false;
	unlinkSync(filePath);
	logger().info({ scope, pageName }, 'Wiki page deleted');
	return true;
}

// Protected root directories that cannot be deleted
const PROTECTED_DIRS = new Set(['io', 'shared', 'squads', 'templates']);

/**
 * Delete a wiki directory and all its contents.
 * Protected directories (io, shared, squads) cannot be deleted.
 * Path is relative to wiki root (e.g. "squads/myproject").
 */
export function deleteWikiDirectory(relativePath: string): boolean {
	if (!wikiRoot) return false;

	// Block deletion of protected root directories
	const normalized = relativePath.replace(/^\/+|\/+$/g, '');
	if (PROTECTED_DIRS.has(normalized)) return false;

	const target = resolve(wikiRoot, normalized);
	// Safety: ensure target is actually inside wikiRoot
	if (!target.startsWith(resolve(wikiRoot))) return false;

	if (!existsSync(target)) return false;

	rmSync(target, { recursive: true, force: true });
	logger().info({ path: normalized }, 'Wiki directory deleted');
	return true;
}

/**
 * Search wiki pages by keyword across one or more scopes.
 * Returns matching pages with context lines.
 */
export function searchWiki(keyword: string, scopes: WikiScope[]): WikiSearchResult[] {
	const results: WikiSearchResult[] = [];
	const lower = keyword.toLowerCase();

	for (const scope of scopes) {
		const pages = listWikiPages(scope);
		for (const pageSummary of pages) {
			const page = readWikiPage(scope, pageSummary.path);
			if (!page) continue;

			const lines = page.content.split('\n');
			const matches: string[] = [];
			for (const line of lines) {
				if (line.toLowerCase().includes(lower)) {
					matches.push(line.trim());
				}
			}

			if (matches.length > 0) {
				results.push({ scope, name: pageSummary.name, matches: matches.slice(0, 5) });
			}
		}
	}

	return results;
}

/**
 * Get accessible scopes for a squad agent.
 */
export function getSquadScopes(squadName: string): WikiScope[] {
	return ['shared', squadName];
}

/**
 * Get accessible scopes for the orchestrator.
 */
export function getOrchestratorScopes(): WikiScope[] {
	return ['io', 'shared'];
}

/**
 * Get a summary of available pages for injection into system prompts.
 * Excludes _rules.md since it's injected separately.
 */
export function getPageListing(scopes: WikiScope[]): string {
	const sections: string[] = [];
	for (const scope of scopes) {
		const pages = listWikiPages(scope).filter((p) => p.path !== '_rules');
		if (pages.length > 0) {
			const label = scope === 'io' ? 'IO' : scope === 'shared' ? 'Shared' : `Squad (${scope})`;
			sections.push(`${label}: ${pages.map((page) => page.name).join(', ')}`);
		}
	}
	return sections.length > 0 ? sections.join('\n') : '(no wiki pages yet)';
}

/**
 * Read the _rules.md content for a squad. Returns null if not found.
 */
export function readSquadRules(squadName: string): string | null {
	const filePath = join(wikiRoot, 'squads', squadName, '_rules.md');
	if (!existsSync(filePath)) return null;
	return readFileSync(filePath, 'utf-8');
}
