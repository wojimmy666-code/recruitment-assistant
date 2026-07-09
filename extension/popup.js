const localBaseUrl = "http://localhost:3000";
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const collectButton = document.getElementById("collect");
const filterCollectButton = document.getElementById("filter-collect");
const recommendQueueButton = document.getElementById("recommend-queue");
const singleGreetingTestButton = document.getElementById("single-greeting-test");
const batchTargetInput = document.getElementById("batch-target");
const batchIntervalMinInput = document.getElementById("batch-interval-min");
const batchIntervalMaxInput = document.getElementById("batch-interval-max");
const batchStartButton = document.getElementById("batch-start");
const batchContinueButton = document.getElementById("batch-continue");
const batchPauseButton = document.getElementById("batch-pause");
const diagnoseFiltersButton = document.getElementById("diagnose-filters");
const openAppButton = document.getElementById("open-app");

collectButton.addEventListener("click", () => {
  void collectCandidates({ applyFilter: false });
});

filterCollectButton.addEventListener("click", () => {
  void collectCandidates({ applyFilter: true });
});

recommendQueueButton.addEventListener("click", () => {
  void collectRecommendQueue();
});

singleGreetingTestButton.addEventListener("click", () => {
  void runSingleGreetingTest();
});

batchStartButton.addEventListener("click", () => {
  void runGreetingBatchStep({ startNew: true });
});

batchContinueButton.addEventListener("click", () => {
  void runGreetingBatchStep({ startNew: false });
});

batchPauseButton.addEventListener("click", () => {
  void pauseGreetingBatch();
});

diagnoseFiltersButton.addEventListener("click", () => {
  void diagnoseFilterControls();
});

openAppButton.addEventListener("click", () => {
  void chrome.tabs.create({ url: localBaseUrl });
});

async function collectCandidates(options = { applyFilter: false }) {
  setBusy(true, options.applyFilter ? "正在读取筛选条件..." : "正在读取当前页面...");
  resultEl.hidden = true;
  resultEl.replaceChildren();

  try {
    await assertLocalToolReady();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("zhipin.com")) {
      throw new Error("请先切换到已登录的 BOSS 页面。");
    }

    let collectOptions = {};
    if (options.applyFilter) {
      const job = await getDefaultJob();
      statusEl.textContent = "正在填写 BOSS 筛选条件...";
      const filterResult = await applyFiltersToTab(tab.id, job);
      collectOptions = { frameId: filterResult.frameId };
      statusEl.textContent = `已填写并提交 ${filterResult.fields.join("、")}，列表已刷新，正在采集...`;
    }

    const pageResult = await collectFromTab(tab.id, collectOptions);
    if (!pageResult?.ok) {
      throw new Error(pageResult?.error || "页面采集失败。");
    }

    const response = await fetch(`${localBaseUrl}/api/extension/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: tab.url,
        title: tab.title,
        candidates: pageResult.candidates
      })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "导入本地工具失败。");

    statusEl.textContent = `已导入 ${payload.sendable} 个待发送候选人。`;
    renderResult(payload);
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(false);
  }
}

async function collectRecommendQueue() {
  setBusy(true, "\u6b63\u5728\u91c7\u96c6\u63a8\u8350\u9875\u5019\u9009\u961f\u5217...");
  resultEl.hidden = true;
  resultEl.replaceChildren();

  try {
    await assertLocalToolReady();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("zhipin.com")) {
      throw new Error("\u8bf7\u5148\u5207\u6362\u5230\u5df2\u767b\u5f55\u7684 BOSS \u63a8\u8350\u725b\u4eba\u9875\u9762\u3002");
    }

    const queueReport = await collectRecommendQueueFromTab(tab.id);
    const response = await fetch(`${localBaseUrl}/api/extension/recommend-queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: tab.url,
        title: tab.title,
        ...queueReport
      })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "\u4e0a\u62a5\u63a8\u8350\u961f\u5217\u5931\u8d25\u3002");

    statusEl.textContent = `\u5df2\u91c7\u96c6\u63a8\u8350\u961f\u5217 ${payload.count} \u4e2a\u5019\u9009\u4eba\u3002`;
    renderRecommendQueueResult(payload.report);
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(false);
  }
}

