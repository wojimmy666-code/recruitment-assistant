import { Router } from "express";
import type { AppDatabase } from "../db";
import { asyncHandler, requiredNumber } from "./utils";

export function createJobsRouter({ db }: { db: AppDatabase }) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(db.prepare("SELECT * FROM jobs ORDER BY id").all());
  });

  router.post("/", asyncHandler(async (req, res) => {
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO jobs
      (name, city, keywords, salary_min, salary_max, active_within, exclude_contacted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(req.body.name || "未命名职位"),
      req.body.city || null,
      req.body.keywords || null,
      nullableNumber(req.body.salary_min),
      nullableNumber(req.body.salary_max),
      req.body.active_within || null,
      req.body.exclude_contacted === false ? 0 : 1,
      now,
      now
    );

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(job);
  }));

  router.put("/:id", asyncHandler(async (req, res) => {
    const id = requiredNumber(req.params.id);
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE jobs SET
        name = ?,
        city = ?,
        keywords = ?,
        salary_min = ?,
        salary_max = ?,
        active_within = ?,
        exclude_contacted = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      String(req.body.name || "未命名职位"),
      req.body.city || null,
      req.body.keywords || null,
      nullableNumber(req.body.salary_min),
      nullableNumber(req.body.salary_max),
      req.body.active_within || null,
      req.body.exclude_contacted === false ? 0 : 1,
      now,
      id
    );

    res.json(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id));
  }));

  return router;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
