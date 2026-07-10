import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTemplate,
  getCandidates,
  getExtensionFilterDiagnostics,
  getGreetingBatch,
  getGreetingTest,
  getJobs,
  getRecommendQueue,
  getSchedule,
  getTemplates,
  inspectSelectors,
  updateJob,
  updateSchedule,
  updateTemplate,
  type Candidate,
  type ExtensionFilterDiagnosticsReport,
  type FilterResult,
  type GreetingBatchState,
  type GreetingTestReport,
  type Job,
  type RecommendQueueReport,
  type Schedule,
  type SelectorDiagnostics,
  type Template
} from "./api";
import { BatchOverviewPanel } from "./components/BatchOverviewPanel";
import { CandidateActivityPanel } from "./components/CandidateActivityPanel";
import { Header } from "./components/Header";
import { JobFilterPanel } from "./components/JobFilterPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";

type WorkspaceView = "filters" | "batch" | "candidates";

export function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [selectorDiagnostics, setSelectorDiagnostics] = useState<SelectorDiagnostics | null>(null);
  const [extensionFilterDiagnostics, setExtensionFilterDiagnostics] = useState<ExtensionFilterDiagnosticsReport | null>(null);
  const [recommendQueue, setRecommendQueue] = useState<RecommendQueueReport | null>(null);
  const [greetingTest, setGreetingTest] = useState<GreetingTestReport | null>(null);
  const [greetingBatch, setGreetingBatch] = useState<GreetingBatchState | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [diagnosingSelectors, setDiagnosingSelectors] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileView, setMobileView] = useState<WorkspaceView>("batch");
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null,
    [selectedTemplateId, templates]
  );
  const batchCandidates = greetingBatch?.candidates || [];
  const pendingBatchCandidates = batchCandidates.filter((candidate) => candidate.status === "pending").length;

  const load = useCallback(async () => {
    const [
      nextJobs,
      nextTemplates,
      nextSchedule,
      nextExtensionDiagnostics,
      nextRecommendQueue,
      nextGreetingTest,
      nextGreetingBatch
    ] = await Promise.all([
      getJobs(),
      getTemplates(),
      getSchedule(),
      getExtensionFilterDiagnostics(),
      getRecommendQueue(),
      getGreetingTest(),
      getGreetingBatch()
    ]);

    const activeJob = nextJobs[0] ?? null;
    const nextCandidates = activeJob ? await getCandidates(activeJob.id) : [];

    setJobs(nextJobs);
    setJob(activeJob);
    setTemplates(nextTemplates);
    setSelectedTemplateId(nextTemplates[0]?.id ?? null);
    setSchedule(nextSchedule);
    setExtensionFilterDiagnostics(nextExtensionDiagnostics);
    setRecommendQueue(nextRecommendQueue);
    setGreetingTest(nextGreetingTest);
    setGreetingBatch(nextGreetingBatch);
    setCandidates(nextCandidates);
  }, []);

  useEffect(() => {
    void load().catch((loadError: unknown) => setError(toMessage(loadError)));
  }, [load]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("filter-result", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as { payload: FilterResult };
      setCandidates(parsed.payload.candidates);
    });
    source.addEventListener("extension-filter-diagnostics", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as { payload: ExtensionFilterDiagnosticsReport };
      setExtensionFilterDiagnostics(parsed.payload);
    });
    source.addEventListener("recommend-queue", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as { payload: RecommendQueueReport };
      setRecommendQueue(parsed.payload);
    });
    source.addEventListener("greeting-test", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as { payload: GreetingTestReport };
      setGreetingTest(parsed.payload);
    });
    source.addEventListener("greeting-batch", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as { payload: GreetingBatchState };
      setGreetingBatch(parsed.payload);
    });
    return () => source.close();
  }, []);

  async function handleSaveJob() {
    if (!job) return;
    setError(null);
    setSavingJob(true);
    try {
      const savedJob = await updateJob(job);
      setJob(savedJob);
      setJobs((current) => current.map((item) => item.id === savedJob.id ? savedJob : item));
    } finally {
      setSavingJob(false);
    }
  }

  async function handleInspectSelectors() {
    setError(null);
    setDiagnosingSelectors(true);
    try {
      setSelectorDiagnostics(await inspectSelectors());
    } finally {
      setDiagnosingSelectors(false);
    }
  }

  async function handleSaveTemplate() {
    if (!selectedTemplate) return;
    setError(null);
    const saved = await updateTemplate(selectedTemplate);
    setTemplates((current) => current.map((template) => template.id === saved.id ? saved : template));
  }

  async function handleCreateTemplate() {
    setError(null);
    const created = await createTemplate({
      name: "新文案 " + (templates.length + 1),
      body: "你好，我们这边正在招聘{职位}，想和你简单沟通一下，可以吗？"
    });
    setTemplates((current) => [...current, created]);
    setSelectedTemplateId(created.id);
  }

  async function handleSaveSchedule() {
    if (!schedule) return;
    setError(null);
    setSchedule(await updateSchedule(schedule));
  }

  if (!job) {
    return <main className="appShell"><div className="loading">正在初始化...</div></main>;
  }

  return (
    <main className="appShell">
      <Header batch={greetingBatch} onSettings={() => setSettingsOpen(true)} />
      {error ? <div className="errorBar">{error}</div> : null}

      <nav className="workspaceTabs" aria-label="工作台视图">
        <button type="button" className={mobileView === "filters" ? "active" : ""} onClick={() => setMobileView("filters")}>筛选</button>
        <button type="button" className={mobileView === "batch" ? "active" : ""} onClick={() => setMobileView("batch")}>批量</button>
        <button type="button" className={mobileView === "candidates" ? "active" : ""} onClick={() => setMobileView("candidates")}>候选人</button>
      </nav>

      <section className="workspace">
        <aside className={workspacePanelClass("filters", mobileView)}>
          <JobFilterPanel
            job={job}
            saving={savingJob}
            candidateCount={batchCandidates.length}
            onChange={setJob}
            onSave={() => void handleSaveJob().catch((saveError: unknown) => setError(toMessage(saveError)))}
          />
          <div className="sourceSummary">
            <div><span>本批次</span><strong>{batchCandidates.length}</strong></div>
            <div><span>待处理</span><strong>{pendingBatchCandidates}</strong></div>
            <div><span>历史</span><strong>{candidates.length}</strong></div>
          </div>
        </aside>

        <article className={workspacePanelClass("batch", mobileView)}>
          <BatchOverviewPanel batch={greetingBatch} />
        </article>

        <aside className={workspacePanelClass("candidates", mobileView)}>
          <CandidateActivityPanel candidates={candidates} batch={greetingBatch} />
        </aside>
      </section>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        jobs={jobs}
        templates={templates}
        selectedTemplate={selectedTemplate}
        schedule={schedule}
        diagnostics={selectorDiagnostics}
        extensionDiagnostics={extensionFilterDiagnostics}
        recommendQueue={recommendQueue}
        greetingTest={greetingTest}
        diagnosing={diagnosingSelectors}
        onTemplateSelect={setSelectedTemplateId}
        onTemplateChange={(template) => setTemplates((current) => current.map((item) => item.id === template.id ? template : item))}
        onTemplateSave={() => void handleSaveTemplate().catch((saveError: unknown) => setError(toMessage(saveError)))}
        onTemplateCreate={() => void handleCreateTemplate().catch((createError: unknown) => setError(toMessage(createError)))}
        onScheduleChange={setSchedule}
        onScheduleSave={() => void handleSaveSchedule().catch((scheduleError: unknown) => setError(toMessage(scheduleError)))}
        onInspectSelectors={() => void handleInspectSelectors().catch((diagnosticError: unknown) => setError(toMessage(diagnosticError)))}
      />
    </main>
  );
}

function workspacePanelClass(view: WorkspaceView, active: WorkspaceView) {
  return "workspacePanel workspace-" + view + (view === active ? " activeMobile" : "");
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
