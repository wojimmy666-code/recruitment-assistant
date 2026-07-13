import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";

let context: BrowserContext | null = null;
let page: Page | null = null;

export async function getControlledPage(): Promise<Page> {
  if (!context || !(await isContextUsable(context))) {
    await createControlledContext();
  }

  let currentContext = context;
  if (!currentContext) {
    throw new Error("browser_context_unavailable");
  }

  if (!page || page.isClosed()) {
    page = getOpenPage(currentContext);
  }

  if (!page) {
    try {
      page = await currentContext.newPage();
      bindPageLifecycle(page);
    } catch {
      await createControlledContext();
      currentContext = context;
      if (!currentContext) {
        throw new Error("browser_context_unavailable");
      }
      page = getOpenPage(currentContext) ?? (await currentContext.newPage());
      bindPageLifecycle(page);
    }
  }

  if (!page) {
    throw new Error("controlled_page_unavailable");
  }

  return page;
}

export async function closeControlledBrowser() {
  await context?.close().catch(() => undefined);
  context = null;
  page = null;
}

async function launchPersistentChrome() {
  const dataDir = path.resolve(process.env.APP_DATA_DIR || "data");
  const userDataDir = path.join(dataDir, "chrome-profile");
  const options = {
    headless: false,
    viewport: { width: 1440, height: 1000 }
  };

  try {
    return await chromium.launchPersistentContext(userDataDir, {
      ...options,
      channel: "chrome"
    });
  } catch {
    return chromium.launchPersistentContext(userDataDir, options);
  }
}

async function createControlledContext() {
  context = await launchPersistentChrome();
  context.on("close", () => {
    context = null;
    page = null;
  });

  page = getOpenPage(context);
  if (!page) {
    page = await context.newPage();
  }
  bindPageLifecycle(page);
}

async function isContextUsable(currentContext: BrowserContext) {
  try {
    currentContext.pages();
    return true;
  } catch {
    context = null;
    page = null;
    return false;
  }
}

function getOpenPage(currentContext: BrowserContext | null) {
  return currentContext?.pages().find((candidate) => !candidate.isClosed()) ?? null;
}

function bindPageLifecycle(currentPage: Page) {
  currentPage.once("close", () => {
    if (page === currentPage) {
      page = null;
    }
  });
}