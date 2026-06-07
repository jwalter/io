import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempHome = mkdtempSync(join(tmpdir(), "io-token-tracker-"));
const originalHome = process.env.HOME;
process.env.HOME = tempHome;

const { attachTokenTracker } = await import("./token-tracker.js");
const { closeDb } = await import("../store/db.js");
const { getTokenUsageSummary } = await import("../store/token-usage.js");

beforeEach(() => {
  closeDb();
  rmSync(join(tempHome, ".io"), { recursive: true, force: true });
});

after(() => {
  closeDb();
  process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

test("attachTokenTracker records token usage from Copilot usage events", () => {
  const handlers: Array<(event: any) => void> = [];
  const session = {
    on: (_event: string, handler: (event: any) => void) => {
      handlers.push(handler);
      return () => {};
    },
  } as any;

  const flush = attachTokenTracker(session, {});

  handlers[0]({
    data: {
      model: "gpt-4.1",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    },
  });

  const totals = flush();

  assert.equal(totals.totalInputTokens, 1_000_000);
  assert.equal(totals.totalOutputTokens, 1_000_000);

  const summary = getTokenUsageSummary();
  assert.equal(summary.total_records, 1);
  assert.equal(summary.total_input_tokens, 1_000_000);
  assert.equal(summary.total_output_tokens, 1_000_000);
});

test("attachTokenTracker accumulates multiple usage events across models", () => {
  const handlers: Array<(event: any) => void> = [];
  const session = {
    on: (_event: string, handler: (event: any) => void) => {
      handlers.push(handler);
      return () => {};
    },
  } as any;

  const flush = attachTokenTracker(session, {});

  handlers[0]({
    data: {
      model: "gpt-4.1",
      inputTokens: 500_000,
      outputTokens: 200_000,
    },
  });

  handlers[0]({
    data: {
      model: "claude-sonnet-4.6",
      inputTokens: 300_000,
      outputTokens: 100_000,
    },
  });

  const totals = flush();

  assert.equal(totals.totalInputTokens, 800_000);
  assert.equal(totals.totalOutputTokens, 300_000);

  const summary = getTokenUsageSummary();
  assert.equal(summary.total_records, 2);
  assert.equal(summary.total_input_tokens, 800_000);
  assert.equal(summary.total_output_tokens, 300_000);
});
