let recommendBatchStepInFlight = false;
const RECOMMEND_PERSON_CARD_SELECTOR = ".geek-card-small.candidate-card-wrap, .candidate-card-wrap";

if (!globalThis.__recruitmentAssistantBridgeLoaded) {
  globalThis.__recruitmentAssistantBridgeLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "COLLECT_CANDIDATES") {
      try {
        const candidates = collectCandidatesFromPage();
        sendResponse({ ok: true, candidates });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    if (message?.type === "RECOMMEND_BATCH_STEP") {
      void processNextRecommendBatchCard(message)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({
          ok: false,
          outcome: "uncertain",
          clicked: false,
          reason: error instanceof Error ? error.message : String(error),
          href: location.href,
          path: location.pathname
        }));
      return true;
    }

    if (message?.type === "RECOMMEND_APPLY_FILTERS") {
      void applyRecruitmentFilters(message.job || {})
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({
          ok: false,
          applied: false,
          refreshed: false,
          reason: error instanceof Error ? error.message : String(error),
          href: location.href,
          path: location.pathname
        }));
      return true;
    }

    return false;
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

  if (isRecommendCandidateFrame()) {
    const personCard = element.matches?.(RECOMMEND_PERSON_CARD_SELECTOR)
      ? element
      : element.closest?.(RECOMMEND_PERSON_CARD_SELECTOR);
    if (personCard) return personCard;
  }

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
  const namedElements = [
    ...Array.from(card.querySelectorAll("[title], .name, .user-name, .geek-name, .candidate-name, .chat-name, .item-name, [class*='name']")),
    card
  ];
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

  const inputs = inspectFilterElements("input, textarea, [contenteditable='true'], [role='slider'], [class*='slider-handle'], [class*='range-handle'], [class*='slider'] [class*='handle'], [class*='slider'] [class*='thumb'], [class*='slider'] [class*='button']", () => true, 100);
  const clickables = inspectFilterElements("button, a, label, li, dt, dd, span, div, [role='button']", hasFilterDiagnosticText, 180);
  const submitControls = clickables.filter((item) => /(确定|确认|完成|应用|筛选|搜索|查看结果|搜索牛人|查找牛人|开始搜索|立即搜索|立即筛选|确认选择)/.test(item.text || item.attrs?.["aria-label"] || item.attrs?.title || ""));
  const filterControls = clickables.filter((item) => /(关键词|搜索|职位|岗位|牛人|人才|意向|期望|求职意向|求职状态|到岗|经验要求|工作经验|在校|应届|毕业|城市|地点|地区|工作地|活跃|活跃度|最近活跃|登录时间|性别|年龄|男|女|薪资|月薪|薪酬|不限|近\s*\d|K|以上|以下)/i.test(item.text || item.attrs?.placeholder || item.attrs?.["aria-label"] || item.attrs?.title || ""));
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
  return /(搜索|筛选|城市|地区|地点|工作地|活跃|登录|求职意向|求职状态|到岗|经验要求|工作经验|在校|应届|毕业|性别|年龄|男|女|薪资|月薪|期望|确定|确认|完成|应用|查看|牛人|关键词|职位|岗位|不限|近\s*\d|K|以上|以下|重置|清空)/i.test(text);
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
    if (!/(搜索|筛选|城市|地区|地点|工作地|活跃|登录|求职意向|求职状态|到岗|经验要求|工作经验|在校|应届|毕业|性别|年龄|男|女|薪资|月薪|期望|确定|确认|完成|应用|查看|牛人|关键词|职位|岗位|不限|近\s*\d|K|以上|以下|重置|清空)/i.test(text)) continue;
    if (!hints.includes(text)) hints.push(text);
    if (hints.length >= 80) break;
  }
  return hints;
}

