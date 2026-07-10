const LOCAL_BASE_URL = "http://localhost:3000";
const STORAGE_KEY = "recruitmentAssistantGreetingBatch";
const ALARM_NAME = "recruitment-assistant-greeting-batch-next";
const MAX_PROCESSED_FINGERPRINTS = 500;

let activeStepPromise = null;
let batchStartPromise = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith("GREETING_BATCH_")) return false;

  void handleBatchMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void runBatchStep();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void pauseIfTargetTabClosed(tabId);
});

chrome.runtime.onStartup.addListener(() => {
  void restoreBatchSchedule();
});

chrome.runtime.onInstalled.addListener(() => {
  void restoreBatchSchedule();
});

async function handleBatchMessage(message) {
  if (message.type === "GREETING_BATCH_START") {
    if (batchStartPromise) throw new Error("正在应用筛选并启动批次，请勿重复点击。");
    batchStartPromise = startGreetingBatch(message).finally(() => {
      batchStartPromise = null;
    });
    return batchStartPromise;
  }
  if (message.type === "GREETING_BATCH_RESUME") return resumeGreetingBatch();
  if (message.type === "GREETING_BATCH_PAUSE") return pauseGreetingBatch();
  if (message.type === "GREETING_BATCH_STATUS") {
    return { ok: true, controller: await readController(), batch: await readBatchSnapshot() };
  }
  return { ok: false, error: "unsupported_batch_message" };
}

async function startGreetingBatch(message) {
  if (activeStepPromise) {
    throw new Error("\u4e0a\u4e00\u6b21\u9875\u9762\u52a8\u4f5c\u4ecd\u5728\u6267\u884c\uff0c\u8bf7\u7a0d\u540e\u518d\u5f00\u59cb\u3002");
  }

  const tabId = Number(message.tabId);
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url?.includes("zhipin.com/web/chat/recommend")) {
    throw new Error("\u8bf7\u5148\u5207\u6362\u5230 BOSS \u63a8\u8350\u725b\u4eba\u9875\u9762\u3002");
  }

  await stopExistingBatchForNewStart();
  const job = await readDefaultJob();
  const filterResult = await applySavedFiltersToRecommendPage(tabId, job);
  const refreshedTab = await chrome.tabs.get(tabId);
  if (!refreshedTab?.url?.includes("zhipin.com/web/chat/recommend")) {
    throw new Error("筛选完成前 BOSS 标签页已离开推荐页，已停止启动批次。");
  }

  const payload = await localRequest("/api/extension/greeting-batch/start", {
    method: "POST",
    body: {
      targetCount: message.targetCount,
      intervalMinSeconds: message.intervalMinSeconds,
      intervalMaxSeconds: message.intervalMaxSeconds,
      sourceUrl: refreshedTab.url,
      title: refreshedTab.title || tab.title || "",
      filterJobId: job.id,
      filterJobName: job.name || "",
      filterFields: filterResult.fields || [],
      filterWarnings: filterResult.warnings || [],
      selectedJobText: filterResult.selectedJobText || "",
      filterAppliedAt: new Date().toISOString()
    }
  });

  const controller = {
    batchId: payload.batch.id,
    tabId,
    active: true,
    resetToTop: true,
    job,
    localFilterFields: filterResult.localFilterFields || [],
    processedFingerprints: [],
    updatedAt: new Date().toISOString(),
    lastError: ""
  };
  await writeController(controller);

  const stepResult = await runBatchStep();
  return {
    ok: stepResult.ok !== false,
    error: stepResult.error || "",
    filterResult,
    controller: await readController(),
    batch: stepResult.batch || await readBatchSnapshot()
  };
}

async function stopExistingBatchForNewStart() {
  await chrome.alarms.clear(ALARM_NAME);
  const controller = await readController();
  if (controller) {
    controller.active = false;
    controller.updatedAt = new Date().toISOString();
    controller.lastError = "";
    await writeController(controller);
  }

  const batch = await readBatchSnapshot();
  if (!batch || batch.status === "completed" || batch.status === "blocked" || batch.status === "paused") return;
  try {
    await localRequest("/api/extension/greeting-batch/pause", {
      method: "POST",
      body: { reason: "正在启动新批次，等待重新应用筛选条件。" }
    });
  } catch (_error) {
    // A missing previous batch must not block a clean start.
  }
}

async function readDefaultJob() {
  const jobs = await localRequest("/api/jobs");
  const job = Array.isArray(jobs) ? jobs[0] : null;
  if (!job) throw new Error("招聘助手中还没有职位筛选条件，请先保存筛选条件。");
  return job;
}

async function applySavedFiltersToRecommendPage(tabId, job) {
  const frame = await getRecommendFrame(tabId);
  if (!frame) {
    throw new Error("未找到 BOSS 推荐列表 frame，请刷新推荐页后重试。");
  }

  const result = await sendMessageToFrame(tabId, frame.frameId, {
    type: "RECOMMEND_APPLY_FILTERS",
    job
  });
  if (!result?.ok || !result?.applied || !result?.refreshed) {
    throw new Error("BOSS 筛选未完成，已停止批量：" + (result?.reason || "页面没有确认筛选结果已刷新。"));
  }

  return {
    ...result,
    frameId: String(frame.frameId),
    frameUrl: frame.url || "",
    framePath: pathFromUrl(frame.url)
  };
}

