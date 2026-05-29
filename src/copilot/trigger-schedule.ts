import { getSchedule, updateScheduleLastRun, type Schedule } from "../store/schedules.js";
import { sendToOrchestrator } from "./orchestrator.js";
import { buildSquadScopedPrompt } from "./io-scheduler.js";
import { delegateTask } from "./agents.js";

/**
 * Trigger a schedule immediately, bypassing cron timing.
 * Returns the schedule if triggered successfully, or undefined if not found.
 */
export function triggerSchedule(id: string): Schedule | undefined {
  const schedule = getSchedule(id);
  if (!schedule) return undefined;

  updateScheduleLastRun(schedule.id);

  if (schedule.type === "squad") {
    if (!schedule.squad_id) return schedule;

    const task = schedule.prompt || `Run "triage" stand-up. Agenda: triage`;

    // Delegate directly to squad lead — same path as the cron scheduler
    delegateTask(schedule.squad_id, task).catch((err) => {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[trigger] Delegation failed for squad ${schedule.squad_id}: ${errMsg}`);
    });
  } else {
    sendToOrchestrator(buildSquadScopedPrompt(schedule), "io-scheduler", (_text, done) => {
      if (done) {
        console.log(`[trigger] IO schedule ${schedule.id} completed.`);
      }
    });
  }

  return schedule;
}
