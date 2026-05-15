import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { Attendee, CustomForm } from "../types";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  declined: "Declined",
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: "#22c55e",
  pending: "#f59e0b",
  declined: "#ef4444",
};

export default function AttendeeDetail() {
  const { eventId, attendeeId } = useParams<{ eventId: string; attendeeId: string }>();
  const [attendee, setAttendee] = useState<Attendee | null>(null);
  // Map of field_id → human-readable label, built from all of the event's
  // custom forms. Without this, the Form Responses section renders the
  // raw UUID field IDs (e.g. "a3b8f2c4-5e7d-…") next to each answer.
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .listAttendees(Number(eventId))
      .then((list) => {
        const found = list.find((a) => a.id === Number(attendeeId));
        if (found) setAttendee(found);
      })
      .catch(console.error);
    // Pull the event's forms in parallel so we can translate field IDs
    // → labels. Multiple forms get merged into one map; if two forms
    // happen to share an ID (rare), the later one wins, which is fine.
    api
      .listForms(Number(eventId))
      .then((forms: CustomForm[]) => {
        const labels: Record<string, string> = {};
        for (const form of forms) {
          for (const field of form.fields) {
            if (field && field.id && field.label) {
              labels[field.id] = field.label;
            }
          }
        }
        setFieldLabels(labels);
      })
      .catch(() => {
        // Non-fatal — if forms can't be loaded we just fall back to
        // showing the raw key as the question text.
      });
  }, [eventId, attendeeId]);

  if (!attendee) return <div className="page loading">Loading...</div>;

  const initials = attendee.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="page attendee-detail-page">
      <Link to={`/events/${eventId}`} className="back-link">
        Back to Event
      </Link>

      <div className="detail-header">
        <div className="detail-avatar">{initials}</div>
        <div>
          <h1>{attendee.name}</h1>
          <span
            className="badge"
            style={{
              background: STATUS_COLORS[attendee.rsvp_status] + "20",
              color: STATUS_COLORS[attendee.rsvp_status],
            }}
          >
            {STATUS_LABELS[attendee.rsvp_status] || attendee.rsvp_status}
          </span>
        </div>
      </div>

      <div className="card detail-section">
        <h3>Contact Information</h3>
        <div className="detail-grid">
          <div className="detail-field">
            <div className="field-label">Email</div>
            <div className="field-value">{attendee.email || "—"}</div>
          </div>
          <div className="detail-field">
            <div className="field-label">Phone</div>
            <div className="field-value">{attendee.phone || "—"}</div>
          </div>
        </div>
      </div>

      <div className="card detail-section">
        <h3>Event Details</h3>
        <div className="detail-grid">
          <div className="detail-field">
            <div className="field-label">Dietary Requirements</div>
            <div className="field-value">{attendee.dietary_requirements || "None specified"}</div>
          </div>
          <div className="detail-field">
            <div className="field-label">RSVP Status</div>
            <div className="field-value">{STATUS_LABELS[attendee.rsvp_status] || attendee.rsvp_status}</div>
          </div>
          {attendee.notes && (
            <div className="detail-field full-width">
              <div className="field-label">Notes</div>
              <div className="field-value">{attendee.notes}</div>
            </div>
          )}
        </div>
      </div>

      {(() => {
        // Filter out meal_selections (rendered separately in the edit
        // drawer — would show as "[object Object]" here) and any other
        // non-string structured values. What's left is plain answers
        // keyed by field ID.
        if (!attendee.responses) return null;
        const entries = Object.entries(attendee.responses).filter(
          ([key, value]) => key !== "meal_selections" && typeof value === "string",
        );
        if (entries.length === 0) return null;
        return (
          <div className="card detail-section">
            <h3>Form Responses</h3>
            <div className="responses-list">
              {entries.map(([fieldId, answer]) => (
                <div key={fieldId} className="response-item">
                  <div className="question">{fieldLabels[fieldId] || fieldId}</div>
                  <div className="answer">{answer as string}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