function diagnosticAttributes(element) {
  const attrs = {};
  const allowNames = new Set(["id", "class", "role", "href", "placeholder", "aria-label", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext", "title", "name", "type", "for", "tabindex"]);
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
  const localFilterFields = [];
  const warnings = [];
  const softWarnings = [];
  const recommendFrame = isRecommendCandidateFrame();
  const selectedJobText = getSelectedRecommendationJobText();
  const keyword = normalizeText(job?.keywords || job?.name || "");
  const city = normalizeText(job?.city || "");
  const activeWithin = normalizeText(job?.active_within || "");
  const jobIntentions = normalizeMultiSelectFilterValues(job?.job_intentions);
  const experienceRequirements = normalizeMultiSelectFilterValues(job?.experience_requirements);
  const gender = normalizeGenderFilter(job?.gender);
  const ageRange = normalizeAgeFilterRange(job?.age_min, job?.age_max);
  const salaryOptions = buildSalaryOptions(job?.salary_min, job?.salary_max);

  if (recommendFrame && selectedJobText && normalizeText(job?.name || "") && !looseTextIncludes(selectedJobText, job.name)) {
    softWarnings.push(`当前 BOSS 职位为 ${selectedJobText}，仅作为本批次打招呼上下文；候选条件仍按招聘助手设置执行。`);
  }

  clickFirstByText(/筛选|过滤|条件|更多条件|基础要求|个性化要求/);
  await waitForUiSettle(500);
  if (await dismissPreviousFilterPrompt()) {
    softWarnings.push("已取消套用 BOSS 上次筛选条件，改用招聘助手当前条件。");
  }

  if (keyword) {
    if (fillInputByHints(/关键词|搜索|职位|岗位|牛人|人才|意向|期望/, keyword)) {
      fields.push("关键词");
      await waitForUiSettle(250);
    } else if (recommendFrame) {
      fields.push("关键词（本地校验）");
      localFilterFields.push("keywords");
      softWarnings.push("推荐页没有关键词输入框，将在点击前按候选卡片关键词校验。");
    } else {
      warnings.push("未找到关键词输入框");
    }
  }

  if (city) {
    if (recommendFrame && recommendationCityMatches(city)) {
      fields.push("城市");
      softWarnings.push(`当前 BOSS 职位城市已是 ${city}，保留该职位城市作为推荐上下文。`);
    } else {
      const cityFilled = fillInputByHints(/城市|地点|地区|工作地|期望城市/, city);
      if (cityFilled) await waitForUiSettle(350);
      const citySelected = await chooseDropdownOption(/城市|地点|地区|工作地|期望城市/, city);
      if (cityFilled || citySelected) {
        fields.push("城市");
      } else {
        warnings.push("未找到城市筛选控件");
      }
      if (citySelected) {
        clickScopedConfirmControl(/^(确认|确定|完成)$/);
        await waitForUiSettle(350);
      }
    }
  }

  if (activeWithin) {
    const activeApplied = await chooseExactFilterOption(
      /活跃|活跃度|最近活跃|登录时间/,
      buildActiveFilterLabels(activeWithin)
    );
    if (activeApplied) {
      fields.push("活跃时间");
      await waitForUiSettle(250);
    } else if (recommendFrame) {
      fields.push("活跃时间（本地校验）");
      localFilterFields.push("active_within");
      softWarnings.push("推荐页没有可匹配的活跃时间控件，将在点击前按候选卡片活跃时间校验。");
    } else {
      warnings.push("未找到活跃时间筛选控件");
    }
  }

  if (jobIntentions.length > 0) {
    if (await chooseMultipleExactFilterOptions(/求职意向|求职状态|到岗状态/, jobIntentions)) {
      fields.push("求职意向");
      await waitForUiSettle(250);
    } else if (recommendFrame) {
      fields.push("求职意向（本地校验）");
      localFilterFields.push("job_intentions");
      softWarnings.push("未能确认 BOSS 求职意向多选，将在点击前按候选卡片到岗状态校验。");
    } else {
      warnings.push(`未找到可匹配的求职意向选项：${jobIntentions.join("、")}`);
    }
  }

  if (experienceRequirements.length > 0) {
    if (await chooseMultipleExactFilterOptions(/经验要求|工作经验|经验/, experienceRequirements)) {
      fields.push("经验要求");
      await waitForUiSettle(250);
    } else if (recommendFrame) {
      fields.push("经验要求（本地校验）");
      localFilterFields.push("experience_requirements");
      softWarnings.push("未能确认 BOSS 经验要求多选，将在点击前按候选卡片经验校验。");
    } else {
      warnings.push(`未找到可匹配的经验要求选项：${experienceRequirements.join("、")}`);
    }
  }

  if (gender) {
    if (await chooseExactFilterOption(/性别|性别要求/, [gender])) {
      fields.push("性别");
      await waitForUiSettle(250);
    } else {
      warnings.push(`未找到性别筛选控件或选项 ${gender}`);
    }
  }

  if (ageRange.min !== null || ageRange.max !== null) {
    const ageApplied = fillFilterRangeInputs(/年龄|年龄要求/, ageRange.min, ageRange.max)
      || await setAgeSliderRange(/年龄|年龄要求/, ageRange.min, ageRange.max)
      || await chooseExactFilterOption(/年龄|年龄要求/, buildAgeFilterLabels(ageRange.min, ageRange.max));
    if (ageApplied) {
      fields.push("年龄");
      await waitForUiSettle(250);
    } else if (recommendFrame) {
      fields.push("年龄（本地校验）");
      localFilterFields.push("age");
      softWarnings.push(`未能确认 BOSS 年龄滑块 ${describeAgeRange(ageRange.min, ageRange.max)}，将在点击前按候选卡片年龄校验。`);
    } else {
      warnings.push(`未找到可匹配的年龄筛选控件 ${describeAgeRange(ageRange.min, ageRange.max)}`);
    }
  }

  if (salaryOptions.length > 0) {
    let salaryApplied = false;
    for (const label of salaryOptions) {
      if (await chooseDropdownOption(/薪资|月薪|期望薪资|薪酬/, label)) {
        salaryApplied = true;
        await waitForUiSettle(250);
        break;
      }
    }
    if (salaryApplied) {
      fields.push("薪资");
    } else if (recommendFrame) {
      fields.push("期望薪资（本地校验）");
      localFilterFields.push("salary");
      softWarnings.push("推荐页没有独立期望薪资筛选控件，将在点击前按候选卡片薪资校验。");
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
    return buildApplySuccess({ fields, localFilterFields, selectedJobText, submitted: "auto", warnings: softWarnings, before, after: after.fingerprint });
  }

  const submitted = recommendFrame
    ? clickBossFilterConfirmControl()
    : clickSubmitControl() || pressEnterOnFocusedInput();
  if (!submitted) {
    if (recommendFrame && recommendationPageCriteriaSatisfied()) {
      return buildApplySuccess({ fields, localFilterFields, selectedJobText, submitted: "already-current", warnings: softWarnings, before, after: getCandidateListFingerprint() });
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
    if (recommendFrame && recommendationPageCriteriaSatisfied()) {
      return buildApplySuccess({ fields, localFilterFields, selectedJobText, submitted: "already-current", warnings: softWarnings, before, after: after.fingerprint });
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

  return buildApplySuccess({ fields, localFilterFields, selectedJobText, submitted, warnings: softWarnings, before, after: after.fingerprint });
}

function buildApplySuccess({ fields, localFilterFields, selectedJobText, submitted, warnings, before, after }) {
  return {
    ok: true,
    applied: true,
    fields,
    localFilterFields,
    selectedJobText,
    submitted,
    refreshed: true,
    warnings,
    path: location.pathname,
    before,
    after
  };
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

function recommendationCityMatches(city) {
  const selectedText = getSelectedRecommendationJobText();
  return Boolean(city) && looseTextIncludes(selectedText, city);
}

function recommendationPageCriteriaSatisfied() {
  return findCandidateListContainers().length > 0;
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
  const bossDialog = findBossFilterDialog();
  const scopes = visibleControlElements(".trade-entry-warp, .filter-wrap, [class*='filter'], [class*='drop'], [class*='pop'], [class*='dialog']")
    .sort((a, b) => elementArea(a) - elementArea(b));
  for (const scope of scopes) {
    const target = Array.from(scope.querySelectorAll("button, a, span, div, [role='button']"))
      .filter(isControlVisible)
      .filter((element) => {
        const text = textFromClickable(element);
        pattern.lastIndex = 0;
        return text && text.length <= 12 && pattern.test(text) && !(bossDialog && text === "确定");
      })
      .sort((a, b) => elementArea(a) - elementArea(b))[0];
    if (target) {
      clickElement(target);
      return true;
    }
  }
  if (bossDialog) return false;
  return clickFirstByText(pattern);
}

function findBossFilterDialog() {
  const headings = visibleControlElements("h1, h2, h3, header, strong, span, div")
    .filter((element) => {
      const text = normalizeText(element.textContent || "");
      return text.startsWith("筛选条件") && text.length <= 40;
    })
    .sort((a, b) => elementArea(a) - elementArea(b));

  for (const heading of headings) {
    let current = heading.parentElement;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const text = normalizeText(current.textContent || "");
      if (!text.includes("年龄") || !text.includes("性别")) continue;
      if (findTextControlWithin(current, /^(确定|确认)$/)) return current;
    }
  }
  return null;
}

async function dismissPreviousFilterPrompt() {
  const root = findBossFilterDialog() || document.body;
  const messages = Array.from(root.querySelectorAll("div, section, aside, p, span"))
    .filter(isControlVisible)
    .filter((element) => {
      const text = normalizeText(element.textContent || "");
      return text.includes("是否应用上次的筛选条件") && text.length <= 180;
    })
    .sort((a, b) => elementArea(a) - elementArea(b));

  for (const message of messages) {
    let current = message;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const cancel = findTextControlWithin(current, /^取消$/);
      if (!cancel) continue;
      clickElement(cancel);
      await waitForUiSettle(250);
      return true;
    }
  }
  return false;
}

function clickBossFilterConfirmControl() {
  const dialog = findBossFilterDialog();
  if (!dialog) return false;

  const controls = Array.from(dialog.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit'], span, div"))
    .filter(isControlVisible)
    .filter((element) => !isDisabled(element))
    .map((element) => ({ element, text: textFromClickable(element), rect: element.getBoundingClientRect() }))
    .filter((item) => /^(确定|确认|完成)$/.test(item.text))
    .sort((a, b) => {
      const exactDifference = Number(b.text === "确定") - Number(a.text === "确定");
      if (exactDifference !== 0) return exactDifference;
      if (b.rect.top !== a.rect.top) return b.rect.top - a.rect.top;
      return elementArea(a.element) - elementArea(b.element);
    });
  if (!controls[0]) return false;
  clickElement(controls[0].element);
  return true;
}

function findTextControlWithin(root, pattern) {
  const candidates = Array.from(root.querySelectorAll("button, a, label, li, span, div, [role='button'], input[type='button'], input[type='submit']"))
    .filter(isControlVisible)
    .filter((element) => {
      const text = textFromClickable(element);
      pattern.lastIndex = 0;
      return text && text.length <= 40 && pattern.test(text);
    })
    .sort((a, b) => elementArea(a) - elementArea(b));
  return candidates[0] || null;
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
  const optionPatterns = [new RegExp(escapeRegExp(optionText), "i"), looseTextPattern(optionText)];
  for (const pattern of optionPatterns) {
    if (clickFilterOptionByText(pattern)) return true;
  }

  const trigger = findFilterControlByText(triggerPattern);
  if (!trigger) return false;
  clickElement(trigger);
  await waitForUiSettle(350);

  for (const pattern of optionPatterns) {
    if (clickFilterOptionByText(pattern)) return true;
  }
  return false;
}

function findFilterControlByText(pattern) {
  const scopes = visibleControlElements(".trade-entry-warp, .filter-wrap, [class*='filter'], [class*='drop'], [class*='pop'], [class*='dialog']")
    .sort((a, b) => elementArea(a) - elementArea(b));
  for (const scope of scopes) {
    const control = Array.from(scope.querySelectorAll("button, a, label, li, dt, dd, span, div, [role='button']"))
      .filter(isControlVisible)
      .filter((element) => {
        const text = textFromClickable(element);
        pattern.lastIndex = 0;
        return text && text.length <= 80 && pattern.test(text);
      })
      .sort((a, b) => elementArea(a) - elementArea(b))[0];
    if (control) return control;
  }
  return null;
}

function clickFilterOptionByText(pattern) {
  const scopes = visibleControlElements(".trade-entry-warp, .filter-wrap, [class*='filter'], [class*='drop'], [class*='pop'], [class*='dialog']")
    .sort((a, b) => elementArea(a) - elementArea(b));
  for (const scope of scopes) {
    const option = Array.from(scope.querySelectorAll("button, a, label, li, dd, span, div, [role='button'], [role='option']"))
      .filter(isControlVisible)
      .filter((element) => {
        const text = textFromClickable(element);
        pattern.lastIndex = 0;
        return text && text.length <= 80 && pattern.test(text);
      })
      .sort((a, b) => elementArea(a) - elementArea(b))[0];
    if (!option) continue;
    if (!isSelectedFilterOption(option)) clickElement(option);
    return true;
  }
  return false;
}

async function chooseExactFilterOption(groupPattern, optionTexts) {
  let option = findExactFilterOption(groupPattern, optionTexts);
  if (!option) {
    const trigger = findClickableByText(groupPattern) || findControlContainerByText(groupPattern);
    if (trigger) {
      clickElement(trigger);
      await waitForUiSettle(350);
      option = findExactFilterOption(groupPattern, optionTexts);
    }
  }
  if (!option) return false;
  if (!isSelectedFilterOption(option)) clickElement(option);
  return true;
}

async function chooseMultipleExactFilterOptions(groupPattern, optionTexts) {
  const expected = normalizeMultiSelectFilterValues(optionTexts);
  if (expected.length === 0) return true;

  let firstOption = findExactFilterOption(groupPattern, [expected[0]]);
  if (!firstOption) {
    const trigger = findClickableByText(groupPattern) || findControlContainerByText(groupPattern);
    if (trigger) {
      clickElement(trigger);
      await waitForUiSettle(350);
      firstOption = findExactFilterOption(groupPattern, [expected[0]]);
    }
  }
  if (!firstOption) return false;

  const resetOption = findExactFilterOption(groupPattern, ["不限"]);
  if (!resetOption) return false;
  clickElement(resetOption);
  await waitForUiSettle(120);

  for (const optionText of expected) {
    const option = findExactFilterOption(groupPattern, [optionText]);
    if (!option) return false;
    if (!isSelectedFilterOption(option)) clickElement(option);
    await waitForUiSettle(100);
  }
  return true;
}

function findExactFilterOption(groupPattern, optionTexts) {
  const expected = new Set(optionTexts.map(normalizeFilterOptionText).filter(Boolean));
  if (expected.size === 0) return null;

  for (const scope of findFilterGroupScopes(groupPattern)) {
    const option = Array.from(scope.querySelectorAll("button, a, label, li, dd, span, div, [role='button'], [role='option']"))
      .filter(isControlVisible)
      .filter((element) => expected.has(normalizeFilterOptionText(textFromClickable(element))))
      .sort((a, b) => elementArea(a) - elementArea(b))[0];
    if (option) return option;
  }
  return null;
}

function fillFilterRangeInputs(groupPattern, minValue, maxValue) {
  for (const scope of findFilterGroupScopes(groupPattern)) {
    const inputs = Array.from(scope.querySelectorAll("input"))
      .filter(isControlVisible)
      .filter((element) => !isDisabled(element) && !/^(checkbox|radio|button|submit)$/i.test(element.type || ""));
    if (inputs.length === 0) continue;

    let minInput = inputs.find((input) => scoreControlByHint(input, /最低|最小|起始|从/) > 0) || null;
    let maxInput = inputs.find((input) => scoreControlByHint(input, /最高|最大|结束|至/) > 0) || null;
    if (!minInput && minValue !== null) minInput = inputs[0] || null;
    if (!maxInput && maxValue !== null) maxInput = inputs.find((input) => input !== minInput) || inputs[inputs.length - 1] || null;
    if (minValue !== null && !minInput) continue;
    if (maxValue !== null && (!maxInput || (minValue !== null && maxInput === minInput))) continue;

    if (minValue !== null && minInput) setControlValue(minInput, String(minValue));
    if (maxValue !== null && maxInput) setControlValue(maxInput, String(maxValue));
    const minMatches = minValue === null || Number(readControlValue(minInput)) === minValue;
    const maxMatches = maxValue === null || Number(readControlValue(maxInput)) === maxValue;
    if (minMatches && maxMatches) return true;
  }
  return false;
}

async function setAgeSliderRange(groupPattern, minValue, maxValue) {
  const scopes = findFilterGroupScopes(groupPattern);
  let attempts = 0;

  for (const scope of scopes) {
    const handles = findAgeSliderHandles(scope);
    if (handles.length < 2) continue;
    attempts += 1;
    if (attempts > 4) break;

    const lowerHandle = handles[0];
    const upperHandle = handles[handles.length - 1];
    if (lowerHandle instanceof HTMLInputElement && upperHandle instanceof HTMLInputElement) {
      if (minValue !== null) setControlValue(lowerHandle, String(minValue));
      if (maxValue !== null) setControlValue(upperHandle, String(maxValue));
      await waitForUiSettle(150);
    } else {
      if (minValue !== null) await setAgeSliderHandleWithKeyboard(scope, lowerHandle, minValue, 16);
      if (maxValue !== null) await setAgeSliderHandleWithKeyboard(scope, upperHandle, maxValue, minValue ?? 16);
      else await moveSliderHandleToBoundary(upperHandle, "End");
    }

    await waitForUiSettle(180);
    if (ageSliderMatchesRange(scope, handles, minValue, maxValue)) return true;
    if (await setAgeSliderRangeByPointer(scope, handles, minValue, maxValue)) return true;
  }
  return false;
}

function findAgeSliderHandles(scope) {
  const nativeRanges = Array.from(scope.querySelectorAll("input[type='range']"))
    .filter(isControlVisible);
  if (nativeRanges.length >= 2) return nativeRanges.slice(0, 2);

  const selectors = [
    "[role='slider']",
    "[class*='slider-handle']",
    "[class*='slider_handle']",
    "[class*='range-handle']",
    "[class*='range_handle']",
    "[class*='slider'] [class*='handle']",
    "[class*='slider'] [class*='thumb']",
    "[class*='slider'] [class*='button']",
    "[class*='range'] [class*='handle']",
    "[class*='range'] [class*='thumb']"
  ];
  const candidates = Array.from(scope.querySelectorAll(selectors.join(", ")))
    .filter(isControlVisible)
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 4 && rect.height >= 4 && rect.width <= 100 && rect.height <= 100;
    })
    .map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
      score: sliderHandleScore(element)
    }))
    .sort((a, b) => b.score - a.score || elementArea(a.element) - elementArea(b.element));
  const unique = [];
  for (const candidate of candidates) {
    const centerX = candidate.rect.left + candidate.rect.width / 2;
    const centerY = candidate.rect.top + candidate.rect.height / 2;
    if (unique.some((item) => Math.abs(item.centerX - centerX) <= 6 && Math.abs(item.centerY - centerY) <= 6)) continue;
    unique.push({ ...candidate, centerX, centerY });
  }
  return unique
    .sort((a, b) => a.centerX - b.centerX)
    .map((item) => item.element);
}

function sliderHandleScore(element) {
  const className = String(element.className || "");
  if (element.getAttribute("role") === "slider") return 100;
  if (element.getAttribute("tabindex") !== null) return 80;
  if (/handle|thumb/i.test(className)) return 60;
  if (/button/i.test(className)) return 40;
  return 10;
}

async function setAgeSliderHandleWithKeyboard(scope, handle, targetValue, fallbackMinimum) {
  if (!Number.isFinite(targetValue)) return false;
  handle.focus?.();
  dispatchSliderKey(handle, "Home");
  await waitForUiSettle(40);

  let currentValue = readSliderNumericValue(handle);
  if (!Number.isFinite(currentValue)) currentValue = readAgeValueNearHandle(scope, handle);
  if (!Number.isFinite(currentValue) || currentValue > targetValue) {
    for (let index = 0; index < 70; index += 1) {
      dispatchSliderKey(handle, "ArrowLeft");
      if (index % 10 === 9) await waitForUiSettle(15);
    }
    currentValue = readSliderNumericValue(handle);
    if (!Number.isFinite(currentValue)) currentValue = readAgeValueNearHandle(scope, handle);
  }
  if (!Number.isFinite(currentValue)) currentValue = fallbackMinimum;

  const delta = Math.round(targetValue - currentValue);
  if (Math.abs(delta) > 70) return false;
  const key = delta >= 0 ? "ArrowRight" : "ArrowLeft";
  for (let index = 0; index < Math.abs(delta); index += 1) {
    dispatchSliderKey(handle, key);
    if (index % 10 === 9) await waitForUiSettle(15);
  }
  await waitForUiSettle(80);
  return true;
}

async function moveSliderHandleToBoundary(handle, key) {
  handle.focus?.();
  dispatchSliderKey(handle, key);
  await waitForUiSettle(80);
}

function dispatchSliderKey(element, key) {
  const code = key === "ArrowLeft" ? 37 : key === "ArrowRight" ? 39 : key === "Home" ? 36 : 35;
  element.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true }));
  element.dispatchEvent(new KeyboardEvent("keyup", { key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true }));
}

