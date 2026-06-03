import { Router } from 'express';
import type { ActivityType } from '../../store/activity.js';
import { getInstance, getSquadInstances } from '../../squad/execution/instance.js';
import { executeInstance, initInstance } from '../../squad/execution/runner.js';
import { getSquadByName, getSquadMembers, listSquads } from '../../squad/manager.js';
import { getDatabase } from '../../store/db.js';

function isActiveInstance(status: string): boolean {
	return status !== 'complete' && status !== 'failed';
}

/** Condense a potentially long objective into a short title (first line, max 80 chars). */
function condensedTitle(objective: string | null | undefined): string {
	if (!objective) return 'Untitled task';
	const firstLine = objective.split('\n')[0]?.trim() || objective.trim();
	if (firstLine.length <= 80) return firstLine;
	return `${firstLine.slice(0, 77)}…`;
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
							color: s.color,
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
					color: squad.color,
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

			// Await init to ensure instance is persisted before responding
			const { instance, runtime } = await initInstance({ squad, objective, issueRef });

			// Fire-and-forget execution phase
			executeInstance({ instance, runtime, squad, objective }).catch(() => {});

			res.status(202).json({
				message: `Instance starting for squad '${squad.name}'`,
				instanceId: instance.id,
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

			const activity = activityResult.rows.map((row) => {
				let content = row.content as string ?? '';
				let toolName: string | null = null;
				let success: boolean | null = null;
				try {
					const parsed = JSON.parse(content);
					if (typeof parsed === 'object' && parsed !== null) {
						toolName = parsed.tool ?? null;
						success = typeof parsed.success === 'boolean' ? parsed.success : null;
						// Format content based on type
						if (toolName && parsed.arguments) {
							const args = parsed.arguments;
							if (typeof args === 'object' && args !== null && args.command) {
								content = String(args.command);
							} else if (typeof args === 'string') {
								content = args;
							} else {
								content = JSON.stringify(args, null, 2);
							}
						} else if (parsed.result) {
							content = String(parsed.result);
						} else if (parsed.error) {
							content = String(parsed.error);
						} else {
							content = parsed.message ?? parsed.content ?? parsed.response ?? parsed.decision ?? JSON.stringify(parsed, null, 2);
						}
					}
				} catch {
					// content is already a plain string
				}
				return {
					id: row.id as string,
					agent: row.agent_role as string,
					type: row.activity_type as string,
					content,
					toolName,
					success,
					model: row.model_used as string | null,
					tokensUsed: row.tokens_used as number | null,
					timestamp: row.timestamp as string,
				};
			});

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
					squadColor: squad.color,
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

	/**
	 * GET /api/squads/:name/history
	 * List completed/errored tasks for a squad (both instances and delegations).
	 */
	router.get('/squads/:name/history', async (req, res) => {
		try {
			const squad = await getSquadByName(req.params.name);
			if (!squad) {
				res.status(404).json({ error: `Squad '${req.params.name}' not found` });
				return;
			}

			const limit = Math.min(Number(req.query.limit) || 25, 100);
			const offset = Number(req.query.offset) || 0;

			const db = getDatabase();

			const countResult = await db.execute({
				sql: `SELECT COUNT(*) as total FROM squad_instances WHERE squad_id = ? AND status IN ('complete', 'failed')`,
				args: [squad.id],
			});
			const total = (countResult.rows[0]?.total as number) ?? 0;

			const result = await db.execute({
				sql: `SELECT si.id, si.type, si.objective, si.status, si.created_at, si.completed_at,
				             (SELECT COUNT(DISTINCT agent_role) FROM agent_activity WHERE instance_id = si.id) as agent_count
				      FROM squad_instances si
				      WHERE si.squad_id = ? AND si.status IN ('complete', 'failed')
				      ORDER BY si.completed_at DESC
				      LIMIT ? OFFSET ?`,
				args: [squad.id, limit, offset],
			});

			const items = result.rows.map((row) => {
				const createdAt = row.created_at as string;
				const completedAt = row.completed_at as string;
				let duration = '';
				if (createdAt && completedAt) {
					const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
					const mins = Math.floor(ms / 60000);
					if (mins >= 60) {
						duration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
					} else {
						duration = `${mins}m`;
					}
				}
				return {
					id: row.id as string,
					title: condensedTitle(row.objective as string),
					type: (row.type as string) ?? 'instance',
					status: row.status === 'complete' ? 'completed' : 'errored',
					createdAt,
					completedAt,
					duration,
					agentCount: (row.agent_count as number) ?? 0,
				};
			});

			res.json({ items, total });
		} catch (err) {
			res.status(500).json({ error: 'Failed to get squad history' });
		}
	});

	/**
	 * GET /api/squads/:name/history/:taskId
	 * Get detailed history for a specific task including agent entries and event timelines.
	 */
	router.get('/squads/:name/history/:taskId', async (req, res) => {
		try {
			const squad = await getSquadByName(req.params.name);
			if (!squad) {
				res.status(404).json({ error: `Squad '${req.params.name}' not found` });
				return;
			}

			const db = getDatabase();
			const { activityTypeToEventKind } = await import('../../store/activity.js');

			// Get the instance/delegation record
			const instanceResult = await db.execute({
				sql: `SELECT id, type, objective, status, created_at, completed_at
				      FROM squad_instances WHERE id = ? AND squad_id = ?`,
				args: [req.params.taskId, squad.id],
			});

			if (instanceResult.rows.length === 0) {
				res.status(404).json({ error: 'Task not found' });
				return;
			}

			const row = instanceResult.rows[0];
			const createdAt = row.created_at as string;
			const completedAt = row.completed_at as string;
			let duration = '';
			if (createdAt && completedAt) {
				const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
				const mins = Math.floor(ms / 60000);
				if (mins >= 60) {
					duration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
				} else {
					duration = `${mins}m`;
				}
			}

			// Get all activity entries for this task
			const activityResult = await db.execute({
				sql: `SELECT id, agent_role, activity_type, content, label, status, timestamp
				      FROM agent_activity
				      WHERE instance_id = ?
				      ORDER BY timestamp ASC`,
				args: [req.params.taskId],
			});

			// Get squad members for display names and role types
			const members = await getSquadMembers(squad.id);
			const memberMap = new Map(members.map((m) => [m.roleName, m]));

			// Group activity by agent role
			const agentGroups = new Map<
				string,
				{ events: Array<{ id: number; kind: string; timestamp: string; label: string | null; content: string; status: string | null }> }
			>();

			for (const actRow of activityResult.rows) {
				const agentRole = actRow.agent_role as string;
				if (!agentGroups.has(agentRole)) {
					agentGroups.set(agentRole, { events: [] });
				}
				const kind = activityTypeToEventKind(actRow.activity_type as ActivityType);
				let content = actRow.content as string ?? '';
				try {
					const parsed = JSON.parse(content);
					if (typeof parsed === 'object' && parsed !== null) {
						// Format tool events to show relevant content
						if ((kind === 'tool_call' || kind === 'tool_result') && parsed.tool) {
							if (parsed.arguments) {
								const args = parsed.arguments;
								if (typeof args === 'object' && args !== null && args.command) {
									content = String(args.command);
								} else if (typeof args === 'string') {
									content = args;
								} else {
									content = JSON.stringify(args, null, 2);
								}
							} else if (parsed.result) {
								content = String(parsed.result);
							} else if (parsed.error) {
								content = String(parsed.error);
							} else {
								content = JSON.stringify(parsed, null, 2);
							}
						} else {
							content = parsed.message ?? parsed.content ?? parsed.response ?? parsed.decision ?? JSON.stringify(parsed, null, 2);
						}
					}
				} catch {
					// content is already a string
				}
				agentGroups.get(agentRole)!.events.push({
					id: actRow.id as number,
					kind,
					timestamp: actRow.timestamp as string,
					label: actRow.label as string | null,
					content,
					status: actRow.status as string | null,
				});
			}

			// Build agent entries
			const agentEntries = Array.from(agentGroups.entries()).map(([role, data]) => {
				const member = memberMap.get(role);
				const lastEvent = data.events[data.events.length - 1];
				const roleType = role.includes('lead') || role === 'technical-pm'
					? 'lead'
					: role.includes('qa')
						? 'qa'
						: role.includes('scribe')
							? 'scribe'
							: 'default';
				return {
					agentId: member?.id ?? role,
					agentName: member?.displayName ?? role,
					role: member?.roleName ?? role,
					roleType,
					summary: lastEvent?.content?.slice(0, 200) ?? '',
					events: data.events,
				};
			});

			res.json({
				id: row.id as string,
					title: condensedTitle(row.objective as string),
				type: (row.type as string) ?? 'instance',
				status: row.status === 'complete' ? 'completed' : 'errored',
				createdAt,
				completedAt,
				duration,
				agentEntries,
			});
		} catch (err) {
			res.status(500).json({ error: 'Failed to get task detail' });
		}
	});

	return router;
}
