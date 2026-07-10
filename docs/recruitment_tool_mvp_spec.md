# 本地招聘打招呼工具 MVP 设计与开发方案

## 1. 产品目标

做一个本地 Web 小工具，用来辅助招聘者在已登录的浏览器里完成三件事：

1. 按某个职位筛选适合的人。
2. 使用提前保存的固定文案，手动或批量打招呼。
3. 记录已发送文案，并支持每天定时执行。

第一版不要做 AI 文案生成、候选人 CRM、复杂看板、简历分析，也不要绕过验证码、登录、风控或平台限制。

## 2. 推荐技术栈

- 前端：React + Vite + TypeScript
- 后端：Node.js + Express + TypeScript
- 浏览器控制：Playwright
- 本地存储：SQLite，推荐 `better-sqlite3`
- 定时任务：`node-cron`
- UI 图标：`lucide-react`

建议使用独立 Chrome 用户数据目录：

```text
data/chrome-profile/
```

第一次运行时由 Playwright 打开 Chrome，用户手动登录招聘网站。之后自动化只复用这个本地 profile，不保存账号密码。

## 3. 页面结构

MVP 只做一个页面：紧凑操作面板。

```text
┌──────────────────────────────────────────────────────────────┐
│ 本地招聘打招呼工具      已连接浏览器      今日 12/20      设置 │
├───────────────────────────────┬──────────────────────────────┤
│ 职位与筛选                     │ 发送控制                      │
│ - 当前职位                     │ - 手动逐个发送 / 批量按上限发送 │
│ - 城市                         │ - 每日上限                     │
│ - 关键词                       │ - 随机间隔                     │
│ - 活跃时间                     │ - 开始 / 暂停                  │
│ - 性别 / 年龄范围              │ - 安全暂停提示                 │
│ - 薪资范围                     │                              │
│ - 跳过已联系                   │                              │
│ - 筛选候选人                   │ 发送记录                      │
│ - 找到/可发送/已跳过            │ - 时间 / 候选人 / 职位 / 文案 / 状态 │
│                               │                              │
│ 固定文案                       │ 每日定时                      │
│ - 文案模板                     │ - 开启/关闭                    │
│ - 文案编辑框                   │ - 执行时间                     │
│ - 保存文案 / 新建文案           │ - 职位 / 文案                  │
│ - 已保存文案列表                │ - 下次执行                     │
└───────────────────────────────┴──────────────────────────────┘
```

## 4. UI 细节

### 顶部栏

- 标题：`本地招聘打招呼工具`
- 浏览器状态：`已连接浏览器` / `未连接` / `需要登录` / `已暂停`
- 今日发送计数：`今日 12/20`
- 设置按钮：后期可做，第一版可以只显示图标。

### 左侧：职位与筛选

字段：

- 当前职位：下拉框，例如 `奶茶店店员（上海）`
- 城市：输入框或下拉框
- 关键词：输入框，例如 `奶茶 店员 服务员`
- 活跃时间：下拉框，例如 `近 3 天活跃`
- 性别：下拉框，支持不限、男、女
- 年龄范围：两个数字输入，支持只填写下限或上限
- 薪资范围：两个数字输入
- 跳过已联系：checkbox，默认开启

按钮：

- `筛选候选人`

筛选结果：

- `找到 38`
- `可发送 25`
- `已跳过 13`

### 左侧：固定文案

字段：

- 文案模板：下拉框
- 文案编辑框
- 保存文案按钮
- 新建文案按钮
- 已保存模板列表

文案支持变量，但第一版只做简单替换：

```text
{职位}
{城市}
```

示例文案：

```text
你好，我们这边正在招聘{职位}，看到你的求职意向比较匹配，想和你简单沟通一下，可以吗？
```

### 右侧：发送控制

字段：

- 发送模式：
  - `手动逐个发送`
  - `批量按上限发送`
- 每日上限：默认 `20`
- 随机间隔：默认 `45-90 秒`

按钮：

- `开始发送`
- `暂停`

安全提示：

```text
验证码、登录失效、页面异常时自动暂停。
```

重要：不要提供“无限制发送”按钮。

### 右侧：发送记录

表格列：

