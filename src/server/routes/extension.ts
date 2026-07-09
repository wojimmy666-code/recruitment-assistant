import { Router } from "express";
import type { AppDatabase } from "../db";
import { getDefaultJob } from "../db";
import type { AdapterCandidate } from "../domain";
import { eventHub } from "../runtime";
import { hasCandidateEvidence, isFalseCandidateText, saveCandidatesForJob } from "../services/candidate-service";
import { asyncHandler } from "./utils";

type ExtensionCandidate = {
  externalKey?: string;
  displayName?: string;
  profileUrl?: string;
  sourceUrl?: string;
  rawText?: string;
};

type ExtensionFilterDiagnosticElement = {
  selector: string;
  selectorCount: number;
  tag: string;
  text: string;
  attrs: Record<string, string>;
  valuePreview: string;
  valueLength: number;
  hrefKind: string;
  path: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type ExtensionFilterFrameDiagnostics = {
  ok: boolean;
  reason: string;
  frameId: string;
  frameUrl: string;
  framePath: string;
  capturedAt: string;
  href: string;
  path: string;
  title: string;
  isChatCandidatePage: boolean;
  bodyTextLength: number;
  loading: boolean;
  candidateSelectorHits: number;
  visibleTextBlocks: number;
  textHints: string[];
  inputs: ExtensionFilterDiagnosticElement[];
  clickables: ExtensionFilterDiagnosticElement[];
  filterControls: ExtensionFilterDiagnosticElement[];
  submitControls: ExtensionFilterDiagnosticElement[];
  candidateContainers: ExtensionFilterDiagnosticElement[];
  listFingerprint: {
    signature: string;
    containerCount: number;
    selectorHits: number;
    textLength: number;
  };
};

type ExtensionFilterDiagnosticsReport = {
  sourceUrl: string;
  title: string;
  capturedAt: string;
  frames: ExtensionFilterFrameDiagnostics[];
};

type ExtensionRecommendQueueItem = {
  id: string;
  index: number;
  externalKey: string;
  displayName: string;
  profileUrl: string;
  rawText: string;
  salary: string;
  activeText: string;
  age: string;
  experience: string;
  education: string;
  arrival: string;
  greetingButtonText: string;
  greetingButtonSelector: string;
  cardSelector: string;
  sourceUrl: string;
};


type ExtensionGreetingActionResult = {
  ok: boolean;
  clicked: boolean;
  reason: string;
  blockedReason: string;
  href: string;
  path: string;
  title: string;
  frameId: string;
  frameUrl: string;
  framePath: string;
  candidateIndex: number;
  externalKey: string;
  displayName: string;
  cardSelector: string;
  greetingButtonText: string;
  greetingButtonSelector: string;
  inputSelector: string;
  inputText: string;
  sendButtonSelector: string;
  sendButtonText: string;
  filled: boolean;
  readyToSend: boolean;
  sent: boolean;
  sendSuppressed: boolean;
  messagePreview: string;
  bodyTextLength: number;
};

type ExtensionGreetingTestReport = {
  sourceUrl: string;
  title: string;
  capturedAt: string;
  item: ExtensionRecommendQueueItem;
  messagePreview: string;
  clickResult: ExtensionGreetingActionResult;
  composerResult: ExtensionGreetingActionResult;
};

type ExtensionGreetingBatchRecord = {
  at: string;
  status: string;
  errorMessage: string;
  item: ExtensionRecommendQueueItem;
  messagePreview: string;
  clickResult: ExtensionGreetingActionResult;
  composerResult: ExtensionGreetingActionResult;
};

type ExtensionGreetingBatchState = {
  id: string;
  status: "running" | "waiting_confirmation" | "waiting_interval" | "paused" | "completed" | "blocked";
  mode: "manual_confirm";
  targetCount: number;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  startedAt: string;
  updatedAt: string;
  nextAllowedAt: string;
  pauseReason: string;
  queueSize: number;
  selectedJobText: string;
  sourceUrl: string;
  attempted: number;
  filled: number;
  failed: number;
  blocked: number;
  skipped: number;
  records: ExtensionGreetingBatchRecord[];
};
type ExtensionRecommendQueueReport = {
  sourceUrl: string;
  title: string;
  capturedAt: string;
  href: string;
  path: string;
  frameId: string;
  frameUrl: string;
  framePath: string;
  selectedJobText: string;
  listContainerCount: number;
  cardCount: number;
  items: ExtensionRecommendQueueItem[];
  warnings: string[];
  listFingerprint: {
    signature: string;
    containerCount: number;
    selectorHits: number;
    textLength: number;
    textSample: string;
  };
};

let lastFilterDiagnostics: ExtensionFilterDiagnosticsReport | null = null;
let lastRecommendQueue: ExtensionRecommendQueueReport | null = null;
let lastGreetingTest: ExtensionGreetingTestReport | null = null;
let lastGreetingBatch: ExtensionGreetingBatchState | null = null;

export function createExtensionRouter({ db }: { db: AppDatabase }) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/filter-diagnostics", (_req, res) => {
    res.json(lastFilterDiagnostics);
  });

  router.get("/recommend-queue", (_req, res) => {
    res.json(lastRecommendQueue);
  });

  router.get("/greeting-test", (_req, res) => {
    res.json(lastGreetingTest);
  });

  router.get("/greeting-batch", (_req, res) => {
    res.json(lastGreetingBatch);
  });

  router.post("/filter-diagnostics", asyncHandler(async (req, res) => {
    const pageUrl = String(req.body.sourceUrl || "");
    if (pageUrl && !pageUrl.includes("zhipin.com")) {
      throw new Error("extension_source_not_supported");
    }

    const report: ExtensionFilterDiagnosticsReport = {
      sourceUrl: truncateText(pageUrl, 500),
      title: truncateText(String(req.body.title || ""), 160),
      capturedAt: new Date().toISOString(),
      frames: normalizeFilterDiagnosticFrames(req.body.frames)
    };

    lastFilterDiagnostics = report;
    eventHub.emit("extension-filter-diagnostics", report);

    res.json({
      ok: true,
      savedAt: report.capturedAt,
      frameCount: report.frames.length,
      usefulFrames: report.frames.filter((frame) => frame.ok).length,
      report
    });
  }));

  router.post("/recommend-queue", asyncHandler(async (req, res) => {
    const pageUrl = String(req.body.sourceUrl || req.body.href || "");
    if (pageUrl && !pageUrl.includes("zhipin.com")) {
      throw new Error("extension_source_not_supported");
    }

    const report = normalizeRecommendQueueReport(req.body, pageUrl);
    lastRecommendQueue = report;
    eventHub.emit("recommend-queue", report);

    res.json({
      ok: true,
      savedAt: report.capturedAt,
      count: report.items.length,
      report
    });
  }));

  router.post("/greeting-test", asyncHandler(async (req, res) => {
    const pageUrl = String(req.body.sourceUrl || req.body.href || "");
    if (pageUrl && !pageUrl.includes("zhipin.com")) {
      throw new Error("extension_source_not_supported");
    }

    const report = normalizeGreetingTestReport(req.body, pageUrl);
    lastGreetingTest = report;
    eventHub.emit("greeting-test", report);

    res.json({
      ok: true,
      savedAt: report.capturedAt,
      report
    });
  }));

  router.post("/greeting-batch/start", asyncHandler(async (req, res) => {
    if (!lastRecommendQueue || lastRecommendQueue.items.length === 0) {
      throw new Error("recommend_queue_not_found");
    }

    const available = lastRecommendQueue.items.filter((item) => item.greetingButtonSelector);
    if (available.length === 0) {
      throw new Error("recommend_queue_has_no_greeting_button");
    }

    const now = new Date().toISOString();
    const targetCount = clampNumber(req.body.targetCount ?? req.body.target_count, 1, Math.min(20, available.length), Math.min(3, available.length));
    const intervalMinSeconds = clampNumber(req.body.intervalMinSeconds ?? req.body.interval_min_seconds, 30, 3600, 45);
    const intervalMaxSeconds = clampNumber(req.body.intervalMaxSeconds ?? req.body.interval_max_seconds, intervalMinSeconds, 7200, Math.max(intervalMinSeconds, 90));

    lastGreetingBatch = {
      id: `batch-${Date.now()}`,
      status: "running",
      mode: "manual_confirm",
      targetCount,
      intervalMinSeconds,
      intervalMaxSeconds,
      startedAt: now,
      updatedAt: now,
      nextAllowedAt: "",
      pauseReason: "",
      queueSize: available.length,
      selectedJobText: lastRecommendQueue.selectedJobText,
      sourceUrl: lastRecommendQueue.sourceUrl,
      attempted: 0,
      filled: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      records: []
    };

    const nextItem = getNextGreetingBatchItem();
    emitGreetingBatch();
    res.json({ ok: true, batch: lastGreetingBatch, nextItem, waitSeconds: 0 });
  }));

  router.post("/greeting-batch/next", asyncHandler(async (_req, res) => {
    if (!lastGreetingBatch) throw new Error("greeting_batch_not_started");
    if (lastGreetingBatch.status === "blocked" || lastGreetingBatch.status === "paused" || lastGreetingBatch.status === "completed") {
      res.json({ ok: true, batch: lastGreetingBatch, nextItem: null, waitSeconds: 0 });
      return;
    }

    const waitSeconds = getBatchWaitSeconds();
    if (waitSeconds > 0) {
      lastGreetingBatch.status = "waiting_interval";
      lastGreetingBatch.updatedAt = new Date().toISOString();
      emitGreetingBatch();
      res.json({ ok: true, batch: lastGreetingBatch, nextItem: null, waitSeconds });
      return;
    }

    lastGreetingBatch.status = "running";
    lastGreetingBatch.updatedAt = new Date().toISOString();
    const nextItem = getNextGreetingBatchItem();
    emitGreetingBatch();
    res.json({ ok: true, batch: lastGreetingBatch, nextItem, waitSeconds: 0 });
  }));

  router.post("/greeting-batch/record", asyncHandler(async (req, res) => {
    if (!lastGreetingBatch) throw new Error("greeting_batch_not_started");

    const record = normalizeGreetingBatchRecord(req.body, lastGreetingBatch.sourceUrl);
    applyGreetingBatchRecord(record);
    emitGreetingBatch();
    res.json({ ok: true, batch: lastGreetingBatch, record });
  }));

  router.post("/greeting-batch/pause", asyncHandler(async (req, res) => {
    if (!lastGreetingBatch) throw new Error("greeting_batch_not_started");
    lastGreetingBatch.status = "paused";
    lastGreetingBatch.pauseReason = truncateText(String(req.body.reason || "\u7528\u6237\u624b\u52a8\u6682\u505c"), 160);
    lastGreetingBatch.updatedAt = new Date().toISOString();
    emitGreetingBatch();
    res.json({ ok: true, batch: lastGreetingBatch });
  }));

  router.post("/candidates", asyncHandler(async (req, res) => {
    const defaultJob = getDefaultJob(db);
    const jobId = Number(req.body.jobId || defaultJob?.id);
    if (!jobId) throw new Error("job_not_found");

    const pageUrl = String(req.body.sourceUrl || "");
    if (pageUrl && !pageUrl.includes("zhipin.com")) {
      throw new Error("extension_source_not_supported");
    }

    const candidates = normalizeCandidates(req.body.candidates || [], pageUrl);
    const result = saveCandidatesForJob({
      db,
      jobId,
      candidates,
      selectorNote: "候选人由 Chrome 扩展从已登录 BOSS 页面导入；发送按钮和输入框仍需在当前页面人工确认或后续扩展化。"
    });

    eventHub.emit("filter-result", result);
    res.json(result);
  }));

  return router;
}

