import type { Squad } from '@io/shared';
import { createChildLogger } from '../../logging/logger.js';
import { type SquadRuntime, bootSquad, getSquadRuntime } from '../manager.js';
import {
	type Instance,
	type PrResult,
	cleanupInstance,
	createInstance,
	createPullRequest,
	executeTasks,
	planInstance,
	reviewWork,
} from './index.js';

const logger = () => createChildLogger('runner');

export interface RunResult {
	instanceId: string;
	success: boolean;
	pr?: PrResult | null;
	error?: string;
}

export interface InitResult {
	instance: Instance;
	runtime: SquadRuntime;
}

/**
 * Initialize an instance: boot the squad runtime and persist the instance to DB.
 * This is the critical part that MUST succeed before we tell the user "started."
 */
export async function initInstance(params: {
	squad: Squad;
	objective: string;
	issueRef?: string;
}): Promise<InitResult> {
	const { squad, objective, issueRef } = params;

	// Ensure squad is booted
	let runtime: SquadRuntime | undefined = getSquadRuntime(squad.id);
	if (!runtime) {
		runtime = await bootSquad(squad);
	}

	// Create instance (persists to DB + creates worktree)
	const instance = await createInstance({ squad, issueRef, objective });

	return { instance, runtime };
}

/**
 * Execute an already-initialized instance through its full lifecycle:
 * planning → tasks → review → PR → cleanup
 */
export async function executeInstance(params: {
	instance: Instance;
	runtime: SquadRuntime;
	squad: Squad;
	objective: string;
	attachments?: Array<{ type: 'file'; path: string; displayName?: string }>;
}): Promise<RunResult> {
	const log = logger();
	const { instance, runtime, squad, objective, attachments } = params;

	log.info({ instanceId: instance.id }, 'Starting instance execution');

	try {
		// Team Lead plans
		await planInstance({ instance, runtime, objective, attachments });

		if (instance.abortController.signal.aborted) {
			return { instanceId: instance.id, success: false, error: 'Cancelled' };
		}

		if (instance.tasks.length === 0) {
			log.warn({ instanceId: instance.id }, 'No tasks generated from planning');
			return {
				instanceId: instance.id,
				success: false,
				error: 'Planning produced no actionable tasks',
			};
		}

		// Execute tasks in parallel
		await executeTasks({ instance, runtime });

		if (instance.abortController.signal.aborted) {
			return { instanceId: instance.id, success: false, error: 'Cancelled' };
		}

		// Gated review/rework cycles
		const reviewResult = await reviewWork({ instance, runtime, objective });

		if (instance.abortController.signal.aborted) {
			return { instanceId: instance.id, success: false, error: 'Cancelled' };
		}

		if (!reviewResult.approved) {
			await cleanupInstance(instance.id, squad);
			return {
				instanceId: instance.id,
				success: false,
				error: reviewResult.failureReason ?? 'Review failed',
			};
		}

		// Create PR
		const prTitle = objective.slice(0, 72);
		const pr = await createPullRequest({ instance, title: prTitle, squadName: squad.name });

		// Cleanup (if no PR was created — otherwise keep the branch for review)
		if (!pr) {
			await cleanupInstance(instance.id, squad);
		}

		return {
			instanceId: instance.id,
			success: true,
			pr,
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		log.error({ instanceId: instance.id, error: errMsg.slice(0, 300) }, 'Instance execution failed');
		await cleanupInstance(instance.id, squad);
		return {
			instanceId: instance.id,
			success: false,
			error: errMsg.slice(0, 500),
		};
	}
}

/**
 * Run a full instance lifecycle (init + execute).
 * Convenience wrapper for callers that don't need to split the phases.
 */
export async function runInstance(params: {
	squad: Squad;
	objective: string;
	issueRef?: string;
	attachments?: Array<{ type: 'file'; path: string; displayName?: string }>;
}): Promise<RunResult> {
	const { squad, objective, issueRef, attachments } = params;

	const { instance, runtime } = await initInstance({ squad, objective, issueRef });

	return executeInstance({ instance, runtime, squad, objective, attachments });
}

