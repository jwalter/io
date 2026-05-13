import { getDb } from "./db.js";

export interface AgentTask {
  task_id: string;
  agent_slug: string;
  description: string;
  status: string;
  result: string | null;
  origin_channel: string | null;
  started_at: string;
  completed_at: string | null;
}

export function createTask(
  taskId: string,
  agentSlug: string,
  description: string,
  originChannel?: string,
): AgentTask {
  const db = getDb();
  db.prepare(
    "INSERT INTO agent_tasks (task_id, agent_slug, description, origin_channel) VALUES (?, ?, ?, ?)",
  ).run(taskId, agentSlug, description, originChannel ?? null);
  return getTask(taskId)!;
}

export function getTask(taskId: string): AgentTask | undefined {
  return getDb()
    .prepare("SELECT * FROM agent_tasks WHERE task_id = ?")
    .get(taskId) as AgentTask | undefined;
}

export function getActiveTasks(): AgentTask[] {
  return getDb()
    .prepare("SELECT * FROM agent_tasks WHERE status = 'running' ORDER BY started_at DESC")
    .all() as AgentTask[];
}

export function completeTask(taskId: string, result: string): void {
  getDb()
    .prepare(
      "UPDATE agent_tasks SET status = 'done', result = ?, completed_at = CURRENT_TIMESTAMP WHERE task_id = ?",
    )
    .run(result, taskId);
}

export function failTask(taskId: string, error: string): void {
  getDb()
    .prepare(
      "UPDATE agent_tasks SET status = 'failed', result = ?, completed_at = CURRENT_TIMESTAMP WHERE task_id = ?",
    )
    .run(error, taskId);
}

export function clearStaleTasks(): void {
  getDb()
    .prepare(
      "UPDATE agent_tasks SET status = 'failed', result = 'Marked stale on startup', completed_at = CURRENT_TIMESTAMP WHERE status = 'running'",
    )
    .run();
}

export function cancelTask(taskId: string, reason = "Cancelled by user"): void {
  getDb()
    .prepare(
      "UPDATE agent_tasks SET status = 'cancelled', result = ?, completed_at = CURRENT_TIMESTAMP WHERE task_id = ? AND status = 'running'",
    )
    .run(reason, taskId);
}

export function listRecentTasks(limit = 50): AgentTask[] {
  return getDb()
    .prepare(
      "SELECT * FROM agent_tasks ORDER BY datetime(started_at) DESC, task_id DESC LIMIT ?",
    )
    .all(limit) as AgentTask[];
}

export interface TaskReview {
  id: number;
  task_id: string;
  squad_slug: string;
  reviewer_character: string;
  approved: number;
  comments: string | null;
  created_at: string;
}

export function createReview(
  taskId: string,
  squadSlug: string,
  reviewerCharacter: string,
  approved: boolean,
  comments?: string,
): TaskReview {
  const db = getDb();
  const info = db
    .prepare(
      "INSERT INTO squad_task_reviews (task_id, squad_slug, reviewer_character, approved, comments) VALUES (?, ?, ?, ?, ?)",
    )
    .run(taskId, squadSlug, reviewerCharacter, approved ? 1 : 0, comments ?? null);
  return db
    .prepare("SELECT * FROM squad_task_reviews WHERE id = ?")
    .get(info.lastInsertRowid) as TaskReview;
}

export function getTaskReviews(taskId: string): TaskReview[] {
  return getDb()
    .prepare(
      "SELECT * FROM squad_task_reviews WHERE task_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(taskId) as TaskReview[];
}
