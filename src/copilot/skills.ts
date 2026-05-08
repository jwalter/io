import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";
import { SKILLS_DIR } from "../paths.js";

export interface SkillInfo {
  name: string;
  slug: string;
  description: string;
  path: string;
}

export interface SkillRegistryResult {
  name: string;
  description: string;
  repoUrl: string;
}

/**
 * Scan SKILLS_DIR for subdirectories that contain a SKILL.md file.
 * Returns absolute paths to qualifying skill directories.
 */
export function getSkillDirectories(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];

  const dirs: string[] = [];

  for (const entry of readdirSync(SKILLS_DIR)) {
    const skillDir = join(SKILLS_DIR, entry);
    if (!statSync(skillDir).isDirectory()) continue;

    const skillMd = join(skillDir, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    dirs.push(skillDir);

    // Check for an agents subdirectory (Copilot SDK custom agents)
    const agentsDir = join(skillDir, "agents");
    if (existsSync(agentsDir) && statSync(agentsDir).isDirectory()) {
      dirs.push(agentsDir);
    }
  }

  return dirs;
}

function parseSkillMd(content: string): { name: string; description: string } {
  const lines = content.split(/\r?\n/);

  let name = "";
  let description = "";
  let foundHeading = false;
  const descLines: string[] = [];

  for (const line of lines) {
    if (!foundHeading) {
      const match = line.match(/^#\s+(.+)/);
      if (match) {
        name = match[1].trim();
        foundHeading = true;
      }
      continue;
    }

    // Skip blank lines between heading and first paragraph
    if (descLines.length === 0 && line.trim() === "") continue;

    // Stop at the next blank line after collecting description text
    if (descLines.length > 0 && line.trim() === "") break;

    // Stop at another heading
    if (line.match(/^#+\s/)) break;

    descLines.push(line.trim());
  }

  description = descLines.join(" ");
  return { name, description };
}

/**
 * List all installed skills with metadata parsed from their SKILL.md files.
 */
export function listSkills(): SkillInfo[] {
  if (!existsSync(SKILLS_DIR)) return [];

  const skills: SkillInfo[] = [];

  for (const entry of readdirSync(SKILLS_DIR)) {
    const skillDir = join(SKILLS_DIR, entry);
    if (!statSync(skillDir).isDirectory()) continue;

    const skillMdPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, "utf-8");
    const { name, description } = parseSkillMd(content);

    skills.push({
      name: name || entry,
      slug: entry,
      description,
      path: skillDir,
    });
  }

  return skills;
}

/**
 * Clone a git repo into SKILLS_DIR and return the installed skill info.
 * Throws if the cloned repo does not contain a SKILL.md file.
 */
export async function installSkill(repoUrl: string): Promise<SkillInfo> {
  const repoName = basename(repoUrl, ".git").replace(/\.git$/, "");
  const destDir = join(SKILLS_DIR, repoName);

  execSync(`git clone ${repoUrl} ${destDir}`, { stdio: "pipe" });

  const skillMdPath = join(destDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    rmSync(destDir, { recursive: true, force: true });
    throw new Error(
      `Repository "${repoUrl}" does not contain a SKILL.md file.`,
    );
  }

  const content = readFileSync(skillMdPath, "utf-8");
  const { name, description } = parseSkillMd(content);

  return {
    name: name || repoName,
    slug: repoName,
    description,
    path: destDir,
  };
}

/**
 * Remove a skill directory by its slug. Returns true if it existed.
 */
export function removeSkill(slug: string): boolean {
  const skillDir = join(SKILLS_DIR, slug);
  if (!existsSync(skillDir)) return false;
  rmSync(skillDir, { recursive: true, force: true });
  return true;
}

/**
 * Search the skills registry for skills matching the given query.
 * Returns an empty array on network or parsing errors.
 */
export async function searchSkillsRegistry(
  query: string,
): Promise<SkillRegistryResult[]> {
  try {
    const url = `https://skills.sh/api/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = (await response.json()) as SkillRegistryResult[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
