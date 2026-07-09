import cron from "node-cron";
import type { AppDatabase } from "./db";
import { getSchedule } from "./db";
import type { SiteAdapter } from "./domain";
import { eventHub, updateRuntime } from "./runtime";
import { runFilterForJob } from "./services/filter-service";
import type { SendService } from "./services/send-service";

export function createScheduler({
  db,
  adapter,
  sendService
}: {
  db: AppDatabase;
  adapter: SiteAdapter;
  sendService: SendService;
}) {
  let lastRunKey: string | null = null;

  const task = cron.schedule("* * * * *", async () => {
    const schedule = getSchedule(db);
    if (!schedule || !schedule.enabled) {
      updateRuntime({ scheduleStatus: "disabled" }, "schedule");
      return;
    }

    updateRuntime({ scheduleStatus: "enabled" }, "schedule");
    const now = new Date();
    const current = now.toTimeString().slice(0, 5);
    const runKey = `${now.toISOString().slice(0, 10)}:${schedule.id}:${schedule.run_time}`;
    if (current !== schedule.run_time || runKey === lastRunKey) return;

    lastRunKey = runKey;
    eventHub.emit("schedule-due", { scheduleId: schedule.id, mode: schedule.mode, runTime: schedule.run_time });

    try {
      if (!schedule.job_id) throw new Error("schedule_job_missing");
      await runFilterForJob({ db, adapter, jobId: schedule.job_id });

      if (schedule.mode === "auto") {
        if (!schedule.template_id) throw new Error("schedule_template_missing");
        sendService.start({
          jobId: schedule.job_id,
          templateId: schedule.template_id,
          dailyCap: schedule.daily_cap,
          intervalMinSeconds: schedule.interval_min_seconds,
          intervalMaxSeconds: schedule.interval_max_seconds
        });
      } else {
        eventHub.emit("schedule-safe-complete", { message: "安全模式已完成筛选，候选人已进入待发送队列。" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateRuntime({ lastError: message, pauseReason: "定时任务异常，已暂停。", sendStatus: "paused" }, "schedule");
    }
  });

  return {
    isEnabled() {
      return Boolean(getSchedule(db)?.enabled);
    },
    stop() {
      task.stop();
    }
  };
}
