import { Save, Search } from "lucide-react";
import type { Candidate, ExtensionFilterDiagnosticElement, ExtensionFilterDiagnosticsReport, ExtensionFilterFrameDiagnostics, FilterResult, GreetingBatchState, GreetingTestReport, Job, RecommendQueueReport, SelectorDiagnostics } from "../api";

type Props = {
  job: Job;
  filterResult: FilterResult | null;
  filtering: boolean;
  diagnosing: boolean;
  saving: boolean;
  diagnostics: SelectorDiagnostics | null;
  extensionDiagnostics: ExtensionFilterDiagnosticsReport | null;
  recommendQueue: RecommendQueueReport | null;
  greetingTest: GreetingTestReport | null;
  greetingBatch: GreetingBatchState | null;
  onChange: (job: Job) => void;
  onSave: () => void;
  onFilter: () => void;
  onInspectSelectors: () => void;
};

export function JobFilterPanel({
  job,
  filterResult,
  filtering,
  diagnosing,
  saving,
  diagnostics,
  extensionDiagnostics,
  recommendQueue,
  greetingTest,
  greetingBatch,
  onChange,
  onSave,
  onFilter,
  onInspectSelectors
}: Props) {
  return (
    <section className="sectionBlock">
      <h2>职位与筛选</h2>
      <label>
        当前职位
        <input value={job.name} onChange={(event) => onChange({ ...job, name: event.target.value })} />
      </label>
      <label>
        城市
        <input value={job.city ?? ""} onChange={(event) => onChange({ ...job, city: event.target.value })} />
      </label>
      <label>
        关键词
        <input value={job.keywords ?? ""} onChange={(event) => onChange({ ...job, keywords: event.target.value })} />
      </label>
      <label>
        活跃时间
        <select value={job.active_within ?? "近 3 天活跃"} onChange={(event) => onChange({ ...job, active_within: event.target.value })}>
          <option>近 1 天活跃</option>
          <option>近 3 天活跃</option>
          <option>近 7 天活跃</option>
        </select>
      </label>
      <div className="twocol">
        <label>
          最低薪资
          <input
            type="number"
            value={job.salary_min ?? ""}
            onChange={(event) => onChange({ ...job, salary_min: toNullableNumber(event.target.value) })}
          />
        </label>
        <label>
          最高薪资
          <input
            type="number"
            value={job.salary_max ?? ""}
            onChange={(event) => onChange({ ...job, salary_max: toNullableNumber(event.target.value) })}
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(job.exclude_contacted)}
          onChange={(event) => onChange({ ...job, exclude_contacted: event.target.checked ? 1 : 0 })}
        />
        跳过已联系
      </label>
      <div className="buttonRow">
        <button type="button" disabled={saving || filtering} onClick={onSave}>
          <Save size={16} />
          {saving ? "保存中" : "保存条件"}
        </button>
        <button className="primary" type="button" disabled={filtering} onClick={onFilter}>
          <Search size={16} />
          {filtering ? "筛选中" : "筛选候选人"}
        </button>
        <button type="button" disabled={diagnosing} onClick={onInspectSelectors}>
          {diagnosing ? "诊断中" : "诊断当前页"}
        </button>
      </div>

      <div className="chips">
        <span>找到 {filterResult?.found ?? 0}</span>
        <span>可发送 {filterResult?.sendable ?? 0}</span>
        <span>已跳过 {filterResult?.skipped ?? 0}</span>
      </div>

      {filterResult ? (
        <div className={filterResult.found > 0 ? "filterFeedback success" : "filterFeedback"}>
          {filterResult.found > 0 ? (
            <span>筛选完成，{filterResult.sendable} 个候选人进入待发送队列。</span>
          ) : (
            <span>筛选已执行，但当前页面没有读取到候选人卡片。请确认受控浏览器停留在招聘候选人列表页。</span>
          )}
          <small>{filterResult.selectorNote}</small>
        </div>
      ) : null}

      {filterResult?.candidates.length ? <CandidateList candidates={filterResult.candidates} /> : null}

      {recommendQueue ? <RecommendQueueBox report={recommendQueue} /> : null}

      {greetingTest ? <GreetingTestBox report={greetingTest} /> : null}

      {greetingBatch ? <GreetingBatchBox report={greetingBatch} /> : null}

      {extensionDiagnostics ? <ExtensionFilterDiagnosticsBox diagnostics={extensionDiagnostics} /> : null}

      {diagnostics ? (
        <div className="diagnosticsBox">
          <strong>当前页诊断</strong>
          <span>{diagnostics.title || diagnostics.url}</span>
          <SelectorList title="候选人卡片" items={diagnostics.candidateCards} />
          <AttributeList title="唯一标识属性" items={diagnostics.identityAttributes} />
          <SelectorList title="消息输入框" items={diagnostics.messageInputs} />
          <SelectorList title="发送按钮" items={diagnostics.sendButtons} />
        </div>
      ) : null}
    </section>
  );
}

