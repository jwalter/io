import { createChildLogger } from '../../logging/logger.js';
import { getEventBus } from '../event-bus.js';
import type { SquadRuntime } from '../manager.js';
import { selectModelForRole } from '../model-selector.js';
import { addInboxEntry } from '../../store/inbox.js';
import type { Instance, InstanceTask } from './instance.js';
import { transitionInstance } from './instance.js';
import { executeRework } from './tasks.js';

const logger = () => createChildLogger('review');

const MAX_REVIEW_CYCLES = 5;

export interface ReviewResult {
	approved: boolean;
	cycles: number;
	failureReason?: string;
}

/**
 * Gated review cycle:
 * 1. Lead reviews all task results
 * 2. If lead rejects → identifies tasks to rework, specialists rework in parallel
 * 3. If lead approves → QA/veto reviews
 * 4. If QA rejects → same rework loop
 * 5. Max 5 cycles total, then fail to inbox
 */
export async function reviewWork(params: {
	instance: Instance;
	runtime: SquadRuntime;
	objective: string;
}): Promise<ReviewResult> {
	const log = logger();
	const { instance, runtime, objective } = params;

	await transitionInstance(instance.id, 'reviewing');

	const teamLead = runtime.members.get('technical-pm');
	if (!teamLead) throw new Error('No team lead for review');

	// Track review activity under this instance
	teamLead.setInstanceId(instance.id);
	if (instance.worktree) {
		teamLead.setWorkingDir(instance.worktree.path);
	}

	// Find veto/QA members
	const vetoMembers = [...runtime.members.entries()].filter(([role]) => {
		const skill = runtime.skills.get(role);
		return skill?.veto && role !== 'technical-pm';
	});

	let cycles = 0;

	while (cycles < MAX_REVIEW_CYCLES) {
		cycles++;
		log.info({ instanceId: instance.id, cycle: cycles }, 'Review cycle');

		await getEventBus().emit({
			id: crypto.randomUUID(),
			timestamp: new Date(),
			type: 'instance:review_cycle',
			squadId: instance.squadId,
			instanceId: instance.id,
			data: { cycle: cycles, maxCycles: MAX_REVIEW_CYCLES },
		});

		// Build task summary for reviewer
		const taskSummary = instance.tasks
			.map((t) => `- [${t.status}] ${t.description} (${t.assignedTo})\n  Result: ${(t.result ?? 'No result').slice(0, 1000)}`)
			.join('\n\n');

		// Step 1: Team Lead reviews
		const reviewModel = selectModelForRole('technical-pm', 'review');
		if (teamLead.getModel() !== reviewModel) {
			await teamLead.switchModel(reviewModel);
		}

		const leadReview = await teamLead.send(
			`Review all completed work for this objective:\n\nObjective: ${objective}\n\nTask results:\n${taskSummary}\n\nBefore deciding, use your tools to VERIFY the work exists on disk:\n- Use read_file to check that expected files were created/modified\n- Use run_command to run tests or check file structure (e.g., "ls -la", "cat <file>", "npm test")\n\nDo NOT trust the task results text alone — verify actual changes exist.\n\nAfter verifying, reply with one of:\n- "APPROVED" if work is verified on disk and meets the objective\n- "REWORK:" followed by a JSON array of objects with "taskId" and "feedback" for each task that needs revision. Example:\nREWORK: [{"taskId": "abc-123", "feedback": "File was not actually written to disk"}]`,
		);

		if (leadReview.toUpperCase().includes('APPROVED')) {
			// Step 2: QA/veto review (gated behind lead approval)
			if (vetoMembers.length === 0) {
				log.info({ instanceId: instance.id }, 'No veto members, lead approval is final');
				return { approved: true, cycles };
			}

			for (const [role, agent] of vetoMembers) {
				agent.setInstanceId(instance.id);
					if (instance.worktree) {
						agent.setWorkingDir(instance.worktree.path);
					}
				const qaModel = selectModelForRole(role, 'review');
				if (agent.getModel() !== qaModel) {
					await agent.switchModel(qaModel);
				}

				const qaReview = await agent.send(
						`As QA, review the following completed work:\n\nObjective: ${objective}\n\nTask results:\n${taskSummary}\n\nBefore deciding, use your tools to VERIFY the work on disk:\n- Use read_file to inspect the actual files\n- Use run_command to run tests or linting\n\nDo NOT rely on task result text alone — verify real changes exist.\n\nReply with:\n- "APPROVED" if verified and satisfactory\n- "REWORK:" followed by a JSON array of objects with "taskId" and "feedback" for tasks that need revision.`,
				);

				if (qaReview.toUpperCase().includes('REWORK:')) {
					// QA rejected — parse rework instructions and loop
					const reworkTasks = parseReworkInstructions(qaReview, instance.tasks);
					if (reworkTasks.length > 0) {
						log.info({ instanceId: instance.id, cycle: cycles, rejectedBy: role, reworkCount: reworkTasks.length }, 'QA rejected, reworking');
						await transitionInstance(instance.id, 'working');
						await executeRework({ instance, runtime, reworkTasks });
						await transitionInstance(instance.id, 'reviewing');
					}
					break; // Back to top of review loop
				}
			}

			// If we didn't break (all QA approved), we're done
			if (!leadReview.toUpperCase().includes('REWORK:')) {
				// Check that we actually reached this point without a QA rejection
				const allQaApproved = true; // If we didn't break, all approved
				if (allQaApproved) {
					log.info({ instanceId: instance.id, cycles }, 'All reviewers approved');
					return { approved: true, cycles };
				}
			}
		} else if (leadReview.toUpperCase().includes('REWORK:')) {
			// Lead rejected — parse rework and loop
			const reworkTasks = parseReworkInstructions(leadReview, instance.tasks);
			if (reworkTasks.length > 0) {
				log.info({ instanceId: instance.id, cycle: cycles, reworkCount: reworkTasks.length }, 'Lead rejected, reworking');
				await transitionInstance(instance.id, 'working');
				await executeRework({ instance, runtime, reworkTasks });
				await transitionInstance(instance.id, 'reviewing');
			} else {
				// Couldn't parse rework instructions — treat as approved to avoid infinite loop
				log.warn({ instanceId: instance.id }, 'Could not parse rework instructions, treating as approved');
				return { approved: true, cycles };
			}
		} else {
			// Ambiguous response — treat as approved
			log.warn({ instanceId: instance.id }, 'Ambiguous review response, treating as approved');
			return { approved: true, cycles };
		}
	}

	// Exhausted review cycles — send to inbox
	const failureReason = `Failed to pass review after ${MAX_REVIEW_CYCLES} cycles for objective: ${objective}`;
	log.error({ instanceId: instance.id }, failureReason);

	await addInboxEntry({
		squadId: instance.squadId,
		instanceId: instance.id,
		kind: 'note',
		title: `Review failed: ${objective.slice(0, 60)}`,
		content: `Instance ${instance.id} exhausted ${MAX_REVIEW_CYCLES} review/rework cycles without reaching approval.\n\nObjective: ${objective}\n\nFinal task states:\n${instance.tasks.map((t) => `- [${t.status}] ${t.description}: ${(t.result ?? 'no result').slice(0, 200)}`).join('\n')}`,
	});

	return { approved: false, cycles, failureReason };
}

