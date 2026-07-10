import { Activity, Settings } from "lucide-react";
import type { GreetingBatchState } from "../api";

type HeaderProps = {
  batch: GreetingBatchState | null;
  onSettings: () => void;
};

const batchLabels: Record<string, string> = {
  running: "运行中",
  waiting_interval: "等待间隔",
  paused: "已暂停",
  completed: "已完成",
  blocked: "已阻断"
};

export function Header({ batch, onSettings }: HeaderProps) {
  const batchStatus = batch?.status || "idle";

  return (
    <header className="topbar">
      <div className="brandBlock">
        <div className="brandIcon"><Activity size={18} /></div>
        <div>
          <h1>招聘助手</h1>
          <p>BOSS 推荐页批量打招呼工作台</p>
        </div>
      </div>
      <div className="statusbar">
        <span className="statusPill connected">本地服务已连接</span>
        <span className={"statusPill batch-" + batchStatus}>
          {batch ? "批量" + (batchLabels[batch.status] || batch.status) : "暂无批次"}
        </span>
        <button className="iconButton" type="button" onClick={onSettings} title="设置与诊断" aria-label="设置与诊断">
          <Settings size={17} />
        </button>
      </div>
    </header>
  );
}