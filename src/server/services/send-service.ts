import type { AppDatabase } from "../db";
import { getTodaySentCount } from "../db";
import type { CandidateRecord, Job, SiteAdapter, Template } from "../domain";
import { eventHub, updateRuntime } from "../runtime";

type SendStartInput = {
  jobId: number;
  templateId: number;
  dailyCap: number;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  candidateIds?: number[];
};

export class SendService {
  private sending = false;
  private paused = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly adapter: SiteAdapter
  ) {}

  start(input: SendStartInput) {
    if (this.sending) {
      return { ok: false, reason: "already_sending", queued: 0 };
    }

    const queue = this.buildQueue(input);
    if (queue.length === 0) {
      updateRuntime({ sendStatus: "completed", pauseReason: null }, "send");
      return { ok: true, queued: 0 };
    }

    this.sending = true;
    this.paused = false;
    updateRuntime({ sendStatus: "sending", pauseReason: null, lastError: null }, "send");
    void this.processQueue(input, queue);
    return { ok: true, queued: queue.length };
  }

  async sendManual(input: SendStartInput & { candidateId: number }) {
    const queue = this.buildQueue({ ...input, candidateIds: [input.candidateId] }).slice(0, 1);
    if (queue.length === 0) return { ok: false, reason: "candidate_not_available" };

    this.sending = true;
    this.paused = false;
    updateRuntime({ sendStatus: "sending", pauseReason: null, lastError: null }, "send");
    await this.processQueue(input, queue, false);
    return { ok: true };
  }

  pause(reason = "用户手动暂停") {
    this.paused = true;
    updateRuntime({ sendStatus: "paused", browserStatus: "paused", pauseReason: reason }, "send");
    eventHub.emit("send-progress", { paused: true, reason });
    return { ok: true };
  }

  isSending() {
    return this.sending;
  }

  private buildQueue(input: SendStartInput) {
    const todaySent = getTodaySentCount(this.db);
    const remaining = Math.max(0, input.dailyCap - todaySent);
    if (remaining <= 0) return [];

    if (input.candidateIds?.length) {
      const placeholders = input.candidateIds.map(() => "?").join(",");
      return this.db
        .prepare(`SELECT * FROM candidates WHERE id IN (${placeholders}) AND status = 'pending' ORDER BY id`)
        .all(...input.candidateIds)
        .slice(0, remaining) as CandidateRecord[];
    }

    return this.db
      .prepare("SELECT * FROM candidates WHERE job_id = ? AND status = 'pending' AND external_key NOT LIKE '%/job_detail/%' AND external_key NOT LIKE 'id:time%' AND COALESCE(display_name, '') NOT LIKE '%页面已停止维护%' AND COALESCE(display_name, '') NOT LIKE '%自动跳转%' ORDER BY id LIMIT ?")
      .all(input.jobId, remaining) as CandidateRecord[];
  }

  private async processQueue(input: SendStartInput, queue: CandidateRecord[], useInterval = true) {
    const job = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(input.jobId) as Job | undefined;
    const template = this.db.prepare("SELECT * FROM templates WHERE id = ?").get(input.templateId) as Template | undefined;
    if (!job || !template) {
      this.finishWithError("job_or_template_not_found");
      return;
    }

    for (let index = 0; index < queue.length; index += 1) {
      const candidate = queue[index];
      if (this.paused) break;

      const duplicate = this.db
        .prepare("SELECT id FROM send_logs WHERE candidate_key = ? AND status = 'sent' LIMIT 1")
        .get(candidate.external_key);

      if (duplicate) {
        this.recordLog(candidate, job, template, renderMessage(template.body, job), "skipped", null);
        this.db.prepare("UPDATE candidates SET status = 'skipped', updated_at = ? WHERE id = ?").run(new Date().toISOString(), candidate.id);
        eventHub.emit("send-progress", { sent: index, total: queue.length, skipped: candidate.display_name });
        continue;
      }

      const message = renderMessage(template.body, job);
      try {
        await this.adapter.sendGreeting(
          {
            externalKey: candidate.external_key,
            displayName: candidate.display_name ?? undefined,
            sourceUrl: candidate.source_url ?? undefined
          },
          message
        );
        this.recordLog(candidate, job, template, message, "sent", null);
        this.db.prepare("UPDATE candidates SET status = 'sent', updated_at = ? WHERE id = ?").run(new Date().toISOString(), candidate.id);
        eventHub.emit("send-progress", { sent: index + 1, total: queue.length, candidate: candidate.display_name });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        this.recordLog(candidate, job, template, message, "failed", messageText);
        this.db.prepare("UPDATE candidates SET status = 'failed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), candidate.id);
        this.paused = true;
        updateRuntime({
          sendStatus: "failed",
          browserStatus: messageText.includes("blocked:login_required") ? "login_required" : "paused",
          pauseReason: toPauseReason(messageText),
          lastError: messageText
        }, "send");
        break;
      }

      if (useInterval && index < queue.length - 1 && !this.paused) {
        await delay(randomIntervalMs(input.intervalMinSeconds, input.intervalMaxSeconds));
      }
    }

    if (this.paused) {
      updateRuntime({ sendStatus: "paused", pauseReason: "发送已暂停" }, "send");
    } else {
      updateRuntime({ sendStatus: "completed", pauseReason: null }, "send");
    }

    this.sending = false;
  }

  private recordLog(
    candidate: CandidateRecord,
    job: Job,
    template: Template,
    messageBody: string,
    status: "sent" | "skipped" | "failed",
    errorMessage: string | null
  ) {
    this.db.prepare(`
      INSERT INTO send_logs
      (candidate_key, candidate_name, job_id, template_id, message_body, status, error_message, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      candidate.external_key,
      candidate.display_name,
      job.id,
      template.id,
      messageBody,
      status,
      errorMessage,
      new Date().toISOString()
    );
  }

  private finishWithError(message: string) {
    this.sending = false;
    this.paused = true;
    updateRuntime({ sendStatus: "failed", lastError: message, pauseReason: message }, "send");
  }
}

function renderMessage(body: string, job: Job) {
  return body.replaceAll("{职位}", job.name).replaceAll("{城市}", job.city ?? "");
}

function randomIntervalMs(minSeconds: number, maxSeconds: number) {
  const min = Math.max(1, Math.min(minSeconds, maxSeconds));
  const max = Math.max(min, maxSeconds);
  return (min + Math.floor(Math.random() * (max - min + 1))) * 1000;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPauseReason(errorMessage: string) {
  if (errorMessage.includes("blocked:captcha")) return "检测到验证码或安全验证，已自动暂停。";
  if (errorMessage.includes("blocked:login_required")) return "登录状态失效，需要手动登录后重试。";
  if (errorMessage.includes("blocked:page_error")) return "页面异常，已自动暂停。";
  return "发送失败，已自动暂停。";
}