function normalizeGreetingBatchRecord(input: unknown, pageUrl: string): ExtensionGreetingBatchRecord {
  const record = toRecord(input);
  const clickResult = normalizeGreetingActionResult(record.clickResult);
  const composerResult = normalizeGreetingActionResult(record.composerResult);
  const blockedReason = composerResult.blockedReason || clickResult.blockedReason;
  const status = blockedReason ? "blocked" : composerResult.inputSelector && composerResult.filled ? "filled" : "failed";
  const errorMessage = blockedReason || composerResult.reason || clickResult.reason || deriveGreetingBatchError(clickResult, composerResult);

  return {
    at: new Date().toISOString(),
    status,
    errorMessage: truncateText(errorMessage, 240),
    item: normalizeGreetingTestItem(record.item, pageUrl),
    messagePreview: truncateText(String(record.messagePreview || composerResult.messagePreview || ""), 160),
    clickResult,
    composerResult
  };
}

function deriveGreetingBatchError(clickResult: ExtensionGreetingActionResult, composerResult: ExtensionGreetingActionResult) {
  if (!clickResult.clicked) return "??????????";
  if (!composerResult.inputSelector) return "??????????????????";
  if (!composerResult.filled) return "??????????????????";
  return "";
}

function applyGreetingBatchRecord(record: ExtensionGreetingBatchRecord) {
  if (!lastGreetingBatch) return;

  lastGreetingBatch.records = [...lastGreetingBatch.records, record].slice(-100);
  lastGreetingBatch.attempted += 1;
  lastGreetingBatch.updatedAt = record.at;

  if (record.status === "blocked") {
    lastGreetingBatch.blocked += 1;
    lastGreetingBatch.status = "blocked";
    lastGreetingBatch.pauseReason = record.errorMessage || "blocked";
    lastGreetingBatch.nextAllowedAt = "";
    return;
  }

  if (record.status === "filled") {
    lastGreetingBatch.filled += 1;
    if (lastGreetingBatch.filled >= lastGreetingBatch.targetCount) {
      lastGreetingBatch.status = "completed";
      lastGreetingBatch.pauseReason = "";
      lastGreetingBatch.nextAllowedAt = "";
      return;
    }

    lastGreetingBatch.status = "waiting_confirmation";
    lastGreetingBatch.pauseReason = "\u7b49\u5f85\u4eba\u5de5\u786e\u8ba4\u53d1\u9001\u5e76\u8fd4\u56de\u63a8\u8350\u9875\u540e\u7ee7\u7eed\u3002";
    lastGreetingBatch.nextAllowedAt = nextBatchAllowedAt(lastGreetingBatch.intervalMinSeconds, lastGreetingBatch.intervalMaxSeconds);
    return;
  }

  lastGreetingBatch.failed += 1;
  lastGreetingBatch.status = "paused";
  lastGreetingBatch.pauseReason = record.errorMessage || "\u5355\u4eba\u5904\u7406\u5931\u8d25\uff0c\u5df2\u6682\u505c\u3002";
  lastGreetingBatch.nextAllowedAt = "";
}

