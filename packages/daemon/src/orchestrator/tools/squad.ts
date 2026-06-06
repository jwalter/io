import { exec } from "node:child_process";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { EVENT_NAMES, QA_MAX_REVISIONS, type Squad, type SquadConfig, type SquadMember } from "@io/shared";
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
import { hireSquad, proposeSquadComposition } from "../../squad/hiring.js";
import { getSquadStatus } from "../../squad/manager.js";
import {
	createObjective,
	deleteSquad,
	getActiveObjectives,
	getMember,
	getSquad,
	listSquads,
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

const hireSquadSchema = z.object({
	repoUrl: z.string().trim().min(1).describe("The repository URL to hire a squad for"),
	context: z
		.string()
		.optional()
		.describe(
			"Additional context from the user to guide squad composition and role selection. Include any specifics about what areas of the codebase the squad will focus on, what technologies matter most, or what kind of work they will do.",
		),
	scanPaths: z
		.array(z.string())
		.optional()
		.describe(
			"Relative paths within the repository to focus the analysis on. When provided, only these directories are scanned for technology detection instead of the entire repo. Extract these from the user's context when they mention specific folders, solution files, or project subsets.",
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
		name: "hire_squad",
		description:
			"Hire or refresh a squad for a repository. Optionally provide context to guide role selection and scanPaths to focus the repo analysis on specific directories.",
		parameters: hireSquadSchema,
		skipPermission: true,
	},
	{
		name: "fire_squad",
		description: "Deactivate or delete a squad.",
		parameters: squadIdSchema,
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

function getDefaultSquadConfig(_config: Config): SquadConfig {
	return {
		prMode: "draft-pr",
		mcpServers: [],
		maxRevisions: QA_MAX_REVISIONS,
	};
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

	// Clone or locate the repo locally for deep analysis
	const repoDir = join(DATA_DIR, "repos", `${owner}--${name}`);
	try {
		await mkdir(join(DATA_DIR, "repos"), { recursive: true });
		if (await pathExists(join(repoDir, ".git"))) {
			// Pull latest
			await execAsync("git pull --ff-only", { cwd: repoDir, timeout: 30_000 }).catch(
				() => undefined,
			);
		} else {
			await execAsync(`git clone --depth 50 ${normalized} "${repoDir}"`, {
				timeout: 60_000,
			});
		}
	} catch {
		lines.push("Unable to clone repository locally; falling back to basic analysis.");
		lines.push("Based on the repository name, propose roles that match common project patterns.");
		return lines.join("\n");
	}

	// Determine scan roots: use scanPaths if provided, otherwise scan the repo root
	const scanRoots =
		scanPaths && scanPaths.length > 0
			? scanPaths.map((p) => ({ path: join(repoDir, p), label: p }))
			: [{ path: repoDir, label: "" }];

	if (scanPaths && scanPaths.length > 0) {
		lines.push(`Focused scan paths: ${scanPaths.join(", ")}`);
	}

	// Scan each root for project structure
	for (const root of scanRoots) {
		try {
			const rootLabel = root.label ? `${root.label}/` : "";
			const rootEntries = await readdir(root.path, { withFileTypes: true });
			const rootFiles = rootEntries.filter((e) => e.isFile()).map((e) => e.name);
			const rootDirs = rootEntries
				.filter((e) => e.isDirectory() && e.name !== ".git")
				.map((e) => e.name);

			if (rootFiles.length) lines.push(`${rootLabel}Files: ${rootFiles.join(", ")}`);
			if (rootDirs.length) lines.push(`${rootLabel}Directories: ${rootDirs.join(", ")}`);

			// Read key manifest/config files for technology detection
			const manifestFiles = [
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

			for (const manifest of manifestFiles) {
				const fullPath = join(root.path, manifest);
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

			// Scan src/ or similar directories one level deep for language detection
			const srcDirs = rootDirs.filter((d) =>
				["src", "lib", "app", "packages", "crates", "cmd", "internal"].includes(d),
			);
			for (const srcDir of srcDirs) {
				try {
					const srcEntries = await readdir(join(root.path, srcDir), { withFileTypes: true });
					const srcFiles = srcEntries.filter((e) => e.isFile()).map((e) => e.name);
					const srcSubDirs = srcEntries.filter((e) => e.isDirectory()).map((e) => e.name);
					lines.push(`\n--- ${rootLabel}${srcDir}/ ---`);
					if (srcSubDirs.length) lines.push(`  Directories: ${srcSubDirs.join(", ")}`);
					if (srcFiles.length) lines.push(`  Files: ${srcFiles.slice(0, 30).join(", ")}`);
				} catch {
					// Skip
				}
			}

			// Check README for project description
			const readmeCandidates = ["README.md", "README.rst", "README.txt", "README"];
			for (const readme of readmeCandidates) {
				try {
					const content = await readFile(join(root.path, readme), "utf8");
					lines.push(`\n--- ${rootLabel}${readme} (excerpt) ---\n${content.slice(0, 1500)}`);
					break;
				} catch {
					// Next candidate
				}
			}
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
		// Process queue: start next instance if capacity allows
		try {
			const running = await countRunningInstances(squad.id);
			const config = (await import("../../config.js")).loadConfig();
			if (running < config.maxInstancesPerSquad) {
				const next = await getNextQueued(squad.id);
				if (next) {
					const freshSquad = await getSquad(squad.id);
					if (freshSquad) {
						void startAndExecuteInstance(next.id, freshSquad, next.objectiveId);
					}
				}
			}
		} catch {
			// Non-fatal — queue will be processed on next trigger
		}
	}
}

export function createSquadToolExecutor(config: Config): OrchestratorToolExecutor {
	return async (toolName, rawArgs) => {
		switch (toolName) {
			case "hire_squad": {
					const { repoUrl, context, scanPaths } = hireSquadSchema.parse(rawArgs);
				const composition = await proposeSquadComposition(
					repoUrl,
						await buildRepoAnalysis(repoUrl, scanPaths),
						context,
					);
					const result = await hireSquad(repoUrl, composition, getDefaultSquadConfig(config));
					return {
						message: `Squad ready for ${repoUrl}.`,
						squad: result.squad,
						members: result.members,
					};
				}
			case "fire_squad": {
				const { squadId } = squadIdSchema.parse(rawArgs);
				const squad = await getSquad(squadId);
				if (!squad) {
					throw new Error(`Squad ${squadId} was not found.`);
				}

				const activeObjectives = await getActiveObjectives(squadId);
				if (activeObjectives.length > 0) {
					const updated = await updateSquad(squadId, { status: "inactive" });
					return {
						message: `Squad ${squadId} was deactivated because it still has active objectives.`,
						squad: updated,
						activeObjectives,
					};
				}

				await deleteSquad(squadId);
				return { message: `Squad ${squadId} was deleted.`, squadId };
			}
			case "list_squads": {
				const squads = await listSquads();
				return {
					message: formatSquadList(squads),
					squads,
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
			case "delegate_to_squad": {
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
					// Start the instance in the background
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
				case "update_squad_member": {
					const { squadId, memberId, role, systemPrompt, model } =
						updateSquadMemberSchema.parse(rawArgs);

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
			default:
				throw new Error(`Unsupported squad tool: ${toolName}`);
		}
	};
}
