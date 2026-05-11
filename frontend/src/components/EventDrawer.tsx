import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Event } from "../types";
import { fileToCompressedDataUrl } from "../utils/image";
import DatePicker from "./DatePicker";

const EVENT_CATEGORIES = [
  { value: "conference", label: "Conference / Event" },
  { value: "retreat", label: "Retreat" },
  { value: "wedding", label: "Wedding & Formal" },
  { value: "social", label: "Social Event" },
];

const VENUE_TYPES = [
  "Restaurant", "Pub", "Bar", "Hotel", "Ballroom", "Park",
  "Museum", "Gallery", "Conference Centre", "Private Club", "Rooftop",
  "Vineyard", "Beach", "Garden", "Farm", "Other",
];

const VENUE_TYPE_ICONS: Record<string, string> = {
  "Restaurant": "🍽", "Pub": "🍺", "Bar": "🍸", "Hotel": "🏨", "Ballroom": "✨",
  "Park": "🌳", "Museum": "🏛", "Gallery": "🖼", "Conference Centre": "🏢",
  "Private Club": "🎩", "Rooftop": "🌆", "Vineyard": "🍷", "Beach": "🏖",
  "Garden": "🌿", "Farm": "🌾", "Other": "📍",
};

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

type Prediction = { place_id: string; description: string; main_text: string; secondary_text: string };

type Props = {
  open: boolean;
  event: Event | null; // null = create mode
  onClose: () => void;
  onSaved: (event: Event, isNew: boolean) => void;
  onDeleted?: (eventId: number) => void;
};

/**
 * Slide-out drawer for creating or editing an event. The same UI is used
 * from the events list (create + edit) and from inside an event detail
 * page (edit only). Owns its own form state — parent supplies callbacks
 * for what to do after a save or delete completes.
 */
