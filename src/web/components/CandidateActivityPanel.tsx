import { useState } from "react";
import { History, ListChecks, Users } from "lucide-react";
import type { Candidate, GreetingBatchState } from "../api";

type Props = {
  candidates: Candidate[];
  batch: GreetingBatchState | null;
};

export function CandidateActivityPanel({ candidates, batch }: Props) {
  const [view, setView] = useState<"batch" | "history" | "activity">("batch");
  const batchCandidates = batch?.candidates || [];
  const records = batch?.records.slice().reverse() || [];

  return (
    <section className="dashboardSection activitySection">
      <div className="sectionHeading">
        <div>
          <span className="eyebrow">数据概览</span>
          <h2>候选人与活动</h2>
        </div>
      </div>
      <div className="viewTabs">
        <button type="button" className={view === "batch" ? "active" : ""} onClick={() => setView("batch")}>
          <Users size={15} />本批次 <span>{batchCandidates.length}</span>
        </button>
        <button type="button" className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
          <History size={15} />历史 <span>{candidates.length}</span>
        </button>
        <button type="button" className={view === "activity" ? "active" : ""} onClick={() => setView("activity")}>
          <ListChecks size={15} />活动 <span>{records.length}</span>
        </button>
      </div>
      <div className="activityList">
        {view === "batch" ? (
          batchCandidates.length ? batchCandidates.map((candidate) => (
            <div className="candidateLine" key={candidate.item.fingerprint || candidate.item.externalKey || candidate.firstSeenAt}>
              <div className="avatar">{initial(candidate.item.displayName)}</div>
              <div>
                <strong>{candidate.item.displayName || "未命名候选人"}</strong>
                <span title={candidate.item.rawText}>{batchCandidateDetails(candidate.item)}</span>
              </div>
              <span className={"candidateStatus " + candidate.status} title={candidate.message}>
                {batchCandidateStatus(candidate.status)}
              </span>
            </div>
          )) : <div className="emptyRow">开始批量打招呼后，这里会显示当前页面识别到的候选人</div>
        ) : view === "history" ? (
          candidates.length ? candidates.map((candidate) => (
            <div className="candidateLine" key={candidate.id}>
              <div className="avatar">{initial(candidate.display_name)}</div>
              <div>
                <strong>{candidate.display_name || "未命名候选人"}</strong>
                <span title={candidate.external_key}>{candidate.external_key}</span>
              </div>
              <span className={"candidateStatus " + candidate.status}>{candidateStatus(candidate.status)}</span>
            </div>
          )) : <div className="emptyRow">历史采集库暂无候选人数据</div>
        ) : (
          records.length ? records.map((record) => (
            <div className="activityRow" key={record.at + "-" + record.item.externalKey}>
              <span className={"recordDot " + record.status} />
              <div>
                <strong>{record.item.displayName || "候选人"}</strong>
                <span>{recordStatus(record.status)}</span>
              </div>
              <time>{formatTime(record.at)}</time>
            </div>
          )) : <div className="emptyRow">当前批次还没有活动记录</div>
        )}
      </div>
    </section>
  );
}

function batchCandidateDetails(item: GreetingBatchState["candidates"][number]["item"]) {
  return [item.salary, item.activeText, item.age, item.experience, item.education, item.arrival]
    .filter(Boolean)
    .join(" · ") || item.externalKey || "已从当前推荐页识别";
}

function batchCandidateStatus(status: GreetingBatchState["candidates"][number]["status"]) {
  if (status === "pending") return "待处理";
  if (status === "already_greeted") return "已联系";
  if (status === "direct_greeted") return "已打招呼";
  if (status === "filtered_out") return "不匹配";
  if (status === "uncertain") return "待确认";
  if (status === "blocked") return "已阻断";
  if (status === "failed") return "失败";
  return "不可操作";
}

function initial(value: string | null) {
  return (value || "候").trim().slice(0, 1).toUpperCase();
}

function candidateStatus(status: string) {
  if (status === "pending") return "待处理";
  if (status === "sent") return "已发送";
  if (status === "skipped") return "已跳过";
  if (status === "failed") return "失败";
  return status;
}

function recordStatus(status: string) {
  if (status === "direct_greeted") return "已打招呼";
  if (status === "exhausted") return "列表已遍历";
  if (status === "uncertain") return "结果待确认";
  if (status === "blocked") return "已阻断";
  return status;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