function RecommendQueueBox({ report }: { report: RecommendQueueReport }) {
  const greetingReady = report.items.filter((item) => item.greetingButtonSelector).length;

  return (
    <div className="diagnosticsBox recommendQueueBox">
      <strong>{"\u63a8\u8350\u9875\u5f85\u6253\u62db\u547c\u961f\u5217"}</strong>
      <span>{report.selectedJobText ? `\u5f53\u524d BOSS \u804c\u4f4d\uff1a${report.selectedJobText}` : report.sourceUrl}</span>
      <span>{`${new Date(report.capturedAt).toLocaleString()} \u00b7 ${report.items.length} \u4e2a\u5019\u9009\u4eba \u00b7 \u6253\u62db\u547c\u6309\u94ae ${greetingReady}/${report.items.length}`}</span>
      {report.warnings.length ? <code>{report.warnings.join("\uff1b")}</code> : null}
      <div className="recommendQueueList">
        {report.items.length === 0 ? <code>{"\u6682\u672a\u91c7\u96c6\u5230\u63a8\u8350\u5019\u9009\u4eba"}</code> : null}
        {report.items.slice(0, 20).map((item) => (
          <div className="recommendQueueRow" key={`${item.externalKey}-${item.index}`}>
            <div>
              <strong>{`${item.index + 1}. ${item.displayName || "\u5019\u9009\u4eba"}`}</strong>
              <span title={item.rawText}>{recommendQueueMeta(item)}</span>
            </div>
            <div className="candidateMeta">
              <span className={`candidateStatus ${item.greetingButtonSelector ? "pending" : "failed"}`}>
                {item.greetingButtonSelector ? "\u53ef\u6253\u62db\u547c" : "\u672a\u8bc6\u522b\u6309\u94ae"}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="selectorGroup nestedDiagnostics">
        <span>{"\u961f\u5217\u9009\u62e9\u5668"}</span>
        <code>{`frame ${report.framePath || report.path || "recommend"} \u00b7 \u5bb9\u5668 ${report.listContainerCount} \u00b7 \u5361\u7247 ${report.cardCount}`}</code>
        {report.items[0]?.cardSelector ? <code>{`card: ${report.items[0].cardSelector}`}</code> : null}
        {report.items[0]?.greetingButtonSelector ? <code>{`greet: ${report.items[0].greetingButtonSelector}`}</code> : null}
      </div>
    </div>
  );
}

function recommendQueueMeta(item: RecommendQueueReport["items"][number]) {
  const parts = [item.salary, item.activeText, item.age, item.experience, item.education, item.arrival].filter(Boolean);
  if (parts.length > 0) return parts.join(" \u00b7 ");
  return item.rawText.slice(0, 120) || item.externalKey;
}

function GreetingTestBox({ report }: { report: GreetingTestReport }) {
  const composer = report.composerResult;
  const click = report.clickResult;
  const status = composer.blockedReason
    ? composer.blockedReason
    : composer.inputSelector
      ? "\u5df2\u586b\u5165\u6587\u6848\uff0c\u672a\u53d1\u9001"
      : click.clicked
        ? "\u5df2\u70b9\u51fb\u6253\u62db\u547c\uff0c\u672a\u8bc6\u522b\u8f93\u5165\u6846"
        : click.reason || "\u672a\u5b8c\u6210\u70b9\u51fb";

  return (
    <div className="diagnosticsBox greetingTestBox">
      <strong>{"\u5355\u4eba\u6253\u62db\u547c\u6d4b\u8bd5"}</strong>
      <span>{`${new Date(report.capturedAt).toLocaleString()} \u00b7 ${report.item.displayName || "\u5019\u9009\u4eba"}`}</span>
      <span>{status}</span>
      <div className="selectorGroup nestedDiagnostics">
        <span>{"\u52a8\u4f5c\u7ed3\u679c"}</span>
        <code>{`click: ${click.clicked ? "ok" : "failed"}${click.reason ? ` / ${click.reason}` : ""}`}</code>
        {click.greetingButtonSelector ? <code>{`greet: ${click.greetingButtonSelector}`}</code> : null}
        {composer.inputSelector ? <code>{`input: ${composer.inputSelector}`}</code> : null}
        {composer.sendButtonSelector ? <code>{`send: ${composer.sendButtonSelector}`}</code> : null}
        {report.messagePreview ? <code>{`message: ${report.messagePreview}`}</code> : null}
      </div>
    </div>
  );
}

function GreetingBatchBox({ report }: { report: GreetingBatchState }) {
  const latestBatchRecord = report.records.at(-1);

  return (
    <div className="diagnosticsBox greetingBatchBox">
      <strong>{"\u6279\u91cf\u4eba\u5de5\u786e\u8ba4\u8fdb\u5ea6"}</strong>
      <span>{`${batchStatusLabel(report.status)} \u00b7 \u76ee\u6807 ${report.targetCount} \u00b7 \u5df2\u586b\u5165 ${report.filled} \u00b7 \u5931\u8d25 ${report.failed} \u00b7 \u8df3\u8fc7 ${report.skipped} \u00b7 \u963b\u65ad ${report.blocked}`}</span>
      <span>{`${report.intervalMinSeconds}-${report.intervalMaxSeconds}s \u95f4\u9694 \u00b7 \u961f\u5217 ${report.queueSize}`}</span>
      {report.pauseReason ? <code>{report.pauseReason}</code> : null}
      {report.nextAllowedAt ? <code>{`\u4e0b\u6b21\u6700\u65e9\u7ee7\u7eed\uff1a${new Date(report.nextAllowedAt).toLocaleString()}`}</code> : null}
      {latestBatchRecord ? <GreetingComposerDiagnosticsBox record={latestBatchRecord} /> : null}
      <div className="selectorGroup nestedDiagnostics">
        <span>{"\u6700\u8fd1\u8bb0\u5f55"}</span>
        {report.records.length === 0 ? <code>{"\u6682\u65e0\u6279\u91cf\u8bb0\u5f55"}</code> : null}
        {report.records.slice(-5).reverse().map((record) => (
          <code key={`${record.at}-${record.item.externalKey}`}>
            {`${new Date(record.at).toLocaleTimeString()} \u00b7 ${recordStatusLabel(record.status)} \u00b7 ${record.item.displayName || "\u5019\u9009\u4eba"}${record.errorMessage ? ` \u00b7 ${record.errorMessage}` : ""}`}
          </code>
        ))}
      </div>
    </div>
  );
}

function GreetingComposerDiagnosticsBox({ record }: { record: GreetingBatchState["records"][number] }) {
  const diagnostics = record.composerResult.diagnostics;
  if (!diagnostics) return null;

  return (
    <div className="selectorGroup nestedDiagnostics">
      <span>{"\u6700\u8fd1\u8f93\u5165\u533a\u8bca\u65ad"}</span>
      <code>{`${record.composerResult.path || "frame"} \u00b7 \u9875\u9762\u6587\u672c ${record.composerResult.bodyTextLength}`}</code>
      {diagnostics.textHints.length ? <code>{`\u63d0\u793a\u6587\u6848\uff1a${diagnostics.textHints.slice(0, 8).join("\uff0c")}`}</code> : null}
      {diagnostics.inputCandidates.length ? (
        <code>{`\u8f93\u5165\u6846\u5019\u9009\uff1a${diagnostics.inputCandidates.slice(0, 3).map((item) => item.selector || item.path || item.tag).join(" | ")}`}</code>
      ) : (
        <code>{"\u8f93\u5165\u6846\u5019\u9009\uff1a\u672a\u547d\u4e2d"}</code>
      )}
      {diagnostics.sendCandidates.length ? <code>{`\u53d1\u9001\u6309\u94ae\u5019\u9009\uff1a${diagnostics.sendCandidates.slice(0, 3).map((item) => item.selector || item.path || item.tag).join(" | ")}`}</code> : null}
    </div>
  );
}

function recordStatusLabel(status: string) {
  if (status === "clicked_no_composer") return "\u63a8\u8350\u9875\u65e0\u7f16\u8f91\u5668";
  if (status === "filled") return "\u5df2\u586b\u5165";
  if (status === "failed") return "\u5931\u8d25";
  if (status === "blocked") return "\u963b\u65ad";
  return status;
}

function batchStatusLabel(status: GreetingBatchState["status"]) {
  if (status === "running") return "\u8fd0\u884c\u4e2d";
  if (status === "waiting_confirmation") return "\u7b49\u5f85\u4eba\u5de5\u786e\u8ba4";
  if (status === "waiting_interval") return "\u7b49\u5f85\u95f4\u9694";
  if (status === "paused") return "\u5df2\u6682\u505c";
  if (status === "completed") return "\u5df2\u5b8c\u6210";
  if (status === "blocked") return "\u5df2\u963b\u65ad";
  return status;
}

function ExtensionFilterDiagnosticsBox({ diagnostics }: { diagnostics: ExtensionFilterDiagnosticsReport }) {
  const usefulFrames = diagnostics.frames.filter((frame) => frame.ok);
  const priorityFrame = usefulFrames.find((frame) => frame.path.includes("/web/frame/search")) ?? usefulFrames[0];

  return (
    <div className="diagnosticsBox">
      <strong>扩展筛选控件诊断</strong>
      <span>{diagnostics.title || diagnostics.sourceUrl}</span>
      <span>{new Date(diagnostics.capturedAt).toLocaleString()} · 有效 frame {usefulFrames.length}/{diagnostics.frames.length}</span>
      {priorityFrame ? <ExtensionFrameDiagnostics frame={priorityFrame} /> : <code>没有有效 frame 诊断，请确认扩展已重新加载并停留在 BOSS 页面。</code>}
      {diagnostics.frames
        .filter((frame) => !frame.ok)
        .slice(0, 3)
        .map((frame) => (
          <code key={`${frame.frameId}-${frame.framePath}`}>{frame.framePath || frame.path || "frame"}: {frame.reason || "无诊断结果"}</code>
        ))}
    </div>
  );
}

function ExtensionFrameDiagnostics({ frame }: { frame: ExtensionFilterFrameDiagnostics }) {
  return (
    <div className="selectorGroup">
      <span>{frame.path || frame.framePath || "frame"}</span>
      <code>
        输入框 {frame.inputs.length} · 筛选控件 {frame.filterControls.length} · 提交按钮 {frame.submitControls.length} · 候选容器 {frame.candidateContainers.length} · 候选命中 {frame.candidateSelectorHits}
      </code>
      <ExtensionElementList title="输入框" items={frame.inputs} />
      <ExtensionElementList title="筛选控件" items={frame.filterControls} />
      <ExtensionElementList title="提交按钮" items={frame.submitControls} />
      <ExtensionElementList title="候选列表容器" items={frame.candidateContainers} />
      {frame.textHints.length ? <code>可见筛选文案：{frame.textHints.slice(0, 20).join("，")}</code> : null}
    </div>
  );
}

function ExtensionElementList({ title, items }: { title: string; items: ExtensionFilterDiagnosticElement[] }) {
  return (
    <div className="selectorGroup nestedDiagnostics">
      <span>{title}</span>
      {items.length === 0 ? <code>未识别</code> : null}
      {items.slice(0, 5).map((item, index) => (
        <code key={`${title}-${item.selector}-${index}`} title={item.path}>
          {item.selector || item.path || item.tag} · {item.selectorCount} 个 · {item.text || item.attrs.placeholder || item.attrs["aria-label"] || item.attrs.title || item.valuePreview || "无文本"}
        </code>
      ))}
    </div>
  );
}
function CandidateList({ candidates }: { candidates: Candidate[] }) {
  return (
    <div className="candidateList">
      <div className="candidateListHeader">
        <strong>候选人列表</strong>
        <span>{candidates.length} 个</span>
      </div>
      {candidates.map((candidate) => (
        <div className="candidateRow" key={candidate.id}>
          <div>
            <strong>{candidate.display_name || "未命名候选人"}</strong>
            <span>{candidate.external_key}</span>
          </div>
          <div className="candidateMeta">
            <span className={`candidateStatus ${candidate.status}`}>{statusLabel(candidate.status)}</span>
            {candidate.source_url ? (
              <a href={candidate.source_url} target="_blank" rel="noreferrer">
                来源页
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "pending") return "待发送";
  if (status === "skipped") return "已跳过";
  if (status === "sent") return "已发送";
  if (status === "failed") return "失败";
  return status;
}

function SelectorList({ title, items }: { title: string; items: SelectorDiagnostics["candidateCards"] }) {
  return (
    <div className="selectorGroup">
      <span>{title}</span>
      {items.length === 0 ? <code>未识别</code> : null}
      {items.slice(0, 3).map((item) => (
        <code key={`${title}-${item.selector}`} title={item.reason}>
          {item.selector} · {item.count} 个 · {item.score} 分
        </code>
      ))}
    </div>
  );
}

function AttributeList({ title, items }: { title: string; items: SelectorDiagnostics["identityAttributes"] }) {
  return (
    <div className="selectorGroup">
      <span>{title}</span>
      {items.length === 0 ? <code>未识别</code> : null}
      {items.slice(0, 3).map((item) => (
        <code key={`${title}-${item.name}`} title={item.reason}>
          {item.name}: {item.values.slice(0, 2).join(", ")}
        </code>
      ))}
    </div>
  );
}

function toNullableNumber(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