function readSliderNumericValue(element) {
  const values = [
    element instanceof HTMLInputElement ? element.value : "",
    element.getAttribute("aria-valuenow"),
    element.getAttribute("data-value"),
    element.getAttribute("aria-valuetext")
  ];
  for (const value of values) {
    const match = String(value || "").match(/\d{1,2}/);
    if (match) return Number(match[0]);
  }
  return null;
}

function readAgeValueNearHandle(scope, handle) {
  const handleRect = handle.getBoundingClientRect();
  const centerX = handleRect.left + handleRect.width / 2;
  const centerY = handleRect.top + handleRect.height / 2;
  const candidates = collectAgeValueElements(scope)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const value = normalizeText(element.textContent || "");
      return {
        value: value === "不限" ? Number.POSITIVE_INFINITY : Number(value),
        distance: Math.abs(rect.left + rect.width / 2 - centerX) + Math.abs(rect.top + rect.height / 2 - centerY)
      };
    })
    .filter((item) => Number.isFinite(item.value) || item.value === Number.POSITIVE_INFINITY)
    .sort((a, b) => a.distance - b.distance);
  return candidates[0]?.value ?? null;
}

function collectAgeValueElements(scope) {
  return Array.from(scope.querySelectorAll("output, span, div, p, strong"))
    .filter(isControlVisible)
    .filter((element) => {
      const text = normalizeText(element.textContent || "");
      if (!/^(?:1[6-9]|[2-6]\d|70|不限)$/.test(text)) return false;
      return Array.from(element.children).every((child) => !normalizeText(child.textContent || ""));
    });
}

