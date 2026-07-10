import { useEffect, useState } from "react";
import { Bug, CalendarClock, FileText, X } from "lucide-react";
import type {
  ExtensionFilterDiagnosticsReport,
  GreetingTestReport,
  Job,
  RecommendQueueReport,
  Schedule,
  SelectorDiagnostics,
  Template
} from "../api";
import { SchedulePanel } from "./SchedulePanel";
import { TemplatePanel } from "./TemplatePanel";

type Props = {
  open: boolean;
  onClose: () => void;
  jobs: Job[];
  templates: Template[];
  selectedTemplate: Template | null;
  schedule: Schedule | null;
  diagnostics: SelectorDiagnostics | null;
  extensionDiagnostics: ExtensionFilterDiagnosticsReport | null;
  recommendQueue: RecommendQueueReport | null;
  greetingTest: GreetingTestReport | null;
  diagnosing: boolean;
  onTemplateSelect: (id: number) => void;
  onTemplateChange: (template: Template) => void;
  onTemplateSave: () => void;
  onTemplateCreate: () => void;
  onScheduleChange: (schedule: Schedule) => void;
  onScheduleSave: () => void;
  onInspectSelectors: () => void;
};

export function SettingsDrawer(props: Props) {
  const [tab, setTab] = useState<"templates" | "schedule" | "diagnostics">("diagnostics");

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div className="drawerOverlay" role="presentation" onMouseDown={props.onClose}>
      <aside className="settingsDrawer" role="dialog" aria-modal="true" aria-label="设置与诊断" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawerHeader">
          <div><span className="eyebrow">辅助配置</span><h2>设置与诊断</h2></div>
          <button className="iconButton" type="button" onClick={props.onClose} title="关闭" aria-label="关闭"><X size={18} /></button>
        </header>
        <nav className="drawerTabs">
          <button className={tab === "diagnostics" ? "active" : ""} type="button" onClick={() => setTab("diagnostics")}><Bug size={15} />诊断</button>
          <button className={tab === "templates" ? "active" : ""} type="button" onClick={() => setTab("templates")}><FileText size={15} />模板</button>
          <button className={tab === "schedule" ? "active" : ""} type="button" onClick={() => setTab("schedule")}><CalendarClock size={15} />计划</button>
        </nav>
        <div className="drawerBody">
          {tab === "diagnostics" ? (
            <DiagnosticsView
              diagnostics={props.diagnostics}
              extensionDiagnostics={props.extensionDiagnostics}
              recommendQueue={props.recommendQueue}
              greetingTest={props.greetingTest}
              diagnosing={props.diagnosing}
              onInspect={props.onInspectSelectors}
            />
          ) : null}
          {tab === "templates" && props.selectedTemplate ? (
            <TemplatePanel
              templates={props.templates}
              selectedTemplate={props.selectedTemplate}
              onSelect={props.onTemplateSelect}
              onChange={props.onTemplateChange}
              onSave={props.onTemplateSave}
              onCreate={props.onTemplateCreate}
            />
          ) : null}
          {tab === "schedule" && props.schedule ? (
            <SchedulePanel
              schedule={props.schedule}
              jobs={props.jobs}
              templates={props.templates}
              onChange={props.onScheduleChange}
              onSave={props.onScheduleSave}
            />
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function DiagnosticsView({
  diagnostics,
  extensionDiagnostics,
  recommendQueue,
  greetingTest,
  diagnosing,
  onInspect
}: {
  diagnostics: SelectorDiagnostics | null;
  extensionDiagnostics: ExtensionFilterDiagnosticsReport | null;
  recommendQueue: RecommendQueueReport | null;
  greetingTest: GreetingTestReport | null;
  diagnosing: boolean;
  onInspect: () => void;
}) {
  const usefulFrames = extensionDiagnostics?.frames.filter((frame) => frame.ok) || [];

  return (
    <section className="drawerSection">
      <div className="diagnosticSummary">
        <div><span>扩展 frame</span><strong>{usefulFrames.length}/{extensionDiagnostics?.frames.length || 0}</strong></div>
        <div><span>推荐队列</span><strong>{recommendQueue?.items.length || 0}</strong></div>
        <div><span>单人测试</span><strong>{greetingTest ? "有记录" : "无"}</strong></div>
      </div>
      <button type="button" disabled={diagnosing} onClick={onInspect}>{diagnosing ? "诊断中" : "运行本地 selector 诊断"}</button>

      <div className="diagnosticGroup">
        <strong>推荐页状态</strong>
        <code>{recommendQueue ? (recommendQueue.framePath || recommendQueue.path || "recommend") + " · 卡片 " + recommendQueue.cardCount : "尚未采集推荐页诊断"}</code>
      </div>

      <div className="diagnosticGroup">
        <strong>扩展筛选 frame</strong>
        {usefulFrames.length === 0 ? <code>暂无有效 frame 诊断</code> : usefulFrames.slice(0, 4).map((frame) => (
          <code key={frame.frameId + "-" + frame.framePath}>
            {(frame.path || frame.framePath || "frame") + " · 控件 " + frame.filterControls.length + " · 卡片命中 " + frame.candidateSelectorHits}
          </code>
        ))}
      </div>

      <div className="diagnosticGroup">
        <strong>本地 selector</strong>
        <code>{diagnostics ? (diagnostics.title || diagnostics.url) + " · 候选卡片方案 " + diagnostics.candidateCards.length : "尚未运行本地诊断"}</code>
      </div>
    </section>
  );
}