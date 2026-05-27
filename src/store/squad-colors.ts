// Palette complementary to the site's brand gradient (magenta #E43A9C → violet #F041FF)
// Avoiding direct brand colors; using analogous/complementary hues that look cohesive
export const SQUAD_COLOR_PALETTE = [
  "#06b6d4", // cyan (complementary to magenta)
  "#14b8a6", // teal
  "#f59e0b", // amber (warm contrast)
  "#8b5cf6", // violet (analogous)
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f43f5e", // rose (analogous warm)
  "#6366f1", // indigo
] as const;

const DEFAULT_SQUAD_COLOR = "#3b82f6";

export function pickSquadColor(
  usedColors: string[],
  random: () => number = Math.random
): string {
  const used = new Set(usedColors.filter(Boolean).map((c) => c.toLowerCase()));
  const available = SQUAD_COLOR_PALETTE.filter((c) => !used.has(c.toLowerCase()));
  const source = available.length > 0 ? available : SQUAD_COLOR_PALETTE;
  if (source.length === 0) return DEFAULT_SQUAD_COLOR;
  const index = Math.floor(random() * source.length);
  return source[index] ?? DEFAULT_SQUAD_COLOR;
}