function ageSliderMatchesRange(scope, handles, minValue, maxValue) {
  const handleValues = handles.map(readSliderNumericValue);
  if (handleValues.length >= 2 && handleValues.every(Number.isFinite)) {
    const minMatches = minValue === null || handleValues[0] === minValue;
    const maxMatches = maxValue === null || handleValues[handleValues.length - 1] === maxValue;
    if (minMatches && maxMatches) return true;
  }

  const texts = collectAgeValueElements(scope).map((element) => normalizeText(element.textContent || ""));
  const minMatches = minValue === null || texts.includes(String(minValue));
  const maxMatches = maxValue === null ? texts.includes("不限") : texts.includes(String(maxValue));
  return minMatches && maxMatches;
}

async function setAgeSliderRangeByPointer(scope, handles, minValue, maxValue) {
  const track = findAgeSliderTrack(scope, handles);
  if (!track) return false;
  const trackRect = track.getBoundingClientRect();
  const bounds = readAgeSliderBounds(handles);

  if (minValue !== null) {
    dragSliderHandleToValue(handles[0], trackRect, minValue, bounds.min, bounds.max);
    await waitForUiSettle(100);
  }
  if (maxValue !== null) {
    dragSliderHandleToValue(handles[handles.length - 1], trackRect, maxValue, bounds.min, bounds.max);
    await waitForUiSettle(120);
  }
  return ageSliderMatchesRange(scope, handles, minValue, maxValue);
}

function findAgeSliderTrack(scope, handles) {
  const candidates = Array.from(scope.querySelectorAll("[class*='slider-track'], [class*='slider-rail'], [class*='slider-runway'], [class*='range-track'], [class*='slider'], [class*='range']"))
    .filter(isControlVisible)
    .map((element) => ({ element, rect: element.getBoundingClientRect(), className: String(element.className || "") }))
    .filter((item) => item.rect.width >= 120 && item.rect.height <= 90)
    .sort((a, b) => {
      const aSpecific = /track|rail|runway/i.test(a.className) ? 1 : 0;
      const bSpecific = /track|rail|runway/i.test(b.className) ? 1 : 0;
      return bSpecific - aSpecific || b.rect.width - a.rect.width;
    });
  if (candidates[0]) return candidates[0].element;

  let current = handles[0]?.parentElement || null;
  while (current && current !== scope.parentElement) {
    const rect = current.getBoundingClientRect();
    if (handles.every((handle) => current.contains(handle)) && rect.width >= 120 && rect.height <= 90) return current;
    current = current.parentElement;
  }
  return null;
}

function readAgeSliderBounds(handles) {
  const mins = handles.map((handle) => readSliderBound(handle, "min")).filter(Number.isFinite);
  const maxes = handles.map((handle) => readSliderBound(handle, "max")).filter(Number.isFinite);
  return {
    min: mins.length > 0 ? Math.min(...mins) : 16,
    max: maxes.length > 0 ? Math.max(...maxes) : 60
  };
}

function readSliderBound(handle, bound) {
  const ariaName = bound === "min" ? "aria-valuemin" : "aria-valuemax";
  const rawValue = handle.getAttribute(ariaName)
    || (handle instanceof HTMLInputElement ? handle[bound] : "");
  if (rawValue === null || rawValue === undefined || rawValue === "") return Number.NaN;
  return Number(rawValue);
}

function dragSliderHandleToValue(handle, trackRect, value, minValue, maxValue) {
  const ratio = Math.max(0, Math.min(1, (value - minValue) / Math.max(1, maxValue - minValue)));
  const handleRect = handle.getBoundingClientRect();
  const startX = handleRect.left + handleRect.width / 2;
  const startY = handleRect.top + handleRect.height / 2;
  const targetX = trackRect.left + trackRect.width * ratio;
  const targetY = trackRect.top + trackRect.height / 2;
  dispatchDragEvent(handle, "pointerdown", startX, startY, 1);
  dispatchDragEvent(document, "pointermove", targetX, targetY, 1);
  dispatchDragEvent(document, "pointerup", targetX, targetY, 0);
  dispatchDragEvent(handle, "mousedown", startX, startY, 1);
  dispatchDragEvent(document, "mousemove", targetX, targetY, 1);
  dispatchDragEvent(document, "mouseup", targetX, targetY, 0);
}

function dispatchDragEvent(target, type, clientX, clientY, buttons) {
  const Constructor = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  target.dispatchEvent(new Constructor(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    buttons,
    pointerId: 1,
    pointerType: "mouse"
  }));
}

function findFilterGroupScopes(pattern) {
  const classScopes = visibleControlElements(".trade-entry-warp, .filter-wrap, .recommend-filter, [class*='filter'], [class*='drop'], [class*='pop'], [class*='dialog']")
    .filter((element) => {
      const text = normalizeText(element.textContent || "");
      pattern.lastIndex = 0;
      return text && text.length <= 2000 && pattern.test(text);
    });
  const semanticScopes = findSemanticFilterGroupScopes(pattern);
  return Array.from(new Set([...classScopes, ...semanticScopes]))
    .sort((a, b) => elementArea(a) - elementArea(b));
}

function findSemanticFilterGroupScopes(pattern) {
  const root = findBossFilterDialog() || document.body;
  const labels = Array.from(root.querySelectorAll("div, section, article, li, dl, dt, dd, label, p, span, strong"))
    .filter(isControlVisible)
    .filter((element) => {
      const text = normalizeText(element.textContent || "");
      pattern.lastIndex = 0;
      return text && text.length <= 80 && pattern.test(text);
    })
    .sort((a, b) => elementArea(a) - elementArea(b));
  const scopes = [];

  for (const label of labels) {
    let current = label;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const text = normalizeText(current.textContent || "");
      pattern.lastIndex = 0;
      if (text && text.length <= 2500 && pattern.test(text)) scopes.push(current);
      if (current === root) break;
    }
  }
  return Array.from(new Set(scopes));
}

function isSelectedFilterOption(element) {
  const className = [element, element.parentElement, element.parentElement?.parentElement]
    .map((current) => String(current?.className || ""))
    .join(" ");
  return element.getAttribute("aria-selected") === "true"
    || element.getAttribute("aria-checked") === "true"
    || (!/(^|[\s_-])(inactive|unselected|unchecked)([\s_-]|$)/i.test(className)
      && /(^|[\s_-])(active|selected|checked|current|chosen|on)([\s_-]|$)/i.test(className));
}

function normalizeFilterOptionText(value) {
  return normalizeText(value)
    .replace(/\s+/g, "")
    .replace(/周岁/g, "岁")
    .replace(/[~～至]/g, "-");
}

function normalizeGenderFilter(value) {
  const gender = normalizeText(value || "");
  return gender === "男" || gender === "女" ? gender : "";
}

function normalizeMultiSelectFilterValues(value) {
  let values = value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      values = Array.isArray(parsed) ? parsed : value.split(/[，,]/);
    } catch {
      values = value.split(/[，,]/);
    }
  }
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((item) => normalizeText(item || "")).filter((item) => item && item !== "不限")));
}

function buildActiveFilterLabels(value) {
  const normalized = normalizeText(value || "").replace(/\s+/g, "");
  const labels = [normalized];
  if (/1天|1日/.test(normalized)) labels.push("近1天活跃", "1日内活跃", "今日活跃", "今天活跃");
  if (/3天|3日/.test(normalized)) labels.push("近3天活跃", "3日内活跃", "三日内活跃");
  if (/7天|7日/.test(normalized)) labels.push("近7天活跃", "7日内活跃", "一周内活跃", "本周活跃");
  return Array.from(new Set(labels.filter(Boolean)));
}

function normalizeAgeFilterRange(minValue, maxValue) {
  return {
    min: normalizeAgeFilterValue(minValue),
    max: normalizeAgeFilterValue(maxValue)
  };
}

function normalizeAgeFilterValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const age = Number(value);
  return Number.isInteger(age) && age >= 16 && age <= 70 ? age : null;
}

