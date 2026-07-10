import { Clock } from "lucide-react";
import type { Job, Schedule, Template } from "../api";

type Props = {
  schedule: Schedule;
  jobs: Job[];
  templates: Template[];
  onChange: (schedule: Schedule) => void;
  onSave: () => void;
};

export function SchedulePanel({ schedule, jobs, templates, onChange, onSave }: Props) {
  return (
    <section className="drawerSection">
      <div className="sectionHeading">
        <div><span className="eyebrow">旧发送设置</span><h2>每日计划</h2></div>
      </div>
      <div className="scheduleGrid">
        <label className="check">
          <input type="checkbox" checked={Boolean(schedule.enabled)} onChange={(event) => onChange({ ...schedule, enabled: event.target.checked ? 1 : 0 })} />
          每天定时执行
        </label>
        <label>
          执行时间
          <span className="inputWithIcon"><Clock size={16} /><input type="time" value={schedule.run_time} onChange={(event) => onChange({ ...schedule, run_time: event.target.value })} /></span>
        </label>
        <label>
          适用职位
          <select value={schedule.job_id ?? ""} onChange={(event) => onChange({ ...schedule, job_id: Number(event.target.value) || null })}>
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}
          </select>
        </label>
        <label>
          使用模板
          <select value={schedule.template_id ?? ""} onChange={(event) => onChange({ ...schedule, template_id: Number(event.target.value) || null })}>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </label>
      </div>
      <div className="actions">
        <button className="primary" type="button" onClick={onSave}>保存计划</button>
        <span className="mutedText">{schedule.enabled ? "执行时间 " + schedule.run_time : "当前未开启"}</span>
      </div>
    </section>
  );
}