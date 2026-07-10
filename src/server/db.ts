import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Job, Schedule, Template } from "./domain";

export type AppDatabase = Database.Database;

const nowIso = () => new Date().toISOString();

export function initDb() {
  fs.mkdirSync("data", { recursive: true });
  const db = new Database(path.resolve("data/app.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      city TEXT,
      keywords TEXT,
      salary_min INTEGER,
      salary_max INTEGER,
      active_within TEXT,
      gender TEXT,
      age_min INTEGER,
      age_max INTEGER,
      exclude_contacted INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_key TEXT NOT NULL UNIQUE,
      display_name TEXT,
      job_id INTEGER,
      source_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS send_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_key TEXT NOT NULL,
      candidate_name TEXT,
      job_id INTEGER,
      template_id INTEGER,
      message_body TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      sent_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (template_id) REFERENCES templates(id)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enabled INTEGER NOT NULL DEFAULT 0,
      run_time TEXT NOT NULL DEFAULT '09:30',
      job_id INTEGER,
      template_id INTEGER,
      mode TEXT NOT NULL DEFAULT 'safe',
      daily_cap INTEGER NOT NULL DEFAULT 20,
      interval_min_seconds INTEGER NOT NULL DEFAULT 45,
      interval_max_seconds INTEGER NOT NULL DEFAULT 90,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (template_id) REFERENCES templates(id)
    );
  `);

  ensureJobFilterColumns(db);
  seedDefaults(db);
  return db;
}

function ensureJobFilterColumns(db: AppDatabase) {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!columns.has("gender")) db.exec("ALTER TABLE jobs ADD COLUMN gender TEXT");
  if (!columns.has("age_min")) db.exec("ALTER TABLE jobs ADD COLUMN age_min INTEGER");
  if (!columns.has("age_max")) db.exec("ALTER TABLE jobs ADD COLUMN age_max INTEGER");
}

export function getDefaultJob(db: AppDatabase) {
  return db.prepare("SELECT * FROM jobs ORDER BY id LIMIT 1").get() as Job | undefined;
}

export function getDefaultTemplate(db: AppDatabase) {
  return db.prepare("SELECT * FROM templates ORDER BY is_default DESC, id LIMIT 1").get() as Template | undefined;
}

export function getSchedule(db: AppDatabase) {
  return db.prepare("SELECT * FROM schedules ORDER BY id LIMIT 1").get() as Schedule | undefined;
}

export function getTodaySentCount(db: AppDatabase) {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM send_logs WHERE status = 'sent' AND date(sent_at, 'localtime') = date('now', 'localtime')")
    .get() as { count: number };
  return row.count;
}

function seedDefaults(db: AppDatabase) {
  const now = nowIso();
  const jobCount = db.prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number };
  if (jobCount.count === 0) {
    db.prepare(`
      INSERT INTO jobs
      (name, city, keywords, salary_min, salary_max, active_within, exclude_contacted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run("奶茶店店员（上海）", "上海", "奶茶 店员 服务员", 5000, 8000, "近 3 天活跃", now, now);
  }

  const templateCount = db.prepare("SELECT COUNT(*) AS count FROM templates").get() as { count: number };
  if (templateCount.count === 0) {
    db.prepare(`
      INSERT INTO templates (name, body, is_default, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
    `).run(
      "默认打招呼文案",
      "你好，我们这边正在招聘{职位}，看到你的求职意向比较匹配，想和你简单沟通一下，可以吗？",
      now,
      now
    );
  }

  const scheduleCount = db.prepare("SELECT COUNT(*) AS count FROM schedules").get() as { count: number };
  if (scheduleCount.count === 0) {
    const job = getDefaultJob(db);
    const template = getDefaultTemplate(db);
    db.prepare(`
      INSERT INTO schedules
      (enabled, run_time, job_id, template_id, mode, daily_cap, interval_min_seconds, interval_max_seconds, updated_at)
      VALUES (0, '09:30', ?, ?, 'safe', 20, 45, 90, ?)
    `).run(job?.id ?? null, template?.id ?? null, now);
  }
}