function buildAgeFilterLabels(minValue, maxValue) {
  if (minValue !== null && maxValue !== null) {
    return [`${minValue}-${maxValue}岁`, `${minValue}至${maxValue}岁`, `${minValue}~${maxValue}岁`, `${minValue}-${maxValue}`];
  }
  if (minValue !== null) return [`${minValue}岁以上`, `${minValue}以上`, `${minValue}+`];
  if (maxValue !== null) return [`${maxValue}岁以下`, `${maxValue}以下`];
  return [];
}

function describeAgeRange(minValue, maxValue) {
  if (minValue !== null && maxValue !== null) return `${minValue}-${maxValue}岁`;
  if (minValue !== null) return `${minValue}岁以上`;
  if (maxValue !== null) return `${maxValue}岁以下`;
  return "不限";
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
      filterReason: "",
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
  const preciseCards = [];

  for (const scope of searchScopes) {
    for (const element of scope.querySelectorAll(RECOMMEND_PERSON_CARD_SELECTOR)) {
      if (!preciseCards.includes(element)) preciseCards.push(element);
    }
  }

  const fallbackSelector = "li.card-item, .card-item, [data-geek-id], [data-candidate-id], [data-uid], [data-user-id], [data-userid]";
  const elements = preciseCards.length > 0
    ? preciseCards
    : searchScopes.flatMap((scope) => Array.from(scope.querySelectorAll(fallbackSelector)));

  for (const element of elements) {
    const card = normalizeCandidateCard(element);
    if (!card || cards.includes(card) || !isVisible(card)) continue;
    const text = normalizeText(card.textContent || "");
    if (!looksLikeRecommendQueueCard(text)) continue;
    cards.push(card);
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
    experience: firstRecommendMatch(text, [/在校\/?应届/, /在校/, /应届(?:生)?/, /(?:20)?\d{2}\s*年(?:后)?毕业/, /\d+\s*年以内/, /\d+\s*-\s*\d+\s*年/, /10\s*年以上/, /\d+\s*年以上/, /\d+\s*年/]),
    education: firstRecommendMatch(text, [/\u521d\u4e2d\u53ca\u4ee5\u4e0b/, /\u4e2d\u4e13\/\u4e2d\u6280/, /\u4e2d\u4e13/, /\u9ad8\u4e2d/, /\u5927\u4e13/, /\u672c\u79d1/, /\u7855\u58eb/, /\u535a\u58eb/]),
    arrival: firstRecommendMatch(text, [/离职-随时到岗/, /在职-暂不考虑/, /在职-考虑机会/, /在职-月内到岗/, /随时到岗/, /月内到岗/, /暂不考虑/, /考虑机会/, /离职/, /在职/])
  };
}

function firstRecommendMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = normalizeText(text).match(pattern);
    if (match?.[0]) return match[0];
  }
  return "";
}

async function processNextRecommendBatchCard(options = {}) {
  if (recommendBatchStepInFlight) {
    return recommendBatchResultBase({
      outcome: "uncertain",
      reason: "上一次打招呼动作仍在执行，已暂停避免重复点击。"
    });
  }
  if (!location.href.includes("zhipin.com") || !isRecommendCandidateFrame()) {
    return recommendBatchResultBase({
      outcome: "uncertain",
      reason: "当前 frame 不是 BOSS 推荐列表。"
    });
  }

  recommendBatchStepInFlight = true;
  try {
    if (options.resetToTop) await resetRecommendListPosition();

    const blockedReason = detectGreetingBlockedReason();
    if (blockedReason) {
      return recommendBatchResultBase({
        outcome: "blocked",
        blockedReason,
        reason: blockedReason
      });
    }

    const processed = new Set(Array.isArray(options.processedFingerprints) ? options.processedFingerprints.filter(Boolean) : []);
    const visitedThisStep = new Set();
    const scannedFingerprints = [];
    const skippedItems = [];
    const filteredItems = [];
    const observedItems = [];
    let previousSignature = "";
    let unchangedScrolls = 0;
    let scrollAttempts = 0;

    for (let pass = 0; pass <= 4; pass += 1) {
      const cards = currentRecommendBatchCards();
      const visibleItems = cards.map((card, index) => recommendBatchItemFromCard(card, index));
      for (const visibleItem of visibleItems) upsertObservedRecommendBatchItem(observedItems, visibleItem);
      for (let index = 0; index < cards.length; index += 1) {
        let card = cards[index];
        let item = visibleItems[index];
        if (!item.fingerprint || processed.has(item.fingerprint) || visitedThisStep.has(item.fingerprint)) continue;
        visitedThisStep.add(item.fingerprint);

        if (findExactRecommendActionControl(card, "继续沟通")) {
          item = { ...item, greetingButtonText: "继续沟通" };
          scannedFingerprints.push(item.fingerprint);
          skippedItems.push(item);
          continue;
        }

        const localFilterResult = evaluateLocalCandidateFilters(item, options.job || {}, options.localFilterFields);
        if (!localFilterResult.matched) {
          item = { ...item, filterReason: localFilterResult.reason };
          upsertObservedRecommendBatchItem(observedItems, item);
          scannedFingerprints.push(item.fingerprint);
          filteredItems.push(item);
          continue;
        }

        let greeting = findExactRecommendActionControl(card, "打招呼");
        if (!greeting) continue;

        card.scrollIntoView?.({ block: "center", inline: "nearest" });
        await waitForUiSettle(450);

        if (!card.isConnected) {
          card = findRecommendCardByFingerprint(item.fingerprint);
        }
        if (!card) {
          return recommendBatchResultBase({
            outcome: "uncertain",
            reason: "候选人卡片在点击前重新渲染，未执行点击。",
            item,
            scannedFingerprints,
            skippedItems,
            filteredItems,
            observedItems,
            scrollAttempts
          });
        }

        const alreadyGreeted = findExactRecommendActionControl(card, "继续沟通");
        if (alreadyGreeted) {
          item = recommendBatchItemFromCard(card, index);
          item.greetingButtonText = "继续沟通";
          upsertObservedRecommendBatchItem(observedItems, item);
          scannedFingerprints.push(item.fingerprint);
          skippedItems.push(item);
          continue;
        }

        greeting = findExactRecommendActionControl(card, "打招呼");
        if (!greeting) {
          return recommendBatchResultBase({
            outcome: "uncertain",
            reason: "候选人操作按钮在点击前发生变化，未执行点击。",
            item,
            scannedFingerprints,
            skippedItems,
            filteredItems,
            observedItems,
            scrollAttempts
          });
        }

        const beforeCardText = truncateDiagnosticText(card.textContent || "", 260);
        clickElement(greeting.element);
        const verification = await waitForRecommendCardGreetingState(card, item.fingerprint, 8000);

        if (verification.blockedReason) {
          return recommendBatchResultBase({
            outcome: "blocked",
            clicked: true,
            blockedReason: verification.blockedReason,
            reason: verification.blockedReason,
            item,
            scannedFingerprints,
            skippedItems,
            filteredItems,
            observedItems,
            scrollAttempts,
            greetingButtonText: greeting.text,
            greetingButtonSelector: greeting.selector,
            afterGreetingButtonText: verification.actionText,
            afterCardText: verification.cardText,
            beforeCardText
          });
        }

        if (verification.confirmed) {
          scannedFingerprints.push(item.fingerprint);
          return recommendBatchResultBase({
            outcome: "direct_greeted",
            clicked: true,
            directGreetingDetected: true,
            reason: "",
            item,
            scannedFingerprints,
            skippedItems,
            filteredItems,
            observedItems,
            scrollAttempts,
            greetingButtonText: greeting.text,
            greetingButtonSelector: greeting.selector,
            afterGreetingButtonText: "继续沟通",
            afterGreetingButtonSelector: verification.selector,
            afterCardText: verification.cardText,
            beforeCardText
          });
        }

        return recommendBatchResultBase({
          outcome: "uncertain",
          clicked: true,
          reason: "已点击打招呼，但 8 秒内同一张卡片未变为“继续沟通”，已暂停避免重复点击。",
          item,
          scannedFingerprints: [...scannedFingerprints, item.fingerprint],
          skippedItems,
          filteredItems,
          observedItems,
          scrollAttempts,
          greetingButtonText: greeting.text,
          greetingButtonSelector: greeting.selector,
          afterGreetingButtonText: verification.actionText,
          afterGreetingButtonSelector: verification.selector,
          afterCardText: verification.cardText,
          beforeCardText
        });
      }

      if (pass === 4) break;
      const signatureBeforeScroll = recommendBatchCardSignature();
      const scrollResult = scrollRecommendListForward();
      if (!scrollResult.moved) break;
      scrollAttempts += 1;
      await waitForUiSettle(1600 + Math.floor(Math.random() * 900));
      const signatureAfterScroll = recommendBatchCardSignature();
      if (signatureAfterScroll === signatureBeforeScroll || signatureAfterScroll === previousSignature) {
        unchangedScrolls += 1;
      } else {
        unchangedScrolls = 0;
      }
      previousSignature = signatureAfterScroll;
      if (unchangedScrolls >= 2) break;
    }

    return recommendBatchResultBase({
      outcome: "exhausted",
      reason: "当前推荐列表没有更多符合条件且未打招呼的候选人。",
      scannedFingerprints,
      skippedItems,
      filteredItems,
      observedItems,
      scrollAttempts
    });
  } finally {
    recommendBatchStepInFlight = false;
  }
}

