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
    <section className="sectionBlock separated">
      <h2>固定文案</h2>
      <label>
        文案模板
        <select value={selectedTemplate.id} onChange={(event) => onSelect(Number(event.target.value))}>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        文案内容
        <textarea
          value={selectedTemplate.body}
          onChange={(event) => onChange({ ...selectedTemplate, body: event.target.value })}
        />
      </label>
      <div className="actions">
        <button type="button" disabled={!selectedTemplate.body.trim()} onClick={onSave}>
          <Save size={16} />
          保存文案
        </button>
        <button type="button" onClick={onCreate}>
          <FilePlus size={16} />
          新建文案
        </button>
      </div>
      <div className="templateList">
        {templates.map((template) => (
          <button
            type="button"
            className={template.id === selectedTemplate.id ? "listButton active" : "listButton"}
            key={template.id}
            onClick={() => onSelect(template.id)}
          >
            {template.name}
          </button>
        ))}
      </div>
    </section>
  );
}
