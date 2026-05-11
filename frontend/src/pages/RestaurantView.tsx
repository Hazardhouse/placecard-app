import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import logoSvg from "../assets/placecard-logo.svg";

type Variant = "attendees" | "seating";

type SeatEntry = {
  seat_number: number;
  attendee_name: string | null;
  dietary: string | null;
};

type SeatingTable = {
  id: number;
  name: string;
  shape: string | null;
  capacity: number;
  seats: SeatEntry[];
};

type MealCount = { option: string; count: number };
type MealCourseTotals = { course: string; totals: MealCount[] };
type MealVenueTotals = { venue: string; total_guests: number; courses: MealCourseTotals[] };

type SeatingArrangementView = {
  id: number;
  name: string;
  tables: SeatingTable[];
  meal_totals?: MealVenueTotals[];
};

type RestaurantViewData = {
  variant: Variant;
  event_name: string;
  event_date: string | null;
  event_location: string | null;
  total_attendees: number;
  confirmed_count: number;
  pending_count: number;
  declined_count: number;
  dietary_breakdown: { label: string; icon: string; count: number }[];
  attendees: { name: string; dietary: string | null }[];
  arrangements: SeatingArrangementView[];
};

export default function RestaurantView() {
  const { variant, shareToken } = useParams<{ variant: string; shareToken: string }>();
  const [data, setData] = useState<RestaurantViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeArrangement, setActiveArrangement] = useState<number | null>(null);

  useEffect(() => {
    if (!shareToken || !variant || (variant !== "attendees" && variant !== "seating")) {
      setError("Invalid link.");
      setLoading(false);
      return;
    }
    api
      .getRestaurantView(variant as Variant, shareToken)
      .then(d => {
        setData(d);
        if (d.arrangements.length > 0) setActiveArrangement(d.arrangements[0].id);
      })
      .catch(e => setError(e.message || "This link is invalid or has been revoked."))
      .finally(() => setLoading(false));
  }, [shareToken, variant]);

  if (loading) {
    return (
      <div className="restaurant-view-page">
        <div className="restaurant-view-card"><p>Loading…</p></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="restaurant-view-page">
        <div className="restaurant-view-card">
          <h1>Link unavailable</h1>
          <p>{error || "This share link is invalid or has been revoked."}</p>
        </div>
      </div>
    );
  }

  const current = data.arrangements.find(a => a.id === activeArrangement) ?? data.arrangements[0];

  return (
    <div className="restaurant-view-page">
      <div className="restaurant-view-card">
        <header className="rv-header">
          <img src={logoSvg} alt="PlaceCard" className="rv-logo" />
          <h1>{data.event_name}</h1>
          <div className="rv-event-meta">
            {data.event_date && <span>{data.event_date}</span>}
            {data.event_date && data.event_location && <span className="rv-dot">•</span>}
            {data.event_location && <span>{data.event_location}</span>}
          </div>
          <p className="rv-subtitle">
            {data.variant === "seating"
              ? "Seating chart with dietary requirements — prepared by the event organizer."
              : "Attendee summary for catering — prepared by the event organizer."}
          </p>
        </header>

        <section className="rv-stats">
          <div className="rv-stat-card rv-stat-total">
            <div className="rv-stat-label">Total attendees</div>
            <div className="rv-stat-number">{data.total_attendees}</div>
          </div>
          <div className="rv-stat-card">
            <div className="rv-stat-label">Confirmed</div>
            <div className="rv-stat-number rv-stat-confirmed">{data.confirmed_count}</div>
          </div>
          <div className="rv-stat-card">
            <div className="rv-stat-label">Pending</div>
            <div className="rv-stat-number rv-stat-pending">{data.pending_count}</div>
          </div>
          <div className="rv-stat-card">
            <div className="rv-stat-label">Declined</div>
            <div className="rv-stat-number rv-stat-declined">{data.declined_count}</div>
          </div>
        </section>

        <section className="rv-section">
          <h2>Dietary requirements</h2>
          {data.dietary_breakdown.length === 0 ? (
            <p className="rv-muted">No dietary information recorded yet.</p>
          ) : (
            <div className="rv-diet-grid">
              {data.dietary_breakdown.map(d => (
                <div key={d.label} className="rv-diet-card">
                  <div className="rv-diet-icon">{d.icon}</div>
                  <div className="rv-diet-count">{d.count}</div>
                  <div className="rv-diet-label">{d.label}</div>
                </div>
              ))}
            </div>
          )}
          <p className="rv-hint">
            Totals add up to more than the attendee count when a guest has multiple
            requirements (e.g. vegetarian and gluten-free).
          </p>
        </section>

        {data.variant === "attendees" && (
          <section className="rv-section">
            <h2>Guest list</h2>
            {data.attendees.length === 0 ? (
              <p className="rv-muted">No attendees added yet.</p>
            ) : (
              <div className="rv-attendee-list">
                <div className="rv-attendee-head">
                  <span>Name</span>
                  <span>Dietary requirements</span>
                </div>
                {data.attendees.map((a, i) => (
                  <div key={i} className="rv-attendee-row">
                    <span className="rv-attendee-name">{a.name}</span>
                    <span className="rv-attendee-diet">{a.dietary || <span className="rv-muted">—</span>}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {data.variant === "seating" && (
          <section className="rv-section">
            <h2>Seating chart</h2>
            {data.arrangements.length === 0 ? (
              <p className="rv-muted">No seating chart has been set up yet.</p>
            ) : (
              <>
                {data.arrangements.length > 1 && (
                  <div className="rv-arr-tabs">
                    {data.arrangements.map(arr => (
                      <button
                        key={arr.id}
                        className={`rv-arr-tab ${current?.id === arr.id ? "rv-arr-tab-active" : ""}`}
                        onClick={() => setActiveArrangement(arr.id)}
                      >
                        {arr.name}
                      </button>
                    ))}
                  </div>
                )}
                {current && current.meal_totals && current.meal_totals.length > 0 && (
                  <div className="rv-meal-totals">
                    <h3 className="rv-meal-totals-heading">Meal counts for catering</h3>
                    {current.meal_totals.map(mv => (
                      <div key={mv.venue} className="rv-meal-venue">
                        <div className="rv-meal-venue-header">
                          <span className="rv-meal-venue-name">{mv.venue}</span>
                          <span className="rv-meal-venue-count">
                            {mv.total_guests} guest{mv.total_guests !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {mv.courses.length === 0 ? (
                          <p className="rv-muted" style={{ margin: 0 }}>No course selections yet.</p>
                        ) : (
                          <div className="rv-meal-courses">
                            {mv.courses.map(c => (
                              <div key={c.course} className="rv-meal-course">
                                <div className="rv-meal-course-label">{c.course}</div>
                                <ul className="rv-meal-course-list">
                                  {c.totals.map(t => (
                                    <li key={t.option} className="rv-meal-option">
                                      <span className="rv-meal-option-count">{t.count}</span>
                                      <span className="rv-meal-option-name">{t.option}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {current && (
                  <div className="rv-tables-grid">
                    {current.tables.map(table => {
                      const seated = table.seats.filter(s => s.attendee_name).length;
                      return (
                        <div key={table.id} className="rv-table-card">
                          <div className="rv-table-head">
                            <span className="rv-table-name">{table.name}</span>
                            <span className="rv-table-count">
                              {seated} / {table.capacity}
                            </span>
                          </div>
                          {table.seats.every(s => !s.attendee_name) ? (
                            <p className="rv-muted rv-table-empty">No guests seated.</p>
                          ) : (
                            <ol className="rv-seat-list">
                              {table.seats.map(seat =>
                                seat.attendee_name ? (
                                  <li key={seat.seat_number} className="rv-seat">
                                    <span className="rv-seat-num">{seat.seat_number}</span>
                                    <span className="rv-seat-name">{seat.attendee_name}</span>
                                    {seat.dietary && (
                                      <span className="rv-seat-diet">{seat.dietary}</span>
                                    )}
                                  </li>
                                ) : (
                                  <li key={seat.seat_number} className="rv-seat rv-seat-empty">
                                    <span className="rv-seat-num">{seat.seat_number}</span>
                                    <span className="rv-muted">Empty</span>
                                  </li>
                                ),
                              )}
                            </ol>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <footer className="rv-footer">
          <p>
            Personal contact details (email, phone, notes) are intentionally hidden from this view.
          </p>
        </footer>
      </div>
    </div>
  );
}