function recommendBatchResultBase(values = {}) {
  const skippedItems = Array.isArray(values.skippedItems) ? values.skippedItems.slice(0, 40) : [];
  const filteredItems = uniqueRecommendBatchItems(values.filteredItems, 100);
  const observedItems = uniqueRecommendBatchItems(values.observedItems, 100);
  return {
    ok: true,
    outcome: values.outcome || "uncertain",
    clicked: Boolean(values.clicked),
    reason: values.reason || "",
    blockedReason: values.blockedReason || "",
    href: location.href,
    path: location.pathname,
    title: document.title,
    item: values.item || emptyRecommendBatchItem(),
    skippedItems,
    filteredItems,
    observedItems,
    filteredCount: filteredItems.length,
    skippedCount: skippedItems.length,
    scannedFingerprints: Array.from(new Set(values.scannedFingerprints || [])).filter(Boolean).slice(-200),
    scrollAttempts: Number(values.scrollAttempts || 0),
    greetingButtonText: values.greetingButtonText || "",
    greetingButtonSelector: values.greetingButtonSelector || "",
    directGreetingDetected: Boolean(values.directGreetingDetected),
    afterGreetingButtonText: values.afterGreetingButtonText || "",
    afterGreetingButtonSelector: values.afterGreetingButtonSelector || "",
    afterCardText: values.afterCardText || "",
    beforeCardText: values.beforeCardText || "",
    bodyTextLength: normalizeText(document.body?.textContent || "").length
  };
}

function uniqueRecommendBatchItems(items, limit) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = recommendBatchItemKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function upsertObservedRecommendBatchItem(items, item) {
  const key = recommendBatchItemKey(item);
  if (!key) return;
  const index = items.findIndex((current) => recommendBatchItemKey(current) === key);
  if (index >= 0) items[index] = item;
  else items.push(item);
}

function recommendBatchItemKey(item) {
  return item?.fingerprint || item?.externalKey || item?.profileUrl || item?.id || "";
}

function emptyRecommendBatchItem() {
  return {
    id: "",
    index: -1,
    externalKey: "",
    displayName: "候选人",
    profileUrl: "",
    rawText: "",
    salary: "",
    activeText: "",
    age: "",
    experience: "",
    education: "",
    arrival: "",
    filterReason: "",
    greetingButtonText: "",
    greetingButtonSelector: "",
    cardSelector: "",
    sourceUrl: location.href,
    fingerprint: ""
  };
}

function currentRecommendBatchCards() {
  const containers = findCandidateListContainers();
  const scopes = containers.length > 0 ? containers : findRecommendQueueFallbackContainers();
  return findRecommendQueueCards(scopes);
}

function recommendBatchItemFromCard(card, index) {
  const rawText = normalizeText(card?.textContent || "");
  const profileUrl = findProfileUrl(card) || "";
  const externalKey = findExternalKey(card, profileUrl, rawText);
  const fields = extractRecommendQueueFields(rawText);
  const greeting = findExactRecommendActionControl(card, "打招呼")
    || findExactRecommendActionControl(card, "继续沟通");
  return {
    id: externalKey || profileUrl || rawText.slice(0, 120),
    index,
    externalKey: externalKey || "",
    displayName: findDisplayName(card, rawText),
    profileUrl,
    rawText,
    salary: fields.salary,
    activeText: fields.activeText,
    age: fields.age,
    experience: fields.experience,
    education: fields.education,
    arrival: fields.arrival,
    filterReason: "",
    greetingButtonText: greeting?.text || "",
    greetingButtonSelector: greeting?.selector || "",
    cardSelector: diagnosticSelector(card),
    sourceUrl: location.href,
    fingerprint: recommendCardFingerprint(card, rawText, profileUrl, fields)
  };
}

function evaluateLocalCandidateFilters(item, job, localFilterFields) {
  const enabledFields = new Set(Array.isArray(localFilterFields) ? localFilterFields : []);
  const cardText = normalizeText(item?.rawText || "");

  if (enabledFields.has("keywords")) {
    const keywords = splitMeaningfulWords(job?.keywords || job?.name || "");
    if (keywords.length > 0 && !keywords.some((keyword) => looseTextIncludes(cardText, keyword))) {
      return { matched: false, reason: `关键词不匹配：${keywords.join("、")}` };
    }
  }

  if (enabledFields.has("salary")) {
    const candidateSalary = parseCandidateSalaryRange(item?.salary || cardText);
    const expectedSalary = normalizeExpectedSalaryRange(job?.salary_min, job?.salary_max);
    if (!candidateSalary) {
      return { matched: false, reason: "未读取到可比较的期望薪资" };
    }
    if (!salaryRangesOverlap(candidateSalary, expectedSalary)) {
      return {
        matched: false,
        reason: `期望薪资 ${item?.salary || "未知"} 不在 ${describeExpectedSalaryRange(expectedSalary)} 范围内`
      };
    }
  }

  if (enabledFields.has("active_within")) {
    const expectedDays = parseActiveWithinDays(job?.active_within);
    const candidateDays = parseActiveWithinDays(item?.activeText || cardText);
    if (expectedDays !== null && candidateDays === null) {
      return { matched: false, reason: "未读取到可比较的活跃时间" };
    }
    if (expectedDays !== null && candidateDays > expectedDays) {
      return {
        matched: false,
        reason: `活跃时间 ${item?.activeText || "未知"} 不符合 ${normalizeText(job?.active_within || "")} 条件`
      };
    }
  }

  if (enabledFields.has("job_intentions")) {
    const expectedIntentions = normalizeMultiSelectFilterValues(job?.job_intentions);
    if (expectedIntentions.length > 0 && !expectedIntentions.some((intention) => candidateMatchesJobIntention(item?.arrival || cardText, intention))) {
      return {
        matched: false,
        reason: `求职意向 ${item?.arrival || "未知"} 不符合 ${expectedIntentions.join("、")}`
      };
    }
  }

  if (enabledFields.has("experience_requirements")) {
    const expectedExperience = normalizeMultiSelectFilterValues(job?.experience_requirements);
    if (expectedExperience.length > 0 && !expectedExperience.some((requirement) => candidateMatchesExperienceRequirement(item?.experience || "", requirement))) {
      return {
        matched: false,
        reason: `经验 ${item?.experience || "未知"} 不符合 ${expectedExperience.join("、")}`
      };
    }
  }

  if (enabledFields.has("age")) {
    const ageRange = normalizeAgeFilterRange(job?.age_min, job?.age_max);
    const candidateAge = parseCandidateAge(item?.age || cardText);
    if (candidateAge === null) {
      return { matched: false, reason: "未读取到可比较的候选人年龄" };
    }
    if ((ageRange.min !== null && candidateAge < ageRange.min) || (ageRange.max !== null && candidateAge > ageRange.max)) {
      return {
        matched: false,
        reason: `候选人年龄 ${candidateAge}岁 不符合 ${describeAgeRange(ageRange.min, ageRange.max)} 条件`
      };
    }
  }

  return { matched: true, reason: "" };
}

function candidateMatchesJobIntention(value, expected) {
  const text = normalizeText(value || "").replace(/\s+/g, "");
  if (!text) return false;
  if (expected === "离职-随时到岗") return /离职.*随时到岗|随时到岗/.test(text);
  if (expected === "在职-暂不考虑") return /在职.*暂不考虑|暂不考虑/.test(text);
  if (expected === "在职-考虑机会") return /在职.*考虑机会|考虑机会/.test(text);
  if (expected === "在职-月内到岗") return /在职.*月内到岗|月内到岗/.test(text);
  return looseTextIncludes(text, expected);
}

function candidateMatchesExperienceRequirement(value, expected) {
  const text = normalizeText(value || "").replace(/\s+/g, "");
  if (!text) return false;
  if (expected === "在校/应届") return /在校|应届/.test(text);

  const graduation = text.match(/(?:20)?(\d{2})年(?:后)?毕业/);
  if (expected === "25年毕业") return Boolean(graduation && Number(graduation[1]) === 25 && !text.includes("年后毕业"));
  if (expected === "26年毕业") return Boolean(graduation && Number(graduation[1]) === 26 && !text.includes("年后毕业"));
  if (expected === "26年后毕业") return Boolean(graduation && (Number(graduation[1]) > 26 || text.includes("26年后毕业")));

  const range = parseCandidateExperienceRange(text);
  if (!range) return false;
  if (expected === "1年以内") return experienceRangesOverlap(range, { min: 0, max: 1 });
  if (expected === "1-3年") return experienceRangesOverlap(range, { min: 1, max: 3 });
  if (expected === "3-5年") return experienceRangesOverlap(range, { min: 3, max: 5 });
  if (expected === "5-10年") return experienceRangesOverlap(range, { min: 5, max: 10 });
  if (expected === "10年以上") return range.max >= 10;
  return false;
}

