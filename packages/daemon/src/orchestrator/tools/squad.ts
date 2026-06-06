import { exec } from "node:child_process";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { EVENT_NAMES, QA_MAX_REVISIONS, type Squad, type SquadConfig } from "@io/shared";
import { DATA_DIR } from "@io/shared/paths";
import { z } from "zod";

import type { Config } from "../../config.js";
import type { ToolDefinition } from "../../copilot/session.js";
import { eventBus } from "../../event-bus.js";
import {
	completeInstance,
	countRunningInstances,
	failInstance,
	getNextQueued,
	spawnInstance,
	startInstance,
} from "../../execution/instances.js";
import { executeObjective, resolveRepoPath } from "../../execution/runner.js";
import { getSquadStatus } from "../../squad/manager.js";
import {
	addMember,
	createObjective,
	createSquad,
	deleteSquad,
	getActiveObjectives,
	getMember,
	getSquad,
	getSquadByRepo,
	listDeletedSquads,
	listSquads,
	removeMember,
	restoreSquad,
	updateMember,
	updateSquad,
} from "../../store/index.js";

const execAsync = promisify(exec);

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export type OrchestratorToolResult = string | Record<string, unknown> | null | undefined;
export type OrchestratorToolExecutor = (
	toolName: string,
	args: Record<string, unknown>,
) => Promise<OrchestratorToolResult>;

const createSquadSchema = z.object({
	repoUrl: z.string().trim().min(1).describe("The repository URL to create a squad for"),
	name: z
		.string()
		.trim()
		.optional()
		.describe("Squad name. Defaults to '<RepoName> Squad' if not provided."),
	config: z
		.object({
			prMode: z
				.enum(["draft-pr", "branch-only", "ready-pr", "auto-merge"])
				.optional()
				.describe("PR creation mode. Defaults to 'draft-pr'."),
			mcpServers: z
				.array(z.string())
				.optional()
				.describe("MCP server URLs to configure for the squad."),
			maxRevisions: z
				.number()
				.optional()
				.describe("Max QA revision cycles. Defaults to system default."),
		})
		.optional()
		.describe("Squad configuration. All fields are optional with sensible defaults."),
});

const addSquadMemberSchema = z.object({
	squadId: z.string().trim().min(1),
	role: z
		.string()
		.trim()
		.min(1)
		.describe("Slug-style role identifier (e.g. 'senior-frontend-engineer', 'team-lead')"),
	name: z
		.string()
		.trim()
		.min(1)
		.describe("Display name for the member (e.g. 'Senior Frontend Engineer')"),
	systemPrompt: z
		.string()
		.min(1)
		.describe(
			"The system prompt defining this member's expertise, responsibilities, and behavior.",
		),
	model: z
		.string()
		.optional()
		.describe("Model override for this member. Uses squad default if not provided."),
});

const removeSquadMemberSchema = z.object({
	squadId: z.string().trim().min(1),
	memberId: z.string().trim().min(1),
});

const updateSquadConfigSchema = z.object({
	squadId: z.string().trim().min(1),
	config: z
		.object({
			prMode: z.enum(["draft-pr", "branch-only", "ready-pr", "auto-merge"]).optional(),
			mcpServers: z.array(z.string()).optional(),
			maxRevisions: z.number().optional(),
		})
		.describe("Partial config fields to update. Only provided fields are changed."),
});

const analyzeRepoSchema = z.object({
	repoUrl: z.string().trim().min(1).describe("The repository URL to analyze"),
	scanPaths: z
		.array(z.string())
		.optional()
		.describe(
			"Relative paths within the repository to focus the analysis on. When provided, only these directories are scanned instead of the entire repo.",
		),
});

const squadIdSchema = z.object({
	squadId: z.string().trim().min(1),
});

const delegateToSquadSchema = z.object({
	squadId: z.string().trim().min(1),
	objective: z.string().trim().min(1),
});

const renameSquadSchema = z.object({
	squadId: z.string().trim().min(1),
	name: z.string().trim().min(1),
});