/**
 * Parse rework instructions from a review response.
 * Expects JSON array after "REWORK:" with {taskId, feedback} objects.
 * Falls back to assigning feedback to all non-done tasks if parsing fails.
 */
function parseReworkInstructions(
	response: string,
	tasks: InstanceTask[],
): Array<{ taskId: string; feedback: string }> {
	const reworkMatch = response.match(/REWORK:\s*(\[[\s\S]*?\])/i);
	if (reworkMatch) {
		try {
			const parsed = JSON.parse(reworkMatch[1]);
			if (Array.isArray(parsed)) {
				return parsed
					.filter((item: { taskId?: string; feedback?: string }) => item.taskId && item.feedback)
					.map((item: { taskId: string; feedback: string }) => ({
						taskId: item.taskId,
						feedback: item.feedback,
					}));
			}
		} catch {
			// Fall through to fallback
		}
	}

	// Fallback: extract plain-text feedback and apply to all completed tasks
	const feedbackMatch = response.match(/REWORK:\s*([\s\S]+)/i);
	const feedback = feedbackMatch?.[1]?.trim() ?? 'Please review and fix issues.';

	return tasks
		.filter((t) => t.status === 'done' || t.status === 'failed')
		.map((t) => ({ taskId: t.id, feedback }));
}
