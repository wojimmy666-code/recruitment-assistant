import { Router } from "express";
import type { SendService } from "../services/send-service";
import { asyncHandler, requiredNumber } from "./utils";

export function createSendRouter({ sendService }: { sendService: SendService }) {
  const router = Router();

  router.post("/start", asyncHandler(async (req, res) => {
    const result = sendService.start({
      jobId: requiredNumber(req.body.jobId ?? req.body.job_id),
      templateId: requiredNumber(req.body.templateId ?? req.body.template_id),
      dailyCap: requiredNumber(req.body.dailyCap ?? req.body.daily_cap, 20),
      intervalMinSeconds: requiredNumber(req.body.intervalMinSeconds ?? req.body.interval_min_seconds, 45),
      intervalMaxSeconds: requiredNumber(req.body.intervalMaxSeconds ?? req.body.interval_max_seconds, 90),
      candidateIds: Array.isArray(req.body.candidateIds) ? req.body.candidateIds.map(Number) : undefined
    });

    res.json(result);
  }));

  router.post("/manual", asyncHandler(async (req, res) => {
    const result = await sendService.sendManual({
      jobId: requiredNumber(req.body.jobId ?? req.body.job_id),
      templateId: requiredNumber(req.body.templateId ?? req.body.template_id),
      dailyCap: requiredNumber(req.body.dailyCap ?? req.body.daily_cap, 20),
      intervalMinSeconds: requiredNumber(req.body.intervalMinSeconds ?? req.body.interval_min_seconds, 45),
      intervalMaxSeconds: requiredNumber(req.body.intervalMaxSeconds ?? req.body.interval_max_seconds, 90),
      candidateId: requiredNumber(req.body.candidateId ?? req.body.candidate_id)
    });

    res.json(result);
  }));

  router.post("/pause", (_req, res) => {
    res.json(sendService.pause());
  });

  return router;
}