function getNextGreetingBatchItem() {
  if (!lastGreetingBatch || !lastRecommendQueue) return null;
  if (lastGreetingBatch.filled >= lastGreetingBatch.targetCount) {
    lastGreetingBatch.status = "completed";
    lastGreetingBatch.nextAllowedAt = "";
    return null;
  }

  const processed = new Set(lastGreetingBatch.records.map((record) => record.item.externalKey).filter(Boolean));
  const nextItem = lastRecommendQueue.items.find((item) => item.greetingButtonSelector && !processed.has(item.externalKey));
  if (!nextItem) {
    lastGreetingBatch.status = "completed";
    lastGreetingBatch.pauseReason = lastGreetingBatch.filled >= lastGreetingBatch.targetCount ? "" : "\u63a8\u8350\u961f\u5217\u6ca1\u6709\u66f4\u591a\u53ef\u6253\u62db\u547c\u5019\u9009\u4eba\u3002";
    lastGreetingBatch.nextAllowedAt = "";
    return null;
  }

  return nextItem;
}

function getBatchWaitSeconds() {
  if (!lastGreetingBatch?.nextAllowedAt) return 0;
  const waitMs = new Date(lastGreetingBatch.nextAllowedAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(waitMs / 1000));
}

function nextBatchAllowedAt(minSeconds: number, maxSeconds: number) {
  const min = Math.max(30, Math.min(minSeconds, maxSeconds));
  const max = Math.max(min, maxSeconds);
  const seconds = min + Math.floor(Math.random() * (max - min + 1));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function emitGreetingBatch() {
  if (lastGreetingBatch) eventHub.emit("greeting-batch", lastGreetingBatch);
}

function normalizeGreetingTestReport(input: unknown, pageUrl: string): ExtensionGreetingTestReport {
  const record = toRecord(input);
  const sourceUrl = truncateText(String(record.sourceUrl || pageUrl || ""), 500);
  return {
    sourceUrl,
    title: truncateText(String(record.title || ""), 160),
    capturedAt: new Date().toISOString(),
    item: normalizeGreetingTestItem(record.item, sourceUrl),
    messagePreview: truncateText(String(record.messagePreview || ""), 160),
    clickResult: normalizeGreetingActionResult(record.clickResult),
    composerResult: normalizeGreetingActionResult(record.composerResult)
  };
}

function normalizeGreetingTestItem(input: unknown, pageUrl: string): ExtensionRecommendQueueItem {
  const normalized = normalizeRecommendQueueItems([input], pageUrl)[0];
  if (normalized) return normalized;
  return {
    id: "",
    index: 0,
    externalKey: "",
    displayName: "\u5019\u9009\u4eba",
    profileUrl: "",
    rawText: "",
    salary: "",
    activeText: "",
    age: "",
    experience: "",
    education: "",
    arrival: "",
    greetingButtonText: "",
    greetingButtonSelector: "",
    cardSelector: "",
    sourceUrl: pageUrl
  };
}

function normalizeGreetingActionResult(input: unknown): ExtensionGreetingActionResult {
  const record = toRecord(input);
  return {
    ok: Boolean(record.ok),
    clicked: Boolean(record.clicked),
    reason: truncateText(String(record.reason || ""), 240),
    blockedReason: truncateText(String(record.blockedReason || ""), 240),
    href: truncateText(String(record.href || ""), 500),
    path: truncateText(String(record.path || ""), 240),
    title: truncateText(String(record.title || ""), 160),
    frameId: truncateText(String(record.frameId || ""), 40),
    frameUrl: truncateText(String(record.frameUrl || ""), 500),
    framePath: truncateText(String(record.framePath || ""), 240),
    candidateIndex: toFiniteNumber(record.candidateIndex),
    externalKey: truncateText(String(record.externalKey || ""), 240),
    displayName: truncateText(String(record.displayName || ""), 80),
    cardSelector: truncateText(String(record.cardSelector || ""), 240),
    greetingButtonText: truncateText(String(record.greetingButtonText || ""), 40),
    greetingButtonSelector: truncateText(String(record.greetingButtonSelector || ""), 240),
    inputSelector: truncateText(String(record.inputSelector || ""), 240),
    inputText: truncateText(String(record.inputText || ""), 100),
    sendButtonSelector: truncateText(String(record.sendButtonSelector || ""), 240),
    sendButtonText: truncateText(String(record.sendButtonText || ""), 40),
    filled: Boolean(record.filled),
    readyToSend: Boolean(record.readyToSend),
    sent: Boolean(record.sent),
    sendSuppressed: Boolean(record.sendSuppressed),
    messagePreview: truncateText(String(record.messagePreview || ""), 160),
    bodyTextLength: toFiniteNumber(record.bodyTextLength)
  };
}

function normalizeRecommendQueueReport(input: unknown, pageUrl: string): ExtensionRecommendQueueReport {
  const record = toRecord(input);
  const listFingerprint = toRecord(record.listFingerprint);
  const sourceUrl = truncateText(String(record.sourceUrl || pageUrl || record.href || ""), 500);
  return {
    sourceUrl,
    title: truncateText(String(record.title || ""), 160),
    capturedAt: new Date().toISOString(),
    href: truncateText(String(record.href || sourceUrl), 500),
    path: truncateText(String(record.path || ""), 240),
    frameId: truncateText(String(record.frameId || ""), 40),
    frameUrl: truncateText(String(record.frameUrl || ""), 500),
    framePath: truncateText(String(record.framePath || ""), 240),
    selectedJobText: truncateText(String(record.selectedJobText || ""), 160),
    listContainerCount: toFiniteNumber(record.listContainerCount),
    cardCount: toFiniteNumber(record.cardCount),
    items: normalizeRecommendQueueItems(record.queue || record.items, sourceUrl),
    warnings: normalizeStringArray(record.warnings, 20, 180),
    listFingerprint: {
      signature: truncateText(String(listFingerprint.signature || ""), 180),
      containerCount: toFiniteNumber(listFingerprint.containerCount),
      selectorHits: toFiniteNumber(listFingerprint.selectorHits),
      textLength: toFiniteNumber(listFingerprint.textLength),
      textSample: truncateText(String(listFingerprint.textSample || ""), 240)
    }
  };
}

function normalizeRecommendQueueItems(input: unknown, pageUrl: string): ExtensionRecommendQueueItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: ExtensionRecommendQueueItem[] = [];

  for (const item of input.slice(0, 100)) {
    const record = toRecord(item);
    const rawText = truncateText(String(record.rawText || ""), 700);
    const externalKey = truncateText(String(record.externalKey || record.id || record.profileUrl || rawText.slice(0, 120)), 240);
    if (!externalKey || seen.has(externalKey)) continue;
    seen.add(externalKey);

    result.push({
      id: externalKey,
      index: toFiniteNumber(record.index),
      externalKey,
      displayName: truncateText(String(record.displayName || "\u5019\u9009\u4eba"), 80),
      profileUrl: truncateText(String(record.profileUrl || ""), 500),
      rawText,
      salary: truncateText(String(record.salary || ""), 40),
      activeText: truncateText(String(record.activeText || ""), 60),
      age: truncateText(String(record.age || ""), 20),
      experience: truncateText(String(record.experience || ""), 40),
      education: truncateText(String(record.education || ""), 40),
      arrival: truncateText(String(record.arrival || ""), 60),
      greetingButtonText: truncateText(String(record.greetingButtonText || ""), 40),
      greetingButtonSelector: truncateText(String(record.greetingButtonSelector || ""), 240),
      cardSelector: truncateText(String(record.cardSelector || ""), 240),
      sourceUrl: truncateText(String(record.sourceUrl || pageUrl), 500)
    });
  }

  return result;
}

