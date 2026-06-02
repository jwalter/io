import { createChildLogger } from '../../logging/logger.js';
import type { SquadRuntime } from '../manager.js';
import { selectModelForTask } from '../model-selector.js';
import { type Instance, type InstanceTask, transitionInstance } from './instance.js';

const logger = () => createChildLogger('task-exec');

/**
 * Execute all tasks in parallel.
 * No per-task review — that's handled by the review phase.
 */
export async function executeTasks(params: {
	instance: Instance;
	runtime: SquadRuntime;
}): Promise<void> {
	const log = logger();
	const { instance, runtime } = params;

	await transitionInstance(instance.id, 'working');

	const teamLead = runtime.members.get('technical-pm');
	if (!teamLead) throw new Error('No team lead for task execution');

	// Execute all tasks concurrently
	await Promise.all(
		instance.tasks
			.filter((task) => task.status !== 'done')
			.map((task) => executeTask(task, instance, runtime, log)),
	);
}

/**
 * Execute tasks that need rework (called during review cycles).
 */
export async function executeRework(params: {
	instance: Instance;
	runtime: SquadRuntime;
	reworkTasks: Array<{ taskId: string; feedback: string }>;
}): Promise<void> {
	const log = logger();
	const { instance, runtime, reworkTasks } = params;

	await Promise.all(
		reworkTasks.map(async ({ taskId, feedback }) => {
			const task = instance.tasks.find((t) => t.id === taskId);
			if (!task) return;

			task.retryCount++;
			task.status = 'in_progress';

			const agent = runtime.members.get(task.assignedTo);
			if (!agent) {
				task.status = 'failed';
				task.result = `No agent with role '${task.assignedTo}' available.`;
				return;
			}

			const model = selectModelForTask(task.modelTier, task.retryCount);
			if (agent.getModel() !== model) {
				await agent.switchModel(model);
			}

			try {
				const workingDir = instance.worktree?.path ?? '';
				const result = await agent.send(
					`Your previous work on "${task.description}" needs revision.\n\nFeedback: ${feedback}\n\n${workingDir ? `Working directory: ${workingDir}\n\n` : ''}Please address this feedback and report your updated results.`,
				);
				task.result = result;
				task.status = 'done';
				log.info({ taskId: task.id, retryCount: task.retryCount }, 'Rework task completed');
			} catch (err) {
				log.error({ err, taskId: task.id }, 'Rework task failed');
				task.status = 'failed';
				task.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		}),
	);
}

async function executeTask(
	task: InstanceTask,
	instance: Instance,
	runtime: SquadRuntime,
	log: ReturnType<typeof logger>,
): Promise<void> {
	log.info({ taskId: task.id, assignedTo: task.assignedTo, modelTier: task.modelTier }, 'Executing task');
	task.status = 'in_progress';

	const agent = runtime.members.get(task.assignedTo);
	if (!agent) {
		log.warn({ role: task.assignedTo }, 'No agent for assigned role');
		task.result = `No agent with role '${task.assignedTo}' available.`;
		task.status = 'failed';
		return;
	}

	const model = selectModelForTask(task.modelTier, task.retryCount);
	if (agent.getModel() !== model) {
		await agent.switchModel(model);
	}

	try {
		const workingDir = instance.worktree?.path ?? '';
		const taskPrompt = buildTaskPrompt(task, workingDir, instance);
		const result = await agent.send(taskPrompt);
		task.result = result;
		task.status = 'done';
		log.info({ taskId: task.id }, 'Task completed');
	} catch (err) {
		log.error({ err, taskId: task.id }, 'Task execution failed');
		task.status = 'failed';
		task.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
	}
}

function buildTaskPrompt(task: InstanceTask, workingDir: string, instance: Instance): string {
	const parts = ['You have been assigned the following task:', `\nTask: ${task.description}`];

	if (workingDir) {
		parts.push(`\nWorking directory: ${workingDir}`);
	}

	if (instance.issueRef) {
		parts.push(`\nRelated issue: ${instance.issueRef}`);
	}

	parts.push(
		'\nComplete the task to the best of your ability. Use your available tools to read, edit, and test code as needed. Report back with a summary of what you did.',
	);

	return parts.join('');
}

