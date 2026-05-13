import { getDb } from "../store/db.js";
import { parseReviewVerdict } from "./agents.js";

interface ReviewRow {
  id: number;
  approved: number;
  comments: string | null;
}

/**
 * Surgically correct historical peer-review rows that were stored as REJECTED
 * (approved=0) but whose comments unambiguously begin with `APPROVED` (issue
 * #50). Earlier daemon builds (pre-#43) inspected only the literal first line,
 * which silently flipped many APPROVED reviews into REJECTED whenever the
 * agent began its response with a markdown rule, blank line, header, or a
 * short prose preamble.
 *
 * We only flip 0 -> 1, and only when the *current* parser sees an explicit
 * line-leading APPROVED token in the prose. We never flip 1 -> 0: doing so
 * would destroy data on legitimate prose-only approvals (e.g. "Excellent
 * work — ships it") that the conservative parser would otherwise downgrade.
 *
 * Returns the number of rows updated.
 */
export function backfillReviewVerdicts(): number {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, approved, comments FROM squad_task_reviews WHERE approved = 0 AND comments IS NOT NULL AND comments != ''",
    )
    .all() as ReviewRow[];

  const update = db.prepare(
    "UPDATE squad_task_reviews SET approved = 1 WHERE id = ?",
  );

  let fixed = 0;
  const tx = db.transaction((batch: ReviewRow[]) => {
    for (const r of batch) {
      if (hasExplicitApproval(r.comments ?? "")) {
        update.run(r.id);
        fixed++;
      }
    }
  });
  tx(rows);
  return fixed;
}

/**
 * True when the comment body unambiguously starts with an APPROVED verdict —
 * either as the first non-empty line (after stripping markdown noise) or as
 * the verdict the current parser extracts before any REJECTED token. Anything
 * shorter than that is left as the daemon originally recorded it.
 */
function hasExplicitApproval(content: string): boolean {
  const stripped = content.replace(/[*_`#>]/g, "");
  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10);
  for (const line of lines) {
    const lead = line
      .toUpperCase()
      .match(/^[^A-Z]*\b(APPROVED|REJECTED)\b/);
    if (lead) return lead[1] === "APPROVED";
  }
  return false;
}