function parseCandidateExperienceRange(value) {
  const range = value.match(/(\d+)\s*-\s*(\d+)年/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const within = value.match(/(\d+)年以内/);
  if (within) return { min: 0, max: Number(within[1]) };
  const above = value.match(/(\d+)年以上/);
  if (above) return { min: Number(above[1]), max: Number.POSITIVE_INFINITY };
  const exact = value.match(/(\d+)年/);
  if (exact) return { min: Number(exact[1]), max: Number(exact[1]) };
  return null;
}

function experienceRangesOverlap(left, right) {
  return left.min <= right.max && right.min <= left.max;
}

function parseCandidateAge(value) {
  const match = normalizeText(value || "").match(/(\d{2})\s*岁/);
  if (!match) return null;
  const age = Number(match[1]);
  return age >= 16 && age <= 70 ? age : null;
}

function parseActiveWithinDays(value) {
  const text = normalizeText(value || "").replace(/\s+/g, "");
  if (!text) return null;
  if (/刚刚|分钟|小时|今日|今天/.test(text)) return 1;
  if (/昨日|昨天/.test(text)) return 1;
  if (/本周|一周/.test(text)) return 7;
  if (/本月|一个月/.test(text)) return 30;
  const match = text.match(/(\d+)\s*(?:天|日)/);
  return match ? Number(match[1]) : null;
}

function parseCandidateSalaryRange(value) {
  const text = normalizeText(value || "").replace(/[~～至]/g, "-");
  if (!text || text.includes("面议")) return null;

  const range = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[Kk]/);
  if (range) {
    return {
      min: Number(range[1]) * 1000,
      max: Number(range[2]) * 1000
    };
  }

  const bounded = text.match(/(\d+(?:\.\d+)?)\s*[Kk]\s*(以上|以下)/);
  if (bounded) {
    const amount = Number(bounded[1]) * 1000;
    return bounded[2] === "以上"
      ? { min: amount, max: Number.POSITIVE_INFINITY }
      : { min: 0, max: amount };
  }

  const exact = text.match(/(\d+(?:\.\d+)?)\s*[Kk]/);
  if (!exact) return null;
  const amount = Number(exact[1]) * 1000;
  return { min: amount, max: amount };
}

function normalizeExpectedSalaryRange(minValue, maxValue) {
  return {
    min: normalizeExpectedSalaryValue(minValue, 0),
    max: normalizeExpectedSalaryValue(maxValue, Number.POSITIVE_INFINITY)
  };
}

function normalizeExpectedSalaryValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number > 0 && number < 1000 ? number * 1000 : number;
}

function salaryRangesOverlap(candidate, expected) {
  return candidate.max >= expected.min && candidate.min <= expected.max;
}

function describeExpectedSalaryRange(range) {
  if (range.min > 0 && Number.isFinite(range.max)) return `${formatSalaryAmount(range.min)}-${formatSalaryAmount(range.max)}`;
  if (range.min > 0) return `${formatSalaryAmount(range.min)}以上`;
  if (Number.isFinite(range.max)) return `${formatSalaryAmount(range.max)}以下`;
  return "不限薪资";
}

