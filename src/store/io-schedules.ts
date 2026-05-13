import { getDb } from "./db.js";

export interface IoSchedule {
  id: number;
  name: string;
  cron_expr: string;
  prompt: string;
  notes: string | null;
  enabled: number; // 0 | 1
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export function createIoSchedule(input: {
  name: string;
  cronExpr: string;
  prompt: string;
  notes?: string | null;
  nextRunAt: string;
}): IoSchedule {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO io_schedules
         (name, cron_expr, prompt, notes, enabled, next_run_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .run(
      input.name,
      input.cronExpr,
      input.prompt,
      input.notes ?? null,
      input.nextRunAt,
    );
  const id = Number(info.lastInsertRowid);
  return getIoSchedule(id)!;
}

export function getIoSchedule(id: number): IoSchedule | undefined {
  return getDb()
    .prepare("SELECT * FROM io_schedules WHERE id = ?")
    .get(id) as IoSchedule | undefined;
}

export function listIoSchedules(): IoSchedule[] {
  return getDb()
    .prepare("SELECT * FROM io_schedules ORDER BY id ASC")
    .all() as IoSchedule[];
}

export function listDueIoSchedules(now: Date): IoSchedule[] {
  return getDb()
    .prepare(
      `SELECT * FROM io_schedules
        WHERE enabled = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC`,
    )
    .all(now.toISOString()) as IoSchedule[];
}

export function deleteIoSchedule(id: number): boolean {
  const info = getDb()
    .prepare("DELETE FROM io_schedules WHERE id = ?")
    .run(id);
  return info.changes > 0;
}

export function setIoScheduleEnabled(id: number, enabled: boolean): boolean {
  const info = getDb()
    .prepare("UPDATE io_schedules SET enabled = ? WHERE id = ?")
    .run(enabled ? 1 : 0, id);
  return info.changes > 0;
}

export function recordIoScheduleRun(
  id: number,
  ranAt: Date,
  nextRunAt: string | null,
): void {
  getDb()
    .prepare(
      "UPDATE io_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?",
    )
    .run(ranAt.toISOString(), nextRunAt, id);
}

export function updateIoScheduleNextRun(
  id: number,
  nextRunAt: string | null,
): void {
  getDb()
    .prepare("UPDATE io_schedules SET next_run_at = ? WHERE id = ?")
    .run(nextRunAt, id);
}