- 时间
- 候选人
- 职位
- 文案
- 状态

状态：

- `已发送`
- `已跳过`
- `失败`
- `暂停`

### 右侧：每日定时

字段：

- 开启定时：toggle
- 执行时间：例如 `09:30`
- 适用职位
- 使用文案
- 模式：
  - 安全模式：只筛选并生成待发送队列
  - 自动模式：按每日上限发送，异常时暂停

建议第一版默认使用安全模式。

## 5. UI 风格与式样（第 3 版：紧凑操作面板）

本项目采用上面第 3 版样式：`Compact Operator Panel`。它不是营销页，也不是复杂后台系统，而是一个每天打开就能用的本地自动化控制面板。

### 设计定位

- 关键词：简单、克制、可靠、可控。
- 使用场景：招聘者每天打开一次，选择职位，确认文案，按上限执行，查看记录。
- 信息层级：先看到连接状态和今日额度，再看到筛选、文案、发送、记录和定时。
- 风格基调：轻量内部工具，不做大面积品牌色、插画、欢迎页、仪表盘装饰。
- 安全感优先：每日上限、跳过已联系、异常暂停、手动/批量模式必须始终清楚可见。

### 页面布局

桌面端优先，目标视口为 `1440 x 1024`。

整体结构：

```text
顶部状态栏
└── 左右两栏主工作区
    ├── 左栏：职位与筛选 + 固定文案
    └── 右栏：发送控制 + 发送记录 + 每日定时
```

尺寸建议：

- 页面外边距：`24px`
- 主区列间距：`18px`
- 左栏宽度：约 `42%`，最小 `360px`
- 右栏宽度：剩余空间
- 面板内边距：`18px`
- 区块标题到内容间距：`14px`
- 表单项间距：`12px`
- 按钮组间距：`10px`

布局规则：

- 不要做左侧导航栏。
- 不要做多页面路由。
- 不要把候选人详情做成大面板。
- 不要做看板列、聊天式审稿区或 AI 生成区。
- 所有核心功能应在一个页面完成。

### 视觉系统

推荐色值：

```css
:root {
  --page-bg: #f4f6f5;
  --panel-bg: #ffffff;
  --text: #17211d;
  --muted-text: #60716a;
  --label-text: #53645d;
  --border: #dce4e0;
  --input-border: #cad6d1;
  --primary: #16815f;
  --primary-muted: #e9f5f0;
  --primary-text: #11694d;
  --warning-bg: #fff8e4;
  --warning-border: #f1d58a;
  --warning-text: #755800;
}
```

字体：

- 字体族：`Inter, "Microsoft YaHei", system-ui, sans-serif`
- 页面标题：`22px`, `600`
- 区块标题：`16px`, `600`
- 表单、按钮、表格正文：`14px`
- 辅助说明：`13px-14px`
- 行高：正文建议 `1.45`，文案编辑框建议 `1.6`

边框与圆角：

- 面板圆角：`8px`
- 输入框、按钮圆角：`6px`
- 标签 chip 圆角可用 `999px`
- 面板使用 `1px solid #dce4e0`
- 不使用明显投影，最多使用极轻微 hover 背景。

### 组件式样

顶部状态栏：

- 左侧显示产品名和一句短说明。
- 右侧显示浏览器连接状态、今日发送额度、设置图标。
- 状态不放在大卡片里，使用水平排列即可。

左侧面板：

- 上半部分为 `职位与筛选`。
- 下半部分为 `固定文案`。
- 两个区块之间用自然留白或细分隔线，不要再嵌套卡片。
- `筛选候选人` 是左侧唯一主按钮，使用绿色主按钮样式。
- 筛选结果使用三个轻量 chip：`找到 38`、`可发送 25`、`已跳过 13`。

右侧面板：

- 顶部为 `发送控制`。
- 中部为 `发送记录` 表格。
- 底部为 `每日定时`。
- `开始发送` 使用绿色主按钮。
- `暂停` 使用白底描边按钮。
- 安全提示使用浅黄色提示条，不能用红色警告占满视觉重心。

输入控件：

