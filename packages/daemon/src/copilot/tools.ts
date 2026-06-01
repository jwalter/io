import { defineTool } from '@github/copilot-sdk';
import { z } from 'zod';
import { createChildLogger } from '../logging/logger.js';
import {
	activateSkill,
	deactivateSkill,
	getActiveSkills,
	installSkillFromUrl,
	listInstalledSkills,
	removeSkill,
} from '../skills/index.js';
import { runInstance } from '../squad/execution/runner.js';
import {
	addMemberToExistingSquad,
	confirmSquad,
	getProposal,
	proposeSquad,
} from '../squad/hiring.js';
import {
	bootSquad,
	delegateToSquad,
	disbandSquad,
	findMember,
	getSquadByName,
	getSquadMembers,
	getSquadRuntime,
	listSquads,
	removeMember,
	renameMember,
	rethemeSquad,
} from '../squad/manager.js';
import { addInboxEntry, listInboxEntries, resolveInboxEntry } from '../store/inbox.js';
import {
	createSchedule,
	deleteSchedule,
	listSchedules,
	updateSchedule,
} from '../store/schedules.js';
import {
	deleteWikiPage,
	getOrchestratorScopes,
	getPageListing,
	listWikiPages,
	readWikiPage,
	searchWiki,
	writeWikiPage,
} from '../wiki/index.js';
import { queryActivity } from '../store/activity.js';
import { getDatabase } from '../store/db.js';

/** Resolve attachment IDs to disk paths from the database */
async function resolveAttachmentPaths(ids: string[]): Promise<Array<{ type: 'file'; path: string; displayName?: string }>> {
	if (ids.length === 0) return [];
	const db = getDatabase();
	const placeholders = ids.map(() => '?').join(',');
	const result = await db.execute({
		sql: `SELECT id, filename, disk_path FROM attachments WHERE id IN (${placeholders})`,
		args: ids,
	});
	return result.rows
		.filter((row) => row.disk_path)
		.map((row) => ({
			type: 'file' as const,
			path: row.disk_path as string,
			displayName: row.filename as string,
		}));
}