async function resumeGreetingBatch() {
  if (activeStepPromise) {
    return { ok: true, controller: await readController(), batch: await readBatchSnapshot() };
  }

  const controller = await readController();
  if (!controller?.batchId || !controller?.tabId) {
    throw new Error("\u8bf7\u5148\u5f00\u59cb\u4e00\u4e2a\u6279\u91cf\u4efb\u52a1\u3002");
  }

  const currentBatch = await readBatchSnapshot();
  if (!currentBatch) throw new Error("\u672c\u5730\u6279\u6b21\u72b6\u6001\u5df2\u4e22\u5931\uff0c\u8bf7\u91cd\u65b0\u5f00\u59cb\u3002");
  if (currentBatch.status === "completed") throw new Error("\u5f53\u524d\u6279\u6b21\u5df2\u5b8c\u6210\u3002");
  if (currentBatch.status === "blocked") {
    throw new Error("\u5f53\u524d\u6279\u6b21\u5df2\u88ab\u98ce\u63a7\u963b\u65ad\uff0c\u8bf7\u5904\u7406 BOSS \u9875\u9762\u540e\u91cd\u65b0\u5f00\u59cb\u3002");
  }

  if (currentBatch.status === "waiting_interval") {
    controller.active = true;
    controller.updatedAt = new Date().toISOString();
    await writeController(controller);
    await scheduleFromBatch(currentBatch);
    return { ok: true, waiting: true, controller, batch: currentBatch };
  }

  const payload = currentBatch.status === "paused"
    ? await localRequest("/api/extension/greeting-batch/resume", { method: "POST", body: {} })
    : { batch: currentBatch };

  controller.active = true;
  controller.updatedAt = new Date().toISOString();
  controller.lastError = "";
  await writeController(controller);

  const stepResult = await runBatchStep();
  return {
    ok: stepResult.ok !== false,
    error: stepResult.error || "",
    controller: await readController(),
    batch: stepResult.batch || payload.batch
  };
}

async function pauseGreetingBatch() {
  await chrome.alarms.clear(ALARM_NAME);
  const controller = await readController();
  if (controller) {
    controller.active = false;
    controller.updatedAt = new Date().toISOString();
    await writeController(controller);
  }

  const payload = await localRequest("/api/extension/greeting-batch/pause", {
    method: "POST",
    body: { reason: "\u7528\u6237\u624b\u52a8\u6682\u505c" }
  });
  return { ok: true, controller, batch: payload.batch };
}

async function runBatchStep() {
  if (activeStepPromise) return activeStepPromise;
  activeStepPromise = executeBatchStep()
    .catch(async (error) => {
      const reason = errorMessage(error);
      await pauseControllerForError(reason);
      return { ok: false, error: reason, batch: await readBatchSnapshot() };
    })
    .finally(() => {
      activeStepPromise = null;
    });
  return activeStepPromise;
}

async function executeBatchStep() {
  let controller = await readController();
  if (!controller?.active) return { ok: true, idle: true, batch: await readBatchSnapshot() };

  const batch = await readBatchSnapshot();
  if (!batch) throw new Error("\u672c\u5730\u6279\u6b21\u72b6\u6001\u5df2\u4e22\u5931\uff0c\u5df2\u505c\u6b62\u3002");

  if (batch.status === "completed" || batch.status === "blocked" || batch.status === "paused") {
    controller.active = false;
    controller.updatedAt = new Date().toISOString();
    await writeController(controller);
    await chrome.alarms.clear(ALARM_NAME);
    return { ok: true, batch };
  }

  if (millisecondsUntil(batch.nextAllowedAt) > 0) {
    await scheduleFromBatch(batch);
    return { ok: true, waiting: true, batch };
  }

  const result = await executeRecommendPageStep(controller);
  const latestController = await readController();
  const stoppedDuringStep = !latestController?.active || latestController.batchId !== controller.batchId;
  if (latestController?.batchId === controller.batchId) controller = latestController;

  const fingerprints = [
    ...(controller.processedFingerprints || []),
    ...(result.scannedFingerprints || []),
    result.item?.fingerprint || ""
  ].filter(Boolean);
  controller.processedFingerprints = Array.from(new Set(fingerprints)).slice(-MAX_PROCESSED_FINGERPRINTS);
  controller.resetToTop = false;
  controller.updatedAt = new Date().toISOString();
  controller.lastError = "";
  await writeController(controller);

  const recordPayload = await localRequest("/api/extension/greeting-batch/record", {
    method: "POST",
    body: {
      item: result.item || {},
      actionResult: result
    }
  });
  const nextBatch = recordPayload.batch;

  if (stoppedDuringStep) {
    controller.active = false;
    controller.updatedAt = new Date().toISOString();
    await writeController(controller);
    await chrome.alarms.clear(ALARM_NAME);
  } else if (nextBatch.status === "waiting_interval") {
    await scheduleFromBatch(nextBatch);
  } else if (nextBatch.status === "running") {
    chrome.alarms.create(ALARM_NAME, { when: Date.now() + 1000 });
  } else {
    controller.active = false;
    controller.updatedAt = new Date().toISOString();
    await writeController(controller);
    await chrome.alarms.clear(ALARM_NAME);
  }

  return { ok: true, result, batch: nextBatch };
}

