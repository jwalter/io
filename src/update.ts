import { execSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const PACKAGE_NAME = "heyio";

interface UpdateInfo {
  updateAvailable: boolean;
  current: string;
  latest: string;
}

function getInstalledVersion(): string {
  try {
    // Resolve package.json relative to this file: dist/update.js → ../package.json
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const current = getInstalledVersion();

    const latest = execSync(`npm view ${PACKAGE_NAME} version 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();

    if (!latest) return { updateAvailable: false, current, latest: current };

    const updateAvailable = latest !== current && compareSemver(current, latest) < 0;
    return { updateAvailable, current, latest };
  } catch {
    return { updateAvailable: false, current: "unknown", latest: "unknown" };
  }
}

/**
 * Auto-update: install the latest version globally and return true if updated.
 * Returns false if already up-to-date or if the update fails.
 */
export async function autoUpdate(): Promise<boolean> {
  const info = await checkForUpdate();
  if (!info.updateAvailable) return false;

  console.log(`[io] ⬆ Updating: v${info.current} → v${info.latest}...`);
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      encoding: "utf-8",
      timeout: 60_000,
      stdio: "pipe",
    });
    console.log(`[io] ✓ Updated to v${info.latest}. Restarting...`);
    return true;
  } catch (err) {
    console.error(`[io] ⚠ Auto-update failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