export function createOrchestratorTools() {
	return [
		defineTool('list_squads', {
			description:
				'List all active squads and their current status. Use this when the user asks about their teams or projects.',
			parameters: z.object({}).strict(),
			handler: async () => {
				const squads = await listSquads();
				if (squads.length === 0) {
					return {
						textResultForLlm: JSON.stringify({
							squads: [],
							message: 'No squads currently active.',
						}),
						resultType: 'success' as const,
					};
				}
				const summary = await Promise.all(
					squads.map(async (s) => {
						const members = await getSquadMembers(s.id);
						return {
							name: s.name,
							project: s.projectPath,
							universe: s.universe,
							autonomy: s.autonomyTier,
							members: members.map((m) => `${m.displayName} (${m.roleName})`),
							status: s.status,
						};
					}),
				);
				return {
					textResultForLlm: JSON.stringify({ squads: summary }),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('get_squad_status', {
			description:
				'Get the detailed status of a specific squad including active instances, team members, and recent activity.',
			parameters: z.object({
				squadName: z.string().describe('The name of the squad to check'),
			}),
			handler: async (args: { squadName: string }) => {
				const squad = await getSquadByName(args.squadName);
				if (!squad) {
					return {
						textResultForLlm: JSON.stringify({ error: `Squad '${args.squadName}' not found.` }),
						resultType: 'success' as const,
					};
				}
				const members = await getSquadMembers(squad.id);
				return {
					textResultForLlm: JSON.stringify({
						squad: {
							name: squad.name,
							project: squad.projectPath,
							repo: squad.repoUrl,
							universe: squad.universe,
							autonomy: squad.autonomyTier,
							status: squad.status,
							createdAt: squad.createdAt.toISOString(),
						},
						members: members.map((m) => ({
							name: m.displayName,
							role: m.roleName,
							veto: m.isVetoMember,
							tools: m.toolsAllowed,
						})),
					}),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('propose_squad', {
			description:
				'Propose a new squad for a project. Clones the repo, uses AI to deeply analyze the codebase, recommends senior/principal-level specialist roles, and generates themed character names. Returns a proposal for the user to review before creation. ALWAYS present the proposal conversationally to the user and ask for their feedback before confirming.',
			parameters: z.object({
				repoUrl: z.string().describe('GitHub repository URL (e.g. https://github.com/owner/repo)'),
				name: z.string().optional().describe('Name for the squad (auto-generated if omitted)'),
				universe: z
					.string()
					.optional()
					.describe(
						'Pop-culture universe for member names (e.g. "The A-Team", "Star Wars", "Lord of the Rings"). Random if omitted.',
					),
			}),
			handler: async (args: { repoUrl: string; name?: string; universe?: string }) => {
				try {
					const { ensureCloned } = await import('../squad/source-resolver.js');
					const projectPath = await ensureCloned(args.repoUrl);
					const proposal = await proposeSquad({
						projectPath,
						repoUrl: args.repoUrl,
						name: args.name,
						universe: args.universe,
					});

					const memberSummary = proposal.members.map((m) => ({
						character: m.displayName ?? m.title,
						role: m.title,
						justification: m.justification,
						isCore: m.isCore,
						persona: m.persona ?? '',
					}));

					return {
						textResultForLlm: JSON.stringify({
							message: `Squad proposal ready for "${proposal.projectName}"! Present this to the user for review.`,
							proposalId: proposal.id,
							projectName: proposal.projectName,
							universe: proposal.universe,
							members: memberSummary,
							instructions:
								'Present this squad proposal conversationally. Show each member with their character name, role title, and why they were chosen. Ask the user if they want to approve, modify, or reject the squad. Use confirm_squad with the proposalId to finalize.',
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to propose squad: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('confirm_squad', {
			description:
				'Confirm a squad proposal and create the actual squad. Use after the user has reviewed and approved a proposal from propose_squad. Can optionally remove roles the user rejected.',
			parameters: z.object({
				proposalId: z.string().describe('The proposal ID from propose_squad'),
				name: z
					.string()
					.optional()
					.describe('Override the squad name (uses project name if omitted)'),
				removedRoles: z
					.array(z.string())
					.optional()
					.describe(
						'Role IDs to remove from the proposal (e.g. ["tester", "senior-react-engineer"])',
					),
			}),
			handler: async (args: { proposalId: string; name?: string; removedRoles?: string[] }) => {
				try {
					const proposal = getProposal(args.proposalId);
					if (!proposal) {
						return {
							textResultForLlm: JSON.stringify({
								error: 'Proposal not found or has expired. Use propose_squad to create a new one.',
							}),
							resultType: 'success' as const,
						};
					}

					const result = await confirmSquad({
						proposalId: args.proposalId,
						name: args.name,
						removedRoles: args.removedRoles,
					});

					return {
						textResultForLlm: JSON.stringify({
							message: 'Squad created successfully!',
							squadId: result.squadId,
							universe: result.universe,
							members: result.members,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to confirm squad: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('retheme_squad', {
			description:
				"Change a squad's pop-culture universe. Generates new character names and personas for all members from the specified universe.",
			parameters: z.object({
				squadName: z.string().describe('Name of the squad to retheme'),
				universe: z
					.string()
					.describe('New pop-culture universe (e.g. "The Office", "Star Wars", "Breaking Bad")'),
			}),
			handler: async (args: { squadName: string; universe: string }) => {
				try {
					const squad = await getSquadByName(args.squadName);
					if (!squad) {
						return {
							textResultForLlm: JSON.stringify({ error: `Squad '${args.squadName}' not found.` }),
							resultType: 'success' as const,
						};
					}
					const members = await getSquadMembers(squad.id);
					const roles = members.map((m) => m.roleName);

					const { generateSquadNames } = await import('../squad/name-generator.js');
					const generated = await generateSquadNames(roles, args.universe);

					await rethemeSquad(squad.id, args.universe, generated.assignments);

					return {
						textResultForLlm: JSON.stringify({
							message: `Squad '${args.squadName}' rethemed to ${args.universe}!`,
							members: generated.assignments.map((a) => `${a.displayName} (${a.role})`),
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to retheme squad: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('disband_squad', {
			description:
				'Delete a squad. This disbands the squad, cancels its schedules, resolves pending inbox items, and removes wiki/skill files from disk. The squad record is preserved for usage reports. This cannot be undone.',
			parameters: z.object({
				squadName: z.string().describe('Name of the squad to disband'),
			}),
			handler: async (args: { squadName: string }) => {
				try {
					const squad = await getSquadByName(args.squadName);
					if (!squad) {
						return {
							textResultForLlm: JSON.stringify({ error: `Squad '${args.squadName}' not found.` }),
							resultType: 'success' as const,
						};
					}
					await disbandSquad(squad.id);
					return {
						textResultForLlm: JSON.stringify({
							disbanded: true,
							message: `Squad '${args.squadName}' has been disbanded. Usage data is preserved for reports.`,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to disband squad: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('rename_squad_member', {
			description:
				"Change a squad member's display name. Identify the member by their current display name or role name.",
			parameters: z.object({
				squadName: z.string().describe('Name of the squad'),
				member: z.string().describe('Current display name or role name of the member to rename'),
				newDisplayName: z.string().describe('The new display name for the member'),
			}),
			handler: async (args: { squadName: string; member: string; newDisplayName: string }) => {
				try {
					const squad = await getSquadByName(args.squadName);
					if (!squad) {
						return {
							textResultForLlm: JSON.stringify({ error: `Squad '${args.squadName}' not found.` }),
							resultType: 'success' as const,
						};
					}
					const found = await findMember(squad.id, args.member);
					if (!found) {
						return {
							textResultForLlm: JSON.stringify({
								error: `Member '${args.member}' not found in squad '${args.squadName}'.`,
							}),
							resultType: 'success' as const,
						};
					}
					await renameMember(found.id, args.newDisplayName);
					return {
						textResultForLlm: JSON.stringify({
							renamed: true,
							previousName: found.displayName,
							newName: args.newDisplayName,
							role: found.roleName,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to rename member: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('fire_squad_member', {
			description:
				'Remove (fire) a member from a squad. The member is retired and their running agent is destroyed. Identify by display name or role name.',
			parameters: z.object({
				squadName: z.string().describe('Name of the squad'),
				member: z.string().describe('Display name or role name of the member to fire'),
			}),
			handler: async (args: { squadName: string; member: string }) => {
				try {
					const squad = await getSquadByName(args.squadName);
					if (!squad) {
						return {
							textResultForLlm: JSON.stringify({ error: `Squad '${args.squadName}' not found.` }),
							resultType: 'success' as const,
						};
					}
					const found = await findMember(squad.id, args.member);
					if (!found) {
						return {
							textResultForLlm: JSON.stringify({
								error: `Member '${args.member}' not found in squad '${args.squadName}'.`,
							}),
							resultType: 'success' as const,
						};
					}
					await removeMember(found.id, squad.id);
					return {
						textResultForLlm: JSON.stringify({
							fired: true,
							member: found.displayName,
							role: found.roleName,
							message: `${found.displayName} (${found.roleName}) has been removed from the squad.`,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to fire member: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('hire_squad_member', {
			description:
				"Add a new member to an existing squad. A skill file is generated for the role and the member gets a themed name from the squad's universe.",
			parameters: z.object({
				squadName: z.string().describe('Name of the squad to add a member to'),
				role: z
					.string()
					.describe(
						'Role for the new member (e.g., "frontend-developer", "backend-developer", "devops-engineer", "designer", "qa-tester")',
					),
			}),
			handler: async (args: { squadName: string; role: string }) => {
				try {
					const squad = await getSquadByName(args.squadName);
					if (!squad) {
						return {
							textResultForLlm: JSON.stringify({ error: `Squad '${args.squadName}' not found.` }),
							resultType: 'success' as const,
						};
					}
					const result = await addMemberToExistingSquad({
						squadId: squad.id,
						squadName: squad.name,
						role: args.role,
						projectPath: squad.projectPath,
						universe: squad.universe,
					});
					return {
						textResultForLlm: JSON.stringify({
							hired: true,
							displayName: result.displayName,
							role: result.role,
							squad: args.squadName,
							message: `${result.displayName} (${result.role}) has joined the squad.`,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to hire member: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('delegate_to_squad', {
			description:
				"Delegate a message or task to a specific squad's team lead. Use this for planning, research, questions, analysis, or any task that does NOT require writing/committing code. The squad will work on it in the background and deliver results to the user's inbox. Returns immediately after dispatching. If the user's message included file attachments, pass their IDs so the squad can access them.",
			parameters: z.object({
				squadName: z.string().describe('Name of the squad to delegate to'),
				message: z.string().describe('The full message or task to delegate'),
				attachmentIds: z
					.array(z.string())
					.optional()
					.describe('IDs of file attachments from the conversation to forward to the squad'),
			}),
			handler: async (args: { squadName: string; message: string; attachmentIds?: string[] }) => {
				const squad = await getSquadByName(args.squadName);
				if (!squad) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Squad '${args.squadName}' not found.`,
						}),
						resultType: 'success' as const,
					};
				}

				try {
					// Boot squad if not already running
					if (!getSquadRuntime(squad.id)) {
						await bootSquad(squad);
					}

					// Resolve attachment IDs to disk paths
					const fileAttachments = args.attachmentIds?.length
						? await resolveAttachmentPaths(args.attachmentIds)
						: undefined;

					// Create a delegation history record
					const delegationId = crypto.randomUUID();
					const db = (await import('../store/db.js')).getDatabase();
					await db.execute({
						sql: `INSERT INTO squad_instances (id, squad_id, type, objective, status)
						      VALUES (?, ?, 'delegation', ?, 'working')`,
						args: [delegationId, squad.id, args.message.slice(0, 500)],
					});

					// Fire-and-forget: send message to team lead with inbox delivery instruction
					const delegationMessage = `${args.message}\n\nIMPORTANT: When you have completed this work or have results to share, deliver them to the user's inbox using the add_to_inbox tool. Include a clear title and your findings/deliverables in the content.`;

					delegateToSquad(squad.id, delegationMessage, fileAttachments)
						.then(async (response) => {
							// Log the team lead's response as activity
							const { logActivity } = await import('../store/activity.js');
							await logActivity({
								squadId: squad.id,
								instanceId: delegationId,
								agentRole: 'technical-pm',
								activityType: 'message',
								label: 'Delegation response',
								content: { response: response.slice(0, 1000) },
							});
							// Mark delegation complete
							await db.execute({
								sql: `UPDATE squad_instances SET status = 'complete', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
								args: [delegationId],
							});
						})
						.catch(async (err) => {
							// Mark delegation as failed
							const { logActivity } = await import('../store/activity.js');
							await logActivity({
								squadId: squad.id,
								instanceId: delegationId,
								agentRole: 'technical-pm',
								activityType: 'message',
								label: 'Error',
								status: 'error',
								content: { error: err instanceof Error ? err.message : String(err) },
							});
							await db.execute({
								sql: `UPDATE squad_instances SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
								args: [delegationId],
							});
							createChildLogger('orchestrator').warn(
								{ err, squadName: args.squadName },
								'Background delegation failed',
							);
						});

					return {
						textResultForLlm: JSON.stringify({
							delegated: true,
							squadName: args.squadName,
							message: `Task dispatched to ${args.squadName}. They will deliver results to the inbox when complete.`,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to delegate: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('run_squad_instance', {
			description:
				'Start a new work instance for a squad. This kicks off the full lifecycle: meeting → task execution → PR creation. ONLY use this when the user explicitly wants code written, committed, and a pull request created. Do NOT use for planning, research, analysis, or questions — use delegate_to_squad for those instead. If the user provided file attachments (mockups, specs), pass their IDs so the squad can reference them.',
			parameters: z.object({
				squadName: z.string().describe('Name of the squad'),
				objective: z.string().describe('What the squad should accomplish'),
				issueRef: z.string().optional().describe('GitHub issue reference (e.g., #42)'),
				attachmentIds: z
					.array(z.string())
					.optional()
					.describe('IDs of file attachments from the conversation to forward to the squad'),
			}),
			handler: async (args: { squadName: string; objective: string; issueRef?: string; attachmentIds?: string[] }) => {
				const squad = await getSquadByName(args.squadName);
				if (!squad) {
					return {
						textResultForLlm: JSON.stringify({ error: `Squad '${args.squadName}' not found.` }),
						resultType: 'success' as const,
					};
				}

				try {
					// Resolve attachment IDs to disk paths
					const fileAttachments = args.attachmentIds?.length
						? await resolveAttachmentPaths(args.attachmentIds)
						: undefined;

					const result = await runInstance({
						squad,
						objective: args.objective,
						issueRef: args.issueRef,
						attachments: fileAttachments,
					});

					return {
						textResultForLlm: JSON.stringify({
							instanceId: result.instanceId,
							success: result.success,
							pr: result.pr ? { url: result.pr.url, number: result.pr.number } : null,
							error: result.error,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to run instance: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('list_inbox', {
			description:
				"List unread inbox entries from squads. Shows deliverables and pending questions that need the user's attention.",
			parameters: z.object({
				status: z
					.enum(['unread', 'read', 'resolved'])
					.optional()
					.describe('Filter by status (default: unread)'),
			}),
			handler: async (args: { status?: 'unread' | 'read' | 'resolved' }) => {
				const entries = await listInboxEntries({
					status: args.status ?? 'unread',
					limit: 20,
				});

				if (entries.length === 0) {
					return {
						textResultForLlm: JSON.stringify({ entries: [], message: 'No inbox entries.' }),
						resultType: 'success' as const,
					};
				}

				const summary = entries.map((e) => ({
					id: e.id,
					squad: e.squadId,
					kind: e.kind,
					title: e.title,
					content: e.content.slice(0, 500),
					status: e.status,
					createdAt: e.createdAt,
				}));

				return {
					textResultForLlm: JSON.stringify({ entries: summary }),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('respond_to_inbox', {
			description:
				"Respond to an inbox question from a squad. Use this when the user provides an answer to a squad's pending question. This unblocks the squad so it can continue working.",
			parameters: z.object({
				entryId: z.string().describe('The inbox entry ID to respond to'),
				response: z.string().describe("The user's response to the squad's question"),
			}),
			handler: async (args: { entryId: string; response: string }) => {
				try {
					const unblocked = await resolveInboxEntry(args.entryId, args.response);
					return {
						textResultForLlm: JSON.stringify({
							resolved: true,
							squadUnblocked: unblocked,
							message: unblocked
								? 'Response delivered — squad has been unblocked and will continue working.'
								: 'Response recorded (squad was not actively waiting).',
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to respond: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('create_schedule', {
			description:
				'Create a cron-based schedule that triggers a squad or the orchestrator with a predefined prompt at specified times. Use standard cron syntax in UTC (e.g., "0 9 * * 1-5" for weekdays at 9am UTC). IMPORTANT: The user speaks in their configured timezone — convert their stated times to UTC before writing the cron expression.',
			parameters: z.object({
				name: z.string().describe('Human-readable name for the schedule (e.g., "Daily Standup")'),
				targetType: z
					.enum(['squad', 'orchestrator'])
					.describe('Whether to target a squad or the orchestrator'),
				targetId: z.string().optional().describe('Squad name (required if targetType is "squad")'),
				cron: z.string().describe('Cron expression in UTC (e.g., "0 14 * * 1-5" for weekdays at 9am US Central)'),
				prompt: z.string().describe('The prompt/message to send when the schedule fires'),
			}),
			handler: async (args: {
				name: string;
				targetType: 'squad' | 'orchestrator';
				targetId?: string;
				cron: string;
				prompt: string;
			}) => {
				try {
					// Validate squad exists if targeting a squad
					if (args.targetType === 'squad') {
						if (!args.targetId) {
							return {
								textResultForLlm: JSON.stringify({
									error: 'targetId (squad name) is required for squad schedules',
								}),
								resultType: 'success' as const,
							};
						}
						const squad = await getSquadByName(args.targetId);
						if (!squad) {
							return {
								textResultForLlm: JSON.stringify({ error: `Squad '${args.targetId}' not found` }),
								resultType: 'success' as const,
							};
						}
						args.targetId = squad.id;
					}

					const schedule = await createSchedule({
						name: args.name,
						targetType: args.targetType,
						targetId: args.targetId,
						cron: args.cron,
						prompt: args.prompt,
					});

					return {
						textResultForLlm: JSON.stringify({
							created: true,
							schedule: {
								id: schedule.id,
								name: schedule.name,
								cron: schedule.cron,
								nextRun: schedule.nextRun,
							},
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to create schedule: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('list_schedules', {
			description: 'List all configured schedules (cron-based automations).',
			parameters: z.object({}).strict(),
			handler: async () => {
				const schedules = await listSchedules();
				if (schedules.length === 0) {
					return {
						textResultForLlm: JSON.stringify({
							schedules: [],
							message: 'No schedules configured.',
						}),
						resultType: 'success' as const,
					};
				}

				const summary = schedules.map((s) => ({
					id: s.id,
					name: s.name,
					targetType: s.targetType,
					targetId: s.targetId,
					cron: s.cron,
					prompt: s.prompt.slice(0, 100),
					enabled: s.enabled,
					nextRun: s.nextRun,
					lastRun: s.lastRun,
				}));

				return {
					textResultForLlm: JSON.stringify({ schedules: summary }),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('delete_schedule', {
			description: 'Delete a schedule by ID. Use list_schedules first to find the ID.',
			parameters: z.object({
				scheduleId: z.string().describe('The ID of the schedule to delete'),
			}),
			handler: async (args: { scheduleId: string }) => {
				try {
					await deleteSchedule(args.scheduleId);
					return {
						textResultForLlm: JSON.stringify({ deleted: true, scheduleId: args.scheduleId }),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to delete: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('read_wiki', {
			description:
				'Read from the wiki knowledge base. Call with no pageName to list available pages, or with a pageName to read its content. You have access to IO-level and Shared wiki scopes.',
			parameters: z.object({
				scope: z.enum(['io', 'shared']).describe('Which wiki scope to read from'),
				pageName: z
					.string()
					.optional()
					.describe('Page name to read (omit to list all pages in scope)'),
			}),
			handler: async (args: { scope: 'io' | 'shared'; pageName?: string }) => {
				if (!args.pageName) {
					const pages = listWikiPages(args.scope);
					return {
						textResultForLlm: JSON.stringify({
							scope: args.scope,
							pages: pages.length > 0 ? pages : '(empty)',
						}),
						resultType: 'success' as const,
					};
				}
				const page = readWikiPage(args.scope, args.pageName);
				if (!page) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Page '${args.pageName}' not found in ${args.scope} wiki`,
						}),
						resultType: 'success' as const,
					};
				}
				return {
					textResultForLlm: JSON.stringify({
						scope: page.scope,
						name: page.name,
						content: page.content,
					}),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('write_wiki', {
			description:
				'Write a page to the wiki knowledge base. Provide the full page content (read existing first and merge if updating). You can write to IO-level and Shared scopes.',
			parameters: z.object({
				scope: z.enum(['io', 'shared']).describe('Which wiki scope to write to'),
				pageName: z
					.string()
					.describe('Page name (no .md extension, e.g., "preferences" or "routing-conventions")'),
				content: z.string().describe('Full markdown content for the page'),
			}),
			handler: async (args: { scope: 'io' | 'shared'; pageName: string; content: string }) => {
				writeWikiPage(args.scope, args.pageName, args.content);
				return {
					textResultForLlm: JSON.stringify({
						written: true,
						scope: args.scope,
						pageName: args.pageName,
					}),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('search_wiki', {
			description: 'Search across wiki pages by keyword. Searches IO-level and Shared scopes.',
			parameters: z.object({
				keyword: z.string().describe('Keyword or phrase to search for'),
			}),
			handler: async (args: { keyword: string }) => {
				const results = searchWiki(args.keyword, getOrchestratorScopes());
				if (results.length === 0) {
					return {
						textResultForLlm: JSON.stringify({ results: [], message: 'No matches found.' }),
						resultType: 'success' as const,
					};
				}
				return {
					textResultForLlm: JSON.stringify({ results }),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('install_skill', {
			description:
				'Install a skill from a URL (raw GitHub URL to a SKILL.md file). Skills extend IO or squad capabilities with additional instructions and behaviors.',
			parameters: z.object({
				name: z
					.string()
					.describe('Name for the skill (kebab-case, e.g., "tdd-workflow" or "code-review")'),
				url: z
					.string()
					.describe(
						'URL to the raw SKILL.md content (e.g., raw.githubusercontent.com/.../SKILL.md)',
					),
			}),
			handler: async (args: { name: string; url: string }) => {
				try {
					const skill = await installSkillFromUrl(args.name, args.url);
					return {
						textResultForLlm: JSON.stringify({
							installed: true,
							name: skill.name,
							preview: skill.content.slice(0, 200),
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to install: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('list_skills', {
			description: 'List all installed skills and their activation status.',
			parameters: z.object({}).strict(),
			handler: async () => {
				const installed = listInstalledSkills();
				const orchestratorActivations = await getActiveSkills('orchestrator');

				const summary = installed.map((s) => ({
					name: s.name,
					activatedForOrchestrator: orchestratorActivations.some((a) => a.skillName === s.name),
					preview: s.content.slice(0, 100),
				}));

				return {
					textResultForLlm: JSON.stringify({
						skills: summary.length > 0 ? summary : '(no skills installed)',
					}),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('activate_skill', {
			description:
				'Activate an installed skill for the orchestrator or a specific squad. Active skills are injected into the system prompt.',
			parameters: z.object({
				skillName: z.string().describe('Name of the installed skill'),
				targetType: z
					.enum(['orchestrator', 'squad'])
					.describe('Activate for orchestrator or a specific squad'),
				targetId: z.string().optional().describe('Squad name (required if targetType is "squad")'),
			}),
			handler: async (args: {
				skillName: string;
				targetType: 'orchestrator' | 'squad';
				targetId?: string;
			}) => {
				try {
					let resolvedTargetId = args.targetId ?? null;
					if (args.targetType === 'squad' && args.targetId) {
						const squad = await getSquadByName(args.targetId);
						if (!squad) {
							return {
								textResultForLlm: JSON.stringify({ error: `Squad '${args.targetId}' not found` }),
								resultType: 'success' as const,
							};
						}
						resolvedTargetId = squad.id;
					}

					await activateSkill(args.skillName, args.targetType, resolvedTargetId ?? undefined);
					return {
						textResultForLlm: JSON.stringify({
							activated: true,
							skillName: args.skillName,
							target: args.targetType === 'orchestrator' ? 'orchestrator' : args.targetId,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to activate: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('deactivate_skill', {
			description: 'Deactivate a skill (stop injecting it into the system prompt).',
			parameters: z.object({
				skillName: z.string().describe('Name of the skill to deactivate'),
				targetType: z
					.enum(['orchestrator', 'squad'])
					.describe('Deactivate from orchestrator or a specific squad'),
				targetId: z.string().optional().describe('Squad name (required if targetType is "squad")'),
			}),
			handler: async (args: {
				skillName: string;
				targetType: 'orchestrator' | 'squad';
				targetId?: string;
			}) => {
				await deactivateSkill(args.skillName, args.targetType, args.targetId ?? undefined);
				return {
					textResultForLlm: JSON.stringify({ deactivated: true, skillName: args.skillName }),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('remove_skill', {
			description: 'Uninstall a skill completely (removes files and all activations).',
			parameters: z.object({
				skillName: z.string().describe('Name of the skill to remove'),
			}),
			handler: async (args: { skillName: string }) => {
				removeSkill(args.skillName);
				return {
					textResultForLlm: JSON.stringify({ removed: true, skillName: args.skillName }),
					resultType: 'success' as const,
				};
			},
		}),

		defineTool('add_to_inbox', {
			description:
				"Create an inbox entry for the user. Use this to deliver results, leave notes, reminders, or ask the user a question that will block until they respond.",
			parameters: z.object({
				kind: z
					.enum(['deliverable', 'question', 'note'])
					.describe('Type of entry: deliverable (work product), question (blocks until answered), note (informational)'),
				title: z.string().describe('Short title for the inbox entry'),
				content: z.string().describe('Full content/body of the entry'),
			}),
			handler: async (args: { kind: 'deliverable' | 'question' | 'note'; title: string; content: string }) => {
				try {
					const { entry } = await addInboxEntry({
						kind: args.kind,
						title: args.title,
						content: args.content,
					});
					return {
						textResultForLlm: JSON.stringify({
							created: true,
							id: entry.id,
							kind: entry.kind,
							title: entry.title,
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to create inbox entry: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('delete_wiki', {
			description: 'Delete a wiki page permanently.',
			parameters: z.object({
				scope: z.enum(['shared', 'io']).describe('Wiki scope'),
				page: z.string().describe('Page name (without extension)'),
			}),
			handler: async (args: { scope: 'shared' | 'io'; page: string }) => {
				try {
					const deleted = deleteWikiPage(args.scope, args.page);
					return {
						textResultForLlm: JSON.stringify({
							deleted,
							scope: args.scope,
							page: args.page,
							message: deleted ? 'Page deleted.' : 'Page not found.',
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to delete wiki page: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('update_schedule', {
			description: 'Update an existing schedule (name, cron expression, prompt, or enabled state).',
			parameters: z.object({
				id: z.string().describe('Schedule ID to update'),
				name: z.string().optional().describe('New name for the schedule'),
				cron: z.string().optional().describe('New cron expression'),
				prompt: z.string().optional().describe('New prompt text'),
				enabled: z.boolean().optional().describe('Enable or disable the schedule'),
			}),
			handler: async (args: {
				id: string;
				name?: string;
				cron?: string;
				prompt?: string;
				enabled?: boolean;
			}) => {
				try {
					const { id, ...updates } = args;
					await updateSchedule(id, updates);
					return {
						textResultForLlm: JSON.stringify({
							updated: true,
							id,
							changes: Object.keys(updates),
						}),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to update schedule: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),

		defineTool('query_activity', {
			description:
				'Query the activity log to understand what has happened recently. Useful for reviewing squad actions, system events, and task history.',
			parameters: z.object({
				activityType: z
					.enum(['tool_call', 'message', 'meeting_contribution', 'task_start', 'task_complete', 'error'])
					.optional()
					.describe('Filter by activity type'),
				squadId: z.string().optional().describe('Filter by squad ID'),
				agentRole: z.string().optional().describe('Filter by agent role'),
				limit: z.number().optional().describe('Max entries to return (default 20)'),
			}),
			handler: async (args: {
				activityType?: string;
				squadId?: string;
				agentRole?: string;
				limit?: number;
			}) => {
				try {
					const entries = await queryActivity({
						activityType: args.activityType as any,
						squadId: args.squadId,
						agentRole: args.agentRole,
						limit: args.limit ?? 20,
					});
					return {
						textResultForLlm: JSON.stringify({ entries, count: entries.length }),
						resultType: 'success' as const,
					};
				} catch (err) {
					return {
						textResultForLlm: JSON.stringify({
							error: `Failed to query activity: ${err instanceof Error ? err.message : String(err)}`,
						}),
						resultType: 'success' as const,
					};
				}
			},
		}),
	];
}
