import { FilePlus, Save } from "lucide-react";
import type { Template } from "../api";

type Props = {
  templates: Template[];
  selectedTemplate: Template;
  onSelect: (templateId: number) => void;
  onChange: (template: Template) => void;
  onSave: () => void;
  onCreate: () => void;
};

export function TemplatePanel({ templates, selectedTemplate, onSelect, onChange, onSave, onCreate }: Props) {
  return (
    <section className="drawerSection">
      <div className="sectionHeading">
        <div><span className="eyebrow">旧发送设置</span><h2>消息模板</h2></div>
      </div>
      <label>
        模板
        <select value={selectedTemplate.id} onChange={(event) => onSelect(Number(event.target.value))}>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
      </label>
      <label>
        内容
        <textarea value={selectedTemplate.body} onChange={(event) => onChange({ ...selectedTemplate, body: event.target.value })} />
      </label>
      <div className="actions">
        <button className="primary" type="button" disabled={!selectedTemplate.body.trim()} onClick={onSave}><Save size={15} />保存模板</button>
        <button type="button" onClick={onCreate}><FilePlus size={15} />新建模板</button>
      </div>
    </section>
  );
}