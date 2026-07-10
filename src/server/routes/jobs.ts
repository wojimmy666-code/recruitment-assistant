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
    const ageRange = normalizeAgeRange(req.body.age_min, req.body.age_max);
    const info = db.prepare(`
      INSERT INTO jobs
      (name, city, keywords, salary_min, salary_max, active_within, gender, age_min, age_max, exclude_contacted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(req.body.name || "未命名职位"),
      req.body.city || null,
      req.body.keywords || null,
      nullableNumber(req.body.salary_min),
      nullableNumber(req.body.salary_max),
      req.body.active_within || null,
      nullableGender(req.body.gender),
      ageRange.min,
      ageRange.max,
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
    const ageRange = normalizeAgeRange(req.body.age_min, req.body.age_max);
    db.prepare(`
      UPDATE jobs SET
        name = ?,
        city = ?,
        keywords = ?,
        salary_min = ?,
        salary_max = ?,
        active_within = ?,
        gender = ?,
        age_min = ?,
        age_max = ?,
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
      nullableGender(req.body.gender),
      ageRange.min,
      ageRange.max,
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

function nullableGender(value: unknown): "男" | "女" | null {
  const gender = String(value || "").trim();
  if (!gender || gender === "不限") return null;
  if (gender === "男" || gender === "女") return gender;
  throw new Error("性别仅支持男、女或不限");
}

function normalizeAgeRange(minValue: unknown, maxValue: unknown) {
  const min = nullableAge(minValue);
  const max = nullableAge(maxValue);
  if (min !== null && max !== null && min > max) throw new Error("年龄下限不能大于年龄上限");
  return { min, max };
}

function nullableAge(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const age = Number(value);
  if (!Number.isInteger(age) || age < 16 || age > 70) throw new Error("年龄必须是 16 至 70 之间的整数");
  return age;
}