async function collectRecommendQueueFromTab(tabId) {
  const frames = await prepareFrames(tabId);
  const results = [];

  for (const frame of frames) {
    if (frame.injectError) {
      results.push({ ok: false, reason: frame.injectError, frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
      continue;
    }

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func: () => {
          const collect = globalThis.__recruitmentAssistantCollectRecommendQueue;
          if (typeof collect !== "function") {
            return { ok: false, reason: "\u63a8\u8350\u961f\u5217\u91c7\u96c6\u811a\u672c\u672a\u52a0\u8f7d\u3002", href: location.href, path: location.pathname };
          }
          return collect();
        }
      });
      results.push({ ...(result?.result || { ok: false, reason: "\u63a8\u8350\u961f\u5217\u811a\u672c\u6ca1\u6709\u8fd4\u56de\u7ed3\u679c\u3002" }), frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
    } catch (error) {
      results.push({ ok: false, reason: error instanceof Error ? error.message : String(error), frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
    }
  }

  const usefulResults = results
    .filter((item) => item?.ok)
    .sort((a, b) => ((b.queue?.length || 0) - (a.queue?.length || 0)) || framePriority(b) - framePriority(a));
  const best = usefulResults.find((item) => (item.queue?.length || 0) > 0) || usefulResults[0];
  if (best && (best.queue?.length || 0) > 0) return best;

  const usefulErrors = results
    .filter((item) => item?.reason)
    .sort((a, b) => framePriority(b) - framePriority(a))
    .map((item) => `${item.path || item.framePath || "frame"}: ${item.reason}`)
    .slice(0, 4)
    .join("\uff1b");
  throw new Error(usefulErrors || "\u5f53\u524d\u63a8\u8350\u9875\u6ca1\u6709\u8bc6\u522b\u5230\u5019\u9009\u961f\u5217\u3002");
}

async function runSingleGreetingTest() {
  setBusy(true, "\u6b63\u5728\u6267\u884c\u5355\u4eba\u6253\u62db\u547c\u6d4b\u8bd5...");
  resultEl.hidden = true;
  resultEl.replaceChildren();

  try {
    await assertLocalToolReady();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("zhipin.com")) {
      throw new Error("\u8bf7\u5148\u5207\u6362\u5230\u5df2\u767b\u5f55\u7684 BOSS \u63a8\u8350\u725b\u4eba\u9875\u9762\u3002");
    }

    const context = await getSingleGreetingContext();
    statusEl.textContent = `\u6b63\u5728\u70b9\u51fb\u961f\u5217\u7b2c ${context.item.index + 1} \u4e2a\u5019\u9009\u4eba\u7684\u6253\u62db\u547c...`;
    const clickResult = await clickGreetingInTab(tab.id, context.item);
    await sleep(1800);

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const inspectTabId = activeTab?.id && activeTab.url?.includes("zhipin.com") ? activeTab.id : tab.id;
    const composerResult = await waitForGreetingComposerInTab(inspectTabId, context.message);

    const response = await fetch(`${localBaseUrl}/api/extension/greeting-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: activeTab?.url || tab.url,
        title: activeTab?.title || tab.title,
        item: context.item,
        messagePreview: context.message.slice(0, 120),
        clickResult,
        composerResult
      })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "\u4e0a\u62a5\u5355\u4eba\u6d4b\u8bd5\u7ed3\u679c\u5931\u8d25\u3002");

    statusEl.textContent = composerResult.blockedReason
      ? `\u5355\u4eba\u6d4b\u8bd5\u5df2\u6682\u505c\uff1a${composerResult.blockedReason}`
      : composerResult.inputSelector
        ? "\u5355\u4eba\u6d4b\u8bd5\u5b8c\u6210\uff1a\u5df2\u586b\u5165\u6587\u6848\uff0c\u672a\u70b9\u51fb\u53d1\u9001\u3002"
        : "\u5df2\u70b9\u51fb\u6253\u62db\u547c\uff0c\u4f46\u672a\u8bc6\u522b\u5230\u6d88\u606f\u8f93\u5165\u6846\u3002";
    renderGreetingTestResult(payload.report);
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(false);
  }
}

async function getSingleGreetingContext() {
  const [queueResponse, jobsResponse, templatesResponse] = await Promise.all([
    fetch(`${localBaseUrl}/api/extension/recommend-queue`),
    fetch(`${localBaseUrl}/api/jobs`),
    fetch(`${localBaseUrl}/api/templates`)
  ]);
  if (!queueResponse.ok) throw new Error("\u8bfb\u53d6\u63a8\u8350\u961f\u5217\u5931\u8d25\u3002");
  if (!jobsResponse.ok) throw new Error("\u8bfb\u53d6\u672c\u5730\u804c\u4f4d\u5931\u8d25\u3002");
  if (!templatesResponse.ok) throw new Error("\u8bfb\u53d6\u6253\u62db\u547c\u6a21\u677f\u5931\u8d25\u3002");

  const queue = await queueResponse.json();
  const jobs = await jobsResponse.json();
  const templates = await templatesResponse.json();
  const item = queue?.items?.find((candidate) => candidate.greetingButtonSelector) || queue?.items?.[0];
  if (!item) throw new Error("\u8bf7\u5148\u5728\u63a8\u8350\u9875\u91c7\u96c6\u5019\u9009\u961f\u5217\u3002");

  const job = Array.isArray(jobs) ? jobs[0] : null;
  const template = Array.isArray(templates) ? templates[0] : null;
  const message = renderTemplateMessage(template?.body || "", job);
  if (!message) throw new Error("\u672c\u5730\u6253\u62db\u547c\u6587\u6848\u4e3a\u7a7a\uff0c\u8bf7\u5148\u5728\u672c\u5730\u5de5\u5177\u586b\u5199\u6a21\u677f\u3002");
  return { item, message };
}

async function clickGreetingInTab(tabId, item) {
  const frames = await prepareFrames(tabId);
  const results = [];
  for (const frame of frames) {
    if (frame.injectError) {
      results.push({ ok: false, reason: frame.injectError, frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
      continue;
    }
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func: (candidate) => {
          const run = globalThis.__recruitmentAssistantClickSingleGreeting;
          if (typeof run !== "function") return { ok: false, reason: "\u5355\u4eba\u6253\u62db\u547c\u811a\u672c\u672a\u52a0\u8f7d\u3002", href: location.href, path: location.pathname };
          return run(candidate);
        },
        args: [item]
      });
      results.push({ ...(result?.result || { ok: false, reason: "\u5355\u4eba\u70b9\u51fb\u811a\u672c\u6ca1\u6709\u8fd4\u56de\u7ed3\u679c\u3002" }), frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
    } catch (error) {
      results.push({ ok: false, reason: error instanceof Error ? error.message : String(error), frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
    }
  }
  const clicked = results.find((result) => result.ok && result.clicked);
  if (clicked) return clicked;
  throw new Error(buildGreetingFrameError(results, "\u6ca1\u6709\u5728\u5f53\u524d BOSS \u9875\u9762\u70b9\u51fb\u5230\u6253\u62db\u547c\u6309\u94ae\u3002"));
}

async function waitForGreetingComposerInTab(tabId, message, timeoutMs = 9000) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt <= timeoutMs) {
    latest = await inspectGreetingComposerInTab(tabId, message);
    if (latest.blockedReason || (latest.inputSelector && latest.filled)) return latest;
    await sleep(700);
  }
  return normalizeComposerFailure(latest);
}

function normalizeComposerFailure(result) {
  if (!result) {
    return { ok: false, reason: "\u672a\u8bc6\u522b\u5230\u6253\u62db\u547c\u8f93\u5165\u533a\uff1a\u6ca1\u6709\u53ef\u7528 frame \u8fd4\u56de\u7ed3\u679c\u3002" };
  }
  if (!result.blockedReason && !result.inputSelector && !result.reason) {
    return { ...result, reason: "\u672a\u8bc6\u522b\u5230\u6253\u62db\u547c\u8f93\u5165\u6846\uff0c\u53ef\u80fd\u672a\u8fdb\u5165\u6c9f\u901a\u9875\u6216 BOSS \u9875\u9762\u8fd8\u672a\u52a0\u8f7d\u5b8c\u3002" };
  }
  if (result.inputSelector && !result.filled && !result.reason) {
    return { ...result, reason: "\u5df2\u8bc6\u522b\u5230\u8f93\u5165\u6846\uff0c\u4f46\u6587\u6848\u672a\u6210\u529f\u5199\u5165\u3002" };
  }
  return result;
}

async function inspectGreetingComposerInTab(tabId, message) {
  const frames = await prepareFrames(tabId);
  const results = [];
  for (const frame of frames) {
    if (frame.injectError) {
      results.push({ ok: false, reason: frame.injectError, frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
      continue;
    }
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func: (messageText) => {
          const inspect = globalThis.__recruitmentAssistantInspectGreetingComposer;
          if (typeof inspect !== "function") return { ok: false, reason: "\u6253\u62db\u547c\u8f93\u5165\u6846\u8bc6\u522b\u811a\u672c\u672a\u52a0\u8f7d\u3002", href: location.href, path: location.pathname };
          return inspect({ message: messageText, fill: true, send: false });
        },
        args: [message]
      });
      results.push({ ...(result?.result || { ok: false, reason: "\u8f93\u5165\u6846\u8bc6\u522b\u811a\u672c\u6ca1\u6709\u8fd4\u56de\u7ed3\u679c\u3002" }), frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
    } catch (error) {
      results.push({ ok: false, reason: error instanceof Error ? error.message : String(error), frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
    }
  }
  const blocked = results.find((result) => result.blockedReason);
  if (blocked) return blocked;
  const ready = results.find((result) => result.ok && result.inputSelector);
  if (ready) return ready;
  return results.sort((a, b) => framePriority(b) - framePriority(a))[0] || { ok: false, reason: "\u672a\u8bc6\u522b\u5230\u6253\u62db\u547c\u8f93\u5165\u533a\u3002" };
}

function buildGreetingFrameError(results, fallback) {
  const details = results
    .filter((result) => result?.reason)
    .sort((a, b) => framePriority(b) - framePriority(a))
    .map((result) => `${result.path || result.framePath || "frame"}: ${result.reason}`)
    .slice(0, 4)
    .join("\uff1b");
  return details || fallback;
}

function renderTemplateMessage(body, job) {
  return String(body || "")
    .replaceAll("{\u804c\u4f4d}", job?.name || "")
    .replaceAll("{\u57ce\u5e02}", job?.city || "")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGreetingBatchStep({ startNew }) {
  setBusy(true, startNew ? "\u6b63\u5728\u542f\u52a8\u6279\u91cf\u4eba\u5de5\u786e\u8ba4..." : "\u6b63\u5728\u51c6\u5907\u7ee7\u7eed\u4e0b\u4e00\u4e2a...");
  resultEl.hidden = true;
  resultEl.replaceChildren();

  try {
    await assertLocalToolReady();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("zhipin.com")) {
      throw new Error("\u8bf7\u5148\u5207\u6362\u5230 BOSS \u63a8\u8350\u9875\uff0c\u5e76\u786e\u4fdd\u5df2\u767b\u5f55\u3002");
    }

    const nextPayload = startNew ? await startGreetingBatch() : await getNextGreetingBatchItemFromServer();
    if (nextPayload.waitSeconds > 0) {
      statusEl.textContent = `\u8ddd\u79bb\u4e0b\u4e00\u6b21\u53ef\u64cd\u4f5c\u8fd8\u9700\u7b49\u5f85 ${nextPayload.waitSeconds} \u79d2\u3002`;
      renderGreetingBatchResult(nextPayload.batch);
      return;
    }

    if (!nextPayload.nextItem) {
      statusEl.textContent = batchDoneText(nextPayload.batch);
      renderGreetingBatchResult(nextPayload.batch);
      return;
    }

    const message = await getDefaultGreetingMessage();
    const item = nextPayload.nextItem;
    statusEl.textContent = `\u6b63\u5728\u5904\u7406\u7b2c ${item.index + 1} \u4e2a\u5019\u9009\u4eba\uff1a${item.displayName || "\u5019\u9009\u4eba"}`;

    const clickResult = await clickGreetingInTab(tab.id, item);
    await sleep(1800);

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const inspectTabId = activeTab?.id && activeTab.url?.includes("zhipin.com") ? activeTab.id : tab.id;
    const composerResult = await waitForGreetingComposerInTab(inspectTabId, message);

    const recordResponse = await fetch(`${localBaseUrl}/api/extension/greeting-batch/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item,
        messagePreview: message.slice(0, 120),
        clickResult,
        composerResult
      })
    });
    const recordPayload = await recordResponse.json();
    if (!recordResponse.ok) throw new Error(recordPayload.error || "\u4e0a\u62a5\u6279\u91cf\u8bb0\u5f55\u5931\u8d25\u3002");

    statusEl.textContent = composerResult.blockedReason
      ? `\u6279\u91cf\u5df2\u505c\u6b62\uff1a${composerResult.blockedReason}`
      : composerResult.inputSelector
        ? "\u5df2\u586b\u5165\u6587\u6848\uff0c\u8bf7\u4eba\u5de5\u786e\u8ba4\u53d1\u9001\uff0c\u8fd4\u56de\u63a8\u8350\u9875\u540e\u70b9\u7ee7\u7eed\u4e0b\u4e00\u4e2a\u3002"
        : "\u672a\u8bc6\u522b\u5230\u8f93\u5165\u6846\uff0c\u6279\u91cf\u5df2\u6682\u505c\u3002";
    renderGreetingBatchResult(recordPayload.batch);
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(false);
  }
}

