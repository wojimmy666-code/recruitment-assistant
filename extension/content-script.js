if (!globalThis.__recruitmentAssistantBridgeLoaded) {
  globalThis.__recruitmentAssistantBridgeLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "COLLECT_CANDIDATES") return false;

    try {
      const candidates = collectCandidatesFromPage();
      sendResponse({ ok: true, candidates });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }

    return true;
  });
}

function collectCandidatesFromPage() {
  if (!location.href.includes("zhipin.com")) {
    throw new Error("当前页面不是 BOSS。");
  }

  if (!isSupportedCandidatePage()) {
    throw new Error("请在 BOSS 招聘者后台候选人、牛人、简历列表页，或聊天搜索/推荐页采集。");
  }

  const candidates = [];
  const seen = new Set();
  const cards = findCandidateCards();

  for (const card of cards) {
    const rawText = normalizeText(card.textContent || "");
    const profileUrl = findProfileUrl(card);
    const displayName = findDisplayName(card, rawText);
    const externalKey = findExternalKey(card, profileUrl, rawText);
    if (!externalKey || seen.has(externalKey) || externalKey.includes("/job_detail/")) continue;
    if (isIgnoredCandidateHref(externalKey) || isIgnoredCandidateHref(profileUrl)) continue;
    if (isIgnoredChatCandidateText(displayName) || isIgnoredChatCandidateText(rawText)) continue;
    seen.add(externalKey);

    candidates.push({
      externalKey,
      displayName,
      profileUrl,
      rawText
    });
  }

  if (candidates.length === 0) {
    throw new Error(buildNoCandidatesError());
  }

  return candidates.slice(0, 100);
}

function findCandidateCards() {
  const scopes = isChatCandidatePage() ? findCandidateListContainers() : [document];
  if (isChatCandidatePage() && scopes.length === 0) return [];

  const selectors = getCandidateSelectors();
  const candidates = [];

  for (const scope of scopes) {
    for (const selector of selectors) {
      for (const element of scope.querySelectorAll(selector)) {
        const card = normalizeCandidateCard(element);
        if (!card || candidates.includes(card)) continue;
        if (!isWithinScopes(card, scopes)) continue;
        if (!isVisible(card)) continue;
        const text = normalizeText(card.textContent || "");
        if (isChatCandidatePage()) {
          if (!looksLikeChatCandidateCard(card, text)) continue;
        } else if (!looksLikeCandidateText(text)) {
          continue;
        }
        if (card.querySelector('a[href*="/job_detail/"]')) continue;
        if (hasIgnoredCandidateHref(card)) continue;
        candidates.push(card);
      }
      if (candidates.length > 0) break;
    }
  }

  if (candidates.length === 0 && isChatCandidatePage()) {
    for (const scope of scopes) {
      for (const element of findChatFallbackCards(scope)) {
        if (!candidates.includes(element)) candidates.push(element);
      }
    }
  }

  return removeNestedCards(candidates);
}

function findCandidateListContainers() {
  const selector = [
    "[data-candidate-list]",
    "[data-geek-list]",
    "[data-list]",
    ".geek-list",
    ".candidate-list",
    ".resume-list",
    ".recommend-list",
    ".search-result-list",
    ".card-list",
    "[class*=\"geek-list\"]",
    "[class*=\"candidate-list\"]",
    "[class*=\"resume-list\"]",
    "[class*=\"recommend-list\"]",
    "[class*=\"search-result\"]",
    "[class*=\"card-list\"]",
    "[class*=\"list\"]"
  ].join(",");

  const containers = Array.from(document.querySelectorAll(selector))
    .filter(isVisible)
    .filter((element) => !isIgnoredCandidateContainer(element))
    .filter(hasCandidateListEvidence);

  return removeAncestorContainers(containers);
}

function isWithinScopes(element, scopes) {
  return scopes.some((scope) => scope === document || scope.contains(element));
}

function isIgnoredCandidateContainer(element) {
  const className = String(element.className || "");
  const id = String(element.id || "");
  const text = normalizeText(element.textContent || "");
  if (/menu|nav|header|top|side|logout|toolbar|filter|condition|pager|pagination|dropmenu/i.test(`${className} ${id}`)) return true;
  if (/职位管理|工具箱|牛人管理|招聘规范|我的客服|账号设置|退出登录/.test(text) && text.length < 180) return true;
  return false;
}

function hasCandidateListEvidence(element) {
  const text = normalizeText(element.textContent || "");
  if (text.length < 4 || isIgnoredChatCandidateText(text)) return false;

  const hasProfileLink = Array.from(element.querySelectorAll("a[href]")).some((anchor) => hasCandidateProfileHref(anchor.getAttribute("href")));
  const hasCandidateId = Boolean(element.querySelector("[data-geek-id], [data-candidate-id], [data-uid], [data-user-id], [data-userid]"));
  const hasPersonText = /岁|经验|学历|求职|离职|在职|活跃|在线|离线|刚刚|分钟|小时|昨天|前天|回复|消息|已读|未读|招呼|感兴趣|附件|投递/.test(text);
  const hasRepeatedCards = getCandidateSelectors().some((selector) => element.querySelectorAll(selector).length >= 2);

  return hasProfileLink || hasCandidateId || hasPersonText || hasRepeatedCards;
}

function removeAncestorContainers(containers) {
  return containers.filter((container) => !containers.some((other) => other !== container && other.contains(container) && elementArea(other) <= elementArea(container) * 4));
}

function getCandidateListFingerprint() {
  const containers = findCandidateListContainers();
  const source = containers.length > 0 ? containers : [];
  const text = source.map((container) => normalizeText(container.textContent || "")).join(" | ");
  const selectorHits = source.reduce((sum, container) => {
    return sum + getCandidateSelectors().reduce((innerSum, selector) => innerSum + container.querySelectorAll(selector).length, 0);
  }, 0);

  return {
    path: location.pathname,
    containerCount: containers.length,
    selectorHits,
    textLength: text.length,
    textSample: text.slice(0, 240),
    signature: `${containers.length}:${selectorHits}:${text.slice(0, 500)}`
  };
}
function getCandidateSelectors() {
  if (isChatCandidatePage()) {
    return [
      "[data-geek-id]",
      "[data-candidate-id]",
      "[data-uid]",
      "[data-user-id]",
      "[data-userid]",
      "a[href*=\"/web/geek/\"]",
      "a[href*=\"geekId=\"]",
      "a[href*=\"uid=\"]",
      ".chat-item",
      ".conversation-item",
      ".dialog-item",
      ".search-item",
      ".search-result-item",
      ".user-item",
      ".friend-item",
      ".geek-item",
      ".resume-item",
      ".card-item",
      "[class*=\"chat\"][class*=\"item\"]",
      "[class*=\"search\"][class*=\"item\"]",
      "[class*=\"user\"][class*=\"item\"]",
      "[class*=\"geek\"][class*=\"item\"]",
      "[class*=\"friend\"][class*=\"item\"]"
    ];
  }

  return [
    "[data-geek-id]",
    "[data-candidate-id]",
    "[data-uid]",
    ".geek-card",
    ".candidate-card",
    ".resume-card",
    ".card-list .card-item",
    "li",
    "article"
  ];
}

function normalizeCandidateCard(element) {
  if (!isChatCandidatePage()) return element;

  const stableRoot = element.closest([
    "[data-geek-id]",
    "[data-candidate-id]",
    "[data-uid]",
    "[data-user-id]",
    "[data-userid]",
    ".chat-item",
    ".conversation-item",
    ".dialog-item",
    ".search-item",
    ".search-result-item",
    ".user-item",
    ".friend-item",
    ".geek-item",
    ".resume-item",
    ".card-item",
    "li",
    "article"
  ].join(","));

  return stableRoot || element;
}

function findChatFallbackCards(scope = document) {
  const elements = Array.from(scope.querySelectorAll([
    "[data-geek-id]",
    "[data-candidate-id]",
    "[data-uid]",
    "[data-user-id]",
    "[data-userid]",
    "a[href*=\"/web/geek/\"]",
    "a[href*=\"geekId=\"]",
    "a[href*=\"uid=\"]",
    "li",
    "article",
    "[class*=\"geek\"]",
    "[class*=\"candidate\"]",
    "[class*=\"resume\"]",
    "[class*=\"card\"]"
  ].join(",")));
  const cards = [];

  for (const element of elements) {
    if (!isVisible(element)) continue;
    if (element.querySelector('a[href*="/job_detail/"]')) continue;
    if (hasIgnoredCandidateHref(element)) continue;

    const rect = element.getBoundingClientRect();
    const text = normalizeText(element.textContent || "");
    if (rect.width < 160 || rect.height < 28 || rect.height > 320) continue;
    if (!looksLikeChatCandidateCard(element, text)) continue;

    cards.push(element);
  }

  return cards;
}
function looksLikeChatCandidateCard(element, text) {
  if (text.length < 2 || text.length > 1000) return false;
  if (isLoadingText(text) || isIgnoredChatCandidateText(text)) return false;
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(text)) return false;
  if (/全部消息|联系人|聊天记录|搜索|暂无|没有找到|请输入|筛选|清空|取消|确定|返回|首页|我的|设置/.test(text) && text.length < 16) return false;
  return hasCandidateCardShape(element, text);
}

