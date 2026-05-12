import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, dirname, resolve, sep } from "path";
import { homedir } from "os";

// Ensure child processes have HOME set (systemd services often don't)
function shellEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.HOME) env.HOME = homedir();
  return env;
}

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
  delegateToAgent: (squadSlug: string, task: string, onComplete: (taskId: string, result: string) => void) => Promise<string>;
  getTask: (taskId: string) => { task_id: string; agent_slug: string; description: string; status: string; result: string | null } | undefined;
  getActiveAgentTasks: () => Array<{ taskId: string; agentSlug: string; description: string; status: string }>;
}

export function createTools(deps: ToolDeps) {
  const wikiRead = defineTool("wiki_read", {
    description: "Read a page from IO's knowledge base wiki. Path is relative to the wiki root (e.g., 'pages/preferences/editor.md').",
    skipPermission: true,
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
    skipPermission: true,
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
    skipPermission: true,
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
    skipPermission: true,
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
    skipPermission: true,
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
    skipPermission: true,
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
    skipPermission: true,
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

  const squadDelegate = defineTool("squad_delegate", {
    description:
      "Delegate a task to a squad agent for autonomous execution. The agent runs in the background and you get a task ID immediately. Use squad_task_status to check progress. Use this after planning work with the user to send each task to the squad for implementation.",
    skipPermission: true,
    parameters: z.object({
      slug: z.string().describe("Squad slug to delegate to"),
      task: z
        .string()
        .describe(
          "Detailed task description. Be specific — include file paths, expected behavior, acceptance criteria. The agent works autonomously with this as its only instruction.",
        ),
    }),
    handler: async ({ slug, task }) => {
      console.error(`[io] squad_delegate called: ${slug} — ${task.slice(0, 100)}…`);
      try {
        const taskId = await deps.delegateToAgent(slug, task, (id, result) => {
          console.error(`[io] Agent task ${id} completed for squad ${slug}`);
        });
        return `Task delegated to squad "${slug}". Task ID: ${taskId}\n\nThe agent is working on this in the background. Use squad_task_status to check progress.`;
      } catch (err) {
        return `Error delegating task: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  const squadTaskStatus = defineTool("squad_task_status", {
    description:
      "Check the status of a delegated squad task, or list all active tasks. Returns status (running/done/failed) and result when complete.",
    skipPermission: true,
    parameters: z.object({
      task_id: z
        .string()
        .optional()
        .describe("Specific task ID to check. If omitted, lists all active tasks."),
    }),
    handler: async ({ task_id }) => {
      if (task_id) {
        const task = deps.getTask(task_id);
        if (!task) return `Task not found: ${task_id}`;
        let response = `**Task ${task.task_id}**\nSquad: ${task.agent_slug}\nStatus: ${task.status}\nDescription: ${task.description}`;
        if (task.result) {
          const result = task.result.length > 4000 ? task.result.slice(0, 4000) + "\n[…truncated]" : task.result;
          response += `\n\nResult:\n${result}`;
        }
        return response;
      }
      const tasks = deps.getActiveAgentTasks();
      if (tasks.length === 0) return "No active tasks.";
      return tasks
        .map((t) => `- **${t.taskId}** (${t.agentSlug}) — ${t.status} — ${t.description}`)
        .join("\n");
    },
  });

  const shell = defineTool("shell", {
    description: "Run a shell command on the host machine. You have FULL ROOT ACCESS. Use for git, apt, npm, build tools, system administration, or anything else. There are NO permission restrictions — all commands are allowed and pre-approved.",
    skipPermission: true,
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
          env: shellEnv(),
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
    skipPermission: true,
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

  // Override built-in bash tool so the model uses our implementation
  const bash = defineTool("bash", {
    description: "Run a bash command on the host machine with full root access.",
    skipPermission: true,
    overridesBuiltInTool: true,
    parameters: z.object({
      command: z.string().describe("The command to run"),
    }),
    handler: async ({ command }) => {
      console.error(`[io] bash tool called: ${command}`);
      try {
        const result = execSync(command, {
          encoding: "utf-8",
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          env: shellEnv(),
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

  // Override built-in read_file tool
  const readFile = defineTool("read_file", {
    description: "Read a file from the filesystem.",
    skipPermission: true,
    overridesBuiltInTool: true,
    parameters: z.object({
      file_path: z.string().describe("Path to the file to read"),
    }),
    handler: async ({ file_path }) => {
      console.error(`[io] read_file tool called: ${file_path}`);
      try {
        const resolved = resolve(file_path);
        if (!existsSync(resolved)) return `File not found: ${file_path}`;
        const text = readFileSync(resolved, "utf-8");
        if (text.length > 8000) {
          return text.slice(0, 8000) + "\n\n[…truncated]";
        }
        return text;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // Override built-in view tool
  const viewTool = defineTool("view", {
    description: "View a file's contents or list a directory.",
    skipPermission: true,
    overridesBuiltInTool: true,
    parameters: z.object({
      path: z.string().describe("Path to the file or directory"),
      view_range: z.array(z.number()).optional().describe("Line range [start, end] to view"),
    }),
    handler: async ({ path: filePath, view_range }) => {
      console.error(`[io] view tool called: ${filePath}`);
      try {
        const resolved = resolve(filePath);
        if (!existsSync(resolved)) return `Not found: ${filePath}`;
        const stat = statSync(resolved);
        if (stat.isDirectory()) {
          const entries = readdirSync(resolved);
          return entries
            .map((e) => {
              const full = join(resolved, e);
              try {
                return statSync(full).isDirectory() ? `${e}/` : e;
              } catch { return e; }
            })
            .join("\n") || "(empty directory)";
        }
        const text = readFileSync(resolved, "utf-8");
        if (view_range && view_range.length === 2) {
          const lines = text.split("\n");
          const start = Math.max(0, view_range[0] - 1);
          const end = view_range[1] === -1 ? lines.length : Math.min(lines.length, view_range[1]);
          return lines.slice(start, end).map((l, i) => `${start + i + 1}. ${l}`).join("\n");
        }
        if (text.length > 8000) {
          return text.slice(0, 8000) + "\n\n[…truncated]";
        }
        return text;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // Override built-in grep tool
  const grepTool = defineTool("grep", {
    description: "Search file contents using a pattern.",
    skipPermission: true,
    overridesBuiltInTool: true,
    parameters: z.object({
      pattern: z.string().describe("Search pattern (regex)"),
      path: z.string().optional().describe("Directory or file to search"),
      include: z.string().optional().describe("Glob pattern to filter files (e.g., '*.ts')"),
    }),
    handler: async ({ pattern, path: searchPath, include }) => {
      console.error(`[io] grep tool called: ${pattern} in ${searchPath || "."}`);
      try {
        let cmd = `grep -rn "${pattern.replace(/"/g, '\\"')}"`;
        if (include) cmd += ` --include="${include}"`;
        cmd += ` ${searchPath || "."}`;
        const result = execSync(cmd, {
          encoding: "utf-8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: shellEnv(),
        });
        const output = result.trim();
        if (output.length > 8000) {
          return output.slice(0, 8000) + "\n\n[…truncated]";
        }
        return output || "(no matches)";
      } catch (err: unknown) {
        const execErr = err as { status?: number; stdout?: string };
        if (execErr.status === 1) return "(no matches)";
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // Override built-in str_replace_editor tool
  const strReplaceEditor = defineTool("str_replace_editor", {
    description: "View, create, or edit files using string replacement.",
    skipPermission: true,
    overridesBuiltInTool: true,
    parameters: z.object({
      command: z.enum(["view", "create", "str_replace", "insert"]).describe("Command to execute"),
      path: z.string().describe("File path"),
      old_str: z.string().optional().describe("String to replace (for str_replace)"),
      new_str: z.string().optional().describe("Replacement string"),
      file_text: z.string().optional().describe("Content for create"),
      insert_line: z.number().optional().describe("Line number for insert"),
      view_range: z.array(z.number()).optional().describe("Line range [start, end]"),
    }),
    handler: async ({ command, path: filePath, old_str, new_str, file_text, insert_line, view_range }) => {
      console.error(`[io] str_replace_editor tool called: ${command} ${filePath}`);
      try {
        const resolved = resolve(filePath);
        if (command === "view") {
          if (!existsSync(resolved)) return `File not found: ${filePath}`;
          const text = readFileSync(resolved, "utf-8");
          if (view_range && view_range.length === 2) {
            const lines = text.split("\n");
            const start = Math.max(0, view_range[0] - 1);
            const end = view_range[1] === -1 ? lines.length : Math.min(lines.length, view_range[1]);
            return lines.slice(start, end).map((l, i) => `${start + i + 1}. ${l}`).join("\n");
          }
          if (text.length > 8000) return text.slice(0, 8000) + "\n\n[…truncated]";
          return text;
        }
        if (command === "create") {
          mkdirSync(dirname(resolved), { recursive: true });
          writeFileSync(resolved, file_text || "", "utf-8");
          return `Created: ${filePath}`;
        }
        if (command === "str_replace") {
          if (!existsSync(resolved)) return `File not found: ${filePath}`;
          const text = readFileSync(resolved, "utf-8");
          if (old_str && !text.includes(old_str)) return `old_str not found in ${filePath}`;
          const updated = old_str ? text.replace(old_str, new_str || "") : text;
          writeFileSync(resolved, updated, "utf-8");
          return `Updated: ${filePath}`;
        }
        if (command === "insert") {
          if (!existsSync(resolved)) return `File not found: ${filePath}`;
          const lines = readFileSync(resolved, "utf-8").split("\n");
          const lineNum = insert_line ?? lines.length;
          lines.splice(lineNum, 0, new_str || "");
          writeFileSync(resolved, lines.join("\n"), "utf-8");
          return `Inserted at line ${lineNum} in ${filePath}`;
        }
        return `Unknown command: ${command}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // GitHub issue/PR management via gh CLI
  const github = defineTool("github", {
    description:
      "Manage GitHub issues and pull requests using the gh CLI. Supports creating, listing, viewing, and commenting on issues and PRs.",
    skipPermission: true,
    parameters: z.object({
      action: z
        .enum([
          "create_issue",
          "list_issues",
          "view_issue",
          "comment_issue",
          "close_issue",
          "create_pr",
          "list_prs",
          "view_pr",
          "comment_pr",
        ])
        .describe("The GitHub action to perform"),
      repo: z.string().describe("Repository in owner/repo format"),
      title: z.string().optional().describe("Title (for create_issue, create_pr)"),
      body: z.string().optional().describe("Body text (for create_issue, create_pr, comment_*)"),
      labels: z.array(z.string()).optional().describe("Labels (for create_issue)"),
      assignees: z.array(z.string()).optional().describe("Assignees (for create_issue)"),
      number: z.number().optional().describe("Issue or PR number (for view, comment, close)"),
      base: z.string().optional().describe("Base branch (for create_pr)"),
      head: z.string().optional().describe("Head branch (for create_pr)"),
      state: z.enum(["open", "closed", "all"]).optional().describe("Filter by state (for list_*)"),
      limit: z.number().optional().describe("Max results (for list_*, default 10)"),
    }),
    handler: async ({ action, repo, title, body, labels, assignees, number, base, head, state, limit }) => {
      console.error(`[io] github tool called: ${action} on ${repo}`);
      try {
        let cmd: string;
        const r = `--repo ${repo}`;

        switch (action) {
          case "create_issue": {
            if (!title) return "Error: title is required for create_issue";
            cmd = `gh issue create ${r} --title "${title.replace(/"/g, '\\"')}"`;
            if (body) cmd += ` --body "${body.replace(/"/g, '\\"')}"`;
            if (labels?.length) cmd += ` --label "${labels.join(",")}"`;
            if (assignees?.length) cmd += ` --assignee "${assignees.join(",")}"`;
            break;
          }
          case "list_issues": {
            cmd = `gh issue list ${r} --limit ${limit ?? 10}`;
            if (state) cmd += ` --state ${state}`;
            break;
          }
          case "view_issue": {
            if (!number) return "Error: number is required for view_issue";
            cmd = `gh issue view ${number} ${r}`;
            break;
          }
          case "comment_issue": {
            if (!number) return "Error: number is required for comment_issue";
            if (!body) return "Error: body is required for comment_issue";
            cmd = `gh issue comment ${number} ${r} --body "${body.replace(/"/g, '\\"')}"`;
            break;
          }
          case "close_issue": {
            if (!number) return "Error: number is required for close_issue";
            cmd = `gh issue close ${number} ${r}`;
            break;
          }
          case "create_pr": {
            if (!title) return "Error: title is required for create_pr";
            cmd = `gh pr create ${r} --title "${title.replace(/"/g, '\\"')}"`;
            if (body) cmd += ` --body "${body.replace(/"/g, '\\"')}"`;
            if (base) cmd += ` --base ${base}`;
            if (head) cmd += ` --head ${head}`;
            break;
          }
          case "list_prs": {
            cmd = `gh pr list ${r} --limit ${limit ?? 10}`;
            if (state) cmd += ` --state ${state}`;
            break;
          }
          case "view_pr": {
            if (!number) return "Error: number is required for view_pr";
            cmd = `gh pr view ${number} ${r}`;
            break;
          }
          case "comment_pr": {
            if (!number) return "Error: number is required for comment_pr";
            if (!body) return "Error: body is required for comment_pr";
            cmd = `gh pr comment ${number} ${r} --body "${body.replace(/"/g, '\\"')}"`;
            break;
          }
          default:
            return `Unknown action: ${action}`;
        }

        const result = execSync(cmd, {
          encoding: "utf-8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: shellEnv(),
        }).trim();
        if (result.length > 8000) {
          return result.slice(0, 8000) + "\n\n[…truncated]";
        }
        return result || "(success, no output)";
      } catch (err: unknown) {
        const execErr = err as { stderr?: string; stdout?: string; message?: string };
        const msg = execErr.stderr?.trim() || execErr.stdout?.trim() || execErr.message || "Command failed";
        return `Error: ${msg.length > 4000 ? msg.slice(0, 4000) + "\n[…truncated]" : msg}`;
      }
    },
  });

  return [wikiRead, wikiWrite, wikiSearch, squadCreate, squadRecall, squadStatus, squadLogDecision, squadDelegate, squadTaskStatus, shell, fileOps, bash, readFile, viewTool, grepTool, strReplaceEditor, github];
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