const updateSquadMemberSchema = z.object({
	squadId: z.string().trim().min(1),
	memberId: z.string().trim().min(1),
	role: z.string().trim().min(1).optional(),
	systemPrompt: z.string().optional(),
	model: z.string().optional(),
});

export const squadToolDefinitions: ToolDefinition[] = [
	{
		name: "create_squad",
		description:
			"Create a new squad for a repository. After creating, use add_squad_member to populate it with agents. Always include team-lead and qa roles.",
		parameters: createSquadSchema,
		skipPermission: true,
	},
	{
		name: "add_squad_member",
		description:
			"Add a member (agent) to an existing squad. Provide a role slug, display name, and a detailed system prompt defining the agent's expertise and responsibilities.",
		parameters: addSquadMemberSchema,
		skipPermission: true,
	},
	{
		name: "remove_squad_member",
		description: "Remove a member from a squad by their ID.",
		parameters: removeSquadMemberSchema,
		skipPermission: true,
	},
	{
		name: "update_squad_config",
		description: "Update a squad's configuration (prMode, mcpServers, maxRevisions).",
		parameters: updateSquadConfigSchema,
		skipPermission: true,
	},
	{
		name: "analyze_repo",
		description:
			"Analyze a repository's structure and tech stack. Returns information about frameworks, languages, directory layout, and config files. Use this before creating a squad to inform role decisions.",
		parameters: analyzeRepoSchema,
		skipPermission: true,
	},
	{
		name: "fire_squad",
		description: "Soft-delete a squad. The squad can be restored later with restore_squad.",
		parameters: squadIdSchema,
		skipPermission: true,
	},
	{
		name: "restore_squad",
		description: "Restore a previously deleted squad and all its members.",
		parameters: squadIdSchema,
		skipPermission: true,
	},
	{
		name: "list_deleted_squads",
		description: "List all soft-deleted squads that can be restored.",
		parameters: z.object({}),
		skipPermission: true,
	},
	{
		name: "list_squads",
		description: "List all squads and their status.",
		parameters: z.object({}),
		skipPermission: true,
	},
	{
		name: "get_squad_status",
		description: "Get detailed status for a squad and its active objectives.",
		parameters: squadIdSchema,
		skipPermission: true,
	},
	{
		name: "delegate_to_squad",
		description: "Create an objective for a squad and start execution.",
		parameters: delegateToSquadSchema,
		skipPermission: true,
	},
	{
		name: "rename_squad",
		description: "Rename a squad.",
		parameters: renameSquadSchema,
		skipPermission: true,
	},
	{
		name: "update_squad_member",
		description:
			"Update a squad member's role, system prompt, and/or default model. All fields are optional; only provided fields are changed.",
		parameters: updateSquadMemberSchema,
		skipPermission: true,
	},
];

function parseRepoUrl(repoUrl: string): { owner: string; name: string } {
	const trimmed = repoUrl.trim();
	const sshMatch = trimmed.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/i);
	if (sshMatch) {
		return { owner: sshMatch[1], name: sshMatch[2] };
	}

	const normalized = trimmed.replace(/\.git$/i, "");
	const url = new URL(normalized);
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length < 2) {
		throw new Error(`Unable to parse owner/name from repo URL: ${repoUrl}`);
	}

	return { owner: segments[0], name: segments[1] };
}

