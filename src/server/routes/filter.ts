import { Router } from "express";
import type { AppDatabase } from "../db";
import type { SiteAdapter } from "../domain";
import { eventHub, updateRuntime } from "../runtime";
import { runFilterForJob } from "../services/filter-service";
import { asyncHandler, requiredNumber } from "./utils";

export function createFilterRouter({ db, adapter }: { db: AppDatabase; adapter: SiteAdapter }) {
  const router = Router();

  router.post("/run", asyncHandler(async (req, res) => {
    const jobId = requiredNumber(req.body.jobId ?? req.body.job_id);

    try {
      const result = await runFilterForJob({ db, adapter, jobId });
      eventHub.emit("filter-result", result);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateRuntime({
        filterStatus: "failed",
        browserStatus: message.includes("login_required") ? "login_required" : "paused",
        pauseReason: toPauseReason(message),
        lastError: message
      }, "filter");
      throw error;
    }
  }));

  return router;
}

function toPauseReason(errorMessage: string) {
  if (errorMessage.includes("wrong_page:")) return errorMessage.split("wrong_page:")[1] || "当前页面不是候选人列表页。";
  if (errorMessage.includes("blocked:captcha")) return "检测到验证码或安全验证，已自动暂停。";
  if (errorMessage.includes("blocked:login_required")) return "需要手动登录招聘网站后重试。";
  if (errorMessage.includes("blocked:page_error")) return "页面异常，已自动暂停。";
  return "筛选失败，已暂停。";
}
