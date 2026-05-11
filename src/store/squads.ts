import { getDb } from "./db.js";

export interface Squad {
  id: number;
  slug: string;
  name: string;
  project_path: string;
  copilot_session_id: string | null;
  model: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SquadDecision {
  id: number;
  squad_slug: string;
  decision: string;
  context: string | null;
  created_at: string;
}

export function createSquad(
  slug: string,
  name: string,
  projectPath: string,
): Squad {
  const db = getDb();
  db.prepare(
    "INSERT INTO squads (slug, name, project_path) VALUES (?, ?, ?)",
  ).run(slug, name, projectPath);
  return getSquad(slug)!;
}

export function getSquad(slug: string): Squad | undefined {
  return getDb()
    .prepare("SELECT * FROM squads WHERE slug = ?")
    .get(slug) as Squad | undefined;
}

export function listSquads(): Squad[] {
  return getDb().prepare("SELECT * FROM squads ORDER BY created_at DESC").all() as Squad[];
}

export function updateSquadSession(slug: string, sessionId: string): void {
  getDb()
    .prepare(
      "UPDATE squads SET copilot_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?",
    )
    .run(sessionId, slug);
}

export function updateSquadStatus(slug: string, status: string): void {
  getDb()
    .prepare(
      "UPDATE squads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?",
    )
    .run(status, slug);
}

export function updateSquadModel(slug: string, model: string | null): void {
  getDb()
    .prepare(
      "UPDATE squads SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?",
    )
    .run(model, slug);
}

export function deleteSquad(slug: string): void {
  const db = getDb();
  db.prepare("DELETE FROM squad_decisions WHERE squad_slug = ?").run(slug);
  db.prepare("DELETE FROM squads WHERE slug = ?").run(slug);
}

export function logDecision(
  squadSlug: string,
  decision: string,
  context?: string,
): void {
  getDb()
    .prepare(
      "INSERT INTO squad_decisions (squad_slug, decision, context) VALUES (?, ?, ?)",
    )
    .run(squadSlug, decision, context ?? null);
}

export function getDecisions(
  squadSlug: string,
  limit = 20,
): SquadDecision[] {
  return getDb()
    .prepare(
      "SELECT * FROM squad_decisions WHERE squad_slug = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(squadSlug, limit) as SquadDecision[];
}

export function getDecisionsSummary(squadSlug: string): string {
  const decisions = getDecisions(squadSlug);
  if (decisions.length === 0) return "No decisions recorded.";

  return decisions
    .reverse()
    .map((d) => {
      const ctx = d.context ? ` (${d.context})` : "";
      return `- [${d.created_at}] ${d.decision}${ctx}`;
    })
    .join("\n");
}
