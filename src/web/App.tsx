import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTemplate,
  getJobs,
  getCandidates,
  getExtensionFilterDiagnostics,
  getGreetingBatch,
  getGreetingTest,
  getLogs,
  getRecommendQueue,
  getSchedule,
  getState,
  getTemplates,
  inspectSelectors,
  openBrowser,
  pauseSend,
  runFilter,
  startSend,
  updateJob,
  updateSchedule,
  updateTemplate,
  type Candidate,
  type FilterResult,
  type GreetingBatchState,
  type GreetingTestReport,
  type ExtensionFilterDiagnosticsReport,
  type Job,
  type RecommendQueueReport,
  type RuntimeState,
  type SelectorDiagnostics,
  type Schedule,
  type SendLog,
  type Template
} from "./api";
import { Header } from "./components/Header";
import { JobFilterPanel } from "./components/JobFilterPanel";
import { SchedulePanel } from "./components/SchedulePanel";
import { SendControlPanel } from "./components/SendControlPanel";
import { SendLogTable } from "./components/SendLogTable";
import { TemplatePanel } from "./components/TemplatePanel";

export function App() {
  const [state, setState] = useState<RuntimeState | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [logs, setLogs] = useState<SendLog[]>([]);
  const [filterResult, setFilterResult] = useState<FilterResult | null>(null);
  const [selectorDiagnostics, setSelectorDiagnostics] = useState<SelectorDiagnostics | null>(null);
  const [extensionFilterDiagnostics, setExtensionFilterDiagnostics] = useState<ExtensionFilterDiagnosticsReport | null>(null);
  const [recommendQueue, setRecommendQueue] = useState<RecommendQueueReport | null>(null);
  const [greetingTest, setGreetingTest] = useState<GreetingTestReport | null>(null);
  const [greetingBatch, setGreetingBatch] = useState<GreetingBatchState | null>(null);
  const [diagnosingSelectors, setDiagnosingSelectors] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0],
    [selectedTemplateId, templates]
  );
  const sendableCandidates = candidates.filter((candidate) => candidate.status === "pending");

  const refreshRuntime = useCallback(async () => {
    const [nextState, nextLogs] = await Promise.all([getState(), getLogs()]);
    setState(nextState);
    setLogs(nextLogs);
  }, []);

  const load = useCallback(async () => {
    const [nextState, nextJobs, nextTemplates, nextSchedule, nextLogs, nextExtensionDiagnostics, nextRecommendQueue, nextGreetingTest, nextGreetingBatch] = await Promise.all([
      getState(),
      getJobs(),
      getTemplates(),
      getSchedule(),
      getLogs(),
      getExtensionFilterDiagnostics(),
      getRecommendQueue(),
      getGreetingTest(),
      getGreetingBatch()
    ]);
    const activeJob = nextJobs[0] ?? null;
    const nextCandidates = activeJob ? await getCandidates(activeJob.id) : [];
    setState(nextState);
    setJobs(nextJobs);
    setJob(activeJob);
    setTemplates(nextTemplates);
    setSelectedTemplateId(nextTemplates[0]?.id ?? null);
    setSchedule(nextSchedule);
    setLogs(nextLogs);
    setExtensionFilterDiagnostics(nextExtensionDiagnostics);
    setRecommendQueue(nextRecommendQueue);
    setGreetingTest(nextGreetingTest);
    setGreetingBatch(nextGreetingBatch);
    setCandidates(nextCandidates);
    if (nextCandidates.length > 0) {
      setFilterResult({
        found: nextCandidates.length,
        sendable: nextCandidates.filter((candidate) => candidate.status === "pending").length,
        skipped: nextCandidates.filter((candidate) => candidate.status === "skipped").length,
        candidates: nextCandidates,
        selectorNote: "候选人来自本地数据库，可能由 Chrome 扩展从已登录页面导入。"
      });
    }
  }, []);

  useEffect(() => {
    void load().catch((loadError: unknown) => setError(toMessage(loadError)));
  }, [load]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    const refresh = () => void refreshRuntime().catch((refreshError: unknown) => setError(toMessage(refreshError)));
    source.addEventListener("state", refresh);
    source.addEventListener("filter", refresh);
    source.addEventListener("send", refresh);
    source.addEventListener("schedule", refresh);
    source.addEventListener("filter-result", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as { payload: FilterResult };
      setFilterResult(parsed.payload);
      setCandidates(parsed.payload.candidates);
      refresh();
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
    source.addEventListener("send-progress", refresh);
    return () => source.close();
  }, [refreshRuntime]);

  async function handleOpenBrowser() {
    setError(null);
    await openBrowser();
    await refreshRuntime();
  }

  async function handleInspectSelectors() {
    setError(null);
    setDiagnosingSelectors(true);
    try {
      const diagnostics = await inspectSelectors();
      setSelectorDiagnostics(diagnostics);
    } finally {
      setDiagnosingSelectors(false);
    }
  }

  async function handleSaveJob() {
    if (!job) return;
    setError(null);
    setSavingJob(true);
    try {
      const savedJob = await updateJob(job);
      setJob(savedJob);
      setJobs((current) => current.map((item) => (item.id === savedJob.id ? savedJob : item)));
    } finally {
      setSavingJob(false);
    }
  }

  async function handleFilter() {
    if (!job) return;
    setError(null);
    setFilterResult(null);
    setCandidates([]);
    const savedJob = await updateJob(job);
    setJob(savedJob);
    setJobs((current) => current.map((item) => (item.id === savedJob.id ? savedJob : item)));
    const result = await runFilter(savedJob.id);
    setFilterResult(result);
    setCandidates(result.candidates);
    await refreshRuntime();
  }

  async function handleSaveTemplate() {
    if (!selectedTemplate) return;
    setError(null);
    const saved = await updateTemplate(selectedTemplate);
    setTemplates((current) => current.map((template) => (template.id === saved.id ? saved : template)));
  }

  async function handleCreateTemplate() {
    setError(null);
    const created = await createTemplate({
      name: `新文案 ${templates.length + 1}`,
      body: "你好，我们这边正在招聘{职位}，想和你简单沟通一下，可以吗？"
    });
    setTemplates((current) => [...current, created]);
    setSelectedTemplateId(created.id);
  }

  async function handleStartSend() {
    if (!job || !selectedTemplate || !schedule) return;
    setError(null);
    await updateSchedule({ ...schedule, job_id: job.id, template_id: selectedTemplate.id });
    await startSend({
      jobId: job.id,
      templateId: selectedTemplate.id,
      dailyCap: schedule.daily_cap,
      intervalMinSeconds: schedule.interval_min_seconds,
      intervalMaxSeconds: schedule.interval_max_seconds,
      candidateIds: sendableCandidates.map((candidate) => candidate.id)
    });
    await refreshRuntime();
  }

  async function handlePauseSend() {
    setError(null);
    await pauseSend();
    await refreshRuntime();
  }

  async function handleSaveSchedule() {
    if (!schedule) return;
    setError(null);
    const saved = await updateSchedule(schedule);
    setSchedule(saved);
    await refreshRuntime();
  }

  if (!job || !selectedTemplate || !schedule) {
    return (
      <main className="app">
        <div className="loading">正在初始化...</div>
      </main>
    );
  }

  return (
    <main className="app">
      <Header state={state} onOpenBrowser={() => void handleOpenBrowser().catch((openError: unknown) => setError(toMessage(openError)))} />
      {error ? <div className="errorBar">{error}</div> : null}
      <section className="grid">
        <aside className="panel">
          <JobFilterPanel
            job={job}
            filterResult={filterResult}
            filtering={state?.filterStatus === "filtering"}
            diagnosing={diagnosingSelectors}
            saving={savingJob}
            diagnostics={selectorDiagnostics}
            extensionDiagnostics={extensionFilterDiagnostics}
            recommendQueue={recommendQueue}
            greetingTest={greetingTest}
            greetingBatch={greetingBatch}
            onChange={setJob}
            onSave={() => void handleSaveJob().catch((saveError: unknown) => setError(toMessage(saveError)))}
            onFilter={() => void handleFilter().catch((filterError: unknown) => setError(toMessage(filterError)))}
            onInspectSelectors={() => void handleInspectSelectors().catch((diagnosticError: unknown) => setError(toMessage(diagnosticError)))}
          />
          <TemplatePanel
            templates={templates}
            selectedTemplate={selectedTemplate}
            onSelect={setSelectedTemplateId}
            onChange={(template) => setTemplates((current) => current.map((item) => (item.id === template.id ? template : item)))}
            onSave={() => void handleSaveTemplate().catch((saveError: unknown) => setError(toMessage(saveError)))}
            onCreate={() => void handleCreateTemplate().catch((createError: unknown) => setError(toMessage(createError)))}
          />
        </aside>

        <section className="panel">
          <SendControlPanel
            state={state}
            schedule={schedule}
            sendableCount={sendableCandidates.length}
            hasTemplateBody={Boolean(selectedTemplate.body.trim())}
            onScheduleChange={setSchedule}
            onStart={() => void handleStartSend().catch((sendError: unknown) => setError(toMessage(sendError)))}
            onPause={() => void handlePauseSend().catch((pauseError: unknown) => setError(toMessage(pauseError)))}
          />
          <SendLogTable logs={logs} />
          <SchedulePanel
            schedule={schedule}
            jobs={jobs}
            templates={templates}
            onChange={setSchedule}
            onSave={() => void handleSaveSchedule().catch((scheduleError: unknown) => setError(toMessage(scheduleError)))}
          />
        </section>
      </section>
    </main>
  );
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

