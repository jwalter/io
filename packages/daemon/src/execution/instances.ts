import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { EVENT_NAMES } from "@io/shared";
import { WIKI_DIR } from "@io/shared/paths";

import { loadConfig } from "../config.js";
import { eventBus } from "../event-bus.js";
import {
	type CreateInstanceInput,
	type SquadInstance,
	countRunningInstances,
	createInstance,
	findStaleInstances,
	getInstance,
	getNextQueued,
	listActiveInstances,
	listInstancesBySquad,
	updateInstanceStatus,
} from "../store/index.js";
import { cleanupWorktree, createWorktree } from "./worktree.js";

export { listInstancesBySquad, listActiveInstances, getInstance };

export interface SpawnInstanceResult {
	instance: SquadInstance;
	queued: boolean;
}

export async function spawnInstance(input: CreateInstanceInput): Promise<SpawnInstanceResult> {
	const config = loadConfig();
	const instance = await createInstance(input);

	emitInstanceEvent(EVENT_NAMES.INSTANCE_CREATED, instance);

	// Check capacity and clean stale before deciding
	await cleanStaleInstances();
	const running = await countRunningInstances(input.squadId);

	if (running < config.maxInstancesPerSquad) {
		// Start immediately — the actual execution is kicked off by the caller
		return { instance, queued: false };
	}

	// At capacity — stays queued
	return { instance, queued: true };
}

export async function startInstance(
	instanceId: string,
	repoPath: string,
	baseBranch: string,
): Promise<SquadInstance> {
	const branchName = `squad/instance-${instanceId.slice(0, 8)}`;

	// Pull latest before creating worktree
	try {
		const { exec } = await import("node:child_process");
		const { promisify } = await import("node:util");
		const execAsync = promisify(exec);
		await execAsync(`git fetch origin && git pull origin ${baseBranch}`, {
			cwd: repoPath,
			maxBuffer: 10 * 1024 * 1024,
		});
	} catch {
		// Non-fatal — worktree will still be created from local state
	}

	const worktreePath = await createWorktree(repoPath, branchName, baseBranch);

	const updated = await updateInstanceStatus(instanceId, "running", {
		branch: branchName,
		worktreePath,
	});

	if (!updated) {
		throw new Error(`Instance ${instanceId} not found during start`);
	}

	emitInstanceEvent(EVENT_NAMES.INSTANCE_STARTED, updated);
	return updated;
}

export async function completeInstance(instanceId: string): Promise<SquadInstance> {
	const instance = await getInstance(instanceId);
	if (!instance) {
		throw new Error(`Instance ${instanceId} not found`);
	}

	// Merge wiki pending pages
	await mergeWikiPages(instance);

	// Cleanup worktree
	if (instance.worktreePath) {
		await cleanupWorktree(instance.worktreePath).catch(() => {});
	}

	const updated = await updateInstanceStatus(instanceId, "completed");
	if (!updated) {
		throw new Error(`Instance ${instanceId} not found during completion`);
	}

	emitInstanceEvent(EVENT_NAMES.INSTANCE_COMPLETED, updated);

	// Process queue
	await processQueue(instance.squadId);
	return updated;
}

export async function failInstance(instanceId: string, error: string): Promise<SquadInstance> {
	const instance = await getInstance(instanceId);
	if (!instance) {
		throw new Error(`Instance ${instanceId} not found`);
	}

	// Cleanup pending wiki (don't merge incomplete work)
	await cleanupPendingWiki(instance);

	// Cleanup worktree
	if (instance.worktreePath) {
		await cleanupWorktree(instance.worktreePath).catch(() => {});
	}

	const updated = await updateInstanceStatus(instanceId, "failed", { error });
	if (!updated) {
		throw new Error(`Instance ${instanceId} not found during failure`);
	}

	emitInstanceEvent(EVENT_NAMES.INSTANCE_FAILED, updated);

	// Process queue
	await processQueue(instance.squadId);
	return updated;
}

export async function cancelInstance(instanceId: string): Promise<SquadInstance> {
	const instance = await getInstance(instanceId);
	if (!instance) {
		throw new Error(`Instance ${instanceId} not found`);
	}

	// Cleanup pending wiki (don't merge cancelled work)
	await cleanupPendingWiki(instance);

	// Cleanup worktree
	if (instance.worktreePath) {
		await cleanupWorktree(instance.worktreePath).catch(() => {});
	}

	const updated = await updateInstanceStatus(instanceId, "cancelled");
	if (!updated) {
		throw new Error(`Instance ${instanceId} not found during cancellation`);
	}

	emitInstanceEvent(EVENT_NAMES.INSTANCE_CANCELLED, updated);

	// Process queue
	await processQueue(instance.squadId);
	return updated;
}

export async function processQueue(squadId: string): Promise<void> {
	const config = loadConfig();
	await cleanStaleInstances();

	const running = await countRunningInstances(squadId);
	if (running >= config.maxInstancesPerSquad) {
		return;
	}

	const next = await getNextQueued(squadId);
	if (!next) {
		return;
	}

	// Transition to running — the actual execution start is handled
	// by the orchestrator/caller who monitors instance events
	emitInstanceEvent(EVENT_NAMES.INSTANCE_STARTED, next);
}

export async function cleanStaleInstances(): Promise<void> {
	const stale = await findStaleInstances();

	for (const instance of stale) {
		if (instance.worktreePath) {
			await cleanupWorktree(instance.worktreePath).catch(() => {});
		}
		await cleanupPendingWiki(instance);
		await updateInstanceStatus(instance.id, "failed", {
			error: "Instance timed out (stale detection)",
		});
		emitInstanceEvent(EVENT_NAMES.INSTANCE_FAILED, instance);
	}
}

export function getWikiPendingDir(instance: SquadInstance): string {
	return join(WIKI_DIR, ".pending", instance.id);
}

async function mergeWikiPages(instance: SquadInstance): Promise<void> {
	const pendingDir = getWikiPendingDir(instance);

	try {
		const entries = await readdir(pendingDir, { withFileTypes: true });
		if (entries.length === 0) {
			await rm(pendingDir, { recursive: true, force: true });
			return;
		}

		// Move all files/directories to the wiki root
		await mkdir(WIKI_DIR, { recursive: true });
		for (const entry of entries) {
			const source = join(pendingDir, entry.name);
			const dest = join(WIKI_DIR, entry.name);
			await rename(source, dest).catch(async () => {
				// If rename fails (cross-device), fall back to copy+delete pattern
				const { cp } = await import("node:fs/promises");
				await cp(source, dest, { recursive: true });
				await rm(source, { recursive: true, force: true });
			});
		}

		await rm(pendingDir, { recursive: true, force: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
}

async function cleanupPendingWiki(instance: SquadInstance): Promise<void> {
	const pendingDir = getWikiPendingDir(instance);
	await rm(pendingDir, { recursive: true, force: true });
}

function emitInstanceEvent(event: string, instance: SquadInstance): void {
	eventBus.emit(event, {
		squadId: instance.squadId,
		instanceId: instance.id,
		status: instance.status,
		branch: instance.branch,
		objectiveId: instance.objectiveId,
	});
}