async function startGreetingBatch() {
  const response = await fetch(`${localBaseUrl}/api/extension/greeting-batch/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetCount: numberInputValue(batchTargetInput, 3),
      intervalMinSeconds: numberInputValue(batchIntervalMinInput, 45),
      intervalMaxSeconds: numberInputValue(batchIntervalMaxInput, 90)
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "\u542f\u52a8\u6279\u91cf\u5931\u8d25\u3002");
  return payload;
}

async function getNextGreetingBatchItemFromServer() {
  const response = await fetch(`${localBaseUrl}/api/extension/greeting-batch/next`, { method: "POST" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "\u8bfb\u53d6\u6279\u91cf\u4e0b\u4e00\u4e2a\u5931\u8d25\u3002");
  return payload;
}

async function pauseGreetingBatch() {
  setBusy(true, "\u6b63\u5728\u6682\u505c\u6279\u91cf...");
  resultEl.hidden = true;
  resultEl.replaceChildren();
  try {
    await assertLocalToolReady();
    const response = await fetch(`${localBaseUrl}/api/extension/greeting-batch/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "\u7528\u6237\u624b\u52a8\u6682\u505c" })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "\u6682\u505c\u6279\u91cf\u5931\u8d25\u3002");
    statusEl.textContent = "\u6279\u91cf\u5df2\u6682\u505c\u3002";
    renderGreetingBatchResult(payload.batch);
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(false);
  }
}

