export const APP_NAME = "io";
export const APP_VERSION = "4.0.3";

export const API_PORT = 7777;
export const API_HOST = "0.0.0.0";

export const DEFAULT_MODEL = "gpt-4o";

export const SESSION_RESET_THRESHOLD = 50;
export const SCHEDULER_INTERVAL_MS = 60_000;
export const QA_MAX_REVISIONS = 3;

export const MANDATORY_ROLES = ["team-lead", "qa"] as const;

export const PR_MODES = ["branch-only", "draft-pr", "ready-pr", "auto-merge"] as const;

export const EVENT_NAMES = {
	SQUAD_CREATED: "squad.created",
	SQUAD_DELETED: "squad.deleted",
	SQUAD_UPDATED: "squad.updated",
	INSTANCE_CREATED: "instance.created",
	INSTANCE_STARTED: "instance.started",
	INSTANCE_COMPLETED: "instance.completed",
	INSTANCE_FAILED: "instance.failed",
	INSTANCE_CANCELLED: "instance.cancelled",
	OBJECTIVE_STARTED: "objective.started",
	OBJECTIVE_COMPLETED: "objective.completed",
	OBJECTIVE_FAILED: "objective.failed",
	TASK_STARTED: "task.started",
	TASK_COMPLETED: "task.completed",
	TASK_FAILED: "task.failed",
	AGENT_EXECUTING: "agent.executing",
	AGENT_COMPLETED: "agent.completed",
	REVIEW_STARTED: "review.started",
	REVIEW_COMPLETED: "review.completed",
	QA_APPROVED: "qa.approved",
	QA_REJECTED: "qa.rejected",
	QA_ESCALATED: "qa.escalated",
	PR_CREATED: "pr.created",
	PR_MERGED: "pr.merged",
	INBOX_NEW_ITEM: "inbox.new_item",
	INBOX_REPLIED: "inbox.replied",
	CHAT_MESSAGE: "chat.message",
	CHAT_STREAM_CHUNK: "chat.stream_chunk",
	CHAT_STREAM_END: "chat.stream_end",
	NOTIFICATION: "notification",
} as const;