- 输入框、下拉框、textarea 高度保持统一，默认高度约 `40px`。
- textarea 高度建议 `128px-160px`，允许纵向 resize。
- checkbox 文案必须可点击，间距保持 `8px`。
- 每日上限和随机间隔并排显示。

分段控制：

用于发送模式：

```text
手动逐个发送 | 批量按上限发送
```

式样：

- 外层浅边框容器。
- 当前选中项使用 `--primary-muted` 背景。
- 不使用复杂 tab 或胶囊式大按钮。

表格：

- 表头使用灰绿色文字，字重 `600`。
- 行间只用底部分隔线。
- 不使用斑马纹。
- 记录较少时仍保持表格结构，不改成卡片列表。

### 状态与交互

必须实现并可见的状态：

- 浏览器状态：`已连接浏览器`、`未连接`、`需要登录`、`已暂停`
- 筛选状态：`未筛选`、`筛选中`、`筛选完成`、`筛选失败`
- 发送状态：`空闲`、`发送中`、`已暂停`、`已完成`、`失败`
- 定时状态：`未开启`、`已开启`、`下次执行 明天 09:30`

按钮状态：

- `开始发送`：没有可发送候选人或没有文案时 disabled。
- `暂停`：只有发送中才 enabled。
- `保存文案`：文案为空时 disabled。
- `筛选候选人`：筛选中显示 loading 状态，避免重复点击。

安全交互：

- 遇到验证码、登录失效、页面异常时，工具必须自动暂停。
- 暂停原因应显示在黄色提示条或顶部状态中。
- 批量发送也必须受每日上限限制。
- 已联系候选人默认跳过，除非用户明确关闭 `跳过已联系`。

### 响应式要求

第一版以桌面为主，但要保证窄屏不崩：

- 大于 `1000px`：左右两栏。
- 小于 `1000px`：上下单栏，左栏在上，右栏在下。
- 小于 `720px`：每日上限和随机间隔从两列变一列。
- 所有按钮文字不能被截断。
- 表格在窄屏可横向滚动，不要压缩到文字重叠。

### 不要做的 UI

- 不要做登录页、营销首页、欢迎页。
- 不要使用大渐变背景、装饰图形、插画、气泡、复杂阴影。
- 不要使用深色大屏风格。
- 不要把每条发送记录做成独立卡片。
- 不要把卡片放进卡片。
- 不要在界面里写长篇说明或教程。
- 不要出现“无限批量发送”“绕过验证码”“自动登录”等文案。

### Codex CLI 实现提示

如果先做静态 UI，可以直接以 `web/App.tsx` 和 `web/styles.css` 的代码骨架为起点。实现时优先还原这些视觉特征：

1. 浅灰页面背景 + 白色双栏面板。
2. 左栏 `42%`，右栏自适应。
3. 绿色只用于主动作和选中态。
4. 黄色只用于安全暂停提示。
5. 表单密度适中，一屏能看完主要功能。
6. 不做任何与第 3 版不一致的复杂导航和候选人详情页。

## 6. 数据库设计

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT,
  keywords TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  active_within TEXT,
  gender TEXT,
  age_min INTEGER,
  age_max INTEGER,
  exclude_contacted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_key TEXT NOT NULL UNIQUE,
  display_name TEXT,
  job_id INTEGER,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS send_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_key TEXT NOT NULL,
  candidate_name TEXT,
  job_id INTEGER,
  template_id INTEGER,
  message_body TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  sent_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (template_id) REFERENCES templates(id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enabled INTEGER NOT NULL DEFAULT 0,
  run_time TEXT NOT NULL DEFAULT '09:30',
  job_id INTEGER,
  template_id INTEGER,
  mode TEXT NOT NULL DEFAULT 'safe',
  daily_cap INTEGER NOT NULL DEFAULT 20,
  interval_min_seconds INTEGER NOT NULL DEFAULT 45,
  interval_max_seconds INTEGER NOT NULL DEFAULT 90,
  updated_at TEXT NOT NULL
);
```

## 7. API 设计

```text
GET  /api/state
GET  /api/jobs
POST /api/jobs
PUT  /api/jobs/:id

GET  /api/templates
POST /api/templates
PUT  /api/templates/:id

