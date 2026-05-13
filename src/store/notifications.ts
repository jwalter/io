import { getDb } from "./db.js";

export interface BackgroundNotificationRow {
  id: number;
  source_type: string;
  source_ref: string | null;     // raw JSON string, parse at call site
  title: string;
  text: string;
  created_at: string;
  read_at: string | null;
}

/**
 * Insert a new background notification. Returns the inserted row including
 * the autoincrement id and DB-assigned created_at timestamp. source_ref
 * should be a JSON string or null.
 */
export function insertNotification(input: {
  source_type: string;
  source_ref: string | null;
  title: string;
  text: string;
}): BackgroundNotificationRow {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO background_notifications (source_type, source_ref, title, text)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.source_type, input.source_ref, input.title, input.text);
  return db
    .prepare("SELECT * FROM background_notifications WHERE id = ?")
    .get(info.lastInsertRowid) as BackgroundNotificationRow;
}

/**
 * List the most recent notifications, newest first. Default limit 50.
 */
export function listRecentNotifications(limit = 50): BackgroundNotificationRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM background_notifications ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .all(limit) as BackgroundNotificationRow[];
}

/**
 * List unread notifications (read_at IS NULL), newest first.
 */
export function listUnreadNotifications(): BackgroundNotificationRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM background_notifications WHERE read_at IS NULL ORDER BY created_at DESC, id DESC",
    )
    .all() as BackgroundNotificationRow[];
}

/**
 * Count unread notifications. Cheap — uses COUNT(*).
 */
export function countUnreadNotifications(): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM background_notifications WHERE read_at IS NULL",
    )
    .get() as { n: number };
  return row.n;
}

/**
 * Mark a single notification read. Returns true if the row exists (whether
 * it was already read or just now marked), false if no such id exists.
 */
export function markNotificationRead(id: number): boolean {
  const db = getDb();
  const info = db
    .prepare(
      "UPDATE background_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND read_at IS NULL",
    )
    .run(id);
  if (info.changes > 0) return true;
  // Already read — verify the row exists at all
  const exists = db
    .prepare("SELECT id FROM background_notifications WHERE id = ?")
    .get(id);
  return exists !== undefined;
}

/**
 * Mark every unread notification read. Returns the number of rows affected.
 */
export function markAllNotificationsRead(): number {
  const info = getDb()
    .prepare(
      "UPDATE background_notifications SET read_at = CURRENT_TIMESTAMP WHERE read_at IS NULL",
    )
    .run();
  return info.changes;
}

/**
 * Delete notifications older than `olderThanDays` days. Returns rows deleted.
 * Used by a future retention sweep.
 */
export function pruneOldNotifications(olderThanDays: number): number {
  const info = getDb()
    .prepare(
      `DELETE FROM background_notifications
       WHERE created_at < datetime('now', ? || ' days')`,
    )
    .run(`-${olderThanDays}`);
  return info.changes;
}
