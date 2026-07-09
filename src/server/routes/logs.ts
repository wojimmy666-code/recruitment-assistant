import { Router } from "express";
import type { AppDatabase } from "../db";

export function createLogsRouter({ db }: { db: AppDatabase }) {
  const router = Router();

  router.get("/", (_req, res) => {
    const rows = db.prepare(`
      SELECT
        send_logs.*,
        jobs.name AS job_name,
        templates.name AS template_name
      FROM send_logs
      LEFT JOIN jobs ON jobs.id = send_logs.job_id
      LEFT JOIN templates ON templates.id = send_logs.template_id
      ORDER BY send_logs.sent_at DESC
      LIMIT 100
    `).all();

    res.json(rows);
  });

  return router;
}