function formatSalaryAmount(value) {
  return `${Number(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
}

function recommendCardFingerprint(card, rawText, profileUrl, fields = extractRecommendQueueFields(rawText)) {
  const identityNode = [card, ...Array.from(card?.querySelectorAll?.("[data-geek-id], [data-candidate-id], [data-uid], [data-user-id], [data-userid]") || [])]
    .find((element) => Array.from(element?.attributes || []).some((attr) => /^(data-geek-id|data-candidate-id|data-uid|data-user-id|data-userid)$/i.test(attr.name) && attr.value));
  const identityAttribute = identityNode
    ? Array.from(identityNode.attributes).find((attr) => /^(data-geek-id|data-candidate-id|data-uid|data-user-id|data-userid)$/i.test(attr.name) && attr.value)
    : null;
  if (identityAttribute?.value) return identityAttribute.name + ":" + identityAttribute.value;
  if (profileUrl) return "profile:" + profileUrl;

  const stableText = normalizeText(rawText)
    .replaceAll(String.fromCharCode(0x6253, 0x62db, 0x547c), "")
    .replaceAll(String.fromCharCode(0x7ee7, 0x7eed, 0x6c9f, 0x901a), "")
    .slice(0, 260);
  return [
    findDisplayName(card, rawText),
    fields.salary,
    fields.age,
    fields.experience,
    fields.education,
    fields.arrival,
    stableText
  ].join("|");
}

function findRecommendCardByFingerprint(fingerprint) {
  if (!fingerprint) return null;
  return currentRecommendBatchCards().find((card) => {
    const rawText = normalizeText(card.textContent || "");
    return recommendCardFingerprint(card, rawText, findProfileUrl(card) || "") === fingerprint;
  }) || null;
}

function findExactRecommendActionControl(card, expectedText) {
  if (!card) return null;
  const expected = compactRecommendActionText(expectedText);
  const controls = Array.from(card.querySelectorAll("button, a, [role=\"button\"], span, div"))
    .filter(isControlVisible)
    .map((element) => ({
      element,
      text: textFromClickable(element),
      score: recommendActionControlScore(element),
      depth: recommendActionControlDepth(element, card)
    }))
    .filter((item) => compactRecommendActionText(item.text) === expected)
    .sort((a, b) => elementArea(a.element) - elementArea(b.element) || b.depth - a.depth || b.score - a.score);

  const target = controls[0];
  if (!target) return null;
  return {
    element: target.element,
    text: normalizeText(target.text),
    selector: diagnosticSelector(target.element)
  };
}

function compactRecommendActionText(value) {
  return normalizeText(String(value || "")).split(" ").join("");
}

function recommendActionControlScore(element) {
  const className = String(element.className || "");
  let score = 0;
  if (/button-chat-wrap|button-chat/.test(className)) score += 100;
  if (/^(BUTTON|A)$/.test(element.tagName)) score += 80;
  if (element.getAttribute("role") === "button") score += 70;
  if (/btn|button|operate|action/i.test(className)) score += 40;
  if (window.getComputedStyle(element).cursor === "pointer") score += 20;
  return score;
}
function recommendActionControlDepth(element, card) {
  let depth = 0;
  let current = element;
  while (current && current !== card) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

async function waitForRecommendCardGreetingState(card, fingerprint, timeoutMs) {
  const startedAt = Date.now();
  let latestCard = card;
  let latestAction = null;
  let latestText = truncateDiagnosticText(card?.textContent || "", 260);

  while (Date.now() - startedAt <= timeoutMs) {
    const blockedReason = detectGreetingBlockedReason();
    if (blockedReason) {
      return {
        confirmed: false,
        blockedReason,
        actionText: latestAction?.text || "",
        selector: latestAction?.selector || "",
        cardText: latestText
      };
    }

    if (!latestCard?.isConnected) latestCard = findRecommendCardByFingerprint(fingerprint);
    if (latestCard) {
      latestAction = findExactRecommendActionControl(latestCard, "继续沟通");
      latestText = truncateDiagnosticText(latestCard.textContent || "", 260);
      if (latestAction) {
        return {
          confirmed: true,
          blockedReason: "",
          actionText: latestAction.text,
          selector: latestAction.selector,
          cardText: latestText
        };
      }
    }

    await waitForUiSettle(350);
  }

  const currentAction = latestCard
    ? findExactRecommendActionControl(latestCard, "打招呼") || findGreetingStateControl(latestCard)
    : null;
  return {
    confirmed: false,
    blockedReason: "",
    actionText: currentAction?.text || "",
    selector: currentAction?.selector || "",
    cardText: latestText
  };
}

async function resetRecommendListPosition() {
  const target = findRecommendScrollTarget();
  if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
    window.scrollTo({ top: 0, behavior: "auto" });
  } else if (target) {
    target.scrollTop = 0;
    target.dispatchEvent(new Event("scroll", { bubbles: true }));
  }
  await waitForUiSettle(700);
}

function scrollRecommendListForward() {
  const target = findRecommendScrollTarget();
  if (!target) return { moved: false, before: 0, after: 0 };

  if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
    const before = window.scrollY;
    const distance = Math.max(420, Math.floor(window.innerHeight * 0.8));
    window.scrollTo({ top: before + distance, behavior: "auto" });
    return { moved: Math.abs(window.scrollY - before) > 2, before, after: window.scrollY };
  }

  const before = target.scrollTop;
  const distance = Math.max(420, Math.floor(target.clientHeight * 0.8));
  target.scrollTop = Math.min(target.scrollHeight, before + distance);
  target.dispatchEvent(new Event("scroll", { bubbles: true }));
  return { moved: Math.abs(target.scrollTop - before) > 2, before, after: target.scrollTop };
}

function findRecommendScrollTarget() {
  const cards = currentRecommendBatchCards();
  const candidates = [];
  for (const card of cards.slice(0, 4)) {
    let parent = card.parentElement;
    for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
      if (!candidates.includes(parent)) candidates.push(parent);
    }
  }
  for (const element of document.querySelectorAll(".recommend-list-wrap, .recommend-list, .card-list, [class*=\"recommend-list\"]")) {
    if (!candidates.includes(element)) candidates.push(element);
  }

  const scrollable = candidates
    .filter((element) => element.clientHeight >= 120 && element.scrollHeight > element.clientHeight + 60)
    .sort((a, b) => {
      const aOverflow = /auto|scroll/.test(window.getComputedStyle(a).overflowY) ? 1 : 0;
      const bOverflow = /auto|scroll/.test(window.getComputedStyle(b).overflowY) ? 1 : 0;
      return bOverflow - aOverflow || a.clientHeight - b.clientHeight;
    })[0];
  if (scrollable) return scrollable;

  const documentScroller = document.scrollingElement || document.documentElement;
  if (documentScroller && documentScroller.scrollHeight > window.innerHeight + 60) return documentScroller;
  return null;
}

function recommendBatchCardSignature() {
  return currentRecommendBatchCards()
    .map((card) => {
      const rawText = normalizeText(card.textContent || "");
      return recommendCardFingerprint(card, rawText, findProfileUrl(card) || "");
    })
    .join("||")
    .slice(0, 4000);
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

  const match = findRecommendQueueCardByCandidate(candidate, { preferGreeting: true });
  if (!match.card) {
    return { ok: false, clicked: false, reason: "candidate_card_not_found", href: location.href, path: location.pathname, candidateIndex: Number(candidate?.index ?? -1) };
  }

  const existingState = inspectRecommendGreetingStateFromMatch(match);
  if (existingState.directGreetingDetected && !findGreetingControl(match.card)) {
    return {
      ok: true,
      clicked: false,
      reason: "already_greeted",
      href: location.href,
      path: location.pathname,
      title: document.title,
      candidateIndex: match.index,
      externalKey: match.externalKey,
      displayName: findDisplayName(match.card, match.rawText),
      cardSelector: diagnosticSelector(match.card),
      greetingButtonText: "",
      greetingButtonSelector: "",
      directGreetingDetected: true,
      afterGreetingButtonText: existingState.greetingButtonText || "",
      afterGreetingButtonSelector: existingState.greetingButtonSelector || "",
      afterCardText: existingState.cardText || "",
      beforeFingerprint: getCandidateListFingerprint(),
      afterFingerprint: getCandidateListFingerprint()
    };
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
      candidateIndex: match.index,
      matchedDisplayName: findDisplayName(match.card, match.rawText),
      matchedCardText: truncateDiagnosticText(match.rawText, 220),
      currentGreetingState: existingState.greetingButtonText || ""
    };
  }

  const beforeFingerprint = getCandidateListFingerprint();
  clickElement(greeting.element);
  const afterState = await waitForDirectGreetingOnCard(match.card, match, 5200);
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

  return inspectRecommendGreetingStateFromMatch(match);
}

async function waitForDirectGreetingOnCard(card, match, timeoutMs) {
  const startedAt = Date.now();
  let latest = inspectRecommendGreetingStateFromMatch({ ...match, card });
  while (Date.now() - startedAt <= timeoutMs) {
    if (latest.directGreetingDetected) return latest;
    await waitForUiSettle(450);
    if (!card.isConnected) {
      const rematch = findRecommendQueueCardByCandidate({ externalKey: match.externalKey, displayName: findDisplayName(card, match.rawText), index: match.index });
      if (rematch.card) {
        card = rematch.card;
        match = rematch;
      }
    }
    latest = inspectRecommendGreetingStateFromMatch({ ...match, card });
  }
  return latest;
}

function inspectRecommendGreetingStateFromMatch(match) {
  const stateControl = findGreetingStateControl(match.card);
  const cardText = normalizeText(match.card?.textContent || match.rawText || "");
  const buttonText = stateControl?.text || "";
  const directGreetingDetected = /\u7ee7\u7eed\s*\u6c9f\u901a/.test(buttonText) || /\u7ee7\u7eed\s*\u6c9f\u901a/.test(cardText);

  return {
    ok: true,
    href: location.href,
    path: location.pathname,
    title: document.title,
    candidateIndex: match.index,
    externalKey: match.externalKey,
    displayName: findDisplayName(match.card, cardText || match.rawText || ""),
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

function findRecommendQueueCardByCandidate(candidate, options = {}) {
  const containers = findCandidateListContainers();
  const scopes = containers.length > 0 ? containers : findRecommendQueueFallbackContainers();
  const cards = findRecommendQueueCards(scopes);
  const desiredIndex = Number(candidate?.index);
  const matches = [];

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const rawText = normalizeText(card.textContent || "");
    const profileUrl = findProfileUrl(card) || "";
    const externalKey = findExternalKey(card, profileUrl, rawText);
    const score = scoreRecommendQueueCandidateMatch(candidate, { rawText, profileUrl, externalKey, index });
    if (score <= 0) continue;
    const greeting = findGreetingControl(card);
    const directGreetingDetected = /\u7ee7\u7eed\s*\u6c9f\u901a/.test(rawText);
    const actionScore = options.preferGreeting && greeting ? 20 : 0;
    matches.push({ card, index, rawText, profileUrl, externalKey, score: score + actionScore, greeting, directGreetingDetected });
  }

  matches.sort((a, b) => b.score - a.score || Number(Boolean(b.greeting)) - Number(Boolean(a.greeting)) || a.index - b.index);
  const best = matches[0];
  if (best) return best;

  if (Number.isInteger(desiredIndex) && desiredIndex >= 0 && desiredIndex < cards.length) {
    const card = cards[desiredIndex];
    const rawText = normalizeText(card.textContent || "");
    const candidateName = normalizeText(candidate?.displayName || "");
    const greeting = findGreetingControl(card);
    const directGreetingDetected = /\u7ee7\u7eed\s*\u6c9f\u901a/.test(rawText);
    if ((!candidateName || rawText.includes(candidateName)) && (!options.preferGreeting || greeting || directGreetingDetected)) {
      const profileUrl = findProfileUrl(card) || "";
      const externalKey = findExternalKey(card, profileUrl, rawText);
      return { card, index: desiredIndex, rawText, profileUrl, externalKey, greeting, directGreetingDetected };
    }
  }

  return { card: null, index: -1, rawText: "", profileUrl: "", externalKey: "" };
}

function scoreRecommendQueueCandidateMatch(candidate, cardInfo) {
  if (!candidate) return 0;
  const candidateKey = normalizeText(candidate.externalKey || candidate.id || "");
  const candidateUrl = normalizeText(candidate.profileUrl || "");
  const candidateName = normalizeText(candidate.displayName || "");
  const cardKey = normalizeText(cardInfo.externalKey || "");
  const cardUrl = normalizeText(cardInfo.profileUrl || "");
  const desiredIndex = Number(candidate.index);

  if (candidateKey && cardKey && candidateKey === cardKey) return 100;
  if (candidateUrl && cardUrl && candidateUrl === cardUrl) return 95;
  if (candidateName && cardInfo.rawText.includes(candidateName) && Number.isInteger(desiredIndex) && desiredIndex === cardInfo.index) return 85;
  if (candidateName && cardInfo.rawText.includes(candidateName) && recommendQueueCandidateFieldOverlap(candidate, cardInfo.rawText)) return 75;
  if (Number.isInteger(desiredIndex) && desiredIndex === cardInfo.index && (!candidateName || cardInfo.rawText.includes(candidateName))) return 55;
  if (candidateName && cardInfo.rawText.includes(candidateName)) return 35;
  return 0;
}

function recommendQueueCandidateFieldOverlap(candidate, rawText) {
  return [candidate.salary, candidate.age, candidate.education, candidate.experience, candidate.arrival]
    .map((value) => normalizeText(String(value || "")))
    .filter((value) => value.length >= 2)
    .some((value) => rawText.includes(value));
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
globalThis.__recruitmentAssistantProcessRecommendBatchCard = processNextRecommendBatchCard;
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






