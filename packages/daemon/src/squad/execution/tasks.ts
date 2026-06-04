import { createChildLogger } from '../../logging/logger.js';
import type { SquadRuntime } from '../manager.js';
import { selectModelForTask } from '../model-selector.js';
import { type Instance, type InstanceTask, transitionInstance } from './instance.js';

const logger = () => createChildLogger('task-exec');

// Max time for a single task (covers send timeout + retries + overhead)
const TASK_TIMEOUT_MS = 300_000; // 5 minutes total per task

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

	if (!instance.worktree) {
		throw new Error('Cannot execute tasks: no worktree available. Instance has no working directory for agents.');
	}

	await transitionInstance(instance.id, 'working');

	const teamLead = runtime.members.get('technical-pm');
	if (!teamLead) throw new Error('No team lead for task execution');

	// Execute all tasks concurrently with per-task timeout
	await Promise.all(
		instance.tasks
			.filter((task) => task.status !== 'done')
			.map((task) => withTimeout(executeTask(task, instance, runtime, log), TASK_TIMEOUT_MS, task)),
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

			// Track activity under this instance
			agent.setInstanceId(instance.id);
			const workingDir = instance.worktree?.path ?? '';
			if (workingDir) {
				agent.setWorkingDir(workingDir);
			}

			const model = selectModelForTask(task.modelTier, task.retryCount);
			if (agent.getModel() !== model) {
				await agent.switchModel(model);
			}

			try {
				const workingDir = instance.worktree?.path ?? '';
				const result = await agent.send(
					`Your previous work on "${task.description}" needs revision.\n\nFeedback: ${feedback}\n\n${workingDir ? `Working directory: ${workingDir}\n\n` : ''}Please address this feedback. Write/edit code and run tests to verify.\n\nIMPORTANT: Do NOT run git commands, create commits, or make PRs — the system handles that after review.`,
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

	// Track activity under this instance and set working directory for tools
	agent.setInstanceId(instance.id);
	const workingDir = instance.worktree?.path ?? '';
	if (workingDir) {
		agent.setWorkingDir(workingDir);
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
		'\nComplete the task by writing code and tests in the working directory. Use your available tools to read, write, and test code.',
		'\n\nIMPORTANT RULES:',
		'\n- Do NOT run git commands (commit, push, branch, checkout, etc.) — the system handles all git operations after review.',
		'\n- Do NOT create pull requests or attempt to merge anything.',
		'\n- Do NOT modify files outside the working directory.',
		'\n- Focus ONLY on writing/editing code and running tests to verify your work.',
		'\n\nWhen done, report a brief summary of what you changed.',
	);

	return parts.join('');
}

/** Wrap a task promise with a timeout — marks the task as failed if it exceeds the limit */
function withTimeout(promise: Promise<void>, ms: number, task: InstanceTask): Promise<void> {
	return Promise.race([
		promise,
		new Promise<void>((_, reject) =>
			setTimeout(() => {
				task.status = 'failed';
				task.result = `Task timed out after ${Math.round(ms / 1000)}s`;
				reject(new Error(`Task ${task.id} timed out`));
			}, ms),
		),
	]).catch(() => {
		// Swallow — task is already marked failed
	});
}