function normalizeCandidates(input: ExtensionCandidate[], pageUrl: string): AdapterCandidate[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const result: AdapterCandidate[] = [];

  for (const item of input) {
    const rawText = String(item.rawText || "").trim();
    const profileUrl = String(item.profileUrl || item.sourceUrl || "").trim();
    const externalKey = String(item.externalKey || profileUrl || rawText.slice(0, 80)).trim();
    const displayName = String(item.displayName || rawText.split("\n").find(Boolean) || "候选人").trim();
    if (!externalKey || externalKey.includes("/job_detail/") || seen.has(externalKey)) continue;
    if (isFalseCandidateText(displayName) || isFalseCandidateText(externalKey)) continue;
    if (isFalseCandidateText(rawText) && !hasCandidateEvidence(rawText)) continue;
    seen.add(externalKey);

    result.push({
      externalKey,
      displayName,
      sourceUrl: pageUrl || profileUrl || undefined
    });
  }

  return result.slice(0, 100);
}

function normalizeFilterDiagnosticFrames(input: unknown): ExtensionFilterFrameDiagnostics[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).map((item, index) => normalizeFilterDiagnosticFrame(item, index));
}

function normalizeFilterDiagnosticFrame(input: unknown, index: number): ExtensionFilterFrameDiagnostics {
  const frame = toRecord(input);
  const listFingerprint = toRecord(frame.listFingerprint);
  return {
    ok: Boolean(frame.ok),
    reason: truncateText(String(frame.reason || ""), 240),
    frameId: truncateText(String(frame.frameId ?? index), 40),
    frameUrl: truncateText(String(frame.frameUrl || ""), 500),
    framePath: truncateText(String(frame.framePath || ""), 240),
    capturedAt: truncateText(String(frame.capturedAt || ""), 80),
    href: truncateText(String(frame.href || ""), 500),
    path: truncateText(String(frame.path || ""), 240),
    title: truncateText(String(frame.title || ""), 160),
    isChatCandidatePage: Boolean(frame.isChatCandidatePage),
    bodyTextLength: toFiniteNumber(frame.bodyTextLength),
    loading: Boolean(frame.loading),
    candidateSelectorHits: toFiniteNumber(frame.candidateSelectorHits),
    visibleTextBlocks: toFiniteNumber(frame.visibleTextBlocks),
    textHints: normalizeStringArray(frame.textHints, 80, 80),
    inputs: normalizeDiagnosticElements(frame.inputs, 80),
    clickables: normalizeDiagnosticElements(frame.clickables, 120),
    filterControls: normalizeDiagnosticElements(frame.filterControls, 80),
    submitControls: normalizeDiagnosticElements(frame.submitControls, 40),
    candidateContainers: normalizeDiagnosticElements(frame.candidateContainers, 30),
    listFingerprint: {
      signature: truncateText(String(listFingerprint.signature || ""), 180),
      containerCount: toFiniteNumber(listFingerprint.containerCount),
      selectorHits: toFiniteNumber(listFingerprint.selectorHits),
      textLength: toFiniteNumber(listFingerprint.textLength)
    }
  };
}

