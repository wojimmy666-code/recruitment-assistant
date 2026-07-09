import { Router } from "express";
import type { AppDatabase } from "../db";
import { listCandidatesForJob } from "../services/candidate-service";
import { requiredNumber } from "./utils";

export function createCandidatesRouter({ db }: { db: AppDatabase }) {
  const router = Router();

  router.get("/", (req, res) => {
    const jobId = req.query.jobId ? requiredNumber(req.query.jobId) : undefined;
    res.json(listCandidatesForJob(db, jobId));
  });

  return router;
}
