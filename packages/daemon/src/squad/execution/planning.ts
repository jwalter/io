import { createChildLogger } from '../../logging/logger.js';
import type { Agent } from '../agent.js';
import { getEventBus } from '../event-bus.js';
import type { SquadRuntime } from '../manager.js';
import { parseTierHint } from '../model-selector.js';
import type { Instance, InstanceTask } from './instance.js';
import { transitionInstance } from './instance.js';

const logger = () => createChildLogger('planning');

export interface PlanResult {
	tasks: InstanceTask[];
}

/**
 * Team Lead plans the instance alone — one LLM call to produce a task list.
 * No round-table, no consensus, no veto at planning stage.
 */
export async function planInstance(params: {
	instance: Instance;
	runtime: SquadRuntime;
	objective: string;
	attachments?: Array<{ type: 'file'; path: string; displayName?: string }>;
}): Promise<PlanResult> {
	const log = logger();
	const { instance, runtime, objective, attachments } = params;

	// Transition to planning (already in 'planning' from createInstance, transition to working skipped — we use a direct status)
	const teamLead = runtime.members.get('technical-pm');
	if (!teamLead) throw new Error('No team lead available for planning');

	// Track activity under this instance
	teamLead.setInstanceId(instance.id);

	// Build roster description so the lead knows who's available (exclude scribe — it's never assigned tasks)
	const roster = [...runtime.members.entries()]
		.filter(([role]) => role !== 'technical-pm' && role !== 'scribe')
		.map(([role]) => `- ${role}`)
		.join('\n');

	const attachmentNote = attachments?.length
		? `\n\nThe user has provided ${attachments.length} file(s) as reference material. They are attached to this message — review them as part of your planning.`
		: '';

	const taskPlan = await teamLead.send(
		`You are the team lead. Plan the following objective and produce a task list for your team.\n\nObjective: ${objective}${attachmentNote}\n\nYour team members (by role):\n${roster}\n\nFor each task, specify:\n1. A brief description of the work\n2. Which team member role should do it (must match a role above)\n3. The model tier needed (fast for simple edits/docs, standard for typical coding, reasoning for complex architecture/analysis)\n\nFormat each task as: "TASK: <description> | ASSIGN: <role> | MODEL_TIER: <fast|standard|reasoning>"\n\nChoose the lowest tier that can handle each task to minimize cost. Tasks will execute in parallel, so ensure they are independent and don't conflict on the same files.`,
		attachments,
	);

	const tasks = parseTaskList(taskPlan, instance.id);

	instance.tasks = tasks;
	instance.meetingLog = [`[technical-pm] Plan:\n${taskPlan}`];

	await getEventBus().emit({
		id: crypto.randomUUID(),
		timestamp: new Date(),
		type: 'instance:planning_complete',
		squadId: instance.squadId,
		instanceId: instance.id,
		data: { taskCount: tasks.length, objective },
	});

	log.info({ instanceId: instance.id, tasks: tasks.length }, 'Planning complete');

	return { tasks };
}

/** Parse the team lead's task list into structured tasks */
function parseTaskList(taskPlan: string, instanceId: string): InstanceTask[] {
	const tasks: InstanceTask[] = [];
	const lines = taskPlan.split('\n');

	for (const line of lines) {
		const match = line.match(/TASK:\s*(.+?)\s*\|\s*ASSIGN:\s*([^|]+)(?:\s*\|\s*MODEL_TIER:\s*(\w+))?/i);
		if (match) {
			const tierHint = parseTierHint(match[3]);
			tasks.push({
				id: crypto.randomUUID(),
				description: match[1].trim(),
				assignedTo: match[2].trim().toLowerCase().replace(/\s+/g, '-'),
				status: 'pending',
				modelTier: tierHint,
				retryCount: 0,
			});
		}
	}

	return tasks;
}
