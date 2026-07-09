import type { AppDatabase } from "../db";
import type { AdapterCandidate, CandidateRecord, Job } from "../domain";

export type CandidateSaveResult = {
  found: number;
  sendable: number;
  skipped: number;
  candidates: CandidateRecord[];
  selectorNote: string;
};

export function saveCandidatesForJob({
  db,
  jobId,
  candidates,
  selectorNote
}: {
  db: AppDatabase;
  jobId: number;
  candidates: AdapterCandidate[];
  selectorNote: string;
}): CandidateSaveResult {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
  if (!job) throw new Error("job_not_found");

  const validCandidates = candidates.filter((candidate) => isValidCandidate(candidate));
  const now = new Date().toISOString();
  const saved: CandidateRecord[] = [];
  let skipped = 0;

  const hasSentLog = db.prepare("SELECT id FROM send_logs WHERE candidate_key = ? AND status = 'sent' LIMIT 1");
  const selectExisting = db.prepare("SELECT * FROM candidates WHERE external_key = ?");
  const upsert = db.prepare(`
    INSERT INTO candidates
    (external_key, display_name, job_id, source_url, status, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_key) DO UPDATE SET
      display_name = excluded.display_name,
      job_id = excluded.job_id,
      source_url = excluded.source_url,
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `);

  const write = db.transaction(() => {
    for (const candidate of validCandidates) {
      const existing = selectExisting.get(candidate.externalKey) as CandidateRecord | undefined;
      const contacted = Boolean(hasSentLog.get(candidate.externalKey));
      const status = chooseStatus({ existing, contacted, excludeContacted: Boolean(job.exclude_contacted) });
      if (status === "skipped") skipped += 1;

      upsert.run(
        candidate.externalKey,
        candidate.displayName ?? null,
        job.id,
        candidate.sourceUrl ?? null,
        status,
        now,
        now,
        now
      );
      saved.push(selectExisting.get(candidate.externalKey) as CandidateRecord);
    }
  });

  write();

  const displayable = saved.filter(isDisplayableCandidateRecord);
  return {
    found: validCandidates.length,
    sendable: displayable.filter((candidate) => candidate.status === "pending").length,
    skipped,
    candidates: displayable,
    selectorNote
  };
}

export function listCandidatesForJob(db: AppDatabase, jobId?: number) {
  if (jobId) {
    const rows = db
      .prepare(`
        SELECT * FROM candidates
        WHERE job_id = ? AND external_key NOT LIKE '%/job_detail/%' AND external_key NOT LIKE 'id:time%' AND COALESCE(display_name, '') NOT LIKE '%页面已停止维护%' AND COALESCE(display_name, '') NOT LIKE '%自动跳转%'
        ORDER BY last_seen_at DESC, id DESC
        LIMIT 200
      `)
      .all(jobId) as CandidateRecord[];

    return rows.filter(isDisplayableCandidateRecord);
  }

  const rows = db
    .prepare(`
      SELECT * FROM candidates
      WHERE external_key NOT LIKE '%/job_detail/%' AND external_key NOT LIKE 'id:time%' AND COALESCE(display_name, '') NOT LIKE '%页面已停止维护%' AND COALESCE(display_name, '') NOT LIKE '%自动跳转%'
      ORDER BY last_seen_at DESC, id DESC
      LIMIT 200
    `)
    .all() as CandidateRecord[];

  return rows.filter(isDisplayableCandidateRecord);
}

export function isFalseCandidateText(value?: string | null) {
  const compact = String(value || "").replace(/\s+/g, "").trim();
  if (!compact) return false;

  if (/^(推荐牛人|搜索牛人|推荐|牛人|候选人|候选|简历|联系人|全部消息|聊天记录|打招呼|新招呼|沟通过|已沟通|工具箱|牛人管理|互动|沟通|职位管理)$/.test(compact)) return true;
  if (/^道具[·.\d\u4e00-\u9fa5\s]*生效中$/.test(compact) || /^意向沟通/.test(compact)) return true;
  return isFalseCandidateHref(compact) || /^(推荐牛人|搜索牛人|候选人|简历){2,}$/.test(compact);
}

export function hasCandidateEvidence(value?: string | null) {
  const text = String(value || "");
  return /岁|经验|学历|求职|离职|在职|活跃|沟通|简历|在线|离线|刚刚|分钟|小时|昨天|前天|回复|消息|已读|未读|招呼|感兴趣|附件|投递/.test(text) ||
    /\d{1,2}:\d{2}/.test(text) ||
    /geek|candidate|resume|uid/i.test(text);
}

function chooseStatus({
  existing,
  contacted,
  excludeContacted
}: {
  existing?: CandidateRecord;
  contacted: boolean;
  excludeContacted: boolean;
}) {
  if (existing?.status === "sent") return "sent";
  if (excludeContacted && contacted) return "skipped";
  return "pending";
}

function isValidCandidate(candidate: AdapterCandidate) {
  const text = `${candidate.externalKey} ${candidate.displayName ?? ""}`;
  if (candidate.externalKey.includes("/job_detail/")) return false;
  if (isFalseCandidateHref(candidate.externalKey) || isFalseCandidateHref(candidate.sourceUrl)) return false;
  if (candidate.externalKey.startsWith("id:time")) return false;
  if (text.includes("页面已停止维护") || text.includes("自动跳转")) return false;
  if (isFalseCandidateText(candidate.displayName) || isFalseCandidateText(candidate.externalKey)) return false;
  return true;
}

function isDisplayableCandidateRecord(candidate: CandidateRecord) {
  if (isFalseCandidateText(candidate.display_name) || isFalseCandidateText(candidate.external_key)) return false;
  if (isFalseCandidateHref(candidate.external_key) || isFalseCandidateHref(candidate.source_url)) return false;
  return true;
}

function isFalseCandidateHref(value?: string | null) {
  if (!value) return false;
  const text = String(value);
  const normalized = text.startsWith("href:") ? text.slice(5) : text;
  const path = normalized.split("?")[0];
  if (/\/job_detail\//.test(path)) return true;
  if (/\/web\/chat\/(toolbox|business\/mall|geek\/manage|interaction|intention|job\/list)/.test(path)) return true;
  if (path === "/web/chat/index" && !/[?&](geekId|uid|userId|friendId|securityId)=/.test(normalized)) return true;
  return false;
}

