import { Router } from "express";
import type { AppDatabase } from "../db";
import { getSchedule, getTodaySentCount } from "../db";
import { runtimeState } from "../runtime";

export function createStateRouter({ db }: { db: AppDatabase }) {
  const router = Router();

  router.get("/", (_req, res) => {
    const schedule = getSchedule(db);
    const todaySent = getTodaySentCount(db);

    res.json({
      ...runtimeState,
      todaySent,
      dailyCap: schedule?.daily_cap ?? 20,
      schedulerEnabled: Boolean(schedule?.enabled),
      nextRun: schedule?.enabled ? `今天或明天 ${schedule.run_time}` : "未开启"
    });
  });

  return router;
}
