import type { SendLog } from "../api";

type Props = {
  logs: SendLog[];
};

const statusLabels: Record<string, string> = {
  sent: "已发送",
  skipped: "已跳过",
  failed: "失败",
  paused: "暂停"
};

export function SendLogTable({ logs }: Props) {
  return (
    <section className="sectionBlock separated">
      <h2>发送记录</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>候选人</th>
              <th>职位</th>
              <th>文案</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="emptyCell">暂无发送记录</td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatTime(log.sent_at)}</td>
                  <td>{log.candidate_name || "候选人"}</td>
                  <td>{log.job_name || "-"}</td>
                  <td>{log.template_name || "文案"}</td>
                  <td>{statusLabels[log.status] || log.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