async function getDefaultGreetingMessage() {
  const [jobsResponse, templatesResponse] = await Promise.all([
    fetch(`${localBaseUrl}/api/jobs`),
    fetch(`${localBaseUrl}/api/templates`)
  ]);
  if (!jobsResponse.ok) throw new Error("\u8bfb\u53d6\u672c\u5730\u804c\u4f4d\u5931\u8d25\u3002");
  if (!templatesResponse.ok) throw new Error("\u8bfb\u53d6\u6253\u62db\u547c\u6a21\u677f\u5931\u8d25\u3002");
  const jobs = await jobsResponse.json();
  const templates = await templatesResponse.json();
  const job = Array.isArray(jobs) ? jobs[0] : null;
  const template = Array.isArray(templates) ? templates[0] : null;
  const message = renderTemplateMessage(template?.body || "", job);
  if (!message) throw new Error("\u672c\u5730\u6253\u62db\u547c\u6587\u6848\u4e3a\u7a7a\uff0c\u8bf7\u5148\u5728\u672c\u5730\u5de5\u5177\u586b\u5199\u6a21\u677f\u3002");
  return message;
}

function numberInputValue(input, fallback) {
  const parsed = Number(input?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function batchDoneText(batch) {
  if (!batch) return "\u6279\u91cf\u72b6\u6001\u672a\u77e5\u3002";
  if (batch.status === "completed") return "\u6279\u91cf\u5df2\u5b8c\u6210\u3002";
  if (batch.status === "blocked") return `\u6279\u91cf\u5df2\u505c\u6b62\uff1a${batch.pauseReason || "blocked"}`;
  if (batch.status === "paused") return `\u6279\u91cf\u5df2\u6682\u505c\uff1a${batch.pauseReason || "paused"}`;
  return "\u6ca1\u6709\u53ef\u7ee7\u7eed\u5904\u7406\u7684\u5019\u9009\u4eba\u3002";
}

async function diagnoseFilterControls() {
  setBusy(true, "正在诊断当前 BOSS 页筛选控件...");
  resultEl.hidden = true;
  resultEl.replaceChildren();

  try {
    await assertLocalToolReady();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("zhipin.com")) {
      throw new Error("请先切换到已登录的 BOSS 页面。");
    }

    const frames = await collectFilterDiagnosticsFromTab(tab.id);
    const response = await fetch(`${localBaseUrl}/api/extension/filter-diagnostics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: tab.url,
        title: tab.title,
        frames
      })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "上报筛选控件诊断失败。");

    statusEl.textContent = `已上报 ${payload.usefulFrames}/${payload.frameCount} 个有效 frame 诊断。`;
    renderDiagnosticsResult(payload.report);
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(false);
  }
}

async function collectFilterDiagnosticsFromTab(tabId) {
  const frames = await prepareFrames(tabId);
  const results = [];

  for (const frame of frames) {
    if (frame.injectError) {
      results.push({ ok: false, reason: frame.injectError, frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
      continue;
    }

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func: () => {
          const diagnose = globalThis.__recruitmentAssistantCollectFilterDiagnostics;
          if (typeof diagnose !== "function") {
            return { ok: false, reason: "筛选控件诊断脚本未加载。", href: location.href, path: location.pathname };
          }
          return diagnose();
        }
      });
      results.push({ ...(result?.result || { ok: false, reason: "诊断脚本没有返回结果。" }), frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
    } catch (error) {
      results.push({ ok: false, reason: error instanceof Error ? error.message : String(error), frameId: frame.frameId, frameUrl: frame.url, framePath: pathFromUrl(frame.url) });
    }
  }

  return results;
}
async function getDefaultJob() {
  const response = await fetch(`${localBaseUrl}/api/jobs`);
  if (!response.ok) throw new Error("读取本地职位条件失败。");
  const jobs = await response.json();
  const job = Array.isArray(jobs) ? jobs[0] : null;
  if (!job) throw new Error("本地工具里还没有职位条件。");
  return job;
}

async function applyFiltersToTab(tabId, job) {
  const frames = await prepareFrames(tabId);
  const results = [];

  for (const frame of frames) {
    if (frame.injectError) {
      results.push({ ok: false, reason: frame.injectError, path: pathFromUrl(frame.url) });
      continue;
    }

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func: async (jobPayload) => {
          const apply = globalThis.__recruitmentAssistantApplyFilters;
          if (typeof apply !== "function") {
            return { ok: false, applied: false, reason: "筛选脚本未加载。", path: location.pathname };
          }
          return apply(jobPayload);
        },
        args: [job]
      });
      if (result?.result) results.push({ ...result.result, frameId: frame.frameId, frameUrl: frame.url });
    } catch (error) {
      results.push({ ok: false, reason: error instanceof Error ? error.message : String(error), path: pathFromUrl(frame.url) });
    }
  }

  const applied = results.find((item) => item?.ok && item.applied && item.submitted && item.refreshed);
  if (applied) return applied;

  const usefulErrors = results
    .filter((item) => item?.reason)
    .sort((a, b) => framePriority(b) - framePriority(a))
    .map((item) => `${item.path || "frame"}: ${item.reason}`)
    .slice(0, 3)
    .join("；");
  throw new Error(usefulErrors || "没有找到可填写的 BOSS 筛选控件。");
}

async function prepareFrames(tabId) {
  const frames = await getCollectableFrames(tabId);
  for (const frame of frames) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        files: ["content-script.js"]
      });
    } catch (error) {
      frame.injectError = error instanceof Error ? error.message : String(error);
    }
  }
  return frames;
}

async function collectFromTab(tabId, options = {}) {
  let frames = await prepareFrames(tabId);
  if (options.frameId !== undefined && options.frameId !== null) {
    frames = frames.filter((frame) => frame.frameId === options.frameId);
  }
  const frameResults = [];
  for (const frame of frames) {
    if (frame.injectError) {
      frameResults.push({ result: { ok: false, error: frame.injectError, href: frame.url, path: pathFromUrl(frame.url) } });
      continue;
    }

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func: () => {
          const collect = globalThis.__recruitmentAssistantCollectCandidates;
          const diagnostics = globalThis.__recruitmentAssistantGetDiagnostics?.();
          if (typeof collect !== "function") {
            return { ok: false, error: "采集脚本未加载。", href: location.href, path: location.pathname, diagnostics };
          }

          try {
            return { ok: true, candidates: collect(), href: location.href, path: location.pathname, diagnostics };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              href: location.href,
              path: location.pathname,
              diagnostics
            };
          }
        }
      });
      if (result) frameResults.push(result);
    } catch (error) {
      frameResults.push({ result: { ok: false, error: error instanceof Error ? error.message : String(error), href: frame.url, path: pathFromUrl(frame.url) } });
    }
  }

  const candidates = [];
  const seen = new Set();
  const frameErrors = [];

  for (const result of frameResults) {
    const value = result.result;
    if (!value) continue;
    if (!value.ok) {
      frameErrors.push(value);
      continue;
    }

    for (const candidate of value.candidates || []) {
      const key = candidate.externalKey || candidate.profileUrl || candidate.rawText;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  if (candidates.length > 0) return { ok: true, candidates };
  return { ok: false, error: buildFrameCollectionError(frameErrors) };
}

async function getCollectableFrames(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return frames
    .filter((frame) => frame.frameId === 0 || isBossFrameUrl(frame.url))
    .sort((a, b) => {
      const priority = framePriority({ path: pathFromUrl(b.url) }) - framePriority({ path: pathFromUrl(a.url) });
      return priority || a.frameId - b.frameId;
    });
}

function isBossFrameUrl(url) {
  if (!url) return false;
  if (url === "about:blank") return true;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("zhipin.com");
  } catch (_error) {
    return url.includes("zhipin.com") || url.startsWith("/web/");
  }
}

function pathFromUrl(url) {
  try {
    return new URL(url).pathname;
  } catch (_error) {
    return url || "";
  }
}

function framePriority(item) {
  const path = item?.path || "";
  if (path.includes("/web/frame/search") || path.includes("/web/frame/recommend")) return 4;
  if (path.includes("/web/frame/")) return 3;
  if (path.includes("/web/chat/search") || path.includes("/web/chat/recommend")) return 2;
  if (path.includes("/web/chat/")) return 1;
  return 0;
}

function buildFrameCollectionError(frameErrors) {
  const usefulErrors = frameErrors.filter((item) => item?.error);
  const framePaths = Array.from(new Set(usefulErrors.map((item) => item.path).filter(Boolean))).join("，");
  const frameError = [...usefulErrors].sort((a, b) => framePriority(b) - framePriority(a))[0];
  if (!frameError) return "当前页没有识别到候选人卡片。";
  return `${frameError.error}${framePaths ? ` frame路径：${framePaths}` : ""}`;
}
async function assertLocalToolReady() {
  const response = await fetch(`${localBaseUrl}/api/extension/health`);
  if (!response.ok) {
    throw new Error("本地工具未启动，请先运行 npm run dev。");
  }
}

function renderGreetingBatchResult(batch) {
  resultEl.hidden = false;
  resultEl.replaceChildren();
  if (!batch) return;

  const summary = document.createElement("p");
  summary.textContent = `\u6279\u91cf ${batch.status} \u00b7 \u76ee\u6807 ${batch.targetCount} \u00b7 \u5df2\u586b\u5165 ${batch.filled} \u00b7 \u5931\u8d25 ${batch.failed} \u00b7 \u963b\u65ad ${batch.blocked}`;
  resultEl.append(summary);

  if (batch.pauseReason) {
    const reason = document.createElement("code");
    reason.textContent = batch.pauseReason;
    resultEl.append(reason);
  }

  if (batch.nextAllowedAt) {
    const wait = document.createElement("code");
    wait.textContent = `\u4e0b\u6b21\u6700\u65e9\u65f6\u95f4\uff1a${new Date(batch.nextAllowedAt).toLocaleTimeString()}`;
    resultEl.append(wait);
  }

  for (const record of (batch.records || []).slice(-4).reverse()) {
    const row = document.createElement("code");
    row.textContent = `${record.status} \u00b7 ${record.item?.displayName || "\u5019\u9009\u4eba"} \u00b7 ${record.errorMessage || record.composerResult?.inputSelector || ""}`;
    resultEl.append(row);
  }
}

function renderGreetingTestResult(report) {
  resultEl.hidden = false;
  resultEl.replaceChildren();
  const summary = document.createElement("p");
  const composer = report?.composerResult || {};
  summary.textContent = composer.blockedReason
    ? `\u5355\u4eba\u6d4b\u8bd5\u6682\u505c\uff1a${composer.blockedReason}`
    : composer.inputSelector
      ? "\u5355\u4eba\u6d4b\u8bd5\u5b8c\u6210\uff1a\u5df2\u586b\u5165\u6587\u6848\uff0c\u672a\u53d1\u9001\u3002"
      : "\u5df2\u70b9\u51fb\u6253\u62db\u547c\uff0c\u4f46\u672a\u8bc6\u522b\u5230\u8f93\u5165\u6846\u3002";
  resultEl.append(summary);

  for (const line of [
    report?.item?.displayName ? `\u5019\u9009\u4eba\uff1a${report.item.displayName}` : "",
    report?.clickResult?.greetingButtonSelector ? `greet: ${report.clickResult.greetingButtonSelector}` : "",
    composer.inputSelector ? `input: ${composer.inputSelector}` : "",
    composer.sendButtonSelector ? `send: ${composer.sendButtonSelector}` : ""
  ].filter(Boolean)) {
    const row = document.createElement("code");
    row.textContent = line;
    resultEl.append(row);
  }
}

function renderDiagnosticsResult(report) {
  resultEl.hidden = false;
  resultEl.replaceChildren();

  const summary = document.createElement("p");
  summary.textContent = report
    ? `筛选控件诊断已保存：${report.frames.filter((frame) => frame.ok).length}/${report.frames.length} 个有效 frame。`
    : "筛选控件诊断已保存。";
  resultEl.append(summary);

  for (const frame of (report?.frames || []).slice(0, 5)) {
    const row = document.createElement("code");
    if (!frame.ok) {
      row.textContent = `${frame.framePath || frame.path || "frame"}: ${frame.reason || "无诊断结果"}`;
    } else {
      row.textContent = `${frame.path || frame.framePath || "frame"}: 输入框 ${frame.inputs?.length || 0}，筛选控件 ${frame.filterControls?.length || 0}，提交按钮 ${frame.submitControls?.length || 0}，候选容器 ${frame.candidateContainers?.length || 0}`;
    }
    resultEl.append(row);
  }
}
function renderRecommendQueueResult(report) {
  resultEl.hidden = false;
  resultEl.replaceChildren();

  const summary = document.createElement("p");
  const items = report?.items || [];
  summary.textContent = `\u63a8\u8350\u961f\u5217 ${items.length} \u4e2a\u5019\u9009\u4eba\uff0c\u6765\u6e90 ${report?.framePath || report?.path || "recommend"}\u3002`;
  resultEl.append(summary);

  if (report?.selectedJobText) {
    const job = document.createElement("code");
    job.textContent = `\u5f53\u524d BOSS \u804c\u4f4d\uff1a${report.selectedJobText}`;
    resultEl.append(job);
  }

  for (const item of items.slice(0, 6)) {
    const row = document.createElement("code");
    const greet = item.greetingButtonSelector ? "\u5df2\u8bc6\u522b\u6253\u62db\u547c" : "\u672a\u8bc6\u522b\u6253\u62db\u547c";
    row.textContent = `${item.index + 1}. ${item.displayName || "\u5019\u9009\u4eba"} \u00b7 ${item.salary || "\u85aa\u8d44\u672a\u77e5"} \u00b7 ${item.activeText || "\u6d3b\u8dc3\u672a\u77e5"} \u00b7 ${greet}`;
    resultEl.append(row);
  }
}

function renderResult(payload) {
  resultEl.hidden = false;
  const summary = document.createElement("p");
  summary.textContent = `找到 ${payload.found}，可发送 ${payload.sendable}，已跳过 ${payload.skipped}`;
  resultEl.append(summary);

  for (const candidate of payload.candidates.slice(0, 5)) {
    const row = document.createElement("code");
    row.textContent = `${candidate.display_name || "候选人"} · ${formatStatus(candidate.status)}`;
    resultEl.append(row);
  }
}

function formatStatus(status) {
  if (status === "pending") return "待发送";
  if (status === "sent") return "已发送";
  if (status === "skipped") return "已跳过";
  if (status === "failed") return "失败";
  return status || "未知";
}

function setBusy(isBusy, message) {
  collectButton.disabled = isBusy;
  filterCollectButton.disabled = isBusy;
  recommendQueueButton.disabled = isBusy;
  singleGreetingTestButton.disabled = isBusy;
  batchStartButton.disabled = isBusy;
  batchContinueButton.disabled = isBusy;
  batchPauseButton.disabled = isBusy;
  diagnoseFiltersButton.disabled = isBusy;
  if (message) statusEl.textContent = message;
}