export default function EventDrawer({ open, event, onClose, onSaved, onDeleted }: Props) {
  const editing = !!event;

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [venue, setVenue] = useState("");
  const [venueType, setVenueType] = useState("");
  const [eventCategory, setEventCategory] = useState("");
  const [description, setDescription] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [openPicker, setOpenPicker] = useState<null | "start" | "end">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Location autocomplete (Google Places via /api/places/autocomplete)
  const [locationSuggestions, setLocationSuggestions] = useState<Prediction[]>([]);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const locationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync form state with the event prop whenever the drawer opens.
  // (Resetting on close as well so the next "create" doesn't show stale data.)
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (event) {
      setName(event.name);
      setStartDate(toDateInputValue(event.start_date));
      setEndDate(toDateInputValue(event.end_date));
      setLocation(event.location || "");
      setVenue(event.venue || "");
      setVenueType(event.venue_type || "");
      setEventCategory(event.event_category || "");
      setDescription(event.description || "");
      setImageData(event.image_data || null);
    } else {
      setName(""); setStartDate(""); setEndDate("");
      setLocation(""); setVenue(""); setVenueType("");
      setEventCategory(""); setDescription("");
      setImageData(null);
    }
  }, [open, event]);

  const onLocationInput = useCallback((value: string) => {
    setLocation(value);
    if (locationTimer.current) clearTimeout(locationTimer.current);
    if (value.trim().length < 3) {
      setLocationSuggestions([]);
      setShowLocationSuggestions(false);
      return;
    }
    locationTimer.current = setTimeout(async () => {
      try {
        const data = await api.placesAutocomplete(value, "geocode");
        setLocationSuggestions(data.predictions);
        setShowLocationSuggestions(data.predictions.length > 0);
      } catch {
        setLocationSuggestions([]);
        setShowLocationSuggestions(false);
      }
    }, 250);
  }, []);

  const selectLocation = useCallback((p: Prediction) => {
    setLocation(p.description);
    setShowLocationSuggestions(false);
    setLocationSuggestions([]);
  }, []);

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageBusy(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 1000, 1000, 0.82);
      setImageData(dataUrl);
    } catch (err) {
      console.error("Image compression failed:", err);
    } finally {
      setImageBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handleRemoveImage = () => setImageData(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const data = {
      name,
      start_date: startDate ? new Date(startDate).toISOString() : null,
      end_date: endDate ? new Date(endDate).toISOString() : null,
      location: location || null,
      venue: venue || null,
      venue_type: venueType || null,
      event_category: eventCategory || null,
      description: description || null,
      image_data: imageData,
    } as Partial<Event>;

    try {
      if (event) {
        const updated = await api.updateEvent(event.id, data);
        onSaved(updated, false);
      } else {
        const created = await api.createEvent(data);
        onSaved(created, true);
      }
    } catch (err) {
      console.error("Failed to save event:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event || !onDeleted) return;
    setDeleting(true);
    try {
      await api.deleteEvent(event.id);
      onDeleted(event.id);
    } catch (err) {
      console.error("Failed to delete event:", err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}

      <div className={`drawer ${open ? "drawer-open" : ""}`}>
        <div className="drawer-header">
          <h2 className="drawer-title">{editing ? "Edit Event" : "New Event"}</h2>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <form className="drawer-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Event Image</label>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImageSelected}
            />
            <div className="event-drawer-image-row">
              <div className="event-drawer-image-preview">
                {imageData ? (
                  <img src={imageData} alt="Event" />
                ) : (
                  <span className="event-drawer-image-placeholder" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="event-drawer-image-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={imageBusy}
                >
                  {imageBusy ? "Processing…" : imageData ? "Replace image" : "Upload image"}
                </button>
                {imageData && (
                  <button type="button" className="btn btn-sm" onClick={handleRemoveImage} disabled={imageBusy}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="form-group">
            <label>Event Type</label>
            <div className="event-category-options">
              {EVENT_CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  type="button"
                  className={`event-category-btn ${eventCategory === cat.value ? "active" : ""}`}
                  onClick={() => setEventCategory(eventCategory === cat.value ? "" : cat.value)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Event Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Annual Gala Dinner"
              required
              autoFocus={open}
            />
          </div>
          <div className="form-group">
            <label>Description *</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="This event is a weekend retreat for entrepreneurs who grow their businesses and network with like-minded entrepreneurs."
              rows={3}
              required
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Start Date</label>
              <DatePicker
                value={startDate}
                placeholder="Pick a start date"
                label="Start date"
                open={openPicker === "start"}
                onOpen={() => setOpenPicker("start")}
                onClose={() => setOpenPicker(p => (p === "start" ? null : p))}
                onChange={(v) => {
                  setStartDate(v);
                  if (!endDate || v > endDate) setEndDate(v);
                }}
                onPick={() => {
                  setOpenPicker("end");
                }}
              />
            </div>
            <div className="form-group">
              <label>End Date</label>
              <DatePicker
                value={endDate}
                placeholder="Pick an end date"
                label="End date"
                minDate={startDate || undefined}
                open={openPicker === "end"}
                onOpen={() => setOpenPicker("end")}
                onClose={() => setOpenPicker(p => (p === "end" ? null : p))}
                onChange={setEndDate}
              />
            </div>
          </div>
          <div className="form-group" style={{ position: "relative" }}>
            <label>Location</label>
            <input
              type="text"
              value={location}
              onChange={e => onLocationInput(e.target.value)}
              onFocus={() => locationSuggestions.length > 0 && setShowLocationSuggestions(true)}
              onBlur={() => setTimeout(() => setShowLocationSuggestions(false), 150)}
              placeholder="e.g. Montpellier, France"
              autoComplete="off"
            />
            {showLocationSuggestions && locationSuggestions.length > 0 && (
              <ul className="autocomplete-list">
                {locationSuggestions.map(p => (
                  <li key={p.place_id} onMouseDown={() => selectLocation(p)}>
                    <span className="autocomplete-main">{p.main_text}</span>
                    {p.secondary_text && (
                      <span className="autocomplete-secondary">{p.secondary_text}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Venue Name</label>
              <input
                type="text"
                value={venue}
                onChange={e => setVenue(e.target.value)}
                placeholder="e.g. Grand Ballroom"
              />
            </div>
            <div className="form-group">
              <label>Venue Type</label>
              <select value={venueType} onChange={e => setVenueType(e.target.value)}>
                <option value="">Select type…</option>
                {VENUE_TYPES.map(t => (
                  <option key={t} value={t}>{VENUE_TYPE_ICONS[t]} {t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="drawer-footer">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Event"}
            </button>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            {editing && onDeleted && !confirmDelete && (
              <button
                type="button"
                className="drawer-delete-btn"
                onClick={() => setConfirmDelete(true)}
                style={{ marginLeft: "auto" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                </svg>
                Delete event
              </button>
            )}
          </div>

          {editing && onDeleted && confirmDelete && event && (
            <div className="drawer-delete-section">
              <div className="drawer-delete-confirm">
                <p>Delete <strong>{event.name}</strong>? This also removes its attendees, seating, schedule, and any share links. This cannot be undone.</p>
                <div className="drawer-delete-confirm-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Keep event
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting…" : "Yes, delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
