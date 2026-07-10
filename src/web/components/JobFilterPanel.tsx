import { Save } from "lucide-react";
import type { Job } from "../api";

type Props = {
  job: Job;
  saving: boolean;
  candidateCount: number;
  onChange: (job: Job) => void;
  onSave: () => void;
};

export function JobFilterPanel({ job, saving, candidateCount, onChange, onSave }: Props) {
  return (
    <section className="dashboardSection filterSection">
      <div className="sectionHeading">
        <div>
          <span className="eyebrow">职位配置</span>
          <h2>筛选条件</h2>
        </div>
        <span className="countText">本批次 {candidateCount} 人</span>
      </div>
      <div className="fieldGrid">
        <label className="span2">
          当前职位
          <input value={job.name} onChange={(event) => onChange({ ...job, name: event.target.value })} />
        </label>
        <label>
          城市
          <input value={job.city ?? ""} onChange={(event) => onChange({ ...job, city: event.target.value })} />
        </label>
        <label>
          性别
          <select value={job.gender ?? ""} onChange={(event) => onChange({ ...job, gender: toNullableGender(event.target.value) })}>
            <option value="">不限</option>
            <option value="男">男</option>
            <option value="女">女</option>
          </select>
        </label>
        <label>
          活跃时间
          <select value={normalizeActiveWithin(job.active_within)} onChange={(event) => onChange({ ...job, active_within: event.target.value })}>
            <option>近1天活跃</option>
            <option>近3天活跃</option>
            <option>近7天活跃</option>
          </select>
        </label>
        <label>
          年龄
          <span className="rangeInputs">
            <input
              type="number"
              min="16"
              max="70"
              placeholder="最低"
              aria-label="最低年龄"
              value={job.age_min ?? ""}
              onChange={(event) => onChange({ ...job, age_min: toNullableNumber(event.target.value) })}
            />
            <span>至</span>
            <input
              type="number"
              min="16"
              max="70"
              placeholder="最高"
              aria-label="最高年龄"
              value={job.age_max ?? ""}
              onChange={(event) => onChange({ ...job, age_max: toNullableNumber(event.target.value) })}
            />
          </span>
        </label>
        <label className="span2">
          关键词
          <input value={job.keywords ?? ""} onChange={(event) => onChange({ ...job, keywords: event.target.value })} />
        </label>
        <label>
          最低薪资
          <input type="number" value={job.salary_min ?? ""} onChange={(event) => onChange({ ...job, salary_min: toNullableNumber(event.target.value) })} />
        </label>
        <label>
          最高薪资
          <input type="number" value={job.salary_max ?? ""} onChange={(event) => onChange({ ...job, salary_max: toNullableNumber(event.target.value) })} />
        </label>
      </div>
      <label className="check compactCheck">
        <input
          type="checkbox"
          checked={Boolean(job.exclude_contacted)}
          onChange={(event) => onChange({ ...job, exclude_contacted: event.target.checked ? 1 : 0 })}
        />
        跳过已联系候选人
      </label>
      <button className="primary fullButton" type="button" disabled={saving} onClick={onSave}>
        <Save size={15} />
        {saving ? "保存中" : "保存筛选条件"}
      </button>
      <p className="sectionNote">保存后，扩展和本地诊断将读取这组条件。</p>
    </section>
  );
}

function toNullableNumber(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableGender(value: string): Job["gender"] {
  return value === "男" || value === "女" ? value : null;
}

function normalizeActiveWithin(value: string | null) {
  return (value || "近3天活跃").replace(/\s+/g, "");
}
