import { QA_MAX_REVISIONS, type Squad, type SquadConfig } from "@io/shared";
import { z } from "zod";

import type { Config } from "../../config.js";
import type { ToolDefinition } from "../../copilot/session.js";
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
	getSquad,
	listSquads,
	updateSquad,
} from "../../store/index.js";

export type OrchestratorToolResult = string | Record<string, unknown> | null | undefined;
export type OrchestratorToolExecutor = (
	toolName: string,
	args: Record<string, unknown>,
) => Promise<OrchestratorToolResult>;

const hireSquadSchema = z.object({
	repoUrl: z.string().trim().min(1),
});

const squadIdSchema = z.object({
	squadId: z.string().trim().min(1),
});

const delegateToSquadSchema = z.object({
	squadId: z.string().trim().min(1),
	objective: z.string().trim().min(1),
});

export const squadToolDefinitions: ToolDefinition[] = [
	{
		name: "hire_squad",
		description: "Hire or refresh a squad for a repository.",
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
];

function getDefaultSquadConfig(_config: Config): SquadConfig {
	return {
		prMode: "draft-pr",
		mcpServers: [],
		maxRevisions: QA_MAX_REVISIONS,
	};
}

async function buildRepoAnalysis(repoUrl: string): Promise<string> {
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

	const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}

	try {
		// Fetch repo metadata
		const metaRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
		if (metaRes.ok) {
			const meta = (await metaRes.json()) as {
				description?: string;
				language?: string;
				topics?: string[];
			};
			if (meta.description) lines.push(`Description: ${meta.description}`);
			if (meta.language) lines.push(`Primary language: ${meta.language}`);
			if (meta.topics?.length) lines.push(`Topics: ${meta.topics.join(", ")}`);
		}

		// Fetch repo tree (shallow)
		const treeRes = await fetch(
			`https://api.github.com/repos/${owner}/${name}/git/trees/HEAD?recursive=false`,
			{ headers },
		);
		if (treeRes.ok) {
			const tree = (await treeRes.json()) as { tree?: Array<{ path: string; type: string }> };
			const rootFiles = (tree.tree ?? [])
				.filter((entry) => entry.type === "blob")
				.map((entry) => entry.path);
			const rootDirs = (tree.tree ?? [])
				.filter((entry) => entry.type === "tree")
				.map((entry) => entry.path);
			if (rootFiles.length) lines.push(`Root files: ${rootFiles.join(", ")}`);
			if (rootDirs.length) lines.push(`Root directories: ${rootDirs.join(", ")}`);
		}

		// Fetch key manifest files for tech detection
		const manifests = [
			"package.json",
			"Cargo.toml",
			"go.mod",
			"requirements.txt",
			"pyproject.toml",
		];
		for (const manifest of manifests) {
			try {
				const fileRes = await fetch(
					`https://api.github.com/repos/${owner}/${name}/contents/${manifest}`,
					{ headers },
				);
				if (fileRes.ok) {
					const file = (await fileRes.json()) as { content?: string; encoding?: string };
					if (file.content && file.encoding === "base64") {
						const decoded = Buffer.from(file.content, "base64").toString("utf8");
						// Truncate to first 2000 chars to avoid huge payloads
						lines.push(`\n--- ${manifest} ---\n${decoded.slice(0, 2000)}`);
					}
				}
			} catch {
				// Skip individual file fetch failures
			}
		}
	} catch {
		// If API calls fail, fall back to just the URL/name
	}

	lines.push(
		"\nBased on the above repository structure, propose roles that match the project's actual technology stack.",
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
				const { repoUrl } = hireSquadSchema.parse(rawArgs);
				const composition = await proposeSquadComposition(
					repoUrl,
					await buildRepoAnalysis(repoUrl),
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
			default:
				throw new Error(`Unsupported squad tool: ${toolName}`);
		}
	};
}
