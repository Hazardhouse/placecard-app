import { useState } from "react";
import { api } from "../api/client";
import type { CustomForm, CustomFormField } from "../types";

type FieldType = CustomFormField["type"];

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Short Text" },
  { value: "textarea", label: "Long Text" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "checkbox", label: "Checkbox" },
];

interface Props {
  eventId: number;
  eventName: string;
  eventDescription?: string | null;
  existingForm?: CustomForm | null;
  onSaved: (form: CustomForm) => void;
  onCancel: () => void;
}

export default function FormBuilder({ eventId, eventName, eventDescription, existingForm, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(existingForm?.title || `${eventName} — Guest Details`);
  // Default the description to whatever the user wrote on the event itself
  // when there's no existing form yet. If they're editing an existing form,
  // keep whatever they previously saved.
  const [description, setDescription] = useState(existingForm?.description || eventDescription || "");
  const [fields, setFields] = useState<CustomFormField[]>(existingForm?.fields || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addField = () => {
    setFields([
      ...fields,
      {
        id: crypto.randomUUID(),
        type: "text",
        label: "",
        required: false,
        options: [],
        placeholder: "",
      },
    ]);
  };

  const updateField = (id: string, updates: Partial<CustomFormField>) => {
    setFields(fields.map(f => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
  };

  const addOption = (fieldId: string) => {
    setFields(
      fields.map(f =>
        f.id === fieldId ? { ...f, options: [...(f.options || []), ""] } : f,
      ),
    );
  };

  const updateOption = (fieldId: string, index: number, value: string) => {
    setFields(
      fields.map(f =>
        f.id === fieldId
          ? { ...f, options: (f.options || []).map((o, i) => (i === index ? value : o)) }
          : f,
      ),
    );
  };

  const removeOption = (fieldId: string, index: number) => {
    setFields(
      fields.map(f =>
        f.id === fieldId
          ? { ...f, options: (f.options || []).filter((_, i) => i !== index) }
          : f,
      ),
    );
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= fields.length) return;
    const newFields = [...fields];
    [newFields[index], newFields[newIndex]] = [newFields[newIndex], newFields[index]];
    setFields(newFields);
  };

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Form title is required.");
      return;
    }
    for (const f of fields) {
      if (!f.label.trim()) {
        setError("All custom fields must have a label.");
        return;
      }
      if ((f.type === "dropdown" || f.type === "multiple_choice") && (!f.options || f.options.filter(o => o.trim()).length < 2)) {
        setError(`"${f.label}" needs at least 2 options.`);
        return;
      }
    }

    setSaving(true);
    try {
      const cleanFields = fields.map(f => ({
        ...f,
        options: f.options?.filter(o => o.trim()),
      }));

      let form: CustomForm;
      if (existingForm) {
        form = await api.updateForm(eventId, existingForm.id, {
          title: title.trim(),
          description: description.trim() || null,
          fields: cleanFields,
        } as any);
      } else {
        form = await api.createForm(eventId, {
          title: title.trim(),
          description: description.trim() || undefined,
          fields: cleanFields,
        });
      }
      onSaved(form);
    } catch (e: any) {
      setError(e.message || "Failed to save form.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-builder">
      <div className="form-builder-header">
        <h3>{existingForm ? "Edit Form" : "Create Attendee Form"}</h3>
        <button className="form-builder-close" onClick={onCancel}>✕</button>
      </div>

      <div className="form-builder-body">
        <div className="form-group">
          <label>Form Title *</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Wedding Guest Details"
          />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief message for your guests..."
            rows={2}
          />
        </div>

        <div className="form-builder-section">
          <h4>Standard Fields</h4>
          <p className="form-builder-hint">These fields are always included in every form.</p>
          <div className="form-builder-standard-fields">
            <div className="form-builder-standard-field">
              <span className="form-builder-field-icon">👤</span>
              <span>Full Name</span>
              <span className="form-builder-required-badge">Required</span>
            </div>
            <div className="form-builder-standard-field">
              <span className="form-builder-field-icon">✉️</span>
              <span>Email</span>
            </div>
            <div className="form-builder-standard-field">
              <span className="form-builder-field-icon">📱</span>
              <span>Phone</span>
            </div>
            <div className="form-builder-standard-field">
              <span className="form-builder-field-icon">🌍</span>
              <span>Country</span>
            </div>
            <div className="form-builder-standard-field">
              <span className="form-builder-field-icon">🍽</span>
              <span>Dietary Requirements</span>
            </div>
          </div>
        </div>

        <div className="form-builder-section">
          <div className="form-builder-section-header">
            <h4>Custom Fields</h4>
            <button className="btn btn-sm btn-primary" onClick={addField}>+ Add Field</button>
          </div>
          {fields.length === 0 && (
            <p className="form-builder-hint">Add custom questions like meal selection, plus-one, accessibility needs, etc.</p>
          )}

          {fields.map((field, index) => (
            <div key={field.id} className="form-builder-field-card">
              <div className="form-builder-field-top">
                <div className="form-builder-field-reorder">
                  <button onClick={() => moveField(index, -1)} disabled={index === 0}>↑</button>
                  <button onClick={() => moveField(index, 1)} disabled={index === fields.length - 1}>↓</button>
                </div>
                <div className="form-builder-field-inputs">
                  <div className="form-row">
                    <div className="form-group" style={{ flex: 2 }}>
                      <label>Label *</label>
                      <input
                        type="text"
                        value={field.label}
                        onChange={e => updateField(field.id, { label: e.target.value })}
                        placeholder="e.g. Meal Selection"
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Type</label>
                      <select
                        value={field.type}
                        onChange={e => updateField(field.id, { type: e.target.value as FieldType, options: [] })}
                      >
                        {FIELD_TYPES.map(ft => (
                          <option key={ft.value} value={ft.value}>{ft.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {(field.type === "dropdown" || field.type === "multiple_choice") && (
                    <div className="form-builder-options">
                      <label>Options</label>
                      {(field.options || []).map((opt, i) => (
                        <div key={i} className="form-builder-option-row">
                          <input
                            type="text"
                            value={opt}
                            onChange={e => updateOption(field.id, i, e.target.value)}
                            placeholder={`Option ${i + 1}`}
                          />
                          <button className="form-builder-option-remove" onClick={() => removeOption(field.id, i)}>✕</button>
                        </div>
                      ))}
                      <button className="btn btn-sm" onClick={() => addOption(field.id)}>+ Add Option</button>
                    </div>
                  )}

                  {field.type === "text" && (
                    <div className="form-group">
                      <label>Placeholder</label>
                      <input
                        type="text"
                        value={field.placeholder || ""}
                        onChange={e => updateField(field.id, { placeholder: e.target.value })}
                        placeholder="Optional placeholder text"
                      />
                    </div>
                  )}

                  <label className="form-builder-required-toggle">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={e => updateField(field.id, { required: e.target.checked })}
                    />
                    <span>Required</span>
                  </label>
                </div>
                <button className="form-builder-field-remove" onClick={() => removeField(field.id)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {error && <p className="form-builder-error">{error}</p>}
      </div>

      <div className="form-builder-footer">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Next"}
        </button>
      </div>
    </div>
  );
}
