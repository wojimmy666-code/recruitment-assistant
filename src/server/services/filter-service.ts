import type { AppDatabase } from "../db";
import type { FilterInput, Job, SiteAdapter } from "../domain";
import { updateRuntime } from "../runtime";
import { saveCandidatesForJob } from "./candidate-service";

export async function runFilterForJob({
  db,
  adapter,
  jobId
}: {
  db: AppDatabase;
  adapter: SiteAdapter;
  jobId: number;
}) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
  if (!job) throw new Error("job_not_found");

  updateRuntime({ filterStatus: "filtering", lastError: null }, "filter");

  const loggedIn = await adapter.ensureLoggedIn();
  if (!loggedIn) {
    updateRuntime({ browserStatus: "login_required", filterStatus: "failed", lastError: "需要手动登录后重试" }, "filter");
    throw new Error("blocked:login_required");
  }

  updateRuntime({ browserStatus: "connected" }, "browser");
  const adapterCandidates = await adapter.runFilter(toFilterInput(job));
  const result = saveCandidatesForJob({
    db,
    jobId: job.id,
    candidates: adapterCandidates,
    selectorNote: "BOSS 页面候选人卡片、唯一 ID、消息输入框和发送按钮 selector 仍需在真实页面校准。"
  });
  updateRuntime({ filterStatus: "completed", lastError: null }, "filter");
  return result;
}

function toFilterInput(job: Job): FilterInput {
  return {
    jobName: job.name,
    city: job.city ?? undefined,
    keywords: job.keywords ?? undefined,
    activeWithin: job.active_within ?? undefined,
    salaryMin: job.salary_min ?? undefined,
    salaryMax: job.salary_max ?? undefined,
    gender: job.gender ?? undefined,
    ageMin: job.age_min ?? undefined,
    ageMax: job.age_max ?? undefined,
    excludeContacted: Boolean(job.exclude_contacted)
  };
}
