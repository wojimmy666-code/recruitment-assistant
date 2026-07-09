import { Router } from "express";
import type { AppDatabase } from "../db";
import { asyncHandler, requiredNumber } from "./utils";

export function createTemplatesRouter({ db }: { db: AppDatabase }) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(db.prepare("SELECT * FROM templates ORDER BY is_default DESC, id").all());
  });

  router.post("/", asyncHandler(async (req, res) => {
    const now = new Date().toISOString();
    const isDefault = req.body.is_default ? 1 : 0;
    if (isDefault) db.prepare("UPDATE templates SET is_default = 0").run();

    const info = db.prepare(`
      INSERT INTO templates (name, body, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      String(req.body.name || "未命名文案"),
      String(req.body.body || ""),
      isDefault,
      now,
      now
    );

    res.status(201).json(db.prepare("SELECT * FROM templates WHERE id = ?").get(info.lastInsertRowid));
  }));

  router.put("/:id", asyncHandler(async (req, res) => {
    const id = requiredNumber(req.params.id);
    const now = new Date().toISOString();
    const isDefault = req.body.is_default ? 1 : 0;
    if (isDefault) db.prepare("UPDATE templates SET is_default = 0 WHERE id <> ?").run(id);

    db.prepare(`
      UPDATE templates SET name = ?, body = ?, is_default = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(req.body.name || "未命名文案"),
      String(req.body.body || ""),
      isDefault,
      now,
      id
    );

    res.json(db.prepare("SELECT * FROM templates WHERE id = ?").get(id));
  }));

  return router;
}