POST /api/filter/run
POST /api/send/start
POST /api/send/pause
POST /api/send/manual

GET  /api/logs
GET  /api/schedule
PUT  /api/schedule

GET  /api/events
```

`/api/events` 使用 Server-Sent Events，把筛选进度、发送进度、暂停原因推送给前端。

## 8. 项目结构

```text
recruitment-outreach-tool/
  package.json
  tsconfig.json
  vite.config.ts
  data/
    app.sqlite
    chrome-profile/
  src/
    server/
      index.ts
      db.ts
      scheduler.ts
      automation/
        browser-controller.ts
        site-adapter.ts
        boss-adapter.ts
      routes/
        state.ts
        jobs.ts
        templates.ts
        filter.ts
        send.ts
        logs.ts
        schedule.ts
    web/
      main.tsx
      App.tsx
      api.ts
      styles.css
      components/
        Header.tsx
        JobFilterPanel.tsx
        TemplatePanel.tsx
        SendControlPanel.tsx
        SendLogTable.tsx
        SchedulePanel.tsx
```

## 9. 关键代码骨架

### package.json

```json
{
  "scripts": {
    "dev": "tsx src/server/index.ts",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "better-sqlite3": "latest",
    "express": "latest",
    "lucide-react": "latest",
    "node-cron": "latest",
    "playwright": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vite": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@types/express": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest"
  }
}
```

### server/index.ts

```ts
import express from "express";
import path from "node:path";
import { initDb } from "./db";
import { createScheduler } from "./scheduler";
import { createSendRouter } from "./routes/send";
import { createFilterRouter } from "./routes/filter";

const app = express();
const port = Number(process.env.PORT || 3000);

const db = initDb();
const scheduler = createScheduler({ db });

app.use(express.json());

app.use("/api/filter", createFilterRouter({ db }));
app.use("/api/send", createSendRouter({ db }));

app.get("/api/state", (_req, res) => {
  const todayCount = db
    .prepare("SELECT COUNT(*) as count FROM send_logs WHERE status = 'sent' AND date(sent_at) = date('now')")
    .get() as { count: number };

  res.json({
    browserStatus: "unknown",
    todaySent: todayCount.count,
    dailyCap: 20,
    schedulerEnabled: scheduler.isEnabled()
  });
});

app.use(express.static(path.resolve("dist")));

app.listen(port, () => {
  console.log(`Local recruitment tool running at http://localhost:${port}`);
});
```

### server/db.ts

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function initDb() {
  fs.mkdirSync("data", { recursive: true });
  const db = new Database(path.resolve("data/app.sqlite"));

  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS send_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_key TEXT NOT NULL,
      candidate_name TEXT,
      job_id INTEGER,
      template_id INTEGER,
      message_body TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      sent_at TEXT NOT NULL
    );
  `);

  return db;
}
```

### automation/site-adapter.ts

```ts
export type Candidate = {
  externalKey: string;
  displayName?: string;
  sourceUrl?: string;
};

export type FilterInput = {
  jobName: string;
  city?: string;
  keywords?: string;
  activeWithin?: string;
  salaryMin?: number;
  salaryMax?: number;
  gender?: "男" | "女";
  ageMin?: number;
  ageMax?: number;
  excludeContacted: boolean;
};

export interface SiteAdapter {
  ensureLoggedIn(): Promise<boolean>;
  runFilter(input: FilterInput): Promise<Candidate[]>;
  sendGreeting(candidate: Candidate, message: string): Promise<void>;
  detectBlockingState(): Promise<"ok" | "captcha" | "login_required" | "page_error">;
}
```

### automation/browser-controller.ts

```ts
import { chromium, BrowserContext, Page } from "playwright";
import path from "node:path";

let context: BrowserContext | null = null;
let page: Page | null = null;

export async function getControlledPage() {
  if (!context) {
    context = await chromium.launchPersistentContext(
      path.resolve("data/chrome-profile"),
      {
        channel: "chrome",
        headless: false,
        viewport: { width: 1440, height: 1000 }
      }
    );
    page = context.pages()[0] ?? await context.newPage();
  }

  if (!page) page = await context.newPage();
  return page;
}
```

### automation/boss-adapter.ts

```ts
import { getControlledPage } from "./browser-controller";
import type { Candidate, FilterInput, SiteAdapter } from "./site-adapter";

