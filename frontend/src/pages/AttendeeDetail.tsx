import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { Attendee } from "../types";

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

  useEffect(() => {
    api
      .listAttendees(Number(eventId))
      .then((list) => {
        const found = list.find((a) => a.id === Number(attendeeId));
        if (found) setAttendee(found);
      })
      .catch(console.error);
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

      {attendee.responses && Object.keys(attendee.responses).length > 0 && (
        <div className="card detail-section">
          <h3>Form Responses</h3>
          <div className="responses-list">
            {Object.entries(attendee.responses).map(([question, answer]) => (
              <div key={question} className="response-item">
                <div className="question">{question}</div>
                <div className="answer">{answer}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