function normalizeDiagnosticElements(input: unknown, limit: number): ExtensionFilterDiagnosticElement[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, limit).map((item) => {
    const element = toRecord(item);
    const rect = toRecord(element.rect);
    return {
      selector: truncateText(String(element.selector || ""), 240),
      selectorCount: toFiniteNumber(element.selectorCount),
      tag: truncateText(String(element.tag || ""), 40),
      text: truncateText(String(element.text || ""), 180),
      attrs: normalizeAttributes(element.attrs),
      valuePreview: truncateText(String(element.valuePreview || ""), 100),
      valueLength: toFiniteNumber(element.valueLength),
      hrefKind: truncateText(String(element.hrefKind || ""), 40),
      path: truncateText(String(element.path || ""), 260),
      rect: {
        x: toFiniteNumber(rect.x),
        y: toFiniteNumber(rect.y),
        width: toFiniteNumber(rect.width),
        height: toFiniteNumber(rect.height)
      }
    };
  });
}

function normalizeAttributes(input: unknown): Record<string, string> {
  const record = toRecord(input);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record).slice(0, 14)) {
    result[truncateText(key, 80)] = truncateText(String(value || ""), 180);
  }
  return result;
}

function normalizeStringArray(input: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, limit).map((item) => truncateText(String(item || ""), maxLength)).filter(Boolean);
}

function toRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
}

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}