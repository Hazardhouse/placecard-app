import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import logoSvg from "../assets/placecard-logo.svg";
import EventMapCard from "../components/EventMapCard";
import type { Event } from "../types";

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return "";
  const s = new Date(start);
  const month = s.toLocaleDateString("en-US", { month: "long" });
  const year = s.getFullYear();
  const startDay = s.getDate();
  if (!end) return `${month} ${startDay}, ${year}`;
  const e = new Date(end);
  if (s.toDateString() === e.toDateString()) return `${month} ${startDay}, ${year}`;
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${month} ${startDay}–${e.getDate()}, ${year}`;
  }
  const endMonth = e.toLocaleDateString("en-US", { month: "long" });
  return `${month} ${startDay} – ${endMonth} ${e.getDate()}, ${e.getFullYear()}`;
}

const CATEGORY_EMOJI: Record<string, string> = {
  wedding: "💍",
  retreat: "🌿",
  social: "🥂",
  conference: "✨",
  corporate: "✨",
};

export default function PublicEvent() {
  const { token } = useParams<{ token: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .getPublicEvent(token)
      .then(setEvent)
      .catch(e => setError(e.message || "This event link is invalid."))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="public-event-page">
        <div className="public-event-card"><p>Loading…</p></div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="public-event-page">
        <div className="public-event-card">
          <h1>Event not found</h1>
          <p>{error || "This event link is invalid or has been deleted."}</p>
        </div>
      </div>
    );
  }

  const emoji = (event.event_category && CATEGORY_EMOJI[event.event_category]) || "✨";

  return (
    <div className="public-event-page">
      <div className="public-event-card">
        <img src={logoSvg} alt="PlaceCard" className="public-event-logo" />

        {event.image_data ? (
          <div className="public-event-hero public-event-hero-photo">
            <img src={event.image_data} alt={event.name} />
          </div>
        ) : (
          <div className="public-event-hero" aria-hidden="true">
            <span className="public-event-hero-icon">{emoji}</span>
          </div>
        )}

        <h1 className="public-event-name">{event.name}</h1>

        <div className="public-event-meta">
          {event.start_date && (
            <div className="public-event-meta-line">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{formatDateRange(event.start_date, event.end_date)}</span>
            </div>
          )}
          {(event.venue || event.location) && (
            <div className="public-event-meta-line">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>
                {event.venue}
                {event.venue && event.location && " · "}
                {event.location}
              </span>
            </div>
          )}
        </div>

        {event.description && (
          <p className="public-event-description">{event.description}</p>
        )}

        {(event.venue || event.location) && (
          <EventMapCard venue={event.venue} location={event.location} />
        )}

        <footer className="public-event-footer">
          <p>Hosted via <a href="https://placecard-events.app">PlaceCard</a></p>
        </footer>
      </div>
    </div>
  );
}
