import { Router } from 'express';
import { getInstance, getSquadInstances } from '../../squad/execution/instance.js';
import { runInstance } from '../../squad/execution/runner.js';
import { getSquadByName, getSquadMembers, listSquads } from '../../squad/manager.js';
import { getDatabase } from '../../store/db.js';

function isActiveInstance(status: string): boolean {
	return status !== 'complete' && status !== 'failed';
}

export function squadsRouter(): Router {
	const router = Router();

	/**
	 * GET /api/squads
	 * List all active squads.
	 */
	router.get('/squads', async (_req, res) => {
		try {
			const db = getDatabase();
			const squads = await listSquads();
			const results = await Promise.all(
				squads.map(async (s) => {
					const members = await getSquadMembers(s.id);
					const instances = getSquadInstances(s.id);
					const activeInstances = instances.filter((i) => isActiveInstance(i.status)).length;

					// Fetch last 5 instances (work items/prompts) for this squad
						const instanceResult = await db.execute({
							sql: `SELECT id, status, objective, issue_ref, created_at
							      FROM squad_instances
						      WHERE squad_id = ?
							      ORDER BY created_at DESC
						      LIMIT 5`,
						args: [s.id],
					});
						const recentActivity = instanceResult.rows.map((row) => ({
							id: row.id as string,
							status: row.status as string,
							objective: row.objective as string | null,
							issueRef: row.issue_ref as string | null,
							timestamp: row.created_at as string,
						}));

					return {
						id: s.id,
						name: s.name,
						projectPath: s.projectPath,
						repoUrl: s.repoUrl,
						universe: s.universe,
						autonomyTier: s.autonomyTier,
						status: activeInstances > 0 ? 'active' : 'idle',
						memberCount: members.length,
						activeInstances,
						totalInstances: instances.length,
						createdAt: s.createdAt.toISOString(),
						recentActivity,
					};
				}),
			);
			res.json({ squads: results });
		} catch (err) {
			res.status(500).json({ error: 'Failed to list squads' });
		}
	});

	/**
	 * GET /api/squads/:name
	 * Get detailed squad info.
	 */
	router.get('/squads/:name', async (req, res) => {
		try {
			const squad = await getSquadByName(req.params.name);
			if (!squad) {
				res.status(404).json({ error: `Squad '${req.params.name}' not found` });
				return;
			}

			const members = await getSquadMembers(squad.id);
			const instances = getSquadInstances(squad.id);
			const activeInstances = instances.filter((inst) => isActiveInstance(inst.status));

			// Build a map of role -> current task (from active instances)
			const currentTasks = new Map<string, string>();
			// Determine if any active instance is in meeting/planning phase
			const meetingInstance = activeInstances.find((i) => i.status === 'meeting');
			const planningInstance = activeInstances.find((i) => i.status === 'planning');
			for (const inst of activeInstances) {
				for (const task of inst.tasks) {
					if (task.status === 'in_progress') {
						currentTasks.set(task.assignedTo, task.description);
					}
				}
			}

			res.json({
				squad: {
					id: squad.id,
					name: squad.name,
					projectPath: squad.projectPath,
					repoUrl: squad.repoUrl,
					universe: squad.universe,
					autonomyTier: squad.autonomyTier,
					autonomyConfig: squad.autonomyConfig,
					status: activeInstances.length > 0 ? 'active' : 'idle',
					createdAt: squad.createdAt.toISOString(),
				},
				members: members.map((m) => {
					const currentTask = currentTasks.get(m.roleName) ?? null;
					const phaseStatus = meetingInstance
						? 'in meeting'
						: planningInstance
							? 'planning'
							: null;
					return {
						id: m.id,
						displayName: m.displayName,
						role: m.roleName,
						roleName: m.roleName,
						persona: m.persona,
						veto: m.isVetoMember,
						tools: m.toolsAllowed,
						status: currentTask ? 'working' : phaseStatus ?? 'idle',
						currentTask,
					};
				}),
				instances: instances.map((i) => ({
					id: i.id,
					status: i.status,
					issueRef: i.issueRef,
					branch: i.branch,
					taskCount: i.tasks.length,
					tasksComplete: i.tasks.filter((t) => t.status === 'done').length,
				})),
			});
		} catch (err) {
			res.status(500).json({ error: 'Failed to get squad' });
		}
	});

	/**
	 * POST /api/squads/:name/run
	 * Spawn a new instance for a squad.
	 * Body: { objective: string, issueRef?: string }
	 */
	router.post('/squads/:name/run', async (req, res) => {
		try {
			const squad = await getSquadByName(req.params.name);
			if (!squad) {
				res.status(404).json({ error: `Squad '${req.params.name}' not found` });
				return;
			}

			const { objective, issueRef } = req.body as {
				objective?: string;
				issueRef?: string;
			};

			if (!objective) {
				res.status(400).json({ error: 'objective is required' });
				return;
			}

			// Run asynchronously — return immediately with instance ID
			const instancePromise = runInstance({ squad, objective, issueRef });

			// We don't await — return accepted status
			// The client can poll /api/squads/:name for progress
			instancePromise.catch(() => {}); // prevent unhandled rejection

			res.status(202).json({
				message: `Instance starting for squad '${squad.name}'`,
				objective,
			});
		} catch (err) {
			res.status(500).json({ error: 'Failed to start instance' });
		}
	});

	/**
	 * GET /api/squads/:name/instances/:instanceId
	 * Get detailed instance info with agent activity.
	 */
	router.get('/squads/:name/instances/:instanceId', async (req, res) => {
		try {
			const squad = await getSquadByName(req.params.name);
			if (!squad) {
				res.status(404).json({ error: `Squad '${req.params.name}' not found` });
				return;
			}

			const instance = getInstance(req.params.instanceId);
			if (!instance || instance.squadId !== squad.id) {
				res.status(404).json({ error: 'Instance not found' });
				return;
			}

			const members = await getSquadMembers(squad.id);
			const db = getDatabase();

			// Fetch agent activity for this instance
			const activityResult = await db.execute({
				sql: `SELECT id, agent_role, activity_type, content, model_used, tokens_used, timestamp
				      FROM agent_activity
				      WHERE instance_id = ?
				      ORDER BY timestamp ASC`,
				args: [instance.id],
			});

			const activity = activityResult.rows.map((row) => ({
				id: row.id as string,
				agent: row.agent_role as string,
				type: row.activity_type as string,
				content: row.content as string,
				model: row.model_used as string | null,
				tokensUsed: row.tokens_used as number | null,
				timestamp: row.timestamp as string,
			}));

			// Build member status from tasks
			const memberDetails = members.map((m) => {
				const task = instance.tasks.find(
					(t) => t.assignedTo === m.roleName && t.status === 'in_progress',
				);
				// During meeting/planning phases, all agents are participating
				const phaseStatus =
					instance.status === 'meeting'
						? 'in meeting'
						: instance.status === 'planning'
							? 'planning'
							: null;
				return {
					id: m.id,
					displayName: m.displayName,
					role: m.roleName,
					roleName: m.roleName,
					status: task ? 'working' : phaseStatus ?? 'idle',
					currentTask: task?.description ?? null,
				};
			});

			res.json({
				instance: {
					id: instance.id,
					status: instance.status,
					branch: instance.branch,
					issueRef: instance.issueRef,
					taskCount: instance.tasks.length,
					tasksComplete: instance.tasks.filter((t) => t.status === 'done').length,
					tasks: instance.tasks.map((t) => ({
						id: t.id,
						description: t.description,
						assignedTo: t.assignedTo,
						status: t.status,
					})),
					meetingLog: instance.meetingLog,
				},
				members: memberDetails,
				activity,
			});
		} catch (err) {
			res.status(500).json({ error: 'Failed to get instance detail' });
		}
	});

	return router;
}
