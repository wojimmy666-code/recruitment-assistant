import { Router } from "express";
import type { AppDatabase } from "../db";
import { getSchedule } from "../db";
import { updateRuntime } from "../runtime";
import { asyncHandler, requiredNumber } from "./utils";

export function createScheduleRouter({ db }: { db: AppDatabase }) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(getSchedule(db));
  });

  router.put("/", asyncHandler(async (req, res) => {
    const schedule = getSchedule(db);
    if (!schedule) throw new Error("schedule_not_found");

    const enabled = req.body.enabled ? 1 : 0;
    const mode = req.body.mode === "auto" ? "auto" : "safe";
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE schedules SET
        enabled = ?,
        run_time = ?,
        job_id = ?,
        template_id = ?,
        mode = ?,
        daily_cap = ?,
        interval_min_seconds = ?,
        interval_max_seconds = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      enabled,
      String(req.body.run_time || "09:30"),
      nullableNumber(req.body.job_id),
      nullableNumber(req.body.template_id),
      mode,
      requiredNumber(req.body.daily_cap, 20),
      requiredNumber(req.body.interval_min_seconds, 45),
      requiredNumber(req.body.interval_max_seconds, 90),
      now,
      schedule.id
    );

    updateRuntime({ scheduleStatus: enabled ? "enabled" : "disabled" }, "schedule");
    res.json(getSchedule(db));
  }));

  return router;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