function hasCandidateCardShape(element, text) {
  if (isIgnoredChatCandidateText(text)) return false;

  const className = String(element.className || "");
  const role = element.getAttribute("role") || "";
  const href = element.getAttribute("href") || "";
  const hasProfileLink = Boolean(
    hasCandidateProfileHref(element.getAttribute("href")) ||
    Boolean(Array.from(element.querySelectorAll("a[href]")).some((anchor) => hasCandidateProfileHref(anchor.getAttribute("href"))))
  );
  const hasCandidateIdAttribute = Array.from(element.attributes || []).some((attr) =>
    /^(data-geek-id|data-candidate-id|data-uid|data-user-id|data-userid)$/i.test(attr.name) && attr.value
  );
  const hasUsefulAttribute = Array.from(element.attributes || []).some((attr) =>
    /^(data-|href$|role$|id$)/.test(attr.name) &&
    /geek|candidate|user|uid|resume|card|item|chat|friend|search|id/i.test(`${attr.name}:${attr.value}`)
  );
  const hasUsefulClass = /geek|candidate|user|uid|resume|card|item|chat|friend|search|dialog|conversation/i.test(className);
  const isInteractive = Boolean(role) || Boolean(href) || Boolean(element.closest("a,[role='button'],button"));
  const hasAvatar = Boolean(element.querySelector("img, [class*='avatar'], [class*='photo'], [class*='head']"));
  const hasNameElement = findNameElement(element) !== undefined;
  const hasPersonEvidence = hasProfileLink || hasCandidateIdAttribute || hasAvatar || hasNameElement || /岁|经验|学历|求职|离职|在职|活跃|在线|离线|刚刚|分钟|小时|昨天|前天|回复|消息|已读|未读|招呼|感兴趣|附件|投递/.test(text) || /\d{1,2}:\d{2}/.test(text);

  if (hasProfileLink || hasCandidateIdAttribute) return true;
  if ((hasAvatar || hasNameElement) && (hasUsefulClass || isInteractive || hasUsefulAttribute)) return true;
  return (hasUsefulClass || isInteractive || hasUsefulAttribute) && hasPersonEvidence && text.length >= 4;
}

function removeNestedCards(cards) {
  return cards.filter((card) => {
    return !cards.some((other) => {
      if (other === card) return false;
      const otherText = normalizeText(other.textContent || "");
      const cardText = normalizeText(card.textContent || "");
      return other.contains(card) &&
        otherText.length <= 1000 &&
        otherText.length <= cardText.length + 120 &&
        (isChatCandidatePage() ? looksLikeChatCandidateCard(other, otherText) : looksLikeCandidateText(otherText));
    });
  });
}

function findExternalKey(card, profileUrl, rawText) {
  const nodes = [card, ...Array.from(card.querySelectorAll("*")).slice(0, 80)];
  for (const node of nodes) {
    for (const attr of Array.from(node.attributes || [])) {
      if (!attr.value || attr.value.length > 160) continue;
      if (attr.name === "href" && isIgnoredCandidateHref(attr.value)) continue;
      if (!/^(data-|id$|href$)/.test(attr.name)) continue;
      if (/geek|candidate|user|resume|uid|id|key|href/i.test(`${attr.name}:${attr.value}`)) {
        return `${attr.name}:${attr.value}`;
      }
    }
  }

  return profileUrl || rawText.slice(0, 80);
}

function findProfileUrl(card) {
  const link = Array.from(card.querySelectorAll("a[href]"))
    .map((anchor) => anchor.getAttribute("href"))
    .find((href) => href && !href.includes("/job_detail/") && !isIgnoredCandidateHref(href));

  if (!link) return undefined;
  return new URL(link, location.href).toString();
}

function findDisplayName(card, rawText) {
  const namedElement = findNameElement(card);
  const title = normalizeText(namedElement?.getAttribute("title") || namedElement?.textContent || "");
  if (title) return title.slice(0, 60);

  const fallback = rawText.split(" ").find((part) => isUsableDisplayName(part));
  return fallback?.slice(0, 60) || "候选人";
}

function findNameElement(card) {
  const namedElements = [card, ...Array.from(card.querySelectorAll("[title], .name, .user-name, .geek-name, .candidate-name, .chat-name, .item-name, [class*='name']"))];
  return namedElements.find((element) => {
    const title = normalizeText(element.getAttribute("title") || element.textContent || "");
    return isUsableDisplayName(title);
  });
}

function isUsableDisplayName(value) {
  const text = normalizeText(value);
  if (!text || text.length > 60) return false;
  if (isIgnoredChatCandidateText(text) || isLoadingText(text)) return false;
  if (isChatCandidatePage() && /全部消息|联系人|聊天记录|搜索|暂无|没有找到|请输入|筛选|清空|取消|确定|返回|首页|我的|设置/.test(text)) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(text);
}

