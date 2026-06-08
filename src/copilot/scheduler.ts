import { listSchedules, updateScheduleLastRun } from "../store/schedules.js";
import { delegateTask } from "./agents.js";
import { addAuditEntry } from "../store/audit-log.js";

let schedulerInterval: ReturnType<typeof setInterval> | undefined;

export function startSquadScheduler(): void {
  // Check every minute for due schedules
  schedulerInterval = setInterval(() => {
    checkSquadSchedules();
  }, 60_000);
  schedulerInterval.unref();
}

function checkSquadSchedules(): void {
  const schedules = listSchedules("squad");
  const now = new Date();

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    if (!isDue(schedule.cron, schedule.last_run, now)) continue;
    if (!schedule.squad_id) {
      console.warn(`[scheduler] Schedule ${schedule.id} skipped: missing squad_id.`);
      continue;
    }

    const squadId = schedule.squad_id!;

    updateScheduleLastRun(schedule.id);

    const task = schedule.prompt || `Run "triage" stand-up. Agenda: triage`;

    addAuditEntry(
      "schedule_triggered",
      `Schedule triggered for squad ${squadId}: ${task.slice(0, 200)}`,
      { squad_id: squadId, schedule_id: schedule.id, task: task.slice(0, 1000) },
      { squad_id: squadId }
    );

    // Delegate directly to the squad lead — bypasses orchestrator rephrasing
    delegateTask(squadId, task).catch((err) => {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[scheduler] Delegation failed for squad ${squadId}: ${errMsg}`);
      addAuditEntry(
        "schedule_error",
        `Scheduled delegation failed: ${errMsg}`,
        { squad_id: squadId, error: errMsg },
        { squad_id: squadId }
      );
    });

    console.log(`[scheduler] Task delegated to squad ${squadId}`);
  }
}

function isDue(cron: string, lastRun: string | null, now: Date): boolean {
  // Simple cron matching: parse "minute hour day month weekday"
  const parts = cron.split(" ");
  if (parts.length !== 5) return false;

  const [minSpec, hourSpec, daySpec, monthSpec, weekdaySpec] = parts;

  if (!matchesCronField(minSpec, now.getMinutes())) return false;
  if (!matchesCronField(hourSpec, now.getHours())) return false;
  if (!matchesCronField(daySpec, now.getDate())) return false;
  if (!matchesCronField(monthSpec, now.getMonth() + 1)) return false;
  if (!matchesCronField(weekdaySpec, now.getDay())) return false;

  // Prevent running more than once per matching minute
  if (lastRun) {
    const lastDate = new Date(lastRun);
    const diffMs = now.getTime() - lastDate.getTime();
    if (diffMs < 60_000) return false;
  }

  return true;
}

function matchesCronField(spec: string, value: number): boolean {
  if (spec === "*") return true;

  // Handle ranges (e.g., "1-5")
  if (spec.includes("-")) {
    const [start, end] = spec.split("-").map(Number);
    return value >= start && value <= end;
  }

  // Handle lists (e.g., "1,3,5")
  if (spec.includes(",")) {
    return spec.split(",").map(Number).includes(value);
  }

  // Handle step values (e.g., "*/5")
  if (spec.startsWith("*/")) {
    const step = parseInt(spec.slice(2), 10);
    return value % step === 0;
  }

  // Exact match
  return parseInt(spec, 10) === value;
}

export function stopSquadScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = undefined;
  }
}
