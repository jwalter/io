/**
 * Tests for src/store/notifications.ts — SQLite CRUD helpers.
 *
 * DB isolation: setDbPathForTests() redirects the SQLite singleton to a
 * fresh tmp file, ensuring these tests never touch ~/.io/io.db.
 */
import { before, after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setDbPathForTests, closeDb, getDb } from "./db.js";
import {
  insertNotification,
  listRecentNotifications,
  listUnreadNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  pruneOldNotifications,
} from "./notifications.js";

// ── DB isolation ────────────────────────────────────────────────────────────

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "io-notifs-test-"));
  setDbPathForTests(join(tmpDir, "io.db"));
});

// Wipe all notifications between tests for a clean slate.
beforeEach(() => {
  getDb().prepare("DELETE FROM background_notifications").run();
});

after(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeNotif(overrides: Partial<Parameters<typeof insertNotification>[0]> = {}) {
  return insertNotification({
    source_type: "io-schedule",
    source_ref: JSON.stringify({ scheduleId: 1 }),
    title: "Test Notification",
    text: "This is the notification body.",
    ...overrides,
  });
}

// ── insertNotification ───────────────────────────────────────────────────────

describe("insertNotification", () => {
  it("returns a row with autoincrement id and created_at timestamp", () => {
    const row = makeNotif();
    assert.ok(typeof row.id === "number" && row.id > 0, "id should be a positive integer");
    assert.ok(row.created_at, "created_at should be set");
    assert.equal(row.title, "Test Notification");
    assert.equal(row.text, "This is the notification body.");
    assert.equal(row.read_at, null);
  });

  it("ids are autoincremented across inserts", () => {
    const a = makeNotif();
    const b = makeNotif();
    assert.ok(b.id > a.id, "second id should be greater than first");
  });

  it("accepts source_ref: null", () => {
    const row = makeNotif({ source_ref: null });
    assert.equal(row.source_ref, null);
  });

  it("stores source_type correctly", () => {
    const row = makeNotif({ source_type: "squad-schedule" });
    assert.equal(row.source_type, "squad-schedule");
  });
});

// ── listRecentNotifications ──────────────────────────────────────────────────

describe("listRecentNotifications", () => {
  it("returns newest first", () => {
    const a = makeNotif({ title: "First" });
    const b = makeNotif({ title: "Second" });
    const c = makeNotif({ title: "Third" });
    const rows = listRecentNotifications();
    assert.equal(rows[0].id, c.id, "newest should be first");
    assert.equal(rows[rows.length - 1].id, a.id, "oldest should be last");
  });

  it("default limit is 50", () => {
    for (let i = 0; i < 55; i++) makeNotif({ title: `N${i}` });
    const rows = listRecentNotifications();
    assert.equal(rows.length, 50);
  });

  it("explicit limit is honored", () => {
    for (let i = 0; i < 10; i++) makeNotif({ title: `N${i}` });
    const rows = listRecentNotifications(3);
    assert.equal(rows.length, 3);
  });
});

// ── countUnreadNotifications ─────────────────────────────────────────────────

describe("countUnreadNotifications", () => {
  it("starts at zero on a clean DB", () => {
    assert.equal(countUnreadNotifications(), 0);
  });

  it("increases on insert", () => {
    makeNotif();
    assert.equal(countUnreadNotifications(), 1);
    makeNotif();
    assert.equal(countUnreadNotifications(), 2);
  });

  it("decreases when a notification is marked read", () => {
    const a = makeNotif();
    makeNotif();
    assert.equal(countUnreadNotifications(), 2);
    markNotificationRead(a.id);
    assert.equal(countUnreadNotifications(), 1);
  });
});

// ── markNotificationRead ─────────────────────────────────────────────────────

describe("markNotificationRead", () => {
  it("returns false on a non-existent id", () => {
    assert.equal(markNotificationRead(999999), false);
  });

  it("returns true on an existing unread notification", () => {
    const row = makeNotif();
    assert.equal(markNotificationRead(row.id), true);
  });

  it("is idempotent — returns true even if already read", () => {
    const row = makeNotif();
    assert.equal(markNotificationRead(row.id), true);
    assert.equal(markNotificationRead(row.id), true, "second call should still return true");
  });

  it("sets read_at on the row", () => {
    const row = makeNotif();
    markNotificationRead(row.id);
    const updated = getDb()
      .prepare("SELECT read_at FROM background_notifications WHERE id = ?")
      .get(row.id) as { read_at: string | null };
    assert.ok(updated.read_at, "read_at should be set after marking read");
  });
});

// ── markAllNotificationsRead ─────────────────────────────────────────────────

describe("markAllNotificationsRead", () => {
  it("returns the count of newly-marked rows", () => {
    makeNotif();
    makeNotif();
    makeNotif();
    assert.equal(markAllNotificationsRead(), 3);
  });

  it("subsequent call returns 0 (all already read)", () => {
    makeNotif();
    makeNotif();
    markAllNotificationsRead();
    assert.equal(markAllNotificationsRead(), 0);
  });

  it("only marks unread rows — pre-read rows not re-touched", () => {
    const a = makeNotif();
    makeNotif();
    markNotificationRead(a.id); // mark one manually first
    const count = markAllNotificationsRead(); // should only mark the remaining 1
    assert.equal(count, 1);
  });
});

// ── listUnreadNotifications ──────────────────────────────────────────────────

describe("listUnreadNotifications", () => {
  it("excludes read rows", () => {
    const a = makeNotif({ title: "A" });
    const b = makeNotif({ title: "B" });
    markNotificationRead(a.id);

    const unread = listUnreadNotifications();
    assert.ok(!unread.some((r) => r.id === a.id), "read row should not appear");
    assert.ok(unread.some((r) => r.id === b.id), "unread row should appear");
  });

  it("returns newest first", () => {
    const a = makeNotif({ title: "A" });
    const b = makeNotif({ title: "B" });
    const rows = listUnreadNotifications();
    assert.equal(rows[0].id, b.id);
    assert.equal(rows[1].id, a.id);
  });

  it("returns empty array when all are read", () => {
    makeNotif();
    makeNotif();
    markAllNotificationsRead();
    assert.deepEqual(listUnreadNotifications(), []);
  });
});

// ── pruneOldNotifications ─────────────────────────────────────────────────────

describe("pruneOldNotifications", () => {
  it("deletes rows older than the threshold and returns the count", () => {
    const old = makeNotif({ title: "Old" });
    makeNotif({ title: "Recent" }); // stays untouched

    // Back-date the 'old' row to 10 days ago
    getDb()
      .prepare(
        "UPDATE background_notifications SET created_at = datetime('now', '-10 days') WHERE id = ?",
      )
      .run(old.id);

    const deleted = pruneOldNotifications(7); // prune rows older than 7 days
    assert.equal(deleted, 1, "should delete exactly the back-dated row");

    const remaining = listRecentNotifications();
    assert.ok(!remaining.some((r) => r.id === old.id), "old row should be gone");
    assert.ok(remaining.some((r) => r.title === "Recent"), "recent row should remain");
  });

  it("returns 0 when nothing is old enough to prune", () => {
    makeNotif();
    makeNotif();
    assert.equal(pruneOldNotifications(7), 0);
  });

  it("is safe on an empty table", () => {
    assert.equal(pruneOldNotifications(1), 0);
  });
});