function looksLikeCandidateText(text) {
  if (text.length < 8 || text.length > 1000) return false;
  if (/职位详情|立即投递|公司|招聘|薪资|岗位职责/.test(text) && /\/job_detail\//.test(location.href)) return false;
  if (isChatCandidatePage()) {
    return text.length >= 2 && !isIgnoredChatCandidateText(text) && !isLoadingText(text) && /[\u4e00-\u9fa5A-Za-z]/.test(text);
  }
  return /岁|年|经验|学历|求职|离职|在职|活跃|沟通|简历|牛人|候选/.test(text) || /geek|candidate|resume/i.test(text);
}

function isIgnoredChatCandidateText(value) {
  const compact = normalizeText(value).replace(/\s+/g, "");
  if (!compact) return false;
  return /^(推荐牛人|搜索牛人|推荐|牛人|候选人|候选|简历|联系人|全部消息|聊天记录|打招呼|新招呼|沟通过|已沟通|工具箱|牛人管理|互动|沟通|职位管理)$/.test(compact) ||
    /^道具[·.\d\u4e00-\u9fa5\s]*生效中$/.test(compact) ||
    /^意向沟通/.test(compact) ||
    /^(推荐牛人|搜索牛人|候选人|简历){2,}$/.test(compact);
}

function hasIgnoredCandidateHref(element) {
  if (isIgnoredCandidateHref(element.getAttribute?.("href"))) return true;
  return Array.from(element.querySelectorAll?.("a[href]") || []).some((anchor) => isIgnoredCandidateHref(anchor.getAttribute("href")));
}

function hasCandidateProfileHref(href) {
  if (!href || isIgnoredCandidateHref(href)) return false;
  return /\/web\/geek\//.test(href) || /[?&](geekId|uid|userId|friendId|securityId)=/.test(href);
}

function isIgnoredCandidateHref(value) {
  if (!value) return false;
  const text = String(value);
  const normalized = text.startsWith("href:") ? text.slice(5) : text;
  let pathname = normalized;
  let search = "";
  try {
    const url = new URL(normalized, location.href);
    pathname = url.pathname;
    search = url.search;
  } catch (_error) {
    const [pathPart, searchPart = ""] = normalized.split("?");
    pathname = pathPart;
    search = searchPart ? `?${searchPart}` : "";
  }

  if (/\/job_detail\//.test(pathname)) return true;
  if (/\/web\/chat\/(toolbox|business\/mall|geek\/manage|interaction|intention|job\/list)/.test(pathname)) return true;
  if (pathname === "/web/chat/index" && !/[?&](geekId|uid|userId|friendId|securityId)=/.test(search)) return true;
  return false;
}

function isLoadingText(value) {
  const text = normalizeText(value);
  return /加载中|请稍候|正在加载/.test(text) && text.length <= 30;
}

function buildNoCandidatesError() {
  const diagnostics = getCandidateDiagnostics();
  const loadingNote = diagnostics.loading ? "BOSS 页面当前仍显示加载中，请等待列表加载完成或刷新页面后再采集。" : "如果这是聊天搜索/推荐页，请确认真实候选人列表已出现，并继续校准候选列表容器 selector。";
  return [
    "当前页没有识别到候选人卡片。",
    loadingNote,
    `诊断：路径 ${diagnostics.path}，候选列表容器 ${diagnostics.listContainers}，候选选择器命中 ${diagnostics.selectorHits}，可见文本块 ${diagnostics.visibleTextBlocks}，页面文本长度 ${diagnostics.bodyTextLength}。`
  ].join("");
}

function getCandidateDiagnostics() {
  const listContainers = isChatCandidatePage() ? findCandidateListContainers() : [];
  const visibleTextBlocks = Array.from(document.querySelectorAll("a, li, article, section, [data-geek-id], [data-candidate-id], [data-uid], [data-user-id], [data-userid], [class*=\"geek\"], [class*=\"candidate\"], [class*=\"resume\"], [class*=\"card\"]"))
    .filter((element) => isVisible(element) && normalizeText(element.textContent || "").length >= 2)
    .length;
  const selectorHits = (isChatCandidatePage() ? listContainers : [document])
    .flatMap((scope) => getCandidateSelectors().flatMap((selector) => Array.from(scope.querySelectorAll(selector))))
    .filter((element, index, array) => array.indexOf(element) === index)
    .filter(isVisible)
    .length;
  const bodyText = normalizeText(document.body?.textContent || "");

  return {
    bodyTextLength: bodyText.length,
    loading: /加载中|请稍候|正在加载/.test(bodyText) && bodyText.length < 1200,
    path: location.pathname,
    listContainers: listContainers.length,
    selectorHits,
    visibleTextBlocks,
    listFingerprint: getCandidateListFingerprint()
  };
}
function collectFilterControlDiagnostics() {
  if (!location.href.includes("zhipin.com")) {
    return { ok: false, reason: "not_boss_page", href: location.href, path: location.pathname };
  }

  const inputs = inspectFilterElements("input, textarea, [contenteditable='true']", () => true, 80);
  const clickables = inspectFilterElements("button, a, label, li, dt, dd, span, div, [role='button']", hasFilterDiagnosticText, 180);
  const submitControls = clickables.filter((item) => /(确定|确认|完成|应用|筛选|搜索|查看结果|搜索牛人|查找牛人|开始搜索|立即搜索|立即筛选|确认选择)/.test(item.text || item.attrs?.["aria-label"] || item.attrs?.title || ""));
  const filterControls = clickables.filter((item) => /(关键词|搜索|职位|岗位|牛人|人才|意向|期望|城市|地点|地区|工作地|活跃|活跃度|最近活跃|登录时间|薪资|月薪|薪酬|不限|近\s*\d|K|以上|以下)/i.test(item.text || item.attrs?.placeholder || item.attrs?.["aria-label"] || item.attrs?.title || ""));
  const candidateContainers = (isChatCandidatePage() ? findCandidateListContainers() : [])
    .slice(0, 20)
    .map((element) => inspectElementForDiagnostics(element));
  const diagnostics = getCandidateDiagnostics();

  return {
    ok: true,
    capturedAt: new Date().toISOString(),
    href: location.href,
    path: location.pathname,
    title: document.title,
    isChatCandidatePage: isChatCandidatePage(),
    bodyTextLength: normalizeText(document.body?.textContent || "").length,
    loading: diagnostics.loading,
    listFingerprint: diagnostics.listFingerprint,
    candidateSelectorHits: diagnostics.selectorHits,
    visibleTextBlocks: diagnostics.visibleTextBlocks,
    inputs,
    clickables,
    filterControls,
    submitControls,
    candidateContainers,
    textHints: collectFilterTextHints()
  };
}

function inspectFilterElements(selector, predicate, limit) {
  const seen = new Set();
  const result = [];
  for (const element of document.querySelectorAll(selector)) {
    if (seen.has(element) || !isControlVisible(element)) continue;
    seen.add(element);
    if (!predicate(element)) continue;
    result.push(inspectElementForDiagnostics(element));
    if (result.length >= limit) break;
  }
  return result;
}

function inspectElementForDiagnostics(element) {
  const attrs = diagnosticAttributes(element);
  const value = readDiagnosticValue(element);
  return {
    selector: diagnosticSelector(element),
    selectorCount: selectorCount(diagnosticSelector(element)),
    tag: element.tagName.toLowerCase(),
    text: truncateDiagnosticText(controlTextForDiagnostics(element), 120),
    attrs,
    valuePreview: truncateDiagnosticText(value, 80),
    valueLength: value.length,
    hrefKind: diagnosticHrefKind(element),
    path: diagnosticElementPath(element),
    rect: diagnosticRect(element)
  };
}

function hasFilterDiagnosticText(element) {
  const text = controlTextForDiagnostics(element);
  if (!text || text.length > 160) return false;
  return /(搜索|筛选|城市|地区|地点|工作地|活跃|登录|薪资|月薪|期望|确定|确认|完成|应用|查看|牛人|关键词|职位|岗位|不限|近\s*\d|K|以上|以下|重置|清空)/i.test(text);
}

function controlTextForDiagnostics(element) {
  return normalizeText([
    element.textContent,
    element.getAttribute?.("placeholder"),
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("title"),
    element.getAttribute?.("value")
  ].filter(Boolean).join(" "));
}

function collectFilterTextHints() {
  const hints = [];
  for (const element of visibleControlElements("button, a, label, li, dt, dd, span, div, input, textarea, [contenteditable='true'], [role='button']")) {
    const text = controlTextForDiagnostics(element);
    if (!text || text.length > 80) continue;
    if (!/(搜索|筛选|城市|地区|地点|工作地|活跃|登录|薪资|月薪|期望|确定|确认|完成|应用|查看|牛人|关键词|职位|岗位|不限|近\s*\d|K|以上|以下|重置|清空)/i.test(text)) continue;
    if (!hints.includes(text)) hints.push(text);
    if (hints.length >= 80) break;
  }
  return hints;
}

function diagnosticAttributes(element) {
  const attrs = {};
  const allowNames = new Set(["id", "class", "role", "href", "placeholder", "aria-label", "title", "name", "type", "for"]);
  for (const attr of Array.from(element.attributes || [])) {
    if (!allowNames.has(attr.name) && !attr.name.startsWith("data-")) continue;
    if (Object.keys(attrs).length >= 14) break;
    attrs[attr.name] = truncateDiagnosticText(attr.value, 160);
  }
  return attrs;
}

function readDiagnosticValue(element) {
  if (element.isContentEditable) return normalizeText(element.textContent || "");
  if ("value" in element) return normalizeText(String(element.value || ""));
  return "";
}

function diagnosticHrefKind(element) {
  const anchor = element.closest?.("a[href]");
  const href = anchor?.getAttribute("href") || "";
  if (!href) return "";
  const normalized = href.trim().toLowerCase();
  if (normalized.startsWith("javascript:")) return "javascript";
  if (normalized.startsWith("#")) return "hash";
  if (normalized.startsWith("/")) return "path";
  if (normalized.includes("zhipin.com")) return "zhipin";
  return "external-or-other";
}

function diagnosticRect(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function diagnosticSelector(element) {
  const direct = directDiagnosticSelector(element);
  if (direct) return direct;

  const parent = element.parentElement;
  const parentSelector = parent ? directDiagnosticSelector(parent) : "";
  const own = nthOfTypeSelector(element);
  if (parentSelector) return `${parentSelector} > ${own}`;
  return diagnosticElementPath(element);
}

function directDiagnosticSelector(element) {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  if (id) {
    const selector = `#${cssDiagnosticEscape(id)}`;
    if (selectorCount(selector) === 1) return selector;
  }

  for (const name of ["data-testid", "data-test", "data-id", "data-key", "data-value", "data-geek-id", "data-user-id", "name", "role", "placeholder"]) {
    const value = element.getAttribute(name);
    if (!value || value.length > 80) continue;
    const selector = `${tag}[${name}="${cssDiagnosticString(value)}"]`;
    const count = selectorCount(selector);
    if (count > 0 && count <= 5) return selector;
  }

  const classes = classListForDiagnostics(element).slice(0, 3);
  if (classes.length > 0) {
    const selector = `${tag}.${classes.map(cssDiagnosticEscape).join(".")}`;
    const count = selectorCount(selector);
    if (count > 0 && count <= 12) return selector;
  }

  return "";
}

function nthOfTypeSelector(element) {
  const tag = element.tagName.toLowerCase();
  const siblings = Array.from(element.parentElement?.children || []).filter((item) => item.tagName === element.tagName);
  const index = siblings.indexOf(element) + 1;
  return `${tag}:nth-of-type(${Math.max(index, 1)})`;
}

function diagnosticElementPath(element) {
  const parts = [];
  let current = element;
  while (current && current.nodeType === 1 && parts.length < 6) {
    const tag = current.tagName.toLowerCase();
    const id = current.getAttribute("id");
    const classes = classListForDiagnostics(current).slice(0, 2);
    parts.unshift(`${tag}${id ? `#${cssDiagnosticEscape(id)}` : ""}${classes.length ? `.${classes.map(cssDiagnosticEscape).join(".")}` : ""}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function classListForDiagnostics(element) {
  return String(element.getAttribute("class") || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item && item.length <= 48 && !/^(active|selected|disabled|hover|focus)$/i.test(item));
}

function selectorCount(selector) {
  if (!selector) return 0;
  try {
    return document.querySelectorAll(selector).length;
  } catch (_error) {
    return 0;
  }
}

function cssDiagnosticEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function cssDiagnosticString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function truncateDiagnosticText(value, maxLength) {
  const text = normalizeText(String(value || ""));
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
function isSupportedCandidatePage() {
  return location.pathname.includes("/web/boss/") || isChatCandidatePage();
}

function isChatCandidatePage() {
  return location.pathname.includes("/web/chat/search") ||
    location.pathname.includes("/web/chat/recommend") ||
    location.pathname.includes("/web/frame/search") ||
    location.pathname.includes("/web/frame/recommend");
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) > 0 &&
    rect.width >= 120 &&
    rect.height >= 28;
}

async function applyRecruitmentFilters(job) {
  if (!isChatCandidatePage()) {
    return { ok: false, applied: false, reason: "not_candidate_frame", path: location.pathname };
  }

  const before = getCandidateListFingerprint();
  const fields = [];
  const warnings = [];
  const softWarnings = [];
  const recommendFrame = isRecommendCandidateFrame();
  const selectedJobText = getSelectedRecommendationJobText();
  const keyword = normalizeText(job?.keywords || job?.name || "");
  const city = normalizeText(job?.city || "");
  const activeWithin = normalizeText(job?.active_within || "");
  const salaryOptions = buildSalaryOptions(job?.salary_min, job?.salary_max);

  if (recommendFrame) {
    const preflightWarnings = getRecommendationPreflightWarnings(job, keyword, city, salaryOptions);
    if (preflightWarnings.length > 0) {
      return {
        ok: false,
        applied: false,
        reason: `推荐页当前职位与本地条件不一致，已停止且未继续点击 BOSS 页面：${preflightWarnings.join("；")}。${describeLocalRecommendCriteria(job, salaryOptions)}`,
        path: location.pathname,
        before,
        after: getCandidateListFingerprint(),
        fields,
        warnings: preflightWarnings
      };
    }
  }

  clickFirstByText(/筛选|过滤|条件|更多条件|基础要求|个性化要求/);
  await waitForUiSettle(500);

  if (keyword) {
    if (fillInputByHints(/关键词|搜索|职位|岗位|牛人|人才|意向|期望/, keyword)) {
      fields.push("关键词");
      await waitForUiSettle(250);
    } else if (recommendFrame && selectedRecommendationJobMatches(job, keyword)) {
      fields.push("职位");
      softWarnings.push(`推荐页没有关键词输入框，已用当前职位匹配：${selectedJobText || "未读取到职位文案"}`);
    } else if (recommendFrame) {
      warnings.push(`推荐页没有关键词输入框，且当前职位未匹配本地条件：${selectedJobText || "未读取到职位文案"}`);
    } else {
      warnings.push("未找到关键词输入框");
    }
  }

  if (city) {
    const cityFilled = fillInputByHints(/城市|地点|地区|工作地|期望城市/, city);
    if (cityFilled) await waitForUiSettle(350);
    const citySelected = await chooseDropdownOption(/城市|地点|地区|工作地|期望城市|筛选/, city);
    if (cityFilled || citySelected || (recommendFrame && recommendationCityMatches(city))) {
      fields.push("城市");
      if (citySelected) {
        clickScopedConfirmControl(/^(确认|确定|完成)$/);
        await waitForUiSettle(350);
      }
    } else {
      warnings.push("未找到城市筛选控件");
    }
  }

  if (activeWithin) {
    if (await chooseDropdownOption(/活跃|活跃度|最近活跃|登录时间/, activeWithin) || clickFirstByText(new RegExp(escapeRegExp(activeWithin)))) {
      fields.push("活跃时间");
      await waitForUiSettle(250);
    } else if (recommendFrame) {
      softWarnings.push("推荐页未暴露活跃时间筛选控件，已跳过该控件校准。候选卡片仍会保留活跃文案供人工复核。");
    } else {
      warnings.push("未找到活跃时间筛选控件");
    }
  }

  if (salaryOptions.length > 0) {
    let salaryApplied = false;
    for (const label of salaryOptions) {
      if (await chooseDropdownOption(/薪资|月薪|期望薪资|薪酬/, label) || clickFirstByText(new RegExp(escapeRegExp(label), "i"))) {
        salaryApplied = true;
        await waitForUiSettle(250);
        break;
      }
    }
    if (salaryApplied) {
      fields.push("薪资");
    } else if (recommendFrame && selectedRecommendationSalaryMatches(salaryOptions)) {
      fields.push("职位薪资");
      softWarnings.push(`推荐页没有独立薪资筛选控件，已用当前职位薪资匹配：${selectedJobText || "未读取到职位文案"}`);
    } else if (recommendFrame) {
      warnings.push(`推荐页没有独立薪资筛选控件，且当前职位薪资未匹配本地条件：${selectedJobText || "未读取到职位文案"}`);
    } else {
      warnings.push("未找到薪资筛选控件");
    }
  }

  if (fields.length === 0) {
    return {
      ok: false,
      applied: false,
      reason: warnings.length ? warnings.join("；") : "未找到可填写或可确认的筛选条件",
      path: location.pathname,
      before,
      after: getCandidateListFingerprint(),
      fields,
      warnings: warnings.concat(softWarnings)
    };
  }

  if (warnings.length > 0) {
    return {
      ok: false,
      applied: false,
      reason: `已确认 ${fields.join("、")}，但还有条件未成功确认：${warnings.join("；")}，已停止采集。`,
      path: location.pathname,
      before,
      after: getCandidateListFingerprint(),
      fields,
      warnings: warnings.concat(softWarnings)
    };
  }

  let after = await waitForListFingerprintChange(before, 1200);
  if (after.changed) {
    return buildApplySuccess({ fields, submitted: "auto", warnings: softWarnings, before, after: after.fingerprint });
  }

  const submitted = clickSubmitControl() || pressEnterOnFocusedInput();
  if (!submitted) {
    if (recommendFrame && recommendationPageCriteriaSatisfied(job, salaryOptions)) {
      return buildApplySuccess({ fields, submitted: "already-current", warnings: softWarnings, before, after: getCandidateListFingerprint() });
    }

    return {
      ok: false,
      applied: false,
      reason: `已确认 ${fields.join("、")}，但没有找到可点击的确认/搜索/筛选按钮，已停止采集。`,
      path: location.pathname,
      before,
      after: getCandidateListFingerprint(),
      fields,
      warnings: warnings.concat(softWarnings)
    };
  }

  after = await waitForListFingerprintChange(before, 6500);
  if (!after.changed) {
    if (recommendFrame && recommendationPageCriteriaSatisfied(job, salaryOptions)) {
      return buildApplySuccess({ fields, submitted: "already-current", warnings: softWarnings, before, after: after.fingerprint });
    }

    return {
      ok: false,
      applied: false,
      reason: `已提交 ${fields.join("、")}，但候选列表没有刷新，已停止采集。请校准 BOSS 筛选按钮或结果列表容器 selector。`,
      path: location.pathname,
      before,
      after: after.fingerprint,
      fields,
      warnings: warnings.concat(softWarnings)
    };
  }

  return buildApplySuccess({ fields, submitted, warnings: softWarnings, before, after: after.fingerprint });
}

function buildApplySuccess({ fields, submitted, warnings, before, after }) {
  return {
    ok: true,
    applied: true,
    fields,
    submitted,
    refreshed: true,
    warnings,
    path: location.pathname,
    before,
    after
  };
}

function getRecommendationPreflightWarnings(job, keyword, city, salaryOptions) {
  const selectedText = getSelectedRecommendationJobText();
  const result = [];
  if (keyword && !selectedRecommendationJobMatches(job, keyword)) {
    result.push(`当前 BOSS 职位未匹配本地职位/关键词：${selectedText || "未读取到职位文案"}`);
  }
  if (city && selectedText && !recommendationCityMatches(city)) {
    result.push(`当前 BOSS 职位城市未匹配本地城市 ${city}：${selectedText}`);
  }
  if (salaryOptions.length > 0 && !selectedRecommendationSalaryMatches(salaryOptions)) {
    result.push(`当前 BOSS 职位薪资未匹配本地薪资：${selectedText || "未读取到职位文案"}`);
  }
  return result;
}

function describeLocalRecommendCriteria(job, salaryOptions) {
  const parts = [];
  if (normalizeText(job?.name || "")) parts.push(`本地职位 ${normalizeText(job.name)}`);
  if (normalizeText(job?.keywords || "")) parts.push(`关键词 ${normalizeText(job.keywords)}`);
  if (normalizeText(job?.city || "")) parts.push(`城市 ${normalizeText(job.city)}`);
  if (salaryOptions.length > 0) parts.push(`薪资 ${salaryOptions[0]}`);
  return parts.length > 0 ? `本地条件：${parts.join("，")}。` : "";
}

function isRecommendCandidateFrame() {
  return location.pathname.includes("/web/frame/recommend") || location.pathname.includes("/web/chat/recommend");
}

function getSelectedRecommendationJobText() {
  const candidates = visibleControlElements(".ui-dropmenu-label, [class*='dropmenu-label'], [class*='job-select'], [class*='position'], [class*='recommend-filter']")
    .map((element) => normalizeText(element.textContent || ""))
    .filter((text) => text && text.length <= 120 && (/\d+\s*-\s*\d+\s*K/i.test(text) || /职位|岗位|店长|店员|经理|顾问|销售|上海|北京|广州|深圳/.test(text)));
  return candidates[0] || "";
}

function selectedRecommendationJobMatches(job, keyword) {
  const selectedText = getSelectedRecommendationJobText();
  if (!selectedText) return false;
  const jobName = normalizeText(job?.name || "");
  if (jobName && looseTextIncludes(selectedText, jobName)) return true;

  const keywordWords = splitMeaningfulWords(keyword);
  if (keywordWords.length === 0) return false;
  const matched = keywordWords.filter((word) => selectedText.includes(word)).length;
  return matched >= Math.min(2, keywordWords.length);
}

function selectedRecommendationSalaryMatches(salaryOptions) {
  const selectedText = getSelectedRecommendationJobText();
  if (!selectedText) return false;
  return salaryOptions.some((label) => looseTextIncludes(selectedText, label));
}

function recommendationCityMatches(city) {
  const selectedText = getSelectedRecommendationJobText();
  return Boolean(city) && looseTextIncludes(selectedText, city);
}

function recommendationPageCriteriaSatisfied(job, salaryOptions) {
  const keyword = normalizeText(job?.keywords || job?.name || "");
  const city = normalizeText(job?.city || "");
  if (keyword && !selectedRecommendationJobMatches(job, keyword)) return false;
  if (city && !recommendationCityMatches(city)) return false;
  if (salaryOptions.length > 0 && !selectedRecommendationSalaryMatches(salaryOptions)) return false;
  return findCandidateListContainers().length > 0;
}

function visiblePageTextMatches(value) {
  const text = normalizeText(document.body?.textContent || "");
  return looseTextIncludes(text, value);
}

function looseTextIncludes(text, value) {
  const compactText = normalizeText(text).replace(/\s+/g, "").toLowerCase();
  const compactValue = normalizeText(value).replace(/\s+/g, "").toLowerCase();
  return Boolean(compactValue) && compactText.includes(compactValue);
}

function splitMeaningfulWords(value) {
  return normalizeText(value)
    .split(/[\s,，、/|]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !/^(招聘|职位|岗位|人员|员工|上海|北京|广州|深圳)$/.test(word));
}

function clickScopedConfirmControl(pattern) {
  const scopes = visibleControlElements(".trade-entry-warp, .filter-wrap, [class*='filter'], [class*='drop'], [class*='pop'], [class*='dialog']")
    .sort((a, b) => elementArea(a) - elementArea(b));
  for (const scope of scopes) {
    const target = Array.from(scope.querySelectorAll("button, a, span, div, [role='button']"))
      .filter(isControlVisible)
      .filter((element) => {
        const text = textFromClickable(element);
        pattern.lastIndex = 0;
        return text && text.length <= 12 && pattern.test(text);
      })
      .sort((a, b) => elementArea(a) - elementArea(b))[0];
    if (target) {
      clickElement(target);
      return true;
    }
  }
  return clickFirstByText(pattern);
}
function fillInputByHints(pattern, value) {
  const controls = visibleControlElements("input, textarea, [contenteditable='true']")
    .filter((element) => !isDisabled(element))
    .map((element) => ({ element, score: scoreControlByHint(element, pattern) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { element } of controls) {
    setControlValue(element, value);
    if (readControlValue(element).includes(value)) return true;
  }

  return false;
}

async function chooseDropdownOption(triggerPattern, optionText) {
  const trigger = findClickableByText(triggerPattern) || findControlContainerByText(triggerPattern);
  if (trigger) {
    clickElement(trigger);
    await waitForUiSettle(350);
  }

  const optionPatterns = [new RegExp(escapeRegExp(optionText), "i"), looseTextPattern(optionText)];
  for (const pattern of optionPatterns) {
    if (clickFirstByText(pattern)) return true;
  }
  return false;
}

function clickSubmitControl() {
  return clickFirstByText(/^(确定|确认|完成|应用|筛选|搜索|查看结果|搜索牛人|查找牛人|开始搜索|立即搜索|立即筛选|确认选择)$/) ||
    clickFirstSubmitLikeControl();
}

function clickFirstSubmitLikeControl() {
  const controls = visibleControlElements("button, a, [role='button'], input[type='button'], input[type='submit'], span, div")
    .filter((element) => !isDisabled(element))
    .map((element) => ({ element, text: textFromClickable(element) }))
    .filter((item) => item.text && item.text.length <= 40 && /(确定|确认|完成|应用|筛选|搜索|查看结果|搜索牛人|查找牛人|开始搜索|立即搜索|立即筛选|确认选择)/.test(item.text))
    .sort((a, b) => elementArea(a.element) - elementArea(b.element));
  if (!controls[0]) return false;
  clickElement(controls[0].element);
  return true;
}

function clickFirstByText(pattern) {
  const element = findClickableByText(pattern);
  if (!element) return false;
  clickElement(element);
  return true;
}

function findClickableByText(pattern) {
  return visibleControlElements("button, a, label, li, dt, dd, span, div, [role='button']")
    .filter((element) => {
      const text = textFromClickable(element);
      if (!text || text.length > 80) return false;
      pattern.lastIndex = 0;
      if (!pattern.test(text)) return false;
      if (isIgnoredChatCandidateText(text) || isLoadingText(text)) return false;
      return true;
    })
    .sort((a, b) => elementArea(a) - elementArea(b))[0];
}

function findControlContainerByText(pattern) {
  return visibleControlElements("label, div, section, li, dl")
    .filter((element) => {
      const text = normalizeText(element.textContent || "");
      pattern.lastIndex = 0;
      return text && text.length <= 120 && pattern.test(text);
    })
    .sort((a, b) => elementArea(a) - elementArea(b))[0];
}

function clickElement(element) {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  const cleanupJavaScriptUrlGuard = installJavaScriptUrlGuard();
  const usesJavaScriptHref = Boolean(findJavaScriptHrefAnchor(element));

  try {
    dispatchMouseLikeEvent(element, "pointerdown");
    dispatchMouseLikeEvent(element, "mousedown");
    dispatchMouseLikeEvent(element, "pointerup");
    dispatchMouseLikeEvent(element, "mouseup");

    if (usesJavaScriptHref) {
      dispatchMouseLikeEvent(element, "click");
    } else {
      element.click();
    }
  } finally {
    setTimeout(cleanupJavaScriptUrlGuard, 0);
  }
}

function dispatchMouseLikeEvent(element, type) {
  const EventConstructor = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  element.dispatchEvent(new EventConstructor(type, { bubbles: true, cancelable: true, view: window }));
}

function installJavaScriptUrlGuard() {
  const handler = (event) => {
    if (findJavaScriptHrefAnchor(event.target)) {
      event.preventDefault();
    }
  };
  window.addEventListener("click", handler, true);
  document.addEventListener("click", handler, true);
  return () => {
    window.removeEventListener("click", handler, true);
    document.removeEventListener("click", handler, true);
  };
}

function findJavaScriptHrefAnchor(element) {
  if (!element || typeof element.closest !== "function") return null;
  const anchor = element.closest("a[href]");
  const href = anchor?.getAttribute("href") || "";
  return href.trim().toLowerCase().startsWith("javascript:") ? anchor : null;
}

function textFromClickable(element) {
  return normalizeText(element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || element.value || "");
}

function looseTextPattern(value) {
  const parts = normalizeText(value).split(/\s+/).filter(Boolean).map(escapeRegExp);
  return new RegExp(parts.join("\\s*"), "i");
}

function scoreControlByHint(element, pattern) {
  const hint = [
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("name"),
    element.id,
    element.className,
    element.closest("label")?.textContent,
    element.parentElement?.textContent,
    element.previousElementSibling?.textContent
  ].map((value) => normalizeText(String(value || ""))).join(" ");

  if (!hint) return 0;
  if (pattern.test(hint)) return 10;
  if (/搜索|请输入|输入/.test(hint)) return 2;
  return 0;
}

function setControlValue(element, value) {
  element.focus();
  if (element.isContentEditable || element.getAttribute("contenteditable") !== null) {
    element.textContent = value;
  } else if ("value" in element) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    if (element.value !== value) element.value = value;
  } else {
    element.textContent = value;
  }
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent("keyup", { key: "Process", bubbles: true }));
}

function readControlValue(element) {
  if (element.isContentEditable) return normalizeText(element.textContent || "");
  return normalizeText(element.value || "");
}

function pressEnterOnFocusedInput() {
  const active = document.activeElement;
  if (!active || !/^(INPUT|TEXTAREA)$/.test(active.tagName)) return false;
  active.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  active.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  return true;
}

function buildSalaryOptions(min, max) {
  const parsedMin = Number(min);
  const parsedMax = Number(max);
  if (!Number.isFinite(parsedMin) && !Number.isFinite(parsedMax)) return [];

  const labels = [];
  if (Number.isFinite(parsedMin) && Number.isFinite(parsedMax)) {
    labels.push(`${Math.round(parsedMin / 1000)}-${Math.round(parsedMax / 1000)}K`);
    labels.push(`${Math.round(parsedMin / 1000)}k-${Math.round(parsedMax / 1000)}k`);
    labels.push(`${parsedMin}-${parsedMax}`);
  }
  if (Number.isFinite(parsedMin)) labels.push(`${Math.round(parsedMin / 1000)}K以上`);
  if (Number.isFinite(parsedMax)) labels.push(`${Math.round(parsedMax / 1000)}K以下`);
  return Array.from(new Set(labels));
}

function visibleElements(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(isVisible);
}

function visibleControlElements(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(isControlVisible);
}

function isControlVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) > 0 &&
    rect.width >= 1 &&
    rect.height >= 1;
}

function isDisabled(element) {
  return Boolean(element.disabled || element.getAttribute("disabled") !== null || element.getAttribute("aria-disabled") === "true");
}

function elementArea(element) {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
}

async function waitForListFingerprintChange(before, timeoutMs) {
  const startedAt = Date.now();
  let latest = getCandidateListFingerprint();
  while (Date.now() - startedAt < timeoutMs) {
    await waitForUiSettle(500);
    latest = getCandidateListFingerprint();
    if (latest.signature !== before.signature && (latest.containerCount > 0 || latest.selectorHits > 0 || latest.textLength > 0)) {
      return { changed: true, fingerprint: latest };
    }
  }
  return { changed: false, fingerprint: latest };
}
function collectRecommendQueueFromPage() {
  if (!location.href.includes("zhipin.com")) {
    return { ok: false, reason: "not_boss_page", href: location.href, path: location.pathname };
  }

  if (!isRecommendCandidateFrame()) {
    return { ok: false, reason: "not_recommend_frame", href: location.href, path: location.pathname, diagnostics: getCandidateDiagnostics() };
  }

  const containers = findCandidateListContainers();
  const scopes = containers.length > 0 ? containers : findRecommendQueueFallbackContainers();
  const cards = findRecommendQueueCards(scopes);
  const warnings = [];
  const seen = new Set();
  const queue = [];

  if (containers.length === 0) {
    warnings.push("\u672a\u8bc6\u522b\u5230\u63a8\u8350\u5217\u8868\u5bb9\u5668\uff0c\u5df2\u4f7f\u7528\u5907\u7528\u5361\u7247\u9009\u62e9\u5668\u3002");
  }

  for (const card of cards) {
    const rawText = normalizeText(card.textContent || "");
    if (!rawText || isIgnoredChatCandidateText(rawText)) continue;

    const profileUrl = findProfileUrl(card);
    const externalKey = findExternalKey(card, profileUrl, rawText);
    const key = externalKey || profileUrl || rawText.slice(0, 120);
    if (!key || seen.has(key) || key.includes("/job_detail/")) continue;
    if (isIgnoredCandidateHref(key) || isIgnoredCandidateHref(profileUrl)) continue;

    const fields = extractRecommendQueueFields(rawText);
    const greeting = findGreetingControl(card);
    seen.add(key);
    queue.push({
      id: key,
      index: queue.length,
      externalKey: key,
      displayName: findDisplayName(card, rawText),
      profileUrl: profileUrl || "",
      rawText,
      salary: fields.salary,
      activeText: fields.activeText,
      age: fields.age,
      experience: fields.experience,
      education: fields.education,
      arrival: fields.arrival,
      greetingButtonText: greeting?.text || "",
      greetingButtonSelector: greeting?.selector || "",
      cardSelector: diagnosticSelector(card),
      sourceUrl: location.href
    });
  }

  if (queue.length === 0) {
    warnings.push("\u5f53\u524d\u63a8\u8350\u9875\u6ca1\u6709\u89e3\u6790\u51fa\u53ef\u5ba1\u67e5\u5019\u9009\u961f\u5217\u3002");
  }

  return {
    ok: true,
    capturedAt: new Date().toISOString(),
    href: location.href,
    path: location.pathname,
    title: document.title,
    selectedJobText: getSelectedRecommendationJobText(),
    listFingerprint: getCandidateListFingerprint(),
    listContainerCount: containers.length,
    cardCount: cards.length,
    queue: queue.slice(0, 100),
    warnings
  };
}

function findRecommendQueueFallbackContainers() {
  return visibleElements(".recommend-list-wrap, .recommend-list, [class*=\"recommend-list\"], .card-list, [class*=\"card-list\"]")
    .filter((element) => normalizeText(element.textContent || "").length >= 20);
}

function findRecommendQueueCards(scopes) {
  const searchScopes = scopes.length > 0 ? scopes : [document];
  const cards = [];
  const selector = "li.card-item, .card-item, [data-geek-id], [data-candidate-id], [data-uid], [data-user-id], [data-userid]";

  for (const scope of searchScopes) {
    for (const element of scope.querySelectorAll(selector)) {
      const card = normalizeCandidateCard(element);
      if (!card || cards.includes(card) || !isVisible(card)) continue;
      const text = normalizeText(card.textContent || "");
      if (!looksLikeRecommendQueueCard(text)) continue;
      cards.push(card);
    }
  }

  return removeNestedCards(cards);
}

function looksLikeRecommendQueueCard(text) {
  if (!text || text.length < 8 || text.length > 1400) return false;
  if (isIgnoredChatCandidateText(text) || isLoadingText(text)) return false;
  return /\u6253\s*\u62db\s*\u547c|\u5c81|\u6d3b\u8dc3|\u79bb\u804c|\u5728\u804c|\d+\s*-\s*\d+\s*[Kk]|\u9762\u8bae/.test(text);
}

function findGreetingControl(card) {
  const controls = Array.from(card.querySelectorAll("button, a, span, div, [role=\"button\"]"))
    .filter(isControlVisible)
    .map((element) => ({ element, text: textFromClickable(element) }))
    .filter((item) => item.text && item.text.length <= 24 && /\u6253\s*\u62db\s*\u547c/.test(item.text))
    .sort((a, b) => elementArea(a.element) - elementArea(b.element));

  const target = controls[0];
  if (!target) return null;
  return {
    element: target.element,
    text: target.text,
    selector: diagnosticSelector(target.element),
    rect: diagnosticRect(target.element)
  };
}

function extractRecommendQueueFields(text) {
  return {
    salary: firstRecommendMatch(text, [/\u9762\u8bae/, /\d+\s*-\s*\d+\s*[Kk]/, /\d+\s*[Kk]\s*(?:\u4ee5\u4e0a|\u4ee5\u4e0b)?/]),
    activeText: firstRecommendMatch(text, [/\u521a\u521a\u6d3b\u8dc3/, /\u4eca(?:\u65e5|\u5929)\u6d3b\u8dc3/, /\u672c\u5468\u6d3b\u8dc3/, /\d+\s*\u65e5\u5185\u6d3b\u8dc3/, /\u8fd1\s*\d+\s*\u5929\u6d3b\u8dc3/, /[^\s]{0,8}\u6d3b\u8dc3/]),
    age: firstRecommendMatch(text, [/\d{2}\s*\u5c81/]),
    experience: firstRecommendMatch(text, [/10\s*\u5e74\u4ee5\u4e0a/, /\d+\s*\u5e74\u4ee5\u4e0a/, /\d+\s*\u5e74/]),
    education: firstRecommendMatch(text, [/\u521d\u4e2d\u53ca\u4ee5\u4e0b/, /\u4e2d\u4e13\/\u4e2d\u6280/, /\u4e2d\u4e13/, /\u9ad8\u4e2d/, /\u5927\u4e13/, /\u672c\u79d1/, /\u7855\u58eb/, /\u535a\u58eb/]),
    arrival: firstRecommendMatch(text, [/\u79bb\u804c-\u968f\u65f6\u5230\u5c97/, /\u968f\u65f6\u5230\u5c97/, /\u6708\u5185\u5230\u5c97/, /\u79bb\u804c/, /\u5728\u804c/])
  };
}

function firstRecommendMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = normalizeText(text).match(pattern);
    if (match?.[0]) return match[0];
  }
  return "";
}

async function clickSingleGreetingFromRecommendQueue(candidate) {
  if (!location.href.includes("zhipin.com")) {
    return { ok: false, reason: "not_boss_page", href: location.href, path: location.pathname };
  }
  if (!isRecommendCandidateFrame()) {
    return { ok: false, reason: "not_recommend_frame", href: location.href, path: location.pathname };
  }

  const blockedReason = detectGreetingBlockedReason();
  if (blockedReason) {
    return { ok: false, clicked: false, blockedReason, reason: blockedReason, href: location.href, path: location.pathname };
  }

  const match = findRecommendQueueCardByCandidate(candidate);
  if (!match.card) {
    return { ok: false, clicked: false, reason: "candidate_card_not_found", href: location.href, path: location.pathname, candidateIndex: Number(candidate?.index ?? -1) };
  }

  const greeting = findGreetingControl(match.card);
  if (!greeting?.element) {
    return {
      ok: false,
      clicked: false,
      reason: "greeting_button_not_found",
      href: location.href,
      path: location.pathname,
      cardSelector: diagnosticSelector(match.card),
      candidateIndex: match.index
    };
  }

  const beforeFingerprint = getCandidateListFingerprint();
  clickElement(greeting.element);
  await waitForUiSettle(1200);
  const afterState = inspectRecommendGreetingState(candidate);
  return {
    ok: true,
    clicked: true,
    href: location.href,
    path: location.pathname,
    title: document.title,
    candidateIndex: match.index,
    externalKey: match.externalKey,
    displayName: findDisplayName(match.card, match.rawText),
    cardSelector: diagnosticSelector(match.card),
    greetingButtonText: greeting.text,
    greetingButtonSelector: greeting.selector,
    directGreetingDetected: Boolean(afterState.directGreetingDetected),
    afterGreetingButtonText: afterState.greetingButtonText || "",
    afterGreetingButtonSelector: afterState.greetingButtonSelector || "",
    afterCardText: afterState.cardText || "",
    beforeFingerprint,
    afterFingerprint: getCandidateListFingerprint()
  };
}

function inspectRecommendGreetingState(candidate) {
  if (!location.href.includes("zhipin.com") || !isRecommendCandidateFrame()) {
    return { ok: false, reason: "not_recommend_frame", href: location.href, path: location.pathname };
  }

  const match = findRecommendQueueCardByCandidate(candidate);
  if (!match.card) {
    return { ok: false, reason: "candidate_card_not_found", href: location.href, path: location.pathname, candidateIndex: Number(candidate?.index ?? -1) };
  }

  const stateControl = findGreetingStateControl(match.card);
  const cardText = normalizeText(match.card.textContent || "");
  const buttonText = stateControl?.text || "";
  const directGreetingDetected = /\u7ee7\u7eed\s*\u6c9f\u901a/.test(buttonText) || /\u7ee7\u7eed\s*\u6c9f\u901a/.test(cardText);

  return {
    ok: true,
    href: location.href,
    path: location.pathname,
    title: document.title,
    candidateIndex: match.index,
    externalKey: match.externalKey,
    displayName: findDisplayName(match.card, match.rawText),
    cardSelector: diagnosticSelector(match.card),
    directGreetingDetected,
    greetingButtonText: buttonText,
    greetingButtonSelector: stateControl?.selector || "",
    cardText: truncateDiagnosticText(cardText, 220)
  };
}

function findGreetingStateControl(card) {
  const controls = Array.from(card.querySelectorAll("button, a, span, div, [role=\"button\"]"))
    .filter(isControlVisible)
    .map((element) => ({ element, text: textFromClickable(element) }))
    .filter((item) => item.text && item.text.length <= 24 && /(\u6253\s*\u62db\s*\u547c|\u7ee7\u7eed\s*\u6c9f\u901a)/.test(item.text))
    .sort((a, b) => elementArea(a.element) - elementArea(b.element));

  const target = controls[0];
  if (!target) return null;
  return {
    element: target.element,
    text: target.text,
    selector: diagnosticSelector(target.element),
    rect: diagnosticRect(target.element)
  };
}

function inspectGreetingComposer(options = {}) {
  const blockedReason = detectGreetingBlockedReason();
  const input = findGreetingInputControl();
  const sendButton = findGreetingSendControl();
  let filled = false;
  const message = normalizeText(options.message || "");

  if (!blockedReason && input && options.fill && message) {
    setControlValue(input, message);
    filled = looseTextIncludes(readControlValue(input), message) || looseTextIncludes(input.textContent || "", message);
  }

  const reason = greetingComposerReason({ blockedReason, input, filled, message });
  const diagnostics = collectGreetingComposerDiagnostics();
  const recommendGreetingState = options.candidate ? inspectRecommendGreetingState(options.candidate) : null;

  return {
    ok: true,
    href: location.href,
    path: location.pathname,
    title: document.title,
    reason,
    blockedReason,
    inputSelector: input ? diagnosticSelector(input) : "",
    inputText: input ? truncateDiagnosticText(controlTextForDiagnostics(input), 80) : "",
    sendButtonSelector: sendButton ? diagnosticSelector(sendButton) : "",
    sendButtonText: sendButton ? textFromClickable(sendButton) : "",
    directGreetingDetected: Boolean(recommendGreetingState?.directGreetingDetected),
    afterGreetingButtonText: recommendGreetingState?.greetingButtonText || "",
    afterGreetingButtonSelector: recommendGreetingState?.greetingButtonSelector || "",
    afterCardText: recommendGreetingState?.cardText || "",
    filled,
    readyToSend: Boolean(!blockedReason && input && sendButton && filled),
    sent: false,
    sendSuppressed: true,
    messagePreview: message.slice(0, 120),
    bodyTextLength: normalizeText(document.body?.textContent || "").length,
    diagnostics
  };
}

function collectGreetingComposerDiagnostics() {
  return {
    inputCandidates: greetingInputDiagnosticCandidates().slice(0, 8).map((item) => ({ ...inspectElementForDiagnostics(item.element), score: item.score })),
    sendCandidates: greetingSendCandidates().slice(0, 8).map((element) => inspectElementForDiagnostics(element)),
    textHints: collectGreetingTextHints()
  };
}

function greetingInputDiagnosticCandidates() {
  const selectors = "textarea, input, [contenteditable], [role=\"textbox\"], [aria-multiline=\"true\"], div[class*=\"input\"], div[class*=\"editor\"], div[class*=\"textarea\"], div[class*=\"message\"], div[class*=\"chat\"]";
  const seen = new Set();
  return visibleControlElements(selectors)
    .filter((element) => !isDisabled(element))
    .filter((element) => !isInsideRecommendCandidateCard(element))
    .filter((element) => {
      if (seen.has(element)) return false;
      seen.add(element);
      return true;
    })
    .map((element) => ({ element, score: scoreGreetingInput(element) }))
    .filter((item) => item.score > 0 || /\u8f93\u5165|\u6d88\u606f|\u56de\u590d|\u6c9f\u901a|chat|message|editor|textarea|input/i.test(greetingControlHint(item.element)))
    .sort((a, b) => b.score - a.score || elementArea(a.element) - elementArea(b.element));
}

function collectGreetingTextHints() {
  const hints = [];
  for (const element of visibleControlElements("button, a, span, div, textarea, input, [contenteditable], [role=\"button\"], [role=\"textbox\"]")) {
    const text = controlTextForDiagnostics(element);
    if (!text || text.length > 100) continue;
    if (!/\u53d1\u9001|\u8f93\u5165|\u6d88\u606f|\u56de\u590d|\u6c9f\u901a|\u6253\u62db\u547c|\u9891\u7e41|\u9a8c\u8bc1|\u767b\u5f55|chat|message|send|reply/i.test(text)) continue;
    if (!hints.includes(text)) hints.push(text);
    if (hints.length >= 30) break;
  }
  return hints;
}

function greetingComposerReason({ blockedReason, input, filled, message }) {
  if (blockedReason) return blockedReason;
  if (!input) return "\u672a\u8bc6\u522b\u5230\u6253\u62db\u547c\u8f93\u5165\u6846\u3002";
  if (message && !filled) return "\u5df2\u8bc6\u522b\u5230\u8f93\u5165\u6846\uff0c\u4f46\u6587\u6848\u672a\u6210\u529f\u5199\u5165\u3002";
  return "";
}

function findRecommendQueueCardByCandidate(candidate) {
  const containers = findCandidateListContainers();
  const scopes = containers.length > 0 ? containers : findRecommendQueueFallbackContainers();
  const cards = findRecommendQueueCards(scopes);
  const desiredIndex = Number(candidate?.index);

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const rawText = normalizeText(card.textContent || "");
    const profileUrl = findProfileUrl(card) || "";
    const externalKey = findExternalKey(card, profileUrl, rawText);
    if (recommendQueueCandidateMatches(candidate, { rawText, profileUrl, externalKey, index })) {
      return { card, index, rawText, profileUrl, externalKey };
    }
  }

  if (Number.isInteger(desiredIndex) && desiredIndex >= 0 && desiredIndex < cards.length) {
    const card = cards[desiredIndex];
    const rawText = normalizeText(card.textContent || "");
    const profileUrl = findProfileUrl(card) || "";
    const externalKey = findExternalKey(card, profileUrl, rawText);
    return { card, index: desiredIndex, rawText, profileUrl, externalKey };
  }

  return { card: null, index: -1, rawText: "", profileUrl: "", externalKey: "" };
}

