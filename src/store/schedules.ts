import { getDb } from "./db.js";

export interface SquadSchedule {
  id: number;
  squad_slug: string;
  name: string;
  cron_expr: string;
  agenda: string[]; // parsed JSON
  notes: string | null;
  enabled: number; // 0 | 1
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

interface ScheduleRow {
  id: number;
  squad_slug: string;
  name: string;
  cron_expr: string;
  agenda: string;
  notes: string | null;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

function rowToSchedule(row: ScheduleRow): SquadSchedule {
  let agenda: string[] = [];
  try {
    agenda = JSON.parse(row.agenda);
    if (!Array.isArray(agenda)) agenda = [];
  } catch {
    agenda = [];
  }
  return { ...row, agenda };
}

export function createSchedule(input: {
  squadSlug: string;
  name: string;
  cronExpr: string;
  agenda: string[];
  notes?: string | null;
  nextRunAt: string;
}): SquadSchedule {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO squad_schedules
         (squad_slug, name, cron_expr, agenda, notes, enabled, next_run_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      input.squadSlug,
      input.name,
      input.cronExpr,
      JSON.stringify(input.agenda),
      input.notes ?? null,
      input.nextRunAt,
    );
  const id = Number(info.lastInsertRowid);
  return getSchedule(id)!;
}

export function getSchedule(id: number): SquadSchedule | undefined {
  const row = getDb()
    .prepare("SELECT * FROM squad_schedules WHERE id = ?")
    .get(id) as ScheduleRow | undefined;
  return row ? rowToSchedule(row) : undefined;
}

export function listSchedules(squadSlug?: string): SquadSchedule[] {
  const rows = squadSlug
    ? (getDb()
        .prepare(
          "SELECT * FROM squad_schedules WHERE squad_slug = ? ORDER BY id ASC",
        )
        .all(squadSlug) as ScheduleRow[])
    : (getDb()
        .prepare("SELECT * FROM squad_schedules ORDER BY squad_slug, id ASC")
        .all() as ScheduleRow[]);
  return rows.map(rowToSchedule);
}

export function listDueSchedules(now: Date): SquadSchedule[] {
  const iso = now.toISOString();
  const rows = getDb()
    .prepare(
      `SELECT * FROM squad_schedules
        WHERE enabled = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC`,
    )
    .all(iso) as ScheduleRow[];
  return rows.map(rowToSchedule);
}

export function deleteSchedule(id: number): boolean {
  const info = getDb()
    .prepare("DELETE FROM squad_schedules WHERE id = ?")
    .run(id);
  return info.changes > 0;
}

export function setScheduleEnabled(id: number, enabled: boolean): boolean {
  const info = getDb()
    .prepare("UPDATE squad_schedules SET enabled = ? WHERE id = ?")
    .run(enabled ? 1 : 0, id);
  return info.changes > 0;
}

export function recordScheduleRun(id: number, ranAt: Date, nextRunAt: string | null): void {
  getDb()
    .prepare(
      "UPDATE squad_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?",
    )
    .run(ranAt.toISOString(), nextRunAt, id);
}

export function updateNextRun(id: number, nextRunAt: string | null): void {
  getDb()
    .prepare("UPDATE squad_schedules SET next_run_at = ? WHERE id = ?")
    .run(nextRunAt, id);
}
