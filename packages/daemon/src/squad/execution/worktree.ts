import { exec as execCb } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createChildLogger } from '../../logging/logger.js';

const exec = promisify(execCb);
const logger = () => createChildLogger('worktree');

export interface WorktreeInfo {
	path: string;
	branch: string;
}

/**
 * Create a git worktree for an instance.
 * Branch naming: io/{squad-name}/{short-id}
 * Always fetches latest from remote before creating the worktree.
 */
export async function createWorktree(params: {
	repoPath: string;
	squadName: string;
	instanceId: string;
}): Promise<WorktreeInfo> {
	const log = logger();
	const shortId = params.instanceId.slice(0, 8);
	const branch = `io/${params.squadName}/${shortId}`;
	const worktreePath = join(
		params.repoPath,
		'..',
		'.io-worktrees',
		`${params.squadName}-${shortId}`,
	);

	// Ensure the repo is a git repository
	if (!existsSync(join(params.repoPath, '.git'))) {
		throw new Error(`Not a git repository: ${params.repoPath}`);
	}

	// Fetch latest from remote to ensure we branch from up-to-date code
	const startPoint = await fetchLatestMainRef(params.repoPath);
	log.info({ startPoint }, 'Fetched latest remote ref for worktree');

	// Create the worktree with a new branch from the latest remote HEAD
	try {
		await exec(`git worktree add -b "${branch}" "${worktreePath}" "${startPoint}"`, {
			cwd: params.repoPath,
		});
	} catch {
		// Branch might already exist — try without -b
		try {
			await exec(`git worktree add "${worktreePath}" "${branch}"`, {
				cwd: params.repoPath,
			});
		} catch (innerErr) {
			throw new Error(
				`Failed to create worktree: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
			);
		}
	}

	log.info({ worktreePath, branch }, 'Worktree created');
	return { path: worktreePath, branch };
}

/**
 * Fetch the latest from the remote and return the ref to branch from.
 * Detects the default branch (main/master) from the remote HEAD.
 */
async function fetchLatestMainRef(repoPath: string): Promise<string> {
	try {
		await exec('git fetch origin', { cwd: repoPath });
	} catch {
		// Fetch failed (offline, no remote, etc.) — fall back to local HEAD
		return 'HEAD';
	}

	// Determine the default branch from the remote
	try {
		const { stdout } = await exec('git symbolic-ref refs/remotes/origin/HEAD', {
			cwd: repoPath,
		});
		const remoteHead = stdout.trim();
		if (remoteHead) {
			return remoteHead;
		}
	} catch {
		// symbolic-ref not set — try common branch names
	}

	// Fallback: try origin/main, then origin/master
	for (const candidate of ['origin/main', 'origin/master']) {
		try {
			await exec(`git rev-parse --verify ${candidate}`, { cwd: repoPath });
			return candidate;
		} catch {
			continue;
		}
	}

	// Last resort: local HEAD
	return 'HEAD';
}

/**
 * Remove a git worktree and delete its branch.
 */
export async function removeWorktree(params: {
	repoPath: string;
	worktreePath: string;
	branch: string;
}): Promise<void> {
	const log = logger();

	try {
		await exec(`git worktree remove "${params.worktreePath}" --force`, {
			cwd: params.repoPath,
		});
	} catch {
		// Worktree might already be removed; try cleaning up the directory
		if (existsSync(params.worktreePath)) {
			rmSync(params.worktreePath, { recursive: true, force: true });
		}
		// Prune worktree references
		try {
			await exec('git worktree prune', { cwd: params.repoPath });
		} catch {
			// ignore
		}
	}

	// Delete the branch
	try {
		await exec(`git branch -D "${params.branch}"`, { cwd: params.repoPath });
	} catch {
		// Branch might not exist or be checked out elsewhere
	}

	log.info({ branch: params.branch }, 'Worktree removed');
}

/**
 * List all IO-managed worktrees for a repository.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
	try {
		const { stdout } = await exec('git worktree list --porcelain', { cwd: repoPath });

		const worktrees: WorktreeInfo[] = [];
		const blocks = stdout.split('\n\n');

		for (const block of blocks) {
			const lines = block.trim().split('\n');
			const pathLine = lines.find((l) => l.startsWith('worktree '));
			const branchLine = lines.find((l) => l.startsWith('branch '));

			if (pathLine && branchLine) {
				const path = pathLine.replace('worktree ', '');
				const branch = branchLine.replace('branch refs/heads/', '');
				if (branch.startsWith('io/')) {
					worktrees.push({ path, branch });
				}
			}
		}

		return worktrees;
	} catch {
		return [];
	}
}
