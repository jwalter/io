import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import matter from "gray-matter";

import { WIKI_DIR } from "@io/shared/paths";

let wikiDirectoryOverride: string | null = null;

export function setWikiDirectory(directory: string | null): void {
	wikiDirectoryOverride = directory;
}

function getWikiPagesDir(): string {
	return wikiDirectoryOverride ?? process.env.WIKI_DIR ?? WIKI_DIR;
}

export interface WikiPage {
	path: string;
	title: string;
	tags: string[];
	content: string;
	updatedAt: string;
}

interface WikiPageMetadata {
	title: string;
	tags: string[];
	updatedAt: string;
}

export async function listPages(): Promise<WikiPage[]> {
	const markdownFiles = await collectMarkdownFiles(getWikiPagesDir());
	const pages = await Promise.all(markdownFiles.map((filePath) => readWikiPageFromFile(filePath)));

	return pages.sort((left, right) => left.path.localeCompare(right.path));
}

export interface WikiDirectory {
	path: string;
}

export async function listDirectories(): Promise<WikiDirectory[]> {
	const directories = await collectDirectories(getWikiPagesDir());
	return directories
		.map((dirPath) => ({ path: relative(getWikiPagesDir(), dirPath).replace(/\\/g, "/") }))
		.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectDirectories(directory: string): Promise<string[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		const dirs: string[] = [];

		for (const entry of entries) {
			if (entry.isDirectory()) {
				const entryPath = join(directory, entry.name);
				dirs.push(entryPath);
				dirs.push(...(await collectDirectories(entryPath)));
			}
		}

		return dirs;
	} catch (error) {
		if (isMissingFileError(error)) {
			return [];
		}

		throw error;
	}
}

export async function getPage(pagePath: string): Promise<WikiPage | null> {
	try {
		return await readWikiPageFromFile(resolvePagePath(pagePath));
	} catch (error) {
		if (isMissingFileError(error)) {
			return null;
		}

		throw error;
	}
}

export async function createPage(
	pagePath: string,
	title: string,
	content: string,
	tags: string[] = [],
): Promise<WikiPage> {
	const filePath = resolvePagePath(pagePath);
	const updatedAt = new Date().toISOString();

	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, serializeWikiPage({ title, tags, updatedAt }, content), { flag: "wx" });

	return {
		path: toRelativePagePath(filePath),
		title,
		tags: normalizeTags(tags),
		content,
		updatedAt,
	};
}

export async function updatePage(
	pagePath: string,
	updates: { title?: string; content?: string; tags?: string[] },
): Promise<WikiPage | null> {
	const existingPage = await getPage(pagePath);

	if (existingPage === null) {
		return null;
	}

	const nextPage: WikiPage = {
		...existingPage,
		title: updates.title ?? existingPage.title,
		content: updates.content ?? existingPage.content,
		tags: normalizeTags(updates.tags ?? existingPage.tags),
		updatedAt: new Date().toISOString(),
	};

	await writeFile(
		resolvePagePath(pagePath),
		serializeWikiPage(
			{ title: nextPage.title, tags: nextPage.tags, updatedAt: nextPage.updatedAt },
			nextPage.content,
		),
	);

	return nextPage;
}

export async function deletePage(pagePath: string): Promise<void> {
	const filePath = resolvePagePath(pagePath);
	await rm(filePath);
	await pruneEmptyDirectories(dirname(filePath), getWikiPagesDir());
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		const files: string[] = [];

		for (const entry of entries) {
			const entryPath = join(directory, entry.name);

			if (entry.isDirectory()) {
				files.push(...(await collectMarkdownFiles(entryPath)));
				continue;
			}

			if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
				files.push(entryPath);
			}
		}

		return files;
	} catch (error) {
		if (isMissingFileError(error)) {
			return [];
		}

		throw error;
	}
}

async function readWikiPageFromFile(filePath: string): Promise<WikiPage> {
	const [rawContent, fileStats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
	const parsed = matter(rawContent);
	const metadata = parseMetadata(filePath, parsed.data, fileStats.mtime.toISOString());

	return {
		path: toRelativePagePath(filePath),
		title: metadata.title,
		tags: metadata.tags,
		content: parsed.content,
		updatedAt: metadata.updatedAt,
	};
}

function parseMetadata(
	filePath: string,
	data: Record<string, unknown>,
	fallbackUpdatedAt: string,
): WikiPageMetadata {
	const fallbackTitle = basename(filePath, ".md");

	return {
		title: typeof data.title === "string" && data.title.trim() !== "" ? data.title : fallbackTitle,
		tags: normalizeTags(data.tags),
		updatedAt:
			typeof data.updated_at === "string" && data.updated_at.trim() !== ""
				? data.updated_at
				: fallbackUpdatedAt,
	};
}

function normalizeTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((tag) => String(tag).trim()).filter(Boolean);
	}

	if (typeof value === "string") {
		return value
			.split(",")
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	return [];
}

function resolvePagePath(pagePath: string): string {
	const normalizedPath = ensureMarkdownExtension(normalizePagePath(pagePath));

	if (normalizedPath === ".md") {
		throw new Error("Wiki page path is required");
	}

	const wikiPagesDir = getWikiPagesDir();
	const resolvedPath = resolve(wikiPagesDir, ...normalizedPath.split("/"));
	const relativePath = relative(wikiPagesDir, resolvedPath);

	if (relativePath.startsWith("..") || relativePath === "") {
		throw new Error(`Invalid wiki page path: ${pagePath}`);
	}

	return resolvedPath;
}

function normalizePagePath(pagePath: string): string {
	return pagePath.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
}

function ensureMarkdownExtension(pagePath: string): string {
	return pagePath.toLowerCase().endsWith(".md") ? pagePath : `${pagePath}.md`;
}

function toRelativePagePath(filePath: string): string {
	return relative(getWikiPagesDir(), filePath).replace(/\\/g, "/");
}

function serializeWikiPage(metadata: WikiPageMetadata, content: string): string {
	const normalizedTags = normalizeTags(metadata.tags);
	const pageContent = content.replace(/^\uFEFF/, "");

	return [
		"---",
		`title: ${JSON.stringify(metadata.title)}`,
		`tags: [${normalizedTags.map((tag) => JSON.stringify(tag)).join(", ")}]`,
		`updated_at: ${JSON.stringify(metadata.updatedAt)}`,
		"---",
		"",
		pageContent,
	].join("\n");
}

async function pruneEmptyDirectories(directory: string, rootDirectory: string): Promise<void> {
	let currentDirectory = directory;
	const resolvedRoot = resolve(rootDirectory);

	while (currentDirectory.startsWith(resolvedRoot) && currentDirectory !== resolvedRoot) {
		try {
			const entries = await readdir(currentDirectory);
			if (entries.length > 0) {
				return;
			}

			await rm(currentDirectory, { recursive: true });
		} catch (error) {
			if (isMissingFileError(error)) {
				return;
			}

			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				(error.code === "ENOTEMPTY" || error.code === "EEXIST")
			) {
				return;
			}

			throw error;
		}

		currentDirectory = dirname(currentDirectory);
	}
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
