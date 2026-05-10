import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, dirname, resolve, sep } from "path";

export interface ToolDeps {
  wikiRead: (path: string) => string | undefined;
  wikiWrite: (path: string, content: string) => void;
  wikiSearch: (query: string) => Array<{ path: string; title: string; snippet: string }>;
  wikiAssertPagePath: (path: string) => void;
  getSquad: (slug: string) => { slug: string; name: string; projectPath: string; status: string } | undefined;
  listSquads: () => Array<{ slug: string; name: string; projectPath: string; status: string }>;
  createSquad: (slug: string, name: string, projectPath: string) => void;
  logDecision: (squadSlug: string, decision: string, context?: string) => void;
  getDecisionsSummary: (squadSlug: string) => string;
  updateSquadStatus: (slug: string, status: string) => void;
}

export function createTools(deps: ToolDeps) {
  const wikiRead = defineTool("wiki_read", {
    description: "Read a page from IO's knowledge base wiki. Path is relative to the wiki root (e.g., 'pages/preferences/editor.md').",
    parameters: z.object({
      path: z.string().describe("Relative path to the wiki page"),
    }),
    handler: async ({ path }) => {
      const content = deps.wikiRead(path);
      if (!content) return `Page not found: ${path}`;
      return content;
    },
  });

  const wikiWrite = defineTool("wiki_write", {
    description: "Write or update a page in IO's knowledge base. Use this to remember preferences, project details, and important facts. Path must be under pages/ and end in .md.",
    parameters: z.object({
      path: z.string().describe("Relative path under pages/ (e.g., 'pages/preferences/clone-location.md')"),
      content: z.string().describe("Markdown content to write"),
    }),
    handler: async ({ path, content }) => {
      try {
        deps.wikiAssertPagePath(path);
        deps.wikiWrite(path, content);
        return `Written: ${path}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  const wikiSearch = defineTool("wiki_search", {
    description: "Search IO's knowledge base for matching pages.",
    parameters: z.object({
      query: z.string().describe("Search query"),
    }),
    handler: async ({ query }) => {
      const results = deps.wikiSearch(query);
      if (results.length === 0) return "No matching pages found.";
      return results
        .map((r) => `**${r.title}** (${r.path})\n${r.snippet}`)
        .join("\n\n");
    },
  });

  const squadCreate = defineTool("squad_create", {
    description: "Create a persistent project squad. Squads remember decisions and context for a specific codebase.",
    parameters: z.object({
      slug: z.string().describe("Unique identifier (e.g., 'michaeljolley-io')"),
      name: z.string().describe("Display name (e.g., 'IO Assistant')"),
      project_path: z.string().describe("Path to the project directory"),
    }),
    handler: async ({ slug, name, project_path }) => {
      try {
        deps.createSquad(slug, name, project_path);
        return `Squad "${name}" created for ${project_path}`;
      } catch (err) {
        return `Error creating squad: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  const squadRecall = defineTool("squad_recall", {
    description: "Recall a squad's context and past decisions. Use this before working on a project to load relevant history.",
    parameters: z.object({
      slug: z.string().describe("Squad slug"),
    }),
    handler: async ({ slug }) => {
      const squad = deps.getSquad(slug);
      if (!squad) return `Squad not found: ${slug}`;
      const decisions = deps.getDecisionsSummary(slug);
      return `**Squad: ${squad.name}**\nProject: ${squad.projectPath}\nStatus: ${squad.status}\n\n${decisions}`;
    },
  });

  const squadStatus = defineTool("squad_status", {
    description: "List all squads and their status.",
    parameters: z.object({}),
    handler: async () => {
      const squads = deps.listSquads();
      if (squads.length === 0) return "No squads created yet.";
      return squads
        .map((s) => `- **${s.name}** (\`${s.slug}\`) — ${s.status} — ${s.projectPath}`)
        .join("\n");
    },
  });

  const squadLogDecision = defineTool("squad_log_decision", {
    description: "Log a decision for a squad. Use this to record important choices made during project work.",
    parameters: z.object({
      slug: z.string().describe("Squad slug"),
      decision: z.string().describe("The decision made"),
      context: z.string().optional().describe("Context or reasoning"),
    }),
    handler: async ({ slug, decision, context }) => {
      try {
        deps.logDecision(slug, decision, context);
        return `Decision logged for squad ${slug}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  const shell = defineTool("shell", {
    description: "Run a shell command on the host machine. You have FULL ROOT ACCESS. Use for git, apt, npm, build tools, system administration, or anything else. There are NO permission restrictions — all commands are allowed and pre-approved.",
    parameters: z.object({
      command: z.string().describe("The command to run"),
      timeout_secs: z.number().optional().describe("Timeout in seconds (default: 60)"),
      working_dir: z.string().optional().describe("Working directory for the command"),
    }),
    handler: async ({ command, timeout_secs, working_dir }) => {
      console.error(`[io] shell tool called: ${command}${working_dir ? ` (cwd: ${working_dir})` : ""}`);
      try {
        const result = execSync(command, {
          encoding: "utf-8",
          timeout: (timeout_secs ?? 60) * 1000,
          maxBuffer: 1024 * 1024,
          cwd: working_dir,
        });
        const output = result.trim();
        if (output.length > 8000) {
          return output.slice(0, 8000) + "\n\n[…truncated]";
        }
        return output || "(no output)";
      } catch (err: unknown) {
        const execErr = err as { stderr?: string; stdout?: string; message?: string };
        const stderr = execErr.stderr?.trim() ?? "";
        const stdout = execErr.stdout?.trim() ?? "";
        const msg = stderr || stdout || execErr.message || "Command failed";
        if (msg.length > 4000) {
          return `Error:\n${msg.slice(0, 4000)}\n[…truncated]`;
        }
        return `Error:\n${msg}`;
      }
    },
  });

  const fileOps = defineTool("file_ops", {
    description: "Read, write, list, or mkdir on the local filesystem. Full access to all paths.",
    parameters: z.object({
      operation: z.enum(["read", "write", "list", "mkdir"]).describe("Operation to perform"),
      path: z.string().describe("File or directory path"),
      content: z.string().optional().describe("Content to write (for write operation)"),
      recursive: z.boolean().optional().describe("Recurse into subdirectories (for list)"),
    }),
    handler: async ({ operation, path: filePath, content, recursive }) => {
      console.error(`[io] file_ops tool called: ${operation} ${filePath}`);
      try {
        const resolved = resolve(filePath);

        if (operation === "read") {
          if (!existsSync(resolved)) return `File not found: ${filePath}`;
          const text = readFileSync(resolved, "utf-8");
          if (text.length > 8000) {
            return text.slice(0, 8000) + "\n\n[…truncated]";
          }
          return text;
        }

        if (operation === "write") {
          if (!content) return "Error: content is required for write operation";
          mkdirSync(dirname(resolved), { recursive: true });
          writeFileSync(resolved, content, "utf-8");
          return `Written: ${filePath}`;
        }

        if (operation === "list") {
          if (!existsSync(resolved)) return `Directory not found: ${filePath}`;
          if (recursive) {
            const files = walkDirectory(resolved);
            return files.join("\n") || "(empty directory)";
          }
          const entries = readdirSync(resolved);
          return entries
            .map((e) => {
              const full = join(resolved, e);
              const isDir = statSync(full).isDirectory();
              return isDir ? `${e}/` : e;
            })
            .join("\n") || "(empty directory)";
        }

        if (operation === "mkdir") {
          mkdirSync(resolved, { recursive: true });
          return `Created directory: ${filePath}`;
        }

        return `Unknown operation: ${operation}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  return [wikiRead, wikiWrite, wikiSearch, squadCreate, squadRecall, squadStatus, squadLogDecision, shell, fileOps];
}

function walkDirectory(dir: string, maxDepth = 3, depth = 0): string[] {
  if (depth >= maxDepth) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(`${entry.name}/`);
      results.push(...walkDirectory(full, maxDepth, depth + 1).map((f) => `  ${entry.name}/${f}`));
    } else {
      results.push(entry.name);
    }
  }
  return results;
}
