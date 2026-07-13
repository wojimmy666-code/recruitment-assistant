import { Router } from "express";
import { deserializeJob, type AppDatabase } from "../db";
import { asyncHandler, requiredNumber } from "./utils";

export function createJobsRouter({ db }: { db: AppDatabase }) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(db.prepare("SELECT * FROM jobs ORDER BY id").all().map(deserializeJob));
  });

  router.post("/", asyncHandler(async (req, res) => {
    const now = new Date().toISOString();
    const ageRange = normalizeAgeRange(req.body.age_min, req.body.age_max);
    const info = db.prepare(`
      INSERT INTO jobs
      (name, city, keywords, salary_min, salary_max, active_within, job_intentions, experience_requirements, gender, age_min, age_max, exclude_contacted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(req.body.name || "未命名职位"),
      req.body.city || null,
      req.body.keywords || null,
      nullableNumber(req.body.salary_min),
      nullableNumber(req.body.salary_max),
      req.body.active_within || null,
      serializeMultiSelect(req.body.job_intentions, JOB_INTENTION_OPTIONS, "求职意向"),
      serializeMultiSelect(req.body.experience_requirements, EXPERIENCE_REQUIREMENT_OPTIONS, "经验要求"),
      nullableGender(req.body.gender),
      ageRange.min,
      ageRange.max,
      req.body.exclude_contacted === false ? 0 : 1,
      now,
      now
    );

    const job = deserializeJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(info.lastInsertRowid));
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
        job_intentions = ?,
        experience_requirements = ?,
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
      serializeMultiSelect(req.body.job_intentions, JOB_INTENTION_OPTIONS, "求职意向"),
      serializeMultiSelect(req.body.experience_requirements, EXPERIENCE_REQUIREMENT_OPTIONS, "经验要求"),
      nullableGender(req.body.gender),
      ageRange.min,
      ageRange.max,
      req.body.exclude_contacted === false ? 0 : 1,
      now,
      id
    );

    res.json(deserializeJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id)));
  }));

  return router;
}

const JOB_INTENTION_OPTIONS = ["离职-随时到岗", "在职-暂不考虑", "在职-考虑机会", "在职-月内到岗"];
const EXPERIENCE_REQUIREMENT_OPTIONS = ["在校/应届", "25年毕业", "26年毕业", "26年后毕业", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"];

function serializeMultiSelect(value: unknown, allowedOptions: string[], label: string) {
  if (value === null || value === undefined || value === "") return null;
  const values = Array.isArray(value) ? value : [value];
  const normalized = Array.from(new Set(values.map((item) => String(item || "").trim()).filter((item) => item && item !== "不限")));
  const invalid = normalized.filter((item) => !allowedOptions.includes(item));
  if (invalid.length > 0) throw new Error(`${label}包含不支持的选项：${invalid.join("、")}`);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
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