async function executeRecommendPageStep(controller) {
  const tab = await chrome.tabs.get(controller.tabId);
  if (!tab?.url?.includes("zhipin.com/web/chat/recommend")) {
    throw new Error("\u76ee\u6807\u6807\u7b7e\u9875\u5df2\u79bb\u5f00 BOSS \u63a8\u8350\u9875\uff0c\u6279\u91cf\u5df2\u6682\u505c\u3002");
  }

  const frame = await getRecommendFrame(controller.tabId);

  if (!frame) {
    throw new Error("\u672a\u627e\u5230 BOSS \u63a8\u8350\u5217\u8868 frame\uff0c\u8bf7\u5237\u65b0\u63a8\u8350\u9875\u540e\u6062\u590d\u3002");
  }

  const result = await sendMessageToFrame(controller.tabId, frame.frameId, {
    type: "RECOMMEND_BATCH_STEP",
    resetToTop: Boolean(controller.resetToTop),
    job: controller.job || {},
    localFilterFields: controller.localFilterFields || [],
    processedFingerprints: controller.processedFingerprints || []
  });
  if (!result?.ok && !result?.outcome) {
    throw new Error(result?.reason || "\u63a8\u8350\u9875\u6ca1\u6709\u8fd4\u56de\u6709\u6548\u7684\u6279\u5904\u7406\u7ed3\u679c\u3002");
  }

  return {
    ...result,
    frameId: String(frame.frameId),
    frameUrl: frame.url || "",
    framePath: pathFromUrl(frame.url)
  };
}

async function getRecommendFrame(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return [...(frames || [])]
    .filter((item) => isRecommendFrameUrl(item.url))
    .sort((a, b) => recommendFramePriority(b.url) - recommendFramePriority(a.url))[0] || null;
}

async function sendMessageToFrame(tabId, frameId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["content-script.js"]
    });
    return chrome.tabs.sendMessage(tabId, message, { frameId });
  }
}

async function scheduleFromBatch(batch) {
  await chrome.alarms.clear(ALARM_NAME);
  const when = Math.max(Date.now() + 1000, new Date(batch.nextAllowedAt || Date.now()).getTime());
  chrome.alarms.create(ALARM_NAME, { when });
}

async function pauseControllerForError(reason) {
  await chrome.alarms.clear(ALARM_NAME);
  const controller = await readController();
  if (controller) {
    controller.active = false;
    controller.lastError = reason;
    controller.updatedAt = new Date().toISOString();
    await writeController(controller);
  }

  try {
    await localRequest("/api/extension/greeting-batch/pause", {
      method: "POST",
      body: { reason }
    });
  } catch (_error) {
    // The local service may be the source of the failure.
  }
}

async function pauseIfTargetTabClosed(tabId) {
  const controller = await readController();
  if (!controller?.active || controller.tabId !== tabId) return;
  await pauseControllerForError("\u76ee\u6807 BOSS \u6807\u7b7e\u9875\u5df2\u5173\u95ed\uff0c\u6279\u91cf\u5df2\u6682\u505c\u3002");
}

async function restoreBatchSchedule() {
  const controller = await readController();
  if (!controller?.active) return;

  const batch = await readBatchSnapshot();
  if (!batch || batch.status === "completed" || batch.status === "blocked" || batch.status === "paused") {
    controller.active = false;
    await writeController(controller);
    return;
  }

  if (millisecondsUntil(batch.nextAllowedAt) > 0) {
    await scheduleFromBatch(batch);
    return;
  }
  chrome.alarms.create(ALARM_NAME, { when: Date.now() + 1000 });
}

function isRecommendFrameUrl(url) {
  return /zhipin\.com\/web\/(?:frame|chat)\/recommend/.test(String(url || ""));
}

function recommendFramePriority(url) {
  const path = pathFromUrl(url);
  if (path.includes("/web/frame/recommend")) return 2;
  if (path.includes("/web/chat/recommend")) return 1;
  return 0;
}

function pathFromUrl(url) {
  try {
    return new URL(url).pathname;
  } catch (_error) {
    return String(url || "");
  }
}

function millisecondsUntil(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, time - Date.now()) : 0;
}

async function readController() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || null;
}

async function writeController(controller) {
  await chrome.storage.local.set({ [STORAGE_KEY]: controller });
}

async function readBatchSnapshot() {
  try {
    return await localRequest("/api/extension/greeting-batch");
  } catch (_error) {
    return null;
  }
}

async function localRequest(path, options = {}) {
  const response = await fetch(LOCAL_BASE_URL + path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || "local_request_failed_" + response.status);
  return payload;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
