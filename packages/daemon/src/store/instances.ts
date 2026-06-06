import {
	type DatabaseClient,
	asNullableString,
	asNumber,
	asString,
	generateId,
	getDatabase,
	nowIso,
} from "./db.js";

export type InstanceStatus =
	| "queued"
	| "running"
	| "completing"
	| "completed"
	| "failed"
	| "cancelled";

export interface SquadInstance {
	id: string;
	squadId: string;
	objectiveId: string | null;
	status: InstanceStatus;
	branch: string | null;
	worktreePath: string | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	error: string | null;
}

export interface CreateInstanceInput {
	squadId: string;
	objectiveId?: string | null;
	branch?: string | null;
}

export async function createInstance(
	input: CreateInstanceInput,
	db?: DatabaseClient,
): Promise<SquadInstance> {
	const database = db ?? (await getDatabase());
	const instance: SquadInstance = {
		id: generateId(),
		squadId: input.squadId,
		objectiveId: input.objectiveId ?? null,
		status: "queued",
		branch: input.branch ?? null,
		worktreePath: null,
		createdAt: nowIso(),
		startedAt: null,
		completedAt: null,
		error: null,
	};

	await database.execute({
		sql: `INSERT INTO squad_instances (id, squad_id, objective_id, status, branch, worktree_path, created_at, started_at, completed_at, error)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			instance.id,
			instance.squadId,
			instance.objectiveId,
			instance.status,
			instance.branch,
			instance.worktreePath,
			instance.createdAt,
			instance.startedAt,
			instance.completedAt,
			instance.error,
		],
	});

	return instance;
}

export async function getInstance(
	instanceId: string,
	db?: DatabaseClient,
): Promise<SquadInstance | null> {
	const database = db ?? (await getDatabase());
	const result = await database.execute({
		sql: "SELECT * FROM squad_instances WHERE id = ?",
		args: [instanceId],
	});

	return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listInstancesBySquad(
	squadId: string,
	db?: DatabaseClient,
): Promise<SquadInstance[]> {
	const database = db ?? (await getDatabase());
	const result = await database.execute({
		sql: "SELECT * FROM squad_instances WHERE squad_id = ? ORDER BY created_at DESC",
		args: [squadId],
	});

	return result.rows.map(mapRow);
}

export async function listActiveInstances(
	squadId: string,
	db?: DatabaseClient,
): Promise<SquadInstance[]> {
	const database = db ?? (await getDatabase());
	const result = await database.execute({
		sql: "SELECT * FROM squad_instances WHERE squad_id = ? AND status IN ('queued', 'running', 'completing') ORDER BY created_at ASC",
		args: [squadId],
	});

	return result.rows.map(mapRow);
}

export async function countRunningInstances(squadId: string, db?: DatabaseClient): Promise<number> {
	const database = db ?? (await getDatabase());
	const result = await database.execute({
		sql: "SELECT COUNT(*) AS cnt FROM squad_instances WHERE squad_id = ? AND status = 'running'",
		args: [squadId],
	});

	return result.rows[0] ? asNumber(result.rows[0].cnt) : 0;
}

export async function getNextQueued(
	squadId: string,
	db?: DatabaseClient,
): Promise<SquadInstance | null> {
	const database = db ?? (await getDatabase());
	const result = await database.execute({
		sql: "SELECT * FROM squad_instances WHERE squad_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1",
		args: [squadId],
	});

	return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function updateInstanceStatus(
	instanceId: string,
	status: InstanceStatus,
	updates?: { branch?: string; worktreePath?: string; error?: string },
	db?: DatabaseClient,
): Promise<SquadInstance | null> {
	const database = db ?? (await getDatabase());
	const now = nowIso();

	const sets: string[] = ["status = ?"];
	const args: Array<string | null> = [status];

	if (status === "running") {
		sets.push("started_at = ?");
		args.push(now);
	}

	if (status === "completed" || status === "failed" || status === "cancelled") {
		sets.push("completed_at = ?");
		args.push(now);
	}

	if (updates?.branch) {
		sets.push("branch = ?");
		args.push(updates.branch);
	}

	if (updates?.worktreePath) {
		sets.push("worktree_path = ?");
		args.push(updates.worktreePath);
	}

	if (updates?.error) {
		sets.push("error = ?");
		args.push(updates.error);
	}

	args.push(instanceId);

	await database.execute({
		sql: `UPDATE squad_instances SET ${sets.join(", ")} WHERE id = ?`,
		args,
	});

	return getInstance(instanceId, database);
}

export async function findStaleInstances(db?: DatabaseClient): Promise<SquadInstance[]> {
	const database = db ?? (await getDatabase());
	// Instances stuck in 'running' for more than 6 hours are considered stale
	const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
	const result = await database.execute({
		sql: "SELECT * FROM squad_instances WHERE status = 'running' AND started_at < ?",
		args: [cutoff],
	});

	return result.rows.map(mapRow);
}

function mapRow(row: Record<string, unknown>): SquadInstance {
	return {
		id: asString(row.id),
		squadId: asString(row.squad_id),
		objectiveId: asNullableString(row.objective_id),
		status: asString(row.status) as InstanceStatus,
		branch: asNullableString(row.branch),
		worktreePath: asNullableString(row.worktree_path),
		createdAt: asString(row.created_at),
		startedAt: asNullableString(row.started_at),
		completedAt: asNullableString(row.completed_at),
		error: asNullableString(row.error),
	};
}