function recommendQueueCandidateMatches(candidate, cardInfo) {
  if (!candidate) return false;
  const candidateKey = normalizeText(candidate.externalKey || candidate.id || "");
  const candidateUrl = normalizeText(candidate.profileUrl || "");
  const candidateName = normalizeText(candidate.displayName || "");
  const cardKey = normalizeText(cardInfo.externalKey || "");
  const cardUrl = normalizeText(cardInfo.profileUrl || "");

  if (candidateKey && cardKey && (candidateKey === cardKey || candidateKey.includes(cardKey) || cardKey.includes(candidateKey))) return true;
  if (candidateUrl && cardUrl && candidateUrl === cardUrl) return true;
  if (candidateName && cardInfo.rawText.includes(candidateName) && Number(candidate.index) === cardInfo.index) return true;
  return false;
}

function findGreetingInputControl() {
  return greetingInputCandidates()[0]?.element || null;
}

function greetingInputCandidates() {
  return visibleControlElements("textarea, input, [contenteditable], [role=\"textbox\"], [aria-multiline=\"true\"]")
    .filter((element) => !isDisabled(element))
    .filter((element) => isPotentialGreetingInput(element))
    .map((element) => ({ element, score: scoreGreetingInput(element) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || elementArea(a.element) - elementArea(b.element));
}

function isInsideRecommendCandidateCard(element) {
  return Boolean(element.closest?.(".recommend-list-wrap, ul.card-list, li.card-item, .candidate-card-wrap, .geek-card-small"));
}

function isPotentialGreetingInput(element) {
  if (isInsideRecommendCandidateCard(element)) return false;
  const tag = element.tagName;
  if (tag === "INPUT") {
    const type = String(element.getAttribute("type") || "text").toLowerCase();
    if (!/^(text|search)?$/.test(type)) return false;
  }
  const hint = greetingControlHint(element);
  if (/\u641c\u7d22|\u7b5b\u9009|\u57ce\u5e02|\u5730\u533a|\u85aa\u8d44|\u5173\u952e\u8bcd/.test(hint)) return false;
  return element.isContentEditable || element.getAttribute("contenteditable") !== null || element.getAttribute("role") === "textbox" || element.getAttribute("aria-multiline") === "true" || /TEXTAREA|INPUT/.test(tag);
}

function scoreGreetingInput(element) {
  const hint = greetingControlHint(element);
  let score = 0;
  if (element.tagName === "TEXTAREA") score += 8;
  if (element.isContentEditable || element.getAttribute("role") === "textbox") score += 8;
  if (/\u8f93\u5165|\u6d88\u606f|\u56de\u590d|\u6c9f\u901a|\u6253\u62db\u547c|\u8bf4\u70b9|chat|message|editor|textarea|input/i.test(hint)) score += 10;
  if (/\u804a\u5929|\u53d1\u9001|\u62db\u547c/.test(normalizeText(document.body?.textContent || ""))) score += 2;
  return score;
}

function greetingControlHint(element) {
  return [
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("role"),
    element.getAttribute("name"),
    element.id,
    element.className,
    element.closest("label")?.textContent,
    element.parentElement?.textContent
  ].map((value) => normalizeText(String(value || ""))).join(" ");
}

function findGreetingSendControl() {
  return greetingSendCandidates()[0] || null;
}

function greetingSendCandidates() {
  return visibleControlElements("button, a, span, div, [role=\"button\"], input[type=\"button\"], input[type=\"submit\"]")
    .filter((element) => !isDisabled(element))
    .map((element) => ({ element, text: textFromClickable(element) }))
    .filter((item) => item.text && item.text.length <= 20 && /^(\u53d1\u9001|\u786e\u8ba4\u53d1\u9001|\u7acb\u5373\u6c9f\u901a|\u5f00\u59cb\u6c9f\u901a|\u6253\u62db\u547c)$/.test(item.text))
    .sort((a, b) => elementArea(a.element) - elementArea(b.element))
    .map((item) => item.element);
}

function detectGreetingBlockedReason() {
  const text = normalizeText(document.body?.textContent || "");
  if (/\u67e5\u770b\u592a\u9891\u7e41|\u64cd\u4f5c\u8fc7\u4e8e\u9891\u7e41|\u8bf7\u7a0d\u540e\u91cd\u8bd5|\u7a0d\u540e\u518d\u8bd5/.test(text)) return "BOSS \u63d0\u793a\u64cd\u4f5c\u9891\u7e41\uff0c\u5df2\u505c\u6b62\u3002";
  if (/\u9a8c\u8bc1\u7801|\u5b89\u5168\u9a8c\u8bc1|\u6ed1\u5757\u9a8c\u8bc1|\u8bf7\u5b8c\u6210\u9a8c\u8bc1/.test(text)) return "BOSS \u51fa\u73b0\u5b89\u5168\u9a8c\u8bc1\uff0c\u5df2\u505c\u6b62\u3002";
  if (/\u8bf7\u5148\u767b\u5f55|\u767b\u5f55\u540e/.test(text)) return "BOSS \u767b\u5f55\u72b6\u6001\u5f02\u5e38\uff0c\u5df2\u505c\u6b62\u3002";
  return "";
}

function waitForUiSettle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
globalThis.__recruitmentAssistantCollectCandidates = collectCandidatesFromPage;
globalThis.__recruitmentAssistantApplyFilters = applyRecruitmentFilters;
globalThis.__recruitmentAssistantGetDiagnostics = getCandidateDiagnostics;
globalThis.__recruitmentAssistantGetListFingerprint = getCandidateListFingerprint;
globalThis.__recruitmentAssistantCollectFilterDiagnostics = collectFilterControlDiagnostics;
globalThis.__recruitmentAssistantCollectRecommendQueue = collectRecommendQueueFromPage;
globalThis.__recruitmentAssistantClickSingleGreeting = clickSingleGreetingFromRecommendQueue;
globalThis.__recruitmentAssistantInspectGreetingComposer = inspectGreetingComposer;
globalThis.__recruitmentAssistantInspectRecommendGreetingState = inspectRecommendGreetingState;

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}






