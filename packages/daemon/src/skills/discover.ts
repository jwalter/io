import { createChildLogger } from '../logging/logger.js';
import { installSkill, installSkillFromUrl, listInstalledSkills, type Skill } from './store.js';

const logger = () => createChildLogger('skills-discovery');
const AWESOME_COPILOT_LLM_URL = 'https://awesome-copilot.github.com/llms.txt';
const SKILLS_SH_SEARCH_URL = 'https://skills.sh/api/search';
const CACHE_TTL_MS = 5 * 60 * 1000;

export type SkillDiscoverySource = 'awesome-copilot' | 'skillssh';

export interface DiscoveredSkill {
	name: string;
	title: string;
	description: string;
	url: string;
	source: SkillDiscoverySource;
	installed: boolean;
	registrySource?: string;
	skillId?: string;
	installs?: number;
}

interface SkillsShSearchResponse {
	skills?: Array<{
		id?: string;
		skillId?: string;
		name?: string;
		source?: string;
		installs?: number;
	}>;
}

const textCache = new Map<string, { expiresAt: number; value: string }>();

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function matchesQuery(parts: Array<string | undefined>, query: string): boolean {
	const needle = normalize(query);
	if (!needle) return true;
	return parts.some((part) => part?.toLowerCase().includes(needle));
}

function formatInstalls(installs?: number): string {
	if (!installs) return 'New';
	if (installs >= 1_000_000) return `${(installs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M installs`;
	if (installs >= 1_000) return `${(installs / 1_000).toFixed(1).replace(/\.0$/, '')}K installs`;
	return `${installs} installs`;
}

async function fetchText(url: string): Promise<string> {
	const cached = textCache.get(url);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const res = await fetch(url, {
		headers: {
			'User-Agent': 'io-skills-discovery',
		},
	});

	if (!res.ok) {
		throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
	}

	const value = await res.text();
	textCache.set(url, { value, expiresAt: Date.now() + CACHE_TTL_MS });
	return value;
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url, {
		headers: {
			Accept: 'application/json',
			'User-Agent': 'io-skills-discovery',
		},
	});

	if (!res.ok) {
		throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
	}

	return (await res.json()) as T;
}

function buildAwesomeCopilotUrl(skillId: string): string {
	return `https://raw.githubusercontent.com/github/awesome-copilot/main/skills/${skillId}/SKILL.md`;
}

function buildSkillsShUrl(registrySource: string, skillId: string): string {
	return `https://github.com/${registrySource}/tree/main/skills/${encodeURIComponent(skillId)}`;
}

function parseAwesomeCopilotSkills(content: string, query: string, installedSkills: Set<string>) {
	const skills: DiscoveredSkill[] = [];
	const lines = content.split(/\r?\n/);
	let inSkillsSection = false;

	for (const line of lines) {
		if (line.startsWith('## Skills')) {
			inSkillsSection = true;
			continue;
		}

		if (inSkillsSection && line.startsWith('## ')) {
			break;
		}

		if (!inSkillsSection) continue;

		const match = line.match(
			/^- \[(.+?)\]\((https:\/\/raw\.githubusercontent\.com\/[^)]+\/skills\/([^/]+)\/SKILL\.md)\):\s*(.+)$/,
		);
		if (!match) continue;

		const [, title, url, skillId, description] = match;
		if (!matchesQuery([skillId, title, description], query)) continue;

		skills.push({
			name: skillId,
			title,
			description,
			url,
			source: 'awesome-copilot',
			installed: installedSkills.has(normalize(skillId)),
			registrySource: 'github/awesome-copilot',
			skillId,
		});
	}

	return skills.slice(0, 50);
}

async function discoverAwesomeCopilotSkills(query: string, installedSkills: Set<string>) {
	const content = await fetchText(AWESOME_COPILOT_LLM_URL);
	return parseAwesomeCopilotSkills(content, query, installedSkills);
}

async function discoverSkillsShSkills(query: string, installedSkills: Set<string>) {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) return [] as DiscoveredSkill[];

	const data = await fetchJson<SkillsShSearchResponse>(
		`${SKILLS_SH_SEARCH_URL}?q=${encodeURIComponent(trimmedQuery)}&limit=30`,
	);

	return (data.skills ?? []).flatMap((skill) => {
		const registrySource = skill.source?.trim();
		const skillId = skill.skillId?.trim();
		if (!registrySource || !skillId) return [];

		const title = skill.name?.trim() || skillId;
		const description = [
			title !== skillId ? title : undefined,
			`Published by ${registrySource}`,
			formatInstalls(skill.installs),
		]
			.filter(Boolean)
			.join(' • ');

		return [
			{
				name: skillId,
				title,
				description,
				url: buildSkillsShUrl(registrySource, skillId),
				source: 'skillssh' as const,
				installed: installedSkills.has(normalize(skillId)),
				registrySource,
				skillId,
				installs: skill.installs,
			},
		];
	});
}

async function fetchGitHubSkillContent(registrySource: string, skillId: string): Promise<string> {
	const [owner, repo] = registrySource.split('/');
	if (!owner || !repo) {
		throw new Error(`Unsupported registry source: ${registrySource}`);
	}

	const candidates = [`skills/${skillId}/SKILL.md`, `${skillId}/SKILL.md`];
	for (const path of candidates) {
		const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
			headers: {
				Accept: 'application/vnd.github.raw+json',
				'User-Agent': 'io-skills-discovery',
			},
		});

		if (!res.ok) continue;

		const content = await res.text();
		if (content.trim()) {
			return content;
		}
	}

	throw new Error(`Could not resolve SKILL.md for ${registrySource}/${skillId}`);
}

export async function discoverSkills(source: SkillDiscoverySource, query: string): Promise<DiscoveredSkill[]> {
	const installedSkills = new Set<string>();
	for (const skill of listInstalledSkills()) {
		installedSkills.add(normalize(skill.name));
	}

	try {
		if (source === 'awesome-copilot') {
			return await discoverAwesomeCopilotSkills(query, installedSkills);
		}

		return await discoverSkillsShSkills(query, installedSkills);
	} catch (error) {
		logger().warn({ error, source, query }, 'Skill discovery failed');
		if (source === 'skillssh' && query.trim()) {
			return [
				{
					name: query.trim().toLowerCase().replace(/\s+/g, '-'),
					title: query.trim(),
					description: 'Registry lookup is unavailable right now. This is placeholder data until the upstream API is reachable.',
					url: '',
					source: 'skillssh',
					installed: false,
				},
			];
		}
		throw error;
	}
}

export async function installDiscoveredSkill(input: {
	name: string;
	source: SkillDiscoverySource;
	url?: string;
	registrySource?: string;
	skillId?: string;
}): Promise<Skill> {
	if (input.source === 'skillssh' && input.registrySource && input.skillId) {
		const content = await fetchGitHubSkillContent(input.registrySource, input.skillId);
		return installSkill(input.name, content);
	}

	if (input.url) {
		return installSkillFromUrl(input.name, input.url || buildAwesomeCopilotUrl(input.skillId ?? input.name));
	}

	if (input.source === 'awesome-copilot') {
		return installSkillFromUrl(input.name, buildAwesomeCopilotUrl(input.skillId ?? input.name));
	}

	throw new Error('No install source was provided for the selected skill');
}
