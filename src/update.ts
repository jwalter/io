import { execSync } from "child_process";

const PACKAGE_NAME = "io-assistant";

interface UpdateInfo {
  updateAvailable: boolean;
  current: string;
  latest: string;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const packageJson = await import("../package.json", { with: { type: "json" } }).catch(() => null);
    const current = (packageJson?.default?.version as string) ?? "0.0.0";

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

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