export class BossAdapter implements SiteAdapter {
  async ensureLoggedIn() {
    const page = await getControlledPage();
    await page.goto("https://www.zhipin.com/", { waitUntil: "domcontentloaded" });
    return !page.url().includes("login");
  }

  async detectBlockingState() {
    const page = await getControlledPage();
    const body = await page.locator("body").innerText().catch(() => "");
    if (body.includes("验证码")) return "captcha";
    if (body.includes("登录") && body.includes("密码")) return "login_required";
    return "ok";
  }

  async runFilter(input: FilterInput): Promise<Candidate[]> {
    const page = await getControlledPage();

    // 第一版建议让用户先手动进入招聘搜索/推荐页面。
    // 这里读取当前页面可见候选人卡片。具体 selector 需要开发时根据页面实际 DOM 调整。
    const blocking = await this.detectBlockingState();
    if (blocking !== "ok") throw new Error(`blocked:${blocking}`);

    const cards = page.locator("[data-candidate-card], .candidate-card, .geek-card");
    const count = await cards.count().catch(() => 0);
    const result: Candidate[] = [];

    for (let i = 0; i < Math.min(count, 100); i++) {
      const card = cards.nth(i);
      const text = await card.innerText().catch(() => "");
      const key = await card.getAttribute("data-id").catch(() => null);
      if (!text) continue;
      result.push({
        externalKey: key || `${input.jobName}:${i}:${text.slice(0, 24)}`,
        displayName: text.split("\n")[0],
        sourceUrl: page.url()
      });
    }

    return result;
  }

  async sendGreeting(candidate: Candidate, message: string) {
    const page = await getControlledPage();
    const blocking = await this.detectBlockingState();
    if (blocking !== "ok") throw new Error(`blocked:${blocking}`);

    // selector 需要根据实际页面调整。
    await page.getByText(candidate.displayName || "").first().click();
    await page.locator("textarea, [contenteditable='true']").last().fill(message);
    await page.getByText("发送").last().click();
  }
}
```

### routes/send.ts

```ts
import express from "express";
import type Database from "better-sqlite3";
import { BossAdapter } from "../automation/boss-adapter";

