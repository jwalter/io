/**
 * Tests for src/notify.ts — isMeaningfulOutput heuristic and notifyBackground
 * dispatch routing.
 *
 * DB isolation: setDbPathForTests() redirects the SQLite singleton to a
 * fresh tmp file so these tests never touch ~/.io/io.db.
 */
import { before, after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setDbPathForTests, closeDb } from "./store/db.js";
import { config } from "./config.js";
import {
  isMeaningfulOutput,
  notifyBackground,
  setTelegramSender,
  setTuiSender,
  setSseBroadcaster,
  _resetNotifySendersForTests,
} from "./notify.js";

// ── DB isolation ────────────────────────────────────────────────────────────

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "io-notify-test-"));
  setDbPathForTests(join(tmpDir, "io.db"));
});

after(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Config teardown ─────────────────────────────────────────────────────────

const origMode = config.backgroundNotifyMode;
const origTelegram = config.backgroundNotifyTelegram;
const origTui = config.backgroundNotifyTui;

afterEach(() => {
  config.backgroundNotifyMode = origMode;
  config.backgroundNotifyTelegram = origTelegram;
  config.backgroundNotifyTui = origTui;
  _resetNotifySendersForTests();
});

// ── isMeaningfulOutput ───────────────────────────────────────────────────────

describe("isMeaningfulOutput", () => {
  describe("returns false for short/empty input", () => {
    it("empty string", () => assert.equal(isMeaningfulOutput(""), false));
    it("whitespace only", () => assert.equal(isMeaningfulOutput("   "), false));
    it("under 20 chars", () => assert.equal(isMeaningfulOutput("short"), false));
    it("exactly 19 chars", () =>
      assert.equal(isMeaningfulOutput("a".repeat(19)), false));
  });

  describe("returns false for heartbeat phrases", () => {
    const phrases = [
      "no active tasks",
      "no active task",
      "nothing to report.",
      "Nothing to report.",
      "ALL CLEAR",
      "no updates",
      "no update",
      "no changes",
      "no change",
      "idle",
      "IDLE",
      "heartbeat",
      "ok",
      "OK",
    ];
    for (const phrase of phrases) {
      it(`"${phrase}"`, () => assert.equal(isMeaningfulOutput(phrase), false));
    }
  });

  it("returns false when heartbeat phrase is first non-empty line (blank preamble)", () => {
    const text = "\n\n  \nno active tasks\nsome more content here that is long";
    assert.equal(isMeaningfulOutput(text), false);
  });

  it("returns false when heartbeat is surrounded by whitespace on its line", () => {
    assert.equal(isMeaningfulOutput("  idle  "), false);
  });

  it("returns true for normal multi-sentence prose ≥20 chars", () => {
    assert.equal(
      isMeaningfulOutput("Task 1 completed successfully. Moving to step 2."),
      true,
    );
  });

  it("returns true for a bulleted report whose first line is not a heartbeat", () => {
    const text = [
      "Squad status update:",
      "- Lion-O: working on PR #80",
      "- Tygra: reviewing PR #79",
      "- Cheetara: idle",
    ].join("\n");
    assert.equal(isMeaningfulOutput(text), true);
  });

  it("returns true for exactly 20 chars", () => {
    assert.equal(isMeaningfulOutput("a".repeat(20)), true);
  });
});

// ── notifyBackground dispatch routing ───────────────────────────────────────

const MEANINGFUL_TEXT =
  "Squad task monitor: PR #80 merged. Lion-O completed the delegation stats feature. All checks passing.";

const HEARTBEAT_TEXT = "no active tasks";

const SOURCE = {
  type: "squad-schedule" as const,
  scheduleId: 7,
  squadSlug: "michaeljolley-io",
  scheduleName: "Active Task Monitor",
};

describe("notifyBackground", () => {
  it('mode="off" → skipped:"off", no senders called, no row inserted', async () => {
    config.backgroundNotifyMode = "off";
    let called = false;
    setSseBroadcaster(() => { called = true; });
    setTuiSender(() => { called = true; });
    setTelegramSender(async () => { called = true; });

    const result = await notifyBackground({ source: SOURCE, title: "T", text: MEANINGFUL_TEXT });

    assert.equal(result.skipped, "off");
    assert.equal(result.id, undefined);
    assert.equal(called, false);
  });

  it("empty text → skipped:empty, no row inserted", async () => {
    config.backgroundNotifyMode = "all";
    const result = await notifyBackground({ source: SOURCE, title: "T", text: "   " });
    assert.equal(result.skipped, "empty");
    assert.equal(result.id, undefined);
  });

  it('mode="meaningful" + heartbeat text → skipped:"not-meaningful", no row', async () => {
    config.backgroundNotifyMode = "meaningful";
    const result = await notifyBackground({ source: SOURCE, title: "T", text: HEARTBEAT_TEXT });
    assert.equal(result.skipped, "not-meaningful");
    assert.equal(result.id, undefined);
  });

  it('mode="all" + heartbeat + all senders → all dispatch, row inserted', async () => {
    config.backgroundNotifyMode = "all";
    config.backgroundNotifyTelegram = true;
    config.backgroundNotifyTui = true;

    const calls = { sse: false, tui: false, telegram: false };
    setSseBroadcaster(() => { calls.sse = true; });
    setTuiSender(() => { calls.tui = true; });
    setTelegramSender(async () => { calls.telegram = true; });

    const result = await notifyBackground({ source: SOURCE, title: "T", text: HEARTBEAT_TEXT });

    assert.ok(result.id, "should return a row id");
    assert.equal(result.dispatched.sse, true);
    assert.equal(result.dispatched.tui, true);
    assert.equal(result.dispatched.telegram, true);
    assert.equal(calls.sse, true);
    assert.equal(calls.tui, true);
    assert.equal(calls.telegram, true);
    assert.equal(result.skipped, undefined);
  });

  it('mode="meaningful" + meaningful text + all senders → all dispatch', async () => {
    config.backgroundNotifyMode = "meaningful";
    config.backgroundNotifyTelegram = true;
    config.backgroundNotifyTui = true;

    const calls = { sse: false, tui: false, telegram: false };
    setSseBroadcaster(() => { calls.sse = true; });
    setTuiSender(() => { calls.tui = true; });
    setTelegramSender(async () => { calls.telegram = true; });

    const result = await notifyBackground({ source: SOURCE, title: "T", text: MEANINGFUL_TEXT });

    assert.ok(result.id);
    assert.equal(result.dispatched.sse, true);
    assert.equal(result.dispatched.tui, true);
    assert.equal(result.dispatched.telegram, true);
  });

  it("backgroundNotifyTelegram=false → telegram skipped, tui+sse still fire", async () => {
    config.backgroundNotifyMode = "all";
    config.backgroundNotifyTelegram = false;
    config.backgroundNotifyTui = true;

    const calls = { sse: false, tui: false, telegram: false };
    setSseBroadcaster(() => { calls.sse = true; });
    setTuiSender(() => { calls.tui = true; });
    setTelegramSender(async () => { calls.telegram = true; });

    const result = await notifyBackground({ source: SOURCE, title: "T", text: MEANINGFUL_TEXT });

    assert.equal(result.dispatched.telegram, false, "telegram should be skipped");
    assert.equal(result.dispatched.tui, true);
    assert.equal(result.dispatched.sse, true);
    assert.equal(calls.telegram, false);
  });

  it("backgroundNotifyTui=false → tui skipped, telegram+sse still fire", async () => {
    config.backgroundNotifyMode = "all";
    config.backgroundNotifyTelegram = true;
    config.backgroundNotifyTui = false;

    const calls = { sse: false, tui: false, telegram: false };
    setSseBroadcaster(() => { calls.sse = true; });
    setTuiSender(() => { calls.tui = true; });
    setTelegramSender(async () => { calls.telegram = true; });

    const result = await notifyBackground({ source: SOURCE, title: "T", text: MEANINGFUL_TEXT });

    assert.equal(result.dispatched.tui, false, "tui should be skipped");
    assert.equal(result.dispatched.telegram, true);
    assert.equal(result.dispatched.sse, true);
    assert.equal(calls.tui, false);
  });

  it("telegram sender throws → dispatched.telegram=false, others true, no rethrow", async () => {
    config.backgroundNotifyMode = "all";
    config.backgroundNotifyTelegram = true;
    config.backgroundNotifyTui = true;

    const calls = { sse: false, tui: false };
    setSseBroadcaster(() => { calls.sse = true; });
    setTuiSender(() => { calls.tui = true; });
    setTelegramSender(async () => { throw new Error("telegram down"); });

    const result = await notifyBackground({ source: SOURCE, title: "T", text: MEANINGFUL_TEXT });

    assert.equal(result.dispatched.telegram, false);
    assert.equal(result.dispatched.sse, true);
    assert.equal(result.dispatched.tui, true);
    assert.ok(result.id, "row should still be inserted");
  });

  it("TUI sender throws → dispatched.tui=false, others true, no rethrow", async () => {
    config.backgroundNotifyMode = "all";
    config.backgroundNotifyTelegram = true;
    config.backgroundNotifyTui = true;

    setSseBroadcaster(() => {});
    setTuiSender(() => { throw new Error("tui down"); });
    setTelegramSender(async () => {});

    const result = await notifyBackground({ source: SOURCE, title: "T", text: MEANINGFUL_TEXT });

    assert.equal(result.dispatched.tui, false);
    assert.equal(result.dispatched.sse, true);
    assert.equal(result.dispatched.telegram, true);
  });

  it("squad-schedule source detail round-trips to SSE broadcaster payload", async () => {
    config.backgroundNotifyMode = "all";

    type SsePayload = { id: number; source: { type: string; [k: string]: unknown }; title: string; text: string; createdAt: string };
    let capturedPayload: SsePayload | undefined;
    setSseBroadcaster((payload) => { capturedPayload = payload; });

    const source = {
      type: "squad-schedule" as const,
      scheduleId: 42,
      squadSlug: "thundercats",
      scheduleName: "Morning Standup",
    };

    const result = await notifyBackground({
      source,
      title: "Morning Standup Result",
      text: MEANINGFUL_TEXT,
    });

    assert.ok(capturedPayload, "SSE broadcaster should have been called");
    assert.equal(capturedPayload.id, result.id);
    assert.equal(capturedPayload.source.type, "squad-schedule");
    assert.equal((capturedPayload.source as Record<string, unknown>).scheduleId, 42);
    assert.equal((capturedPayload.source as Record<string, unknown>).squadSlug, "thundercats");
    assert.equal((capturedPayload.source as Record<string, unknown>).scheduleName, "Morning Standup");
    assert.equal(capturedPayload.title, "Morning Standup Result");
    assert.ok(capturedPayload.createdAt, "createdAt should be set");
  });
});
