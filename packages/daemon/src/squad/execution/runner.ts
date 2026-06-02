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

/**
 * Run a full instance lifecycle:
 * 1. Create instance (with worktree)
 * 2. Team Lead plans tasks (1 LLM call)
 * 3. Execute tasks in parallel
 * 4. Gated review/rework cycles (lead → QA)
 * 5. Create PR
 * 6. Clean up
 */
export async function runInstance(params: {
	squad: Squad;
	objective: string;
	issueRef?: string;
	attachments?: Array<{ type: 'file'; path: string; displayName?: string }>;
}): Promise<RunResult> {
	const log = logger();
	const { squad, objective, issueRef, attachments } = params;

	// Ensure squad is booted
	let runtime: SquadRuntime | undefined = getSquadRuntime(squad.id);
	if (!runtime) {
		runtime = await bootSquad(squad);
	}

	// 1. Create instance
	const instance = await createInstance({ squad, issueRef, objective });
	log.info({ instanceId: instance.id }, 'Starting instance run');

	try {
		// 2. Team Lead plans
		const planResult = await planInstance({ instance, runtime, objective, attachments });

		if (instance.tasks.length === 0) {
			log.warn({ instanceId: instance.id }, 'No tasks generated from planning');
			return {
				instanceId: instance.id,
				success: false,
				error: 'Planning produced no actionable tasks',
			};
		}

		// 3. Execute tasks in parallel
		await executeTasks({ instance, runtime });

		// 4. Gated review/rework cycles
		const reviewResult = await reviewWork({ instance, runtime, objective });

		if (!reviewResult.approved) {
			await cleanupInstance(instance.id, squad);
			return {
				instanceId: instance.id,
				success: false,
				error: reviewResult.failureReason ?? 'Review failed',
			};
		}

		// 5. Create PR
		const prTitle = objective.slice(0, 72);
		const pr = await createPullRequest({ instance, title: prTitle, squadName: squad.name });

		// 6. Cleanup (if no PR was created — otherwise keep the branch for review)
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
		log.error({ instanceId: instance.id, error: errMsg.slice(0, 300) }, 'Instance run failed');
		await cleanupInstance(instance.id, squad);
		return {
			instanceId: instance.id,
			success: false,
			error: errMsg.slice(0, 500),
		};
	}
}

