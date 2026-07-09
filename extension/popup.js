const localBaseUrl = "http://localhost:3000";
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const collectButton = document.getElementById("collect");
const filterCollectButton = document.getElementById("filter-collect");
const recommendQueueButton = document.getElementById("recommend-queue");
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
  diagnoseFiltersButton.disabled = isBusy;
  if (message) statusEl.textContent = message;
}





