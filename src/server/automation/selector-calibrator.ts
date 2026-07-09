import type { Page } from "playwright";

export type SelectorCandidate = {
  selector: string;
  count: number;
  score: number;
  sampleText: string;
  reason: string;
};

export type AttributeCandidate = {
  name: string;
  values: string[];
  score: number;
  reason: string;
};

export type SelectorDiagnostics = {
  url: string;
  title: string;
  candidateCards: SelectorCandidate[];
  identityAttributes: AttributeCandidate[];
  messageInputs: SelectorCandidate[];
  sendButtons: SelectorCandidate[];
};

const SELECTOR_DIAGNOSTICS_SCRIPT = String.raw`
(() => {
  const selectorEscape = (value) => {
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") return globalThis.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };

  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0 &&
      rect.width >= 24 &&
      rect.height >= 16;
  };

  const textOf = (element) => (element.textContent || "").replace(/\s+/g, " ").trim();

  const stableClasses = (element) => Array.from(element.classList)
    .filter((className) => !/^\d+$/.test(className))
    .filter((className) => !/^(active|selected|hover|current|disabled|focus)$/i.test(className))
    .slice(0, 3);

  const selectorFor = (element) => {
    const dataAttrs = Array.from(element.attributes).filter((attr) => /^data-/.test(attr.name) && attr.value && attr.value.length < 80);
    const priorityAttr = dataAttrs.find((attr) => /id|key|uid|geek|candidate|card|item/i.test(attr.name));
    if (priorityAttr) {
      return element.tagName.toLowerCase() + "[" + priorityAttr.name + "=\"" + selectorEscape(priorityAttr.value) + "\"]";
    }

    const classes = stableClasses(element);
    if (classes.length > 0) {
      return element.tagName.toLowerCase() + "." + classes.map(selectorEscape).join(".");
    }

    const role = element.getAttribute("role");
    if (role) return element.tagName.toLowerCase() + "[role=\"" + selectorEscape(role) + "\"]";

    return element.tagName.toLowerCase();
  };

  const unique = (items) => Array.from(new Set(items));
  const visibleElements = Array.from(document.querySelectorAll("body *")).filter(isVisible);
  const groupedCards = new Map();

  for (const element of visibleElements) {
    const tag = element.tagName.toLowerCase();
    if (["script", "style", "svg", "path", "input", "textarea", "button", "select", "option"].includes(tag)) continue;

    const rect = element.getBoundingClientRect();
    const text = textOf(element);
    if (text.length < 18 || text.length > 1000) continue;
    if (rect.width < 180 || rect.height < 42) continue;

    let score = 0;
    const reasonParts = [];
    if (/候选|求职|简历|沟通|打招呼|活跃|在线|经验|期望|学历|岁|年/.test(text)) {
      score += 20;
      reasonParts.push("包含招聘候选人常见文本");
    }
    if (/geek|candidate|card|resume|user|item|list/i.test(String(element.className))) {
      score += 18;
      reasonParts.push("class 命名像候选人卡片");
    }
    if (Array.from(element.attributes).some((attr) => /geek|candidate|user|uid|id|ka/i.test(attr.name + ":" + attr.value))) {
      score += 14;
      reasonParts.push("包含可疑唯一标识属性");
    }
    if (rect.height >= 70 && rect.height <= 320) {
      score += 10;
      reasonParts.push("高度接近列表卡片");
    }
    if (rect.width >= 280) {
      score += 8;
      reasonParts.push("宽度接近列表卡片");
    }

    if (score < 18) continue;

    const selector = selectorFor(element);
    const group = groupedCards.get(selector) || { elements: [], score: 0, reasonParts: [] };
    group.elements.push(element);
    group.score += score;
    group.reasonParts.push(...reasonParts);
    groupedCards.set(selector, group);
  }

  const candidateCards = Array.from(groupedCards.entries())
    .map(([selector, group]) => {
      let count = group.elements.length;
      try { count = document.querySelectorAll(selector).length; } catch {}
      const repeatedScore = count >= 3 ? 25 : count === 2 ? 10 : 0;
      return {
        selector,
        count,
        score: Math.round(group.score / group.elements.length + repeatedScore + Math.min(count, 20)),
        sampleText: textOf(group.elements[0]).slice(0, 120),
        reason: unique(group.reasonParts).slice(0, 3).join("；")
      };
    })
    .filter((candidate) => candidate.count > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const identityAttributes = [];
  const topCardSelector = candidateCards[0] && candidateCards[0].selector;
  if (topCardSelector) {
    const cards = Array.from(document.querySelectorAll(topCardSelector)).slice(0, 10);
    const attrMap = new Map();
    for (const card of cards) {
      for (const element of [card, ...Array.from(card.querySelectorAll("*")).slice(0, 40)]) {
        for (const attr of Array.from(element.attributes)) {
          if (!attr.value || attr.value.length > 120) continue;
          if (!/^(data-|id$|href$)/.test(attr.name)) continue;
          if (!/id|uid|key|geek|candidate|user|resume|ka|href/i.test(attr.name + ":" + attr.value)) continue;
          const values = attrMap.get(attr.name) || [];
          values.push(attr.value);
          attrMap.set(attr.name, values);
        }
      }
    }

    for (const [name, values] of attrMap.entries()) {
      const distinct = unique(values).slice(0, 5);
      identityAttributes.push({
        name,
        values: distinct,
        score: distinct.length >= Math.min(cards.length, 3) ? 40 : 20,
        reason: distinct.length > 1 ? "多个候选人样本里有不同值，可作为唯一标识来源" : "存在可疑唯一标识属性"
      });
    }
    identityAttributes.sort((a, b) => b.score - a.score);
  }

  const messageInputs = visibleElements
    .filter((element) => {
      const tag = element.tagName.toLowerCase();
      return tag === "textarea" || element.getAttribute("contenteditable") === "true" || element.getAttribute("role") === "textbox";
    })
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const selector = selectorFor(element);
      let count = 1;
      try { count = document.querySelectorAll(selector).length; } catch {}
      return {
        selector,
        count,
        score: Math.round(30 + Math.min(rect.width / 20, 20) + Math.min(rect.height / 10, 20)),
        sampleText: textOf(element).slice(0, 80),
        reason: "可编辑文本输入区域"
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const sendButtons = visibleElements
    .filter((element) => {
      const text = textOf(element);
      if (!/^(发送|打招呼|立即沟通|沟通|开聊)$/.test(text)) return false;
      const tag = element.tagName.toLowerCase();
      return ["button", "a", "div", "span"].includes(tag) || element.getAttribute("role") === "button";
    })
    .map((element) => {
      const selector = selectorFor(element);
      const text = textOf(element);
      let count = 1;
      try { count = document.querySelectorAll(selector).length; } catch {}
      return {
        selector,
        count,
        score: text === "发送" ? 70 : 50,
        sampleText: text,
        reason: "文本像发送/沟通按钮"
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    url: location.href,
    title: document.title,
    candidateCards,
    identityAttributes: identityAttributes.slice(0, 8),
    messageInputs,
    sendButtons
  };
})()
`;

export async function inspectCurrentPageSelectors(page: Page): Promise<SelectorDiagnostics> {
  return page.evaluate(SELECTOR_DIAGNOSTICS_SCRIPT) as Promise<SelectorDiagnostics>;
}

export async function detectCandidateCardSelector(page: Page) {
  const diagnostics = await inspectCurrentPageSelectors(page);
  return diagnostics.candidateCards[0]?.selector ?? null;
}

export async function detectMessageInputSelector(page: Page) {
  const diagnostics = await inspectCurrentPageSelectors(page);
  return diagnostics.messageInputs[0]?.selector ?? null;
}

export async function detectSendButtonSelector(page: Page) {
  const diagnostics = await inspectCurrentPageSelectors(page);
  return diagnostics.sendButtons[0]?.selector ?? null;
}