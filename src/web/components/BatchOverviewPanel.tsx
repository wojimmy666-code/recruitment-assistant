import { AlertTriangle, CheckCircle2, Clock3, SkipForward, SlidersHorizontal } from "lucide-react";
import type { GreetingBatchState } from "../api";

type Props = {
  batch: GreetingBatchState | null;
};

const statusLabels: Record<string, string> = {
  running: "运行中",
  waiting_candidates: "\u7b49\u5f85\u5019\u9009\u4eba",
  waiting_interval: "等待间隔",
  paused: "已暂停",
  completed: "已完成",
  blocked: "已阻断"
};

export function BatchOverviewPanel({ batch }: Props) {
  if (!batch) {
    return (
      <section className="dashboardSection emptyDashboardState">
        <div className="emptyIcon"><Clock3 size={24} /></div>
        <h2>暂无批量任务</h2>
        <p>在 BOSS 推荐页打开扩展并开始批量打招呼。</p>
      </section>
    );
  }

  const completed = batch.directGreeted || 0;
  const progress = Math.min(100, Math.round((completed / Math.max(1, batch.targetCount)) * 100));
  const recentRecords = batch.records.slice(-4).reverse();

  return (
    <section className="dashboardSection batchSection">
      <div className="sectionHeading">
        <div>
          <span className="eyebrow">实时任务</span>
          <h2>批量打招呼</h2>
        </div>
        <span className={"batchBadge " + batch.status}>{statusLabels[batch.status] || batch.status}</span>
      </div>

      <div className="progressHeader">
        <strong>{completed} / {batch.targetCount}</strong>
        <span>{progress}%</span>
      </div>
      <div className="progressTrack" aria-label={"批量进度 " + progress + "%"}>
        <span style={{ width: progress + "%" }} />
      </div>

      <div className="metricStrip">
        <div><CheckCircle2 size={16} /><span>成功</span><strong>{completed}</strong></div>
        <div><SkipForward size={16} /><span>已联系</span><strong>{batch.skipped}</strong></div>
        <div><SlidersHorizontal size={16} /><span>过滤</span><strong>{batch.filteredOut || 0}</strong></div>
        <div><AlertTriangle size={16} /><span>失败</span><strong>{batch.failed}</strong></div>
        <div><AlertTriangle size={16} /><span>阻断</span><strong>{batch.blocked}</strong></div>
      </div>

      {batch.filterFields?.length ? (
        <div className="batchTiming">
          <SlidersHorizontal size={16} />
          <div>
            <strong>已应用筛选{batch.filterJobName ? " · " + batch.filterJobName : ""}</strong>
            <span title={batch.filterWarnings?.join("；")}>{batch.filterFields.join(" · ")}</span>
          </div>
        </div>
      ) : null}

      <div className="batchTiming">
        <Clock3 size={16} />
        <div>
          <strong>{batch.intervalMinSeconds}-{batch.intervalMaxSeconds}s 随机间隔</strong>
          <span>{batch.nextAllowedAt ? "下次自动执行 " + new Date(batch.nextAllowedAt).toLocaleTimeString() : "当前没有等待中的动作"}</span>
        </div>
      </div>

      {batch.pauseReason ? <div className={"stateMessage " + batch.status}>{batch.pauseReason}</div> : null}

      <div className="subsectionHeading">
        <strong>最近执行</strong>
        <span>{batch.records.length} 条记录</span>
      </div>
      <div className="batchRecordList">
        {recentRecords.length === 0 ? <div className="emptyRow">暂无执行记录</div> : null}
        {recentRecords.map((record) => (
          <div className="activityRow" key={record.at + "-" + record.item.externalKey}>
            <span className={"recordDot " + record.status} />
            <div>
              <strong>{record.item.displayName || "候选人"}</strong>
              <span>{recordLabel(record.status) + (record.errorMessage ? " · " + record.errorMessage : "")}</span>
            </div>
            <time>{formatTime(record.at)}</time>
          </div>
        ))}
      </div>
    </section>
  );
}

function recordLabel(status: string) {
  if (status === "direct_greeted") return "已打招呼";
  if (status === "waiting_candidates") return "\u7b49\u5f85 BOSS \u52a0\u8f7d\u66f4\u591a\u5019\u9009\u4eba";
  if (status === "exhausted") return "列表已遍历";
  if (status === "uncertain") return "结果待确认";
  if (status === "blocked") return "已阻断";
  return status;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
