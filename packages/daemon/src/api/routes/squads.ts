import {
	EVENT_NAMES,
	type Objective,
	QA_MAX_REVISIONS,
	type SquadConfig,
	type SquadStatus,
	type UpdateSquadConfigRequest,
} from "@io/shared";
import { Router } from "express";

import { loadConfig } from "../../config.js";
import { eventBus } from "../../event-bus.js";
import {
	cancelInstance,
	getInstance,
	listActiveInstances,
	listInstancesBySquad,
} from "../../execution/instances.js";
import { asNullableString, asNumber, asString, getDatabase } from "../../store/db.js";
import {
	createObjective,
	createSquad,
	deleteSquad,
	getMember,
	getMembers,
	getSquad,
	getSquadActivity,
	getSquadByName,
	listDeletedSquads,
	listSquads,
	logActivity,
	restoreSquad,
	updateMember,
	updateSquad,
} from "../../store/index.js";

const router = Router();
const DEFAULT_CONFIG: SquadConfig = {
	prMode: "draft-pr",
	mcpServers: [],
	maxRevisions: QA_MAX_REVISIONS,
};

async function resolveSquad(idOrName: string) {
	return (await getSquad(idOrName)) ?? (await getSquadByName(idOrName));
}

router.get("/api/squads", async (_req, res) => {
	try {
		const squads = await listSquads();
		const config = loadConfig();
		const enriched = await Promise.all(
			squads.map(async (squad) => {
				const instances = await listActiveInstances(squad.id);
				const allInstances = await listInstancesBySquad(squad.id);
				const members = await getMembers(squad.id);
				return {
					...squad,
					memberCount: members.length,
					activeInstances: instances.filter((i) => i.status === "running").length,
					totalInstances: allInstances.length,
					recentActivity: [],
				};
			}),
		);
		res
			.status(200)
			.json({ squads: enriched, config: { maxInstancesPerSquad: config.maxInstancesPerSquad } });
	} catch (error) {
		res.status(500).json({
			error: "Failed to list squads",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.get("/api/squads/:id", async (req, res) => {
	try {
		const squad = await resolveSquad(req.params.id);
		if (!squad) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		const members = await getMembers(squad.id);
		const instances = await listActiveInstances(squad.id);
		const instanceSummaries = instances.map((inst) => ({
			id: inst.id,
			status: inst.status,
			issueRef: null,
			branch: inst.branch,
			taskCount: 0,
			tasksComplete: 0,
		}));

		res.status(200).json({
			squad,
			members,
			instances: instanceSummaries,
		});
	} catch (error) {
		res.status(500).json({
			error: "Failed to fetch squad",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.post("/api/squads", async (req, res) => {
	try {
		const body = (req.body ?? {}) as Record<string, unknown>;
		const name = typeof body.name === "string" ? body.name.trim() : "";
		const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : "";

		if (!name || !repoUrl) {
			res.status(400).json({ error: "name and repoUrl are required" });
			return;
		}

		const repoInfo = parseRepoInfo(
			repoUrl,
			typeof body.repoOwner === "string" ? body.repoOwner : undefined,
			typeof body.repoName === "string" ? body.repoName : undefined,
		);
		const squad = await createSquad({
			name,
			repoUrl,
			repoOwner: repoInfo.repoOwner,
			repoName: repoInfo.repoName,
			status: (typeof body.status === "string" ? body.status : undefined) as
				| SquadStatus
				| undefined,
			config: normalizeConfig(body.config),
		});

		await logActivity({
			squadId: squad.id,
			event: EVENT_NAMES.SQUAD_CREATED,
			description: `Created squad ${squad.name}`,
			metadata: { repoUrl: squad.repoUrl },
		});
		eventBus.emit(EVENT_NAMES.SQUAD_CREATED, { squad });
		res.status(201).json(squad);
	} catch (error) {
		res.status(isValidationError(error) ? 400 : 500).json({
			error: "Failed to create squad",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.put("/api/squads/:id", async (req, res) => {
	try {
		const existing = await resolveSquad(req.params.id);
		if (!existing) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		const body = (req.body ?? {}) as Record<string, unknown>;
		const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : existing.repoUrl;
		const repoInfo = parseRepoInfo(
			repoUrl,
			typeof body.repoOwner === "string" ? body.repoOwner : existing.repoOwner,
			typeof body.repoName === "string" ? body.repoName : existing.repoName,
		);
		const updated = await updateSquad(req.params.id, {
			name: typeof body.name === "string" ? body.name.trim() : existing.name,
			repoUrl,
			repoOwner: repoInfo.repoOwner,
			repoName: repoInfo.repoName,
			status: (typeof body.status === "string" ? body.status : existing.status) as SquadStatus,
			config: mergeConfig(
				existing.config,
				body.config as UpdateSquadConfigRequest | SquadConfig | undefined,
			),
		});

		if (!updated) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		await logActivity({
			squadId: updated.id,
			event: EVENT_NAMES.SQUAD_UPDATED,
			description: `Updated squad ${updated.name}`,
			metadata: { repoUrl: updated.repoUrl },
		});
		eventBus.emit(EVENT_NAMES.SQUAD_UPDATED, { squad: updated });
		res.status(200).json(updated);
	} catch (error) {
		res.status(isValidationError(error) ? 400 : 500).json({
			error: "Failed to update squad",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.delete("/api/squads/:id", async (req, res) => {
	try {
		const existing = await resolveSquad(req.params.id);
		if (!existing) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		const deleted = await deleteSquad(req.params.id);
		if (!deleted) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		await logActivity({
			squadId: existing.id,
			event: EVENT_NAMES.SQUAD_DELETED,
			description: `Deleted squad ${existing.name}`,
			metadata: { repoUrl: existing.repoUrl },
		});
		eventBus.emit(EVENT_NAMES.SQUAD_DELETED, { squadId: existing.id });
		res.status(200).json({ deleted: true });
	} catch (error) {
		res.status(500).json({
			error: "Failed to delete squad",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.get("/api/squads/deleted", async (_req, res) => {
	try {
		const squads = await listDeletedSquads();
		res.status(200).json({ squads });
	} catch (error) {
		res.status(500).json({
			error: "Failed to list deleted squads",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.post("/api/squads/:id/restore", async (req, res) => {
	try {
		const restored = await restoreSquad(req.params.id);
		if (!restored) {
			res.status(404).json({ error: "Squad not found or not deleted" });
			return;
		}

		await logActivity({
			squadId: restored.id,
			event: EVENT_NAMES.SQUAD_UPDATED,
			description: `Restored squad ${restored.name}`,
			metadata: { repoUrl: restored.repoUrl },
		});
		eventBus.emit(EVENT_NAMES.SQUAD_UPDATED, { squad: restored });
		res.status(200).json({ squad: restored });
	} catch (error) {
		res.status(500).json({
			error: "Failed to restore squad",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.get("/api/squads/:id/members", async (req, res) => {
	try {
		const squad = await resolveSquad(req.params.id);
		if (!squad) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		res.status(200).json(await getMembers(squad.id));
	} catch (error) {
		res.status(500).json({
			error: "Failed to list squad members",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.put("/api/squads/:id/members/:memberId", async (req, res) => {
	try {
		const member = await getMember(req.params.memberId);
		if (!member) {
			res.status(404).json({ error: "Member not found" });
			return;
		}

		const { role, systemPrompt, model } = req.body as {
			role?: string;
			systemPrompt?: string;
			model?: string;
		};

		const updated = await updateMember(member.id, {
			role,
			systemPrompt,
			model: model === "" ? null : model,
		});

		eventBus.emit(EVENT_NAMES.SQUAD_MEMBER_UPDATED, {
			squadId: member.squadId,
			member: updated!,
		});

		res.status(200).json(updated);
	} catch (error) {
		res.status(500).json({
			error: "Failed to update member",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.post("/api/squads/:id/objectives", async (req, res) => {
	try {
		const squad = await resolveSquad(req.params.id);
		if (!squad) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		const description =
			typeof req.body?.description === "string" ? req.body.description.trim() : "";
		if (!description) {
			res.status(400).json({ error: "description is required" });
			return;
		}

		const objective = await createObjective(req.params.id, description);
		await logActivity({
			squadId: squad.id,
			objectiveId: objective.id,
			event: "objective.created",
			description,
		});
		res.status(201).json(objective);
	} catch (error) {
		res.status(500).json({
			error: "Failed to create objective",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.get("/api/squads/:id/objectives", async (req, res) => {
	try {
		const squad = await resolveSquad(req.params.id);
		if (!squad) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		res.status(200).json(await listObjectivesForSquad(squad.id));
	} catch (error) {
		res.status(500).json({
			error: "Failed to list squad objectives",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

async function listObjectivesForSquad(squadId: string): Promise<Objective[]> {
	const database = await getDatabase();
	const result = await database.execute({
		sql: "SELECT * FROM objectives WHERE squad_id = ? ORDER BY updated_at DESC, created_at DESC, id DESC",
		args: [squadId],
	});

	return result.rows.map((row) => ({
		id: asString(row.id),
		squadId: asString(row.squad_id),
		description: asString(row.description),
		status: asString(row.status) as Objective["status"],
		plan: asNullableString(row.plan),
		revisionCount: asNumber(row.revision_count),
		branch: asNullableString(row.branch),
		prUrl: asNullableString(row.pr_url),
		createdAt: asString(row.created_at),
		updatedAt: asString(row.updated_at),
	}));
}

function normalizeConfig(input: unknown): SquadConfig {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return { ...DEFAULT_CONFIG };
	}

	return mergeConfig(DEFAULT_CONFIG, input as UpdateSquadConfigRequest | SquadConfig);
}

function mergeConfig(
	baseConfig: SquadConfig,
	updates: UpdateSquadConfigRequest | SquadConfig | undefined,
): SquadConfig {
	if (!updates || typeof updates !== "object") {
		return { ...baseConfig };
	}

	const nextConfig: SquadConfig = {
		prMode: typeof updates.prMode === "string" ? updates.prMode : baseConfig.prMode,
		mcpServers: Array.isArray(updates.mcpServers)
			? updates.mcpServers.filter((server): server is string => typeof server === "string")
			: baseConfig.mcpServers,
		maxRevisions:
			"maxRevisions" in updates &&
			typeof updates.maxRevisions === "number" &&
			updates.maxRevisions > 0
				? updates.maxRevisions
				: baseConfig.maxRevisions,
	};

	if (!nextConfig.prMode) {
		throw new Error("Invalid squad config");
	}

	return nextConfig;
}

function parseRepoInfo(
	repoUrl: string,
	repoOwner?: string,
	repoName?: string,
): { repoOwner: string; repoName: string } {
	if (repoOwner?.trim() && repoName?.trim()) {
		return { repoOwner: repoOwner.trim(), repoName: repoName.trim() };
	}

	const url = new URL(repoUrl);
	const segments = url.pathname
		.replace(/\.git$/i, "")
		.split("/")
		.filter(Boolean);
	if (segments.length < 2) {
		throw new Error("repoUrl must include owner and repository name");
	}

	return {
		repoOwner: repoOwner?.trim() || segments[0],
		repoName: repoName?.trim() || segments[1],
	};
}

function isValidationError(error: unknown): boolean {
	return error instanceof Error && /repoUrl|config|Invalid URL/i.test(error.message);
}

// ─── History Routes ───────────────────────────────────────────────────────────

router.get("/api/squads/:id/history", async (req, res) => {
	try {
		const squad = await resolveSquad(req.params.id);
		if (!squad) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
		const offset = Math.max(Number(req.query.offset) || 0, 0);
		const items = await getSquadActivity(squad.id, limit, offset);
		res.status(200).json({ items, total: items.length < limit ? offset + items.length : -1 });
	} catch (error) {
		res.status(500).json({
			error: "Failed to fetch squad history",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.get("/api/squads/:id/history/:activityId", async (req, res) => {
	try {
		const squad = await resolveSquad(req.params.id);
		if (!squad) {
			res.status(404).json({ error: "Squad not found" });
			return;
		}

		const database = await getDatabase();
		const result = await database.execute({
			sql: "SELECT * FROM activity WHERE id = ? AND squad_id = ? LIMIT 1",
			args: [req.params.activityId, squad.id],
		});
		const row = result.rows[0];
		if (!row) {
			res.status(404).json({ error: "Activity not found" });
			return;
		}

		res.status(200).json({
			id: asString(row.id),
			squadId: asString(row.squad_id),
			objectiveId: asNullableString(row.objective_id),
			event: asString(row.event),
			description: asNullableString(row.description),
			metadata: row.metadata ? JSON.parse(asString(row.metadata)) : null,
			createdAt: asString(row.created_at),
		});
	} catch (error) {
		res.status(500).json({
			error: "Failed to fetch activity detail",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

// ─── Instance Routes ──────────────────────────────────────────────────────────

router.get("/api/squads/:name/instances/:instanceId", async (req, res) => {
	try {
		const instance = await getInstance(req.params.instanceId);
		if (!instance) {
			res.status(404).json({ error: "Instance not found" });
			return;
		}

		const squad = await getSquad(instance.squadId);
		const members = squad ? await getMembers(squad.id) : [];
		const tasks = instance.objectiveId ? await getTasksForInstance(instance.objectiveId) : [];

		res.status(200).json({
			squadColor: squad?.color ?? undefined,
			instance: {
				id: instance.id,
				status: instance.status,
				branch: instance.branch,
				issueRef: null,
				taskCount: tasks.length,
				tasksComplete: tasks.filter((t) => t.status === "completed").length,
				tasks,
				meetingLog: [],
			},
			members: members.map((m) => ({
				id: m.id,
				name: m.name,
				role: m.role,
				displayName: m.name,
				veto: false,
				status: "idle",
				currentTask: null,
			})),
			activity: [],
		});
	} catch (error) {
		res.status(500).json({
			error: "Failed to get instance",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.post("/api/squads/:name/instances/:instanceId/cancel", async (req, res) => {
	try {
		const instance = await cancelInstance(req.params.instanceId);
		res.status(200).json({ instance });
	} catch (error) {
		res.status(500).json({
			error: "Failed to cancel instance",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

async function getTasksForInstance(
	objectiveId: string,
): Promise<Array<{ id: string; description: string; assignedTo: string; status: string }>> {
	const database = await getDatabase();
	const result = await database.execute({
		sql: "SELECT id, title, assignee_id, status FROM tasks WHERE objective_id = ? ORDER BY created_at ASC",
		args: [objectiveId],
	});

	return result.rows.map((row) => ({
		id: asString(row.id),
		description: asString(row.title),
		assignedTo: asNullableString(row.assignee_id) ?? "unassigned",
		status: asString(row.status),
	}));
}

export { router as squadsRouter };