export function createSendRouter({ db }: { db: Database.Database }) {
  const router = express.Router();
  const adapter = new BossAdapter();
  let paused = false;

  router.post("/pause", (_req, res) => {
    paused = true;
    res.json({ ok: true });
  });

  router.post("/start", async (req, res) => {
    paused = false;
    const { candidates, messageBody, templateId, jobId, dailyCap = 20 } = req.body;

    const today = db
      .prepare("SELECT COUNT(*) as count FROM send_logs WHERE status = 'sent' AND date(sent_at) = date('now')")
      .get() as { count: number };

    const remaining = Math.max(0, dailyCap - today.count);
    const queue = candidates.slice(0, remaining);

    for (const candidate of queue) {
      if (paused) break;

      const duplicate = db
        .prepare("SELECT id FROM send_logs WHERE candidate_key = ? AND status = 'sent' LIMIT 1")
        .get(candidate.externalKey);

      if (duplicate) continue;

      try {
        await adapter.sendGreeting(candidate, messageBody);
        db.prepare(`
          INSERT INTO send_logs
          (candidate_key, candidate_name, job_id, template_id, message_body, status, sent_at)
          VALUES (?, ?, ?, ?, ?, 'sent', ?)
        `).run(candidate.externalKey, candidate.displayName, jobId, templateId, messageBody, new Date().toISOString());
      } catch (error) {
        paused = true;
        db.prepare(`
          INSERT INTO send_logs
          (candidate_key, candidate_name, job_id, template_id, message_body, status, error_message, sent_at)
          VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)
        `).run(
          candidate.externalKey,
          candidate.displayName,
          jobId,
          templateId,
          messageBody,
          error instanceof Error ? error.message : String(error),
          new Date().toISOString()
        );
        break;
      }

      const waitMs = 45000 + Math.floor(Math.random() * 45000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    res.json({ ok: true, paused });
  });

  return router;
}
```

### web/App.tsx

```tsx
import { useState } from "react";
import { Play, Pause, Save, Clock } from "lucide-react";
import "./styles.css";

export function App() {
  const [message, setMessage] = useState(
    "你好，我们这边正在招聘{职位}，看到你的求职意向比较匹配，想和你简单沟通一下，可以吗？"
  );

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>本地招聘打招呼工具</h1>
          <p>固定文案、按上限发送、自动记录</p>
        </div>
        <div className="status">
          <span>已连接浏览器</span>
          <strong>今日 12/20</strong>
        </div>
      </header>

      <section className="grid">
        <aside className="panel">
          <h2>职位与筛选</h2>
          <label>当前职位<select><option>奶茶店店员（上海）</option></select></label>
          <label>城市<input defaultValue="上海" /></label>
          <label>关键词<input defaultValue="奶茶 店员 服务员" /></label>
          <label>活跃时间<select><option>近 3 天活跃</option></select></label>
          <label>薪资范围<input defaultValue="5000-8000" /></label>
          <label className="check"><input type="checkbox" defaultChecked /> 跳过已联系</label>
          <button className="primary">筛选候选人</button>

          <div className="chips">
            <span>找到 38</span>
            <span>可发送 25</span>
            <span>已跳过 13</span>
          </div>

          <h2>固定文案</h2>
          <label>文案模板<select><option>默认打招呼文案</option></select></label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
          <div className="actions">
            <button><Save size={16} />保存文案</button>
            <button>新建文案</button>
          </div>
        </aside>

        <section className="panel">
          <h2>发送控制</h2>
          <div className="segmented">
            <button className="active">手动逐个发送</button>
            <button>批量按上限发送</button>
          </div>
          <div className="twocol">
            <label>每日上限<input type="number" defaultValue={20} /></label>
            <label>随机间隔<input defaultValue="45-90 秒" /></label>
          </div>
          <div className="warning">验证码、登录失效、页面异常时自动暂停。</div>
          <div className="actions">
            <button className="primary"><Play size={16} />开始发送</button>
            <button><Pause size={16} />暂停</button>
          </div>

          <h2>发送记录</h2>
          <table>
            <thead>
              <tr><th>时间</th><th>候选人</th><th>职位</th><th>文案</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr><td>09:42</td><td>候选人A</td><td>店员</td><td>默认文案</td><td>已发送</td></tr>
              <tr><td>09:39</td><td>候选人B</td><td>店员</td><td>默认文案</td><td>已跳过</td></tr>
            </tbody>
          </table>

          <h2>每日定时</h2>
          <div className="schedule">
            <label className="check"><input type="checkbox" defaultChecked /> 每天定时执行</label>
            <label><Clock size={16} />执行时间<input defaultValue="09:30" /></label>
            <p>下次执行：明天 09:30，安全模式</p>
          </div>
        </section>
      </section>
    </main>
  );
}
```

### web/styles.css

```css
:root {
  font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
  color: #17211d;
  background: #f4f6f5;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.app {
  min-height: 100vh;
  padding: 24px;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}

h1 {
  margin: 0;
  font-size: 22px;
}

h2 {
  margin: 0 0 14px;
  font-size: 16px;
}

p {
  margin: 4px 0 0;
  color: #60716a;
  font-size: 14px;
}

.status {
  display: flex;
  gap: 14px;
  align-items: center;
  font-size: 14px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(360px, 42%) 1fr;
  gap: 18px;
}

.panel {
  background: #fff;
  border: 1px solid #dce4e0;
  border-radius: 8px;
  padding: 18px;
}

label {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
  color: #53645d;
  font-size: 14px;
}

input,
select,
textarea,
button {
  font: inherit;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid #cad6d1;
  border-radius: 6px;
  padding: 10px 11px;
  background: #fff;
  color: #17211d;
}

textarea {
  min-height: 128px;
  resize: vertical;
  line-height: 1.6;
}

button {
  border: 1px solid #c9d6d1;
  border-radius: 6px;
  background: #fff;
  padding: 10px 13px;
  cursor: pointer;
}

.primary {
  border-color: #16815f;
  background: #16815f;
  color: #fff;
}

.actions {
  display: flex;
  gap: 10px;
  margin: 12px 0 20px;
}

.actions button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
}

