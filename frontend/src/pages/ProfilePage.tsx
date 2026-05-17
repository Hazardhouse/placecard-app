import { useEffect, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { api, type ProfileShape } from "../api/client";

type HostedEvent = {
  id: number;
  name: string;
  public_token: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  venue: string | null;
  image_data: string | null;
  is_private: boolean;
  salon_id: number | null;
  salon_slug: string | null;
  salon_name: string | null;
};

type ProfileSalon = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  event_count: number;
};

type FullProfile = ProfileShape & {
  hosted_events: HostedEvent[];
  salons: ProfileSalon[];
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

export default function ProfilePage() {
  // RR7 won't bind a param after a literal `@`, so App.tsx dispatches
  // here based on pathname.startsWith("/@") and we strip the prefix
  // directly off useLocation.
  const location = useLocation();
  const handle = location.pathname.slice(2).toLowerCase();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    setError(null);
    api.getProfileByHandle(handle)
      .then(setProfile)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [handle]);

  if (loading) {
    return (
      <div className="profile-page">
        <p style={{ color: "#64748b" }}>Loading…</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="profile-page">
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Profile not found</h1>
        <p style={{ color: "#64748b" }}>No host at <code>@{handle}</code>.</p>
        <Link to="/" style={{ color: "#1b4fff" }}>← Back home</Link>
      </div>
    );
  }

  const initials = profile.display_name
    .split(" ")
    .map(p => p[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div className="profile-avatar">
          {profile.photo_url ? (
            <img src={profile.photo_url} alt={profile.display_name} />
          ) : (
            <span className="profile-avatar-initials">{initials}</span>
          )}
        </div>
        <div className="profile-header-text">
          <h1 className="profile-display-name">{profile.display_name}</h1>
          <div className="profile-handle">@{profile.handle}</div>
          {profile.city && <div className="profile-city">{profile.city}</div>}
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        </div>
      </header>

      {profile.salons.length > 0 && (
        <section className="profile-salons">
          <h2 className="profile-section-title">
            Salons <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 14 }}>·  {profile.salons.length}</span>
          </h2>
          <div className="profile-salons-grid">
            {profile.salons.map(s => (
              <Link
                key={s.id}
                to={`/@${profile.handle}/${s.slug}`}
                className="profile-salon-card-link"
              >
                <div
                  className="profile-salon-card"
                  style={s.cover_image_url ? { backgroundImage: `url(${s.cover_image_url})` } : undefined}
                >
                  <div className="profile-salon-card-body">
                    <div className="profile-salon-name">{s.name}</div>
                    <div className="profile-salon-meta">
                      {s.event_count} event{s.event_count === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="profile-events">
        <h2 className="profile-section-title">Hosted events</h2>
        {profile.hosted_events.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>No events yet.</p>
        ) : (
          <div className="profile-events-grid">
            {profile.hosted_events.map(ev => (
              <ProfileEventCard
                key={ev.id}
                event={ev}
                hostName={profile.display_name}
                hostHandle={profile.handle}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProfileEventCard({
  event, hostName, hostHandle,
}: { event: HostedEvent; hostName: string; hostHandle: string }) {
  const isPrivate = event.is_private;
  const dateStr = formatEventDate(event.start_date, event.end_date);

  const body = (
    <div className={`profile-event-card ${isPrivate ? "is-private" : ""}`}>
      <div
        className="profile-event-card-image"
        style={event.image_data && !isPrivate
          ? { backgroundImage: `url(${event.image_data})` }
          : undefined}
      >
        {isPrivate && <span className="profile-event-private-label">Private event</span>}
        {!isPrivate && event.salon_name && (
          <span className="profile-event-salon-tag">{event.salon_name}</span>
        )}
      </div>
      <div className="profile-event-card-body">
        <div className="profile-event-card-name">
          {isPrivate ? "Private event" : event.name}
        </div>
        {dateStr && <div className="profile-event-card-date">{dateStr}</div>}
        {!isPrivate && (event.venue || event.location) && (
          <div className="profile-event-card-location">
            {event.venue ? `${event.venue} · ${event.location ?? ""}`.replace(/ · $/, "") : event.location}
          </div>
        )}
        <div className="profile-event-card-host">Hosted by {hostName}</div>
      </div>
    </div>
  );

  // Private events render as a sealed card with no detail link.
  if (isPrivate) return body;
  // Prefer the salon page when the event belongs to one — that's the
  // canonical context for it. Fall back to the standalone public-event
  // URL otherwise.
  const href = event.salon_slug
    ? `/@${hostHandle}/${event.salon_slug}`
    : event.public_token
      ? `/event/${event.public_token}`
      : null;
  if (!href) return body;
  return (
    <Link to={href} className="profile-event-card-link">
      {body}
    </Link>
  );
}
