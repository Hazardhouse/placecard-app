import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type SalonEvent = {
  id: number;
  name: string;
  public_token: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  venue: string | null;
  image_data: string | null;
};

type SalonDetail = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  visibility: "public" | "unlisted" | "private";
  join_mode: "closed" | "request_to_join" | "open";
  event_count: number;
  host_handle: string;
  host_display_name: string;
  host_photo_url: string | null;
  events: SalonEvent[];
};

function formatEventDate(start: string | null, end: string | null): string {
  if (!start) return "";
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return "";
  const sStr = s.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (!end) return sStr;
  const e = new Date(end);
  if (Number.isNaN(e.getTime()) || start.slice(0, 10) === end.slice(0, 10)) return sStr;
  const eStr = e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${sStr} – ${eStr}`;
}

export default function SalonPage({ handle, salonSlug }: { handle: string; salonSlug: string }) {
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getSalonDetail(handle, salonSlug)
      .then(s => setSalon(s as SalonDetail))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [handle, salonSlug]);

  if (loading) {
    return (
      <div className="profile-page">
        <p style={{ color: "#64748b" }}>Loading…</p>
      </div>
    );
  }

  if (error || !salon) {
    return (
      <div className="profile-page">
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Salon not found</h1>
        <p style={{ color: "#64748b" }}>No salon at <code>@{handle}/{salonSlug}</code>.</p>
        <Link to={`/@${handle}`} style={{ color: "#1b4fff" }}>← Back to @{handle}</Link>
      </div>
    );
  }

  const joinModeLabel =
    salon.join_mode === "open" ? "Open — anyone can join"
    : salon.join_mode === "closed" ? "Invite-only"
    : "Request to join";

  return (
    <div className="profile-page">
      <div style={{ marginBottom: 20 }}>
        <Link to={`/@${salon.host_handle}`} style={{ color: "#64748b", fontSize: 14, textDecoration: "none" }}>
          ← @{salon.host_handle}
        </Link>
      </div>

      <header className="salon-header">
        <div
          className="salon-cover"
          style={salon.cover_image_url
            ? { backgroundImage: `url(${salon.cover_image_url})` }
            : undefined}
        />
        <div className="salon-header-text">
          <h1 className="profile-display-name" style={{ marginBottom: 6 }}>{salon.name}</h1>
          <div className="profile-handle" style={{ marginBottom: 8 }}>
            Hosted by{" "}
            <Link to={`/@${salon.host_handle}`} style={{ color: "#1b4fff", textDecoration: "none" }}>
              {salon.host_display_name}
            </Link>
            {" · "}
            <span style={{ fontSize: 13 }}>{joinModeLabel}</span>
          </div>
          {salon.description && (
            <p className="profile-bio">{salon.description}</p>
          )}
          {salon.join_mode !== "closed" && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 12 }}
              disabled
              title="Coming soon in Phase I-C"
            >
              {salon.join_mode === "open" ? "Join salon" : "Request to join"}
            </button>
          )}
        </div>
      </header>

      <section className="profile-events" style={{ marginTop: 32 }}>
        <h2 className="profile-section-title">
          Events <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 14 }}>·  {salon.events.length}</span>
        </h2>
        {salon.events.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>No events scheduled yet.</p>
        ) : (
          <div className="profile-events-grid">
            {salon.events.map(ev => (
              <SalonEventCard
                key={ev.id}
                event={ev}
                hostName={salon.host_display_name}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SalonEventCard({ event, hostName }: { event: SalonEvent; hostName: string }) {
  const dateStr = formatEventDate(event.start_date, event.end_date);
  const body = (
    <div className="profile-event-card">
      <div
        className="profile-event-card-image"
        style={event.image_data ? { backgroundImage: `url(${event.image_data})` } : undefined}
      />
      <div className="profile-event-card-body">
        <div className="profile-event-card-name">{event.name}</div>
        {dateStr && <div className="profile-event-card-date">{dateStr}</div>}
        {(event.venue || event.location) && (
          <div className="profile-event-card-location">
            {event.venue ? `${event.venue} · ${event.location ?? ""}`.replace(/ · $/, "") : event.location}
          </div>
        )}
        <div className="profile-event-card-host">Hosted by {hostName}</div>
      </div>
    </div>
  );
  if (!event.public_token) return body;
  return (
    <Link to={`/event/${event.public_token}`} className="profile-event-card-link">
      {body}
    </Link>
  );
}
