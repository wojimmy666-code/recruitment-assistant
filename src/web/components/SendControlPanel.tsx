import { Pause, Play } from "lucide-react";
import type { RuntimeState, Schedule } from "../api";

type Props = {
  state: RuntimeState | null;
  schedule: Schedule;
  sendableCount: number;
  hasTemplateBody: boolean;
  onScheduleChange: (schedule: Schedule) => void;
  onStart: () => void;
  onPause: () => void;
};

export function SendControlPanel({
  state,
  schedule,
  sendableCount,
  hasTemplateBody,
  onScheduleChange,
  onStart,
  onPause
}: Props) {
  const sending = state?.sendStatus === "sending";
  const canStart = sendableCount > 0 && hasTemplateBody && !sending;

  return (
    <section className="sectionBlock">
      <h2>发送控制</h2>
      <div className="segmented">
        <button type="button" className={schedule.mode === "safe" ? "active" : ""} onClick={() => onScheduleChange({ ...schedule, mode: "safe" })}>
          手动逐个发送
        </button>
        <button type="button" className={schedule.mode === "auto" ? "active" : ""} onClick={() => onScheduleChange({ ...schedule, mode: "auto" })}>
          批量按上限发送
        </button>
      </div>
      <div className="twocol">
        <label>
          每日上限
          <input
            type="number"
            min={1}
            value={schedule.daily_cap}
            onChange={(event) => onScheduleChange({ ...schedule, daily_cap: Number(event.target.value) || 1 })}
          />
        </label>
        <label>
          随机间隔
          <div className="inlineInputs">
            <input
              type="number"
              min={1}
              value={schedule.interval_min_seconds}
              onChange={(event) => onScheduleChange({ ...schedule, interval_min_seconds: Number(event.target.value) || 1 })}
            />
            <span>-</span>
            <input
              type="number"
              min={1}
              value={schedule.interval_max_seconds}
              onChange={(event) => onScheduleChange({ ...schedule, interval_max_seconds: Number(event.target.value) || 1 })}
            />
          </div>
        </label>
      </div>
      <div className="warning">{state?.pauseReason || "验证码、登录失效、页面异常时自动暂停。"}</div>
      <div className="actions">
        <button className="primary" type="button" disabled={!canStart} onClick={onStart}>
          <Play size={16} />
          开始发送
        </button>
        <button type="button" disabled={!sending} onClick={onPause}>
          <Pause size={16} />
          暂停
        </button>
      </div>
    </section>
  );
}
