export type RuntimeState = {
  browserStatus: "unknown" | "connected" | "not_connected" | "login_required" | "paused";
  filterStatus: "idle" | "filtering" | "completed" | "failed";
  sendStatus: "idle" | "sending" | "paused" | "completed" | "failed";
  scheduleStatus: "disabled" | "enabled";
  pauseReason: string | null;
  lastError: string | null;
  todaySent: number;
  dailyCap: number;
  schedulerEnabled: boolean;
  nextRun: string;
};

export type Job = {
  id: number;
  name: string;
  city: string | null;
  keywords: string | null;
  salary_min: number | null;
  salary_max: number | null;
  active_within: string | null;
  exclude_contacted: number;
};

export type Template = {
  id: number;
  name: string;
  body: string;
  is_default: number;
};

export type Candidate = {
  id: number;
  external_key: string;
  display_name: string | null;
  job_id: number | null;
  source_url: string | null;
  status: string;
  last_seen_at?: string;
};

export type FilterResult = {
  found: number;
  sendable: number;
  skipped: number;
  candidates: Candidate[];
  selectorNote: string;
};

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

export type ExtensionFilterDiagnosticElement = {
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

export type ExtensionFilterFrameDiagnostics = {
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

export type ExtensionFilterDiagnosticsReport = {
  sourceUrl: string;
  title: string;
  capturedAt: string;
  frames: ExtensionFilterFrameDiagnostics[];
};

export type RecommendQueueItem = {
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

export type RecommendQueueReport = {
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
  items: RecommendQueueItem[];
  warnings: string[];
  listFingerprint: {
    signature: string;
    containerCount: number;
    selectorHits: number;
    textLength: number;
    textSample: string;
  };
};

export type GreetingActionResult = {
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

export type GreetingTestReport = {
  sourceUrl: string;
  title: string;
  capturedAt: string;
  item: RecommendQueueItem;
  messagePreview: string;
  clickResult: GreetingActionResult;
  composerResult: GreetingActionResult;
};
export type SendLog = {
  id: number;
  candidate_key: string;
  candidate_name: string | null;
  job_id: number | null;
  template_id: number | null;
  message_body: string;
  status: string;
  error_message: string | null;
  sent_at: string;
  job_name: string | null;
  template_name: string | null;
};

export type Schedule = {
  id: number;
  enabled: number;
  run_time: string;
  job_id: number | null;
  template_id: number | null;
  mode: "safe" | "auto";
  daily_cap: number;
  interval_min_seconds: number;
  interval_max_seconds: number;
};

export async function getState() {
  return request<RuntimeState>("/api/state");
}

export async function getJobs() {
  return request<Job[]>("/api/jobs");
}

export async function updateJob(job: Job) {
  return request<Job>(`/api/jobs/${job.id}`, {
    method: "PUT",
    body: JSON.stringify(job)
  });
}

export async function getTemplates() {
  return request<Template[]>("/api/templates");
}

export async function updateTemplate(template: Template) {
  return request<Template>(`/api/templates/${template.id}`, {
    method: "PUT",
    body: JSON.stringify(template)
  });
}

export async function createTemplate(template: Pick<Template, "name" | "body">) {
  return request<Template>("/api/templates", {
    method: "POST",
    body: JSON.stringify(template)
  });
}

export async function runFilter(jobId: number) {
  return request<FilterResult>("/api/filter/run", {
    method: "POST",
    body: JSON.stringify({ jobId })
  });
}

export async function inspectSelectors() {
  return request<SelectorDiagnostics>("/api/diagnostics/selectors", { method: "POST" });
}
export async function getExtensionFilterDiagnostics() {
  return request<ExtensionFilterDiagnosticsReport | null>("/api/extension/filter-diagnostics");
}

export async function getRecommendQueue() {
  return request<RecommendQueueReport | null>("/api/extension/recommend-queue");
}

export async function getGreetingTest() {
  return request<GreetingTestReport | null>("/api/extension/greeting-test");
}

export async function getCandidates(jobId?: number) {
  const query = jobId ? `?jobId=${encodeURIComponent(String(jobId))}` : "";
  return request<Candidate[]>(`/api/candidates${query}`);
}

export async function startSend(payload: {
  jobId: number;
  templateId: number;
  dailyCap: number;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  candidateIds?: number[];
}) {
  return request<{ ok: boolean; queued: number; reason?: string }>("/api/send/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function pauseSend() {
  return request<{ ok: boolean }>("/api/send/pause", { method: "POST" });
}

export async function getLogs() {
  return request<SendLog[]>("/api/logs");
}

export async function getSchedule() {
  return request<Schedule>("/api/schedule");
}

export async function updateSchedule(schedule: Schedule) {
  return request<Schedule>("/api/schedule", {
    method: "PUT",
    body: JSON.stringify(schedule)
  });
}

export async function openBrowser() {
  return request<{ ok: boolean; loggedIn: boolean }>("/api/browser/open", { method: "POST" });
}

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}
