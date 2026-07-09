import type { Page } from "playwright";
import { getControlledPage } from "./browser-controller";
import { detectCandidateCardSelector, detectMessageInputSelector, detectSendButtonSelector } from "./selector-calibrator";
import type { AdapterCandidate, BlockingState, FilterInput, SiteAdapter } from "../domain";

const recruiterCandidateUrls = [
  "https://www.zhipin.com/web/boss/recommend",
  "https://www.zhipin.com/web/boss/search/geek",
  "https://www.zhipin.com/web/boss/geek/recommend",
  "https://www.zhipin.com/web/boss/index"
];

export class BossAdapter implements SiteAdapter {
  async ensureLoggedIn() {
    const page = await getControlledPage();
    if (page.url() === "about:blank") {
      await page.goto("https://www.zhipin.com/", { waitUntil: "domcontentloaded" });
    }

    const blocking = await this.detectBlockingState();
    return blocking !== "login_required";
  }

  async detectBlockingState(): Promise<BlockingState> {
    try {
      const page = await getControlledPage();
      return detectBlockingStateOnPage(page);
    } catch {
      return "page_error";
    }
  }

  async runFilter(input: FilterInput): Promise<AdapterCandidate[]> {
    const page = await getControlledPage();
    const blocking = await this.detectBlockingState();
    if (blocking !== "ok") {
      throw new Error(`blocked:${blocking}`);
    }

    await ensureRecruiterCandidateListPage(page);

    const afterNavigationBlocking = await detectBlockingStateOnPage(page);
    if (afterNavigationBlocking !== "ok") {
      throw new Error(`blocked:${afterNavigationBlocking}`);
    }

    assertRecruiterCandidatePage(page.url());

    const defaultSelector = "[data-candidate-card], .candidate-card, .geek-card, .card-list .card-item";
    const defaultCards = page.locator(defaultSelector);
    const defaultCount = await defaultCards.count().catch(() => 0);
    const detectedSelector = defaultCount === 0 ? await detectCandidateCardSelector(page) : null;
    const cards = detectedSelector ? page.locator(detectedSelector) : defaultCards;
    const count = detectedSelector ? await cards.count().catch(() => 0) : defaultCount;
    const result: AdapterCandidate[] = [];

    for (let i = 0; i < Math.min(count, 100); i += 1) {
      const card = cards.nth(i);
      const text = await card.innerText().catch(() => "");
      const key = await card.evaluate((element) => {
        const nodes = [element, ...Array.from(element.querySelectorAll("*"))];
        for (const node of nodes) {
          for (const attr of Array.from(node.attributes)) {
            if (!attr.value || attr.value.length > 160) continue;
            if (!/^(data-|id$|href$)/.test(attr.name)) continue;
            if (/id|uid|key|geek|candidate|user|resume|ka|href/i.test(`${attr.name}:${attr.value}`)) {
              return `${attr.name}:${attr.value}`;
            }
          }
        }
        return null;
      }).catch(() => null);
      if (!text.trim()) continue;

      const displayName = text.split("\n").find(Boolean)?.trim();
      result.push({
        externalKey: key || `${input.jobName}:${i}:${text.trim().slice(0, 40)}`,
        displayName,
        sourceUrl: page.url()
      });
    }

    assertExtractedCandidatesLookValid(result);
    return result;
  }

  async sendGreeting(candidate: AdapterCandidate, message: string) {
    const page = await getControlledPage();
    const blocking = await this.detectBlockingState();
    if (blocking !== "ok") {
      throw new Error(`blocked:${blocking}`);
    }

    if (candidate.displayName) {
      await page.getByText(candidate.displayName).first().click({ timeout: 5000 });
    }

    const detectedEditorSelector = await detectMessageInputSelector(page);
    const editor = detectedEditorSelector
      ? page.locator(detectedEditorSelector).last()
      : page.locator("textarea, [contenteditable='true']").last();
    await editor.fill(message);

    const detectedSendSelector = await detectSendButtonSelector(page);
    if (detectedSendSelector) {
      await page.locator(detectedSendSelector).last().click();
    } else {
      await page.getByText("发送").last().click();
    }
  }
}

async function ensureRecruiterCandidateListPage(page: Page) {
  if (isRecruiterCandidatePageUrl(page.url())) return;

  if (isRecruiterAreaUrl(page.url())) {
    const clicked = await clickCandidateNavigation(page);
    if (clicked && isRecruiterCandidatePageUrl(page.url())) return;
  }

  for (const url of recruiterCandidateUrls) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);

    const blocking = await detectBlockingStateOnPage(page);
    if (blocking !== "ok") throw new Error(`blocked:${blocking}`);

    if (isRecruiterCandidatePageUrl(page.url())) return;

    const clicked = await clickCandidateNavigation(page);
    if (clicked && isRecruiterCandidatePageUrl(page.url())) return;
  }

  if (isJobSeekerJobPage(page.url())) {
    throw new Error("wrong_page:已尝试自动跳转招聘者候选人页，但当前仍像求职者职位页。请确认这个账号有招聘者身份并已登录招聘者后台。");
  }
}

async function clickCandidateNavigation(page: Page) {
  const nav = page
    .locator('a, button, [role="button"]')
    .filter({ hasText: /推荐牛人|搜索牛人|候选人|牛人|人才|简历/ })
    .first();
  const count = await nav.count().catch(() => 0);
  if (count === 0) return false;

  await nav.click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  return true;
}

async function detectBlockingStateOnPage(page: Page): Promise<BlockingState> {
  try {
    const url = page.url();
    const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");

    if (body.includes("验证码") || body.includes("安全验证") || body.includes("拖动滑块")) {
      return "captcha";
    }

    if (url.includes("login") || (body.includes("登录") && (body.includes("密码") || body.includes("手机号")))) {
      return "login_required";
    }

    return "ok";
  } catch {
    return "page_error";
  }
}

function assertRecruiterCandidatePage(url: string) {
  if (isJobSeekerJobPage(url)) {
    throw new Error("wrong_page:请在招聘者后台的候选人列表或推荐列表页执行筛选，当前页面像职位搜索/职位详情页。");
  }
}

function assertExtractedCandidatesLookValid(candidates: AdapterCandidate[]) {
  if (candidates.length === 0) return;

  const jobDetailLike = candidates.filter((candidate) => candidate.externalKey.includes("/job_detail/")).length;
  if (jobDetailLike / candidates.length >= 0.5) {
    throw new Error("wrong_page:当前页面提取到的是职位卡片，不是候选人卡片。请切换到招聘者后台候选人列表页后重试。");
  }
}

function isRecruiterCandidatePageUrl(url: string) {
  const parsed = new URL(url);
  return parsed.pathname.includes("/web/boss/") && /(recommend|geek|candidate|resume|search)/i.test(parsed.pathname);
}

function isRecruiterAreaUrl(url: string) {
  return new URL(url).pathname.includes("/web/boss/");
}

function isJobSeekerJobPage(url: string) {
  const parsed = new URL(url);
  return parsed.pathname.includes("/job_detail/") || parsed.pathname.includes("/web/geek/") || /^\/[a-z]+\/?$/.test(parsed.pathname);
}