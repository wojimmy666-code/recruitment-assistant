import { Power, Settings } from "lucide-react";
import type { RuntimeState } from "../api";

type HeaderProps = {
  state: RuntimeState | null;
  onOpenBrowser: () => void;
};

const browserLabels: Record<string, string> = {
  unknown: "未知",
  connected: "已连接浏览器",
  not_connected: "未连接",
  login_required: "需要登录",
  paused: "已暂停"
};

export function Header({ state, onOpenBrowser }: HeaderProps) {
  return (
    <header className="topbar">
      <div>
        <h1>本地招聘打招呼工具</h1>
        <p>固定文案、按上限发送、自动记录</p>
      </div>
      <div className="statusbar">
        <button className="iconButton" type="button" onClick={onOpenBrowser} title="打开受控浏览器">
          <Power size={17} />
        </button>
        <span className={`statusPill ${state?.browserStatus || "unknown"}`}>
          {browserLabels[state?.browserStatus || "unknown"]}
        </span>
        <strong>今日 {state?.todaySent ?? 0}/{state?.dailyCap ?? 20}</strong>
        <button className="iconButton" type="button" title="设置">
          <Settings size={17} />
        </button>
      </div>
    </header>
  );
}
