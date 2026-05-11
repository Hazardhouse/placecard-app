import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { CustomFormPublic } from "../types";

const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Australia", "Germany", "France",
  "Spain", "Italy", "Netherlands", "Brazil", "Mexico", "Japan", "South Korea",
  "India", "China", "Singapore", "United Arab Emirates", "South Africa", "Nigeria",
  "Argentina", "Colombia", "Poland", "Romania", "Sweden", "Norway", "Denmark",
  "Finland", "Ireland", "Scotland", "Belgium", "Switzerland", "Austria", "Portugal",
  "Greece", "Turkey", "Russia", "Ukraine", "Czech Republic", "Hungary", "Albania",
  "Croatia", "Serbia", "New Zealand", "Philippines", "Thailand", "Vietnam",
  "Indonesia", "Malaysia", "Israel", "Egypt", "Morocco", "Kenya", "Ghana",
  "Chile", "Peru", "Ecuador", "Costa Rica", "Panama", "Jamaica", "Dominican Republic",
].sort();

export default function PublicForm() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [formData, setFormData] = useState<CustomFormPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Standard fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [dietary, setDietary] = useState("");

  // Custom field responses keyed by field ID
  const [responses, setResponses] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!shareToken) return;
    api
      .getPublicForm(shareToken)
      .then(data => {
        setFormData(data);
        if (!data.is_active) setError("This form is no longer accepting responses.");
      })
      .catch(() => setError("Form not found."))
      .finally(() => setLoading(false));
  }, [shareToken]);

  const setResponse = (fieldId: string, value: string) => {
    setResponses(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareToken || !formData) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      await api.submitPublicForm(shareToken, {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        country: country || null,
        dietary_requirements: dietary.trim() || null,
        responses: Object.keys(responses).length > 0 ? responses : null,
      });
      setSubmitted(true);
    } catch (err: any) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="public-form-page">
        <div className="public-form-card">
          <p style={{ textAlign: "center", color: "#6b7280" }}>Loading form...</p>
        </div>
      </div>
    );
  }

  if (error || !formData) {
    return (
      <div className="public-form-page">
        <div className="public-form-card">
          <div className="public-form-logo">Place<span>card</span></div>
          <h1 className="public-form-error-title">{error || "Form not found"}</h1>
          <p style={{ color: "#6b7280", textAlign: "center" }}>
            This link may be invalid or the form may have been closed.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="public-form-page">
        <div className="public-form-card public-form-success">
          <div className="public-form-logo">Place<span>card</span></div>
          <div className="public-form-success-icon">✓</div>
          <h1>Thank You!</h1>
          <p>Your details for <strong>{formData.event_name}</strong> have been submitted.</p>
          <p className="public-form-success-sub">The event organizer will be in touch with more details soon.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-form-page">
      <div className="public-form-card">
        <div className="public-form-logo">Place<span>card</span></div>

        <div className="public-form-event-header">
          <h1>{formData.event_name}</h1>
          {formData.event_date && <p className="public-form-date">{formData.event_date}</p>}
          {formData.event_location && <p className="public-form-location">{formData.event_location}</p>}
        </div>

        <h2 className="public-form-title">{formData.title}</h2>
        {formData.description && <p className="public-form-description">{formData.description}</p>}

        <form onSubmit={handleSubmit} className="public-form-fields">
          <div className="form-group">
            <label>Full Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your full name"
              required
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
              />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Country</label>
              <select value={country} onChange={e => setCountry(e.target.value)}>
                <option value="">Select country...</option>
                {COUNTRIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Dietary Requirements</label>
              <input
                type="text"
                value={dietary}
                onChange={e => setDietary(e.target.value)}
                placeholder="e.g. Vegetarian, Gluten-free"
              />
            </div>
          </div>

          {formData.fields.length > 0 && (
            <div className="public-form-custom-divider" />
          )}

          {formData.fields.map(field => (
            <div key={field.id} className="form-group">
              <label>
                {field.label}
                {field.required && " *"}
              </label>

              {field.type === "text" && (
                <input
                  type="text"
                  value={responses[field.id] || ""}
                  onChange={e => setResponse(field.id, e.target.value)}
                  placeholder={field.placeholder || ""}
                  required={field.required}
                />
              )}

              {field.type === "textarea" && (
                <textarea
                  value={responses[field.id] || ""}
                  onChange={e => setResponse(field.id, e.target.value)}
                  placeholder={field.placeholder || ""}
                  required={field.required}
                  rows={3}
                />
              )}

              {field.type === "dropdown" && (
                <select
                  value={responses[field.id] || ""}
                  onChange={e => setResponse(field.id, e.target.value)}
                  required={field.required}
                >
                  <option value="">Select...</option>
                  {(field.options || []).map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )}

              {field.type === "multiple_choice" && (
                <div className="public-form-radio-group">
                  {(field.options || []).map(opt => (
                    <label key={opt} className="public-form-radio-option">
                      <input
                        type="radio"
                        name={field.id}
                        value={opt}
                        checked={responses[field.id] === opt}
                        onChange={() => setResponse(field.id, opt)}
                        required={field.required && !responses[field.id]}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              )}

              {field.type === "checkbox" && (
                <label className="public-form-checkbox-option">
                  <input
                    type="checkbox"
                    checked={responses[field.id] === "yes"}
                    onChange={e => setResponse(field.id, e.target.checked ? "yes" : "")}
                  />
                  <span>{field.label}</span>
                </label>
              )}
            </div>
          ))}

          {submitError && <p className="edit-user-error">{submitError}</p>}

          <button type="submit" className="btn btn-primary public-form-submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit"}
          </button>
        </form>

        <p className="public-form-footer">
          Powered by <a href="https://placecard-events.app" target="_blank" rel="noopener noreferrer">PlaceCard</a>
        </p>
      </div>
    </div>
  );
}