.check input {
  width: auto;
}

.chips {
  display: flex;
  gap: 8px;
  margin: 14px 0 22px;
}

.chips span {
  border: 1px solid #dce4e0;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 13px;
  color: #53645d;
}

.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px;
  border: 1px solid #dce4e0;
  border-radius: 8px;
  margin-bottom: 14px;
}

.segmented button {
  border: 0;
}

.segmented .active {
  background: #e9f5f0;
  color: #11694d;
}

.twocol {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.warning {
  margin: 10px 0 14px;
  border: 1px solid #f1d58a;
  background: #fff8e4;
  border-radius: 6px;
  padding: 10px 12px;
  color: #755800;
  font-size: 14px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 22px;
  font-size: 14px;
}

th,
td {
  border-bottom: 1px solid #e5ece8;
  padding: 10px 8px;
  text-align: left;
}

th {
  color: #60716a;
  font-weight: 600;
}

.schedule {
  border-top: 1px solid #e5ece8;
  padding-top: 14px;
}
```

## 10. 自动化流程

### 筛选流程

1. 用户在工具里选择职位和筛选条件。
2. 点击 `筛选候选人`。
3. 后端打开或复用受控 Chrome。
4. 如果未登录，前端显示 `需要登录`，用户手动登录后重试。
5. 如果出现验证码，立即暂停，不尝试绕过。
6. 从当前招聘页面读取可见候选人卡片。
7. 根据本地发送记录去重。
8. 返回找到数量、可发送数量、已跳过数量。

### 发送流程

1. 用户在已登录的 BOSS 推荐页点击扩展中的 `开始批量打招呼`。
2. 扩展读取招聘助手中保存的默认职位和筛选条件。
3. 扩展在 BOSS 推荐列表 frame 中应用全部条件，并等待候选列表刷新。
4. 任一已保存条件无法确认时停止启动，不点击候选人卡片。
5. 筛选成功后创建新批次，从刷新后的列表顶部开始处理。
6. 已显示 `继续沟通` 的候选人直接跳过。
7. 对可处理候选人点击 `打招呼`，并确认按钮状态发生变化。
8. 批量模式使用随机间隔，并按目标数量停止。
9. 遇到验证码、登录失效、页面异常，立即暂停。

### 定时流程

1. `node-cron` 每分钟检查是否到达定时时间。
2. 到达后读取 schedule 设置。
3. 安全模式：只筛选并保存待发送队列。
4. 自动模式：按每日上限发送。
5. 任意异常都进入暂停状态，并写入日志。

## 11. 给 Codex CLI 的开发提示词

可以把下面这段作为 Codex CLI 的任务输入：

```text
请根据 outputs/recruitment_outreach_tool_mvp_spec.md 开发一个本地招聘打招呼工具 MVP。

要求：
1. 使用 React + Vite + TypeScript 做前端，Node.js + Express + TypeScript 做后端。
2. 使用 Playwright 控制本地 Chrome，使用独立 data/chrome-profile profile，不保存账号密码。
3. 使用 SQLite 保存职位、文案模板、候选人、发送记录、定时配置。
4. UI 按文档第 5 节“第 3 版：紧凑操作面板”实现：左侧职位筛选和固定文案，右侧发送控制、发送记录、每日定时。
5. 第一版不需要 AI 文案生成，不需要复杂候选人详情。
6. 必须有每日发送上限、去重、暂停、登录/验证码/页面异常自动暂停。
7. 不要绕过验证码，不要绕过登录，不要做无限批量发送。
8. BOSS 页面 selector 先做成 adapter 层，允许后续根据实际页面 DOM 调整。
9. 实现 npm run dev 启动，打开 http://localhost:3000 可用。
10. UI 不要做登录页、营销页、复杂导航、候选人详情页、AI 文案页或看板页；优先还原浅灰背景、白色双栏面板、绿色主动作、黄色安全提示条。
11. 完成后运行 typecheck，并说明还有哪些 selector 需要在真实页面上校准。
```