function titleCase(value: string): string {
	return value
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

const MANIFEST_FILES = [
	"package.json",
	"Cargo.toml",
	"go.mod",
	"requirements.txt",
	"pyproject.toml",
	"Gemfile",
	"pom.xml",
	"build.gradle",
	"composer.json",
	"Makefile",
	"Dockerfile",
	"docker-compose.yml",
	"docker-compose.yaml",
	".github/workflows",
];

const SRC_DIR_NAMES = ["src", "lib", "app", "packages", "crates", "cmd", "internal"];
const README_CANDIDATES = ["README.md", "README.rst", "README.txt", "README"];

async function readManifests(rootPath: string, rootLabel: string): Promise<string[]> {
	const lines: string[] = [];
	for (const manifest of MANIFEST_FILES) {
		const fullPath = join(rootPath, manifest);
		try {
			const fileStat = await stat(fullPath);
			if (fileStat.isFile()) {
				const content = await readFile(fullPath, "utf8");
				lines.push(`\n--- ${rootLabel}${manifest} ---\n${content.slice(0, 3000)}`);
			} else if (fileStat.isDirectory()) {
				const children = await readdir(fullPath);
				lines.push(`\n--- ${rootLabel}${manifest}/ ---\n${children.join(", ")}`);
			}
		} catch {
			// File doesn't exist, skip
		}
	}
	return lines;
}

async function scanSrcDirs(rootPath: string, rootLabel: string, dirs: string[]): Promise<string[]> {
	const lines: string[] = [];
	const srcDirs = dirs.filter((d) => SRC_DIR_NAMES.includes(d));
	for (const srcDir of srcDirs) {
		try {
			const srcEntries = await readdir(join(rootPath, srcDir), { withFileTypes: true });
			const srcFiles = srcEntries.filter((e) => e.isFile()).map((e) => e.name);
			const srcSubDirs = srcEntries.filter((e) => e.isDirectory()).map((e) => e.name);
			lines.push(`\n--- ${rootLabel}${srcDir}/ ---`);
			if (srcSubDirs.length) lines.push(`  Directories: ${srcSubDirs.join(", ")}`);
			if (srcFiles.length) lines.push(`  Files: ${srcFiles.slice(0, 30).join(", ")}`);
		} catch {
			// Skip
		}
	}
	return lines;
}

async function findReadme(rootPath: string, rootLabel: string): Promise<string | null> {
	for (const readme of README_CANDIDATES) {
		try {
			const content = await readFile(join(rootPath, readme), "utf8");
			return `\n--- ${rootLabel}${readme} (excerpt) ---\n${content.slice(0, 1500)}`;
		} catch {
			// Next candidate
		}
	}
	return null;
}

async function scanRoot(root: { path: string; label: string }): Promise<string[]> {
	const lines: string[] = [];
	const rootLabel = root.label ? `${root.label}/` : "";
	const rootEntries = await readdir(root.path, { withFileTypes: true });
	const rootFiles = rootEntries.filter((e) => e.isFile()).map((e) => e.name);
	const rootDirs = rootEntries
		.filter((e) => e.isDirectory() && e.name !== ".git")
		.map((e) => e.name);

	if (rootFiles.length) lines.push(`${rootLabel}Files: ${rootFiles.join(", ")}`);
	if (rootDirs.length) lines.push(`${rootLabel}Directories: ${rootDirs.join(", ")}`);

	lines.push(...(await readManifests(root.path, rootLabel)));
	lines.push(...(await scanSrcDirs(root.path, rootLabel, rootDirs)));

	const readme = await findReadme(root.path, rootLabel);
	if (readme) lines.push(readme);

	return lines;
}

async function cloneOrUpdateRepo(normalized: string, repoDir: string): Promise<boolean> {
	try {
		await mkdir(join(DATA_DIR, "repos"), { recursive: true });
		if (await pathExists(join(repoDir, ".git"))) {
			await execAsync("git pull --ff-only", { cwd: repoDir, timeout: 30_000 }).catch(
				() => undefined,
			);
		} else {
			await execAsync(`git clone --depth 50 ${normalized} "${repoDir}"`, {
				timeout: 60_000,
			});
		}
		return true;
	} catch {
		return false;
	}
}

async function buildRepoAnalysis(repoUrl: string, scanPaths?: string[]): Promise<string> {
	const normalized = repoUrl.trim();
	const segments = normalized
		.replace(/\.git$/i, "")
		.split("/")
		.filter(Boolean);
	const owner = segments.at(-2) ?? "";
	const name = segments.at(-1) ?? normalized;

	const lines = [`Repository URL: ${normalized}`, `Repository name: ${name}`];

	if (!owner || !name) {
		lines.push(
			"Use the repository identity and any available conventions to propose a practical squad composition.",
		);
		return lines.join("\n");
	}

	const repoDir = join(DATA_DIR, "repos", `${owner}--${name}`);
	const cloned = await cloneOrUpdateRepo(normalized, repoDir);
	if (!cloned) {
		lines.push("Unable to clone repository locally; falling back to basic analysis.");
		lines.push("Based on the repository name, propose roles that match common project patterns.");
		return lines.join("\n");
	}

	const scanRoots =
		scanPaths && scanPaths.length > 0
			? scanPaths.map((p) => ({ path: join(repoDir, p), label: p }))
			: [{ path: repoDir, label: "" }];

	if (scanPaths && scanPaths.length > 0) {
		lines.push(`Focused scan paths: ${scanPaths.join(", ")}`);
	}

	for (const root of scanRoots) {
		try {
			lines.push(...(await scanRoot(root)));
		} catch {
			lines.push(`Filesystem scan failed for ${root.label || "repo root"}; skipping.`);
		}
	}

	lines.push(
		"\nBased on the above repository structure and contents, propose roles that match the project's actual technology stack and architecture.",
	);
	return lines.join("\n");
}

function formatSquadList(squads: Squad[]): string {
	if (squads.length === 0) {
		return "No squads are currently configured.";
	}

	return squads
		.map(
			(squad) =>
				`${squad.id}: ${squad.name} (${squad.repoOwner}/${squad.repoName}) [${squad.status}]`,
		)
		.join("\n");
}

async function processQueue(squadId: string): Promise<void> {
	try {
		const running = await countRunningInstances(squadId);
		const config = (await import("../../config.js")).loadConfig();
		if (running < config.maxInstancesPerSquad) {
			const next = await getNextQueued(squadId);
			if (next) {
				const freshSquad = await getSquad(squadId);
				if (freshSquad && next.objectiveId) {
					void startAndExecuteInstance(next.id, freshSquad, next.objectiveId);
				}
			}
		}
	} catch {
		// Non-fatal — queue will be processed on next trigger
	}
}

async function startAndExecuteInstance(
	instanceId: string,
	squad: Squad,
	objectiveId: string,
): Promise<void> {
	try {
		const repoPath = await resolveRepoPath(squad.repoUrl, squad.repoName);
		const baseBranch = "main";
		const started = await startInstance(instanceId, repoPath, baseBranch);

		const result = await executeObjective(squad.id, objectiveId, {
			instanceId: started.id,
			worktreePath: started.worktreePath ?? "",
			branch: started.branch ?? "",
		});

		if (result.success) {
			await completeInstance(instanceId);
		} else {
			await failInstance(instanceId, result.error ?? "Unknown execution failure");
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		await failInstance(instanceId, message).catch(() => {});
	} finally {
		await processQueue(squad.id);
	}
}

async function handleCreateSquad(
	rawArgs: Record<string, unknown>,
): Promise<OrchestratorToolResult> {
	const { repoUrl, name, config } = createSquadSchema.parse(rawArgs);
	const parsedRepo = parseRepoUrl(repoUrl);

	const existingSquad = await getSquadByRepo(parsedRepo.owner, parsedRepo.name);
	if (existingSquad) {
		return {
			message: `A squad already exists for ${parsedRepo.owner}/${parsedRepo.name}.`,
			squad: existingSquad,
		};
	}

	const squadName = name || `${titleCase(parsedRepo.name)} Squad`;
	const squadConfig: SquadConfig = {
		prMode: config?.prMode ?? "draft-pr",
		mcpServers: config?.mcpServers ?? [],
		maxRevisions: config?.maxRevisions ?? QA_MAX_REVISIONS,
	};

	const squad = await createSquad({
		name: squadName,
		repoUrl,
		repoOwner: parsedRepo.owner,
		repoName: parsedRepo.name,
		status: "active",
		config: squadConfig,
	});

	eventBus.emit(EVENT_NAMES.SQUAD_CREATED, { squad });
	return {
		message: `Squad "${squad.name}" created for ${parsedRepo.owner}/${parsedRepo.name}. Add members with add_squad_member.`,
		squad,
	};
}

async function handleAddSquadMember(
	rawArgs: Record<string, unknown>,
): Promise<OrchestratorToolResult> {
	const { squadId, role, name, systemPrompt, model } = addSquadMemberSchema.parse(rawArgs);

	const squad = await getSquad(squadId);
	if (!squad) {
		throw new Error(`Squad ${squadId} was not found.`);
	}

	const member = await addMember(squadId, {
		role,
		name,
		systemPrompt,
		model: model ?? null,
	});

	eventBus.emit(EVENT_NAMES.SQUAD_MEMBER_UPDATED, { squadId, member });
	return {
		message: `Added member "${member.name}" (${member.role}) to squad "${squad.name}".`,
		member,
	};
}

async function handleRemoveSquadMember(
	rawArgs: Record<string, unknown>,
): Promise<OrchestratorToolResult> {
	const { squadId, memberId } = removeSquadMemberSchema.parse(rawArgs);

	const squad = await getSquad(squadId);
	if (!squad) {
		throw new Error(`Squad ${squadId} was not found.`);
	}

	const member = await getMember(memberId);
	if (!member || member.squadId !== squadId) {
		throw new Error(`Member ${memberId} was not found in squad ${squadId}.`);
	}

	await removeMember(memberId);

	eventBus.emit(EVENT_NAMES.SQUAD_UPDATED, { squad });
	return {
		message: `Removed member "${member.name}" (${member.role}) from squad "${squad.name}".`,
		memberId,
	};
}

async function handleUpdateSquadConfig(
	rawArgs: Record<string, unknown>,
): Promise<OrchestratorToolResult> {
	const { squadId, config } = updateSquadConfigSchema.parse(rawArgs);

	const squad = await getSquad(squadId);
	if (!squad) {
		throw new Error(`Squad ${squadId} was not found.`);
	}

	const mergedConfig: SquadConfig = {
		prMode: config.prMode ?? squad.config.prMode,
		mcpServers: config.mcpServers ?? squad.config.mcpServers,
		maxRevisions: config.maxRevisions ?? squad.config.maxRevisions,
	};

	const updated = await updateSquad(squadId, { config: mergedConfig });
	if (!updated) {
		throw new Error(`Failed to update squad ${squadId}.`);
	}

	eventBus.emit(EVENT_NAMES.SQUAD_UPDATED, { squad: updated });
	return {
		message: `Updated config for squad "${updated.name}".`,
		squad: updated,
	};
}

async function handleAnalyzeRepo(
	rawArgs: Record<string, unknown>,
): Promise<OrchestratorToolResult> {
	const { repoUrl, scanPaths } = analyzeRepoSchema.parse(rawArgs);
	const analysis = await buildRepoAnalysis(repoUrl, scanPaths);
	return {
		message: "Repository analysis complete.",
		analysis,
	};
}

async function handleFireSquad(rawArgs: Record<string, unknown>): Promise<OrchestratorToolResult> {
	const { squadId } = squadIdSchema.parse(rawArgs);
	const squad = await getSquad(squadId);
	if (!squad) {
		throw new Error(`Squad ${squadId} was not found.`);
	}

	const activeObjectives = await getActiveObjectives(squadId);
	if (activeObjectives.length > 0) {
		const updated = await updateSquad(squadId, { status: "inactive" });
		return {
			message: `Squad ${squadId} was deactivated because it still has active objectives. Use fire_squad again after objectives complete to delete it.`,
			squad: updated,
			activeObjectives,
		};
	}

	await deleteSquad(squadId);
	return {
		message: `Squad "${squad.name}" has been deleted. It can be restored with restore_squad if needed.`,
		squadId,
	};
}

async function handleRestoreSquad(
	rawArgs: Record<string, unknown>,
): Promise<OrchestratorToolResult> {
	const { squadId } = squadIdSchema.parse(rawArgs);
	const restored = await restoreSquad(squadId);
	if (!restored) {
		throw new Error(`Squad ${squadId} was not found or is not deleted.`);
	}

	eventBus.emit(EVENT_NAMES.SQUAD_UPDATED, { squad: restored });
	return {
		message: `Squad "${restored.name}" has been restored.`,
		squad: restored,
	};
}

async function handleDelegateToSquad(
	rawArgs: Record<string, unknown>,
): Promise<OrchestratorToolResult> {
	const { squadId, objective } = delegateToSquadSchema.parse(rawArgs);
	const squad = await getSquad(squadId);
	if (!squad) {
		throw new Error(`Squad ${squadId} was not found.`);
	}

	const createdObjective = await createObjective(squadId, objective);
	const { instance, queued } = await spawnInstance({
		squadId,
		objectiveId: createdObjective.id,
	});

	if (!queued) {
		void startAndExecuteInstance(instance.id, squad, createdObjective.id);
	}

	return {
		message: queued
			? `Objective queued for squad ${squad.name} (at capacity). Instance ${instance.id} will start when a slot opens.`
			: `Delegated objective to squad ${squad.name}. Instance ${instance.id} started.`,
		objective: createdObjective,
		instanceId: instance.id,
		queued,
	};
}

async function handleUpdateSquadMember(
	rawArgs: Record<string, unknown>,
): Promise<OrchestratorToolResult> {
	const { squadId, memberId, role, systemPrompt, model } = updateSquadMemberSchema.parse(rawArgs);

	const squad = await getSquad(squadId);
	if (!squad) {
		throw new Error(`Squad ${squadId} was not found.`);
	}

	const member = await getMember(memberId);
	if (!member || member.squadId !== squadId) {
		throw new Error(`Member ${memberId} was not found in squad ${squadId}.`);
	}

	const updated = await updateMember(memberId, {
		role,
		systemPrompt,
		model: model === "" ? null : model,
	});

	if (!updated) {
		throw new Error(`Failed to update member ${memberId}.`);
	}

	eventBus.emit(EVENT_NAMES.SQUAD_MEMBER_UPDATED, {
		squadId,
		member: updated,
	});

	return {
		message: `Updated member "${updated.name}" in squad "${squad.name}".`,
		member: updated,
	};
}

export function createSquadToolExecutor(_config: Config): OrchestratorToolExecutor {
	return async (toolName, rawArgs) => {
		switch (toolName) {
			case "create_squad":
				return handleCreateSquad(rawArgs);
			case "add_squad_member":
				return handleAddSquadMember(rawArgs);
			case "remove_squad_member":
				return handleRemoveSquadMember(rawArgs);
			case "update_squad_config":
				return handleUpdateSquadConfig(rawArgs);
			case "analyze_repo":
				return handleAnalyzeRepo(rawArgs);
			case "fire_squad":
				return handleFireSquad(rawArgs);
			case "restore_squad":
				return handleRestoreSquad(rawArgs);
			case "list_deleted_squads": {
				const deletedSquads = await listDeletedSquads();
				if (deletedSquads.length === 0) {
					return { message: "No deleted squads.", squads: [] };
				}
				const list = deletedSquads
					.map((s) => `${s.id}: ${s.name} (${s.repoOwner}/${s.repoName}) [deleted ${s.deletedAt}]`)
					.join("\n");
				return { message: list, squads: deletedSquads };
			}
			case "list_squads": {
				const squads = await listSquads();
				const deletedCount = (await listDeletedSquads()).length;
				const suffix =
					deletedCount > 0
						? `\n\n${deletedCount} deleted squad(s) available for restore (use list_deleted_squads to view).`
						: "";
				return {
					message: formatSquadList(squads) + suffix,
					squads,
					deletedCount,
				};
			}
			case "get_squad_status": {
				const { squadId } = squadIdSchema.parse(rawArgs);
				const status = await getSquadStatus(squadId);
				return {
					message: `Squad ${status.squad.name} has ${status.activeObjectivesCount} active objective(s).`,
					...status,
				};
			}
			case "delegate_to_squad":
				return handleDelegateToSquad(rawArgs);
			case "rename_squad": {
				const { squadId, name } = renameSquadSchema.parse(rawArgs);
				const updated = await updateSquad(squadId, { name });
				if (!updated) {
					throw new Error(`Squad ${squadId} was not found.`);
				}

				eventBus.emit(EVENT_NAMES.SQUAD_UPDATED, { squad: updated });
				return {
					message: `Squad renamed to "${updated.name}".`,
					squad: updated,
				};
			}
			case "update_squad_member":
				return handleUpdateSquadMember(rawArgs);
			default:
				throw new Error(`Unsupported squad tool: ${toolName}`);
		}
	};
}
