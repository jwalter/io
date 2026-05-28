import { execSync } from "node:child_process";
import { loadConfig } from "../config.js";

/**
 * Cached GitHub token for CLI operations.
 * Resolution order: GH_TOKEN env → GITHUB_TOKEN env → config.githubToken → `gh auth token` CLI.
 * Resolved once at first access and cached for the lifetime of the process.
 */
let cachedToken: string | undefined;
let resolved = false;

export function getGhToken(): string | undefined {
  if (resolved) return cachedToken;
  resolved = true;

  // 1. Prefer explicit env vars
  if (process.env.GH_TOKEN) {
    cachedToken = process.env.GH_TOKEN;
    return cachedToken;
  }
  if (process.env.GITHUB_TOKEN) {
    cachedToken = process.env.GITHUB_TOKEN;
    return cachedToken;
  }

  // 2. Check IO config file
  try {
    const config = loadConfig();
    if (config.githubToken) {
      cachedToken = config.githubToken;
      return cachedToken;
    }
  } catch {
    // Config not available
  }

  // 3. Try extracting from gh CLI auth
  try {
    const token = execSync("gh auth token", {
      timeout: 5_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) {
      cachedToken = token;
    }
  } catch {
    // gh not available or not authenticated
  }

  return cachedToken;
}
