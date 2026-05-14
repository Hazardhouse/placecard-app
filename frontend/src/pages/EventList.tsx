import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Event } from "../types";
import EventDrawer from "../components/EventDrawer";

const EVENT_CATEGORIES = [
  { value: "conference", label: "Conference / Event" },
  { value: "retreat", label: "Retreat" },
  { value: "wedding", label: "Wedding & Formal" },
  { value: "social", label: "Social Event" },
];

const VENUE_TYPE_ICONS: Record<string, string> = {
  "Home": "🏠",
  "Restaurant": "🍽", "Pub": "🍺", "Bar": "🍸", "Hotel": "🏨", "Ballroom": "✨",
  "Park": "🌳", "Museum": "🏛", "Gallery": "🖼", "Conference Centre": "🏢",
  "Private Club": "🎩", "Rooftop": "🌆", "Vineyard": "🍷", "Beach": "🏖",
  "Garden": "🌿", "Farm": "🌾", "Other": "📍",
};

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

type EventFilter = "upcoming" | "past";

function isEventPast(ev: Event): boolean {
  // An event is "past" when it has a date AND that date is before today.
  // If no end_date, fall back to start_date. Events with no date at all are
  // treated as upcoming (they haven't been scheduled yet).
  const endish = ev.end_date || ev.start_date;
  if (!endish) return false;
  const end = new Date(endish);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return end < startOfToday;
}

export default function EventList() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [filter, setFilter] = useState<EventFilter>("upcoming");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  useEffect(() => {
    api.listEvents().then(setEvents).catch(console.error);
  }, []);

  const openCreateDrawer = () => { setEditingEvent(null); setDrawerOpen(true); };
  const openEditDrawer = (event: Event) => {
    setEditingEvent(event);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingEvent(null);
  };

  const handleSaved = (saved: Event, isNew: boolean) => {
    if (isNew) {
      setEvents(prev => [saved, ...prev]);
      closeDrawer();
      // Drop the user straight into the new event's Attendees tab
      navigate(`/events/${saved.id}`);
    } else {
      setEvents(prev => prev.map(ev => ev.id === saved.id ? saved : ev));
      closeDrawer();
    }
  };

  const handleDeleted = (id: number) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    closeDrawer();
  };

  const handleDuplicate = async (source: Event) => {
    // Deep-clone: metadata + attendees + tables + schedule + seating
    // arrangements + seat assignments + custom forms are all carried over
    // server-side. Share tokens are regenerated so old links keep pointing at
    // the source event.
    const copy = await api.duplicateEvent(source.id);
    setEvents(prev => [copy, ...prev]);
  };

  const upcomingCount = events.filter(e => !isEventPast(e)).length;
  const pastCount = events.filter(isEventPast).length;
  const filteredEvents = events.filter(e => (filter === "past" ? isEventPast(e) : !isEventPast(e)));

  return (
    <div className="page">
      <div className="page-header">
        <h1>Events</h1>
        <div className="event-filter-toggle" role="tablist" aria-label="Filter events">
          <button
            role="tab"
            aria-selected={filter === "upcoming"}
            className={`event-filter-btn ${filter === "upcoming" ? "event-filter-btn-active" : ""}`}
            onClick={() => setFilter("upcoming")}
          >
            Upcoming
            {upcomingCount > 0 && <span className="event-filter-count">{upcomingCount}</span>}
          </button>
          <button
            role="tab"
            aria-selected={filter === "past"}
            className={`event-filter-btn ${filter === "past" ? "event-filter-btn-active" : ""}`}
            onClick={() => setFilter("past")}
          >
            Past
            {pastCount > 0 && <span className="event-filter-count">{pastCount}</span>}
          </button>
        </div>
      </div>

      <div className="event-grid">
        {filter === "upcoming" && (
          <button className="event-card-add" onClick={openCreateDrawer}>
            <span className="event-card-add-icon">+</span>
            <span className="event-card-add-label">New Event</span>
          </button>
        )}

        {filteredEvents.map((event) => (
          <div key={event.id} className="card event-card" style={{ position: "relative" }}>
            <div className="event-card-actions">
              <button
                className="event-card-action-btn"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditDrawer(event); }}
                title="Edit event"
                aria-label="Edit event"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button
                className="event-card-action-btn"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDuplicate(event); }}
                title="Duplicate event"
                aria-label="Duplicate event"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
            <Link to={`/events/${event.id}`} className="event-card-link">
              <h3 className="event-card-title">
                {event.name}
                {" "}
                <span className="event-attendee-count" title={`${event.attendee_count} attendees`}>
                  {event.attendee_count}
                </span>
              </h3>
              <div className="event-meta">
                {(event.start_date || event.end_date) && (
                  <div>{formatDateRange(event.start_date, event.end_date)}</div>
                )}
                {event.location && <div>{event.location}</div>}
              </div>
              {event.event_category && (
                <div className="event-category-badge-row">
                  <span className="event-category-badge">{EVENT_CATEGORIES.find(c => c.value === event.event_category)?.label ?? event.event_category}</span>
                </div>
              )}
              {(event.venue || event.venue_type) && (
                <div className="event-venue">
                  {event.venue_type && (
                    <span className="venue-type-badge">
                      {VENUE_TYPE_ICONS[event.venue_type] ?? "📍"} {event.venue_type}
                    </span>
                  )}
                  {event.venue && <span>{event.venue}</span>}
                </div>
              )}
            </Link>
          </div>
        ))}

        {filteredEvents.length === 0 && filter === "past" && (
          <div className="event-filter-empty">No past events yet.</div>
        )}
      </div>

      <EventDrawer
        open={drawerOpen}
        event={editingEvent}
        onClose={closeDrawer}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
