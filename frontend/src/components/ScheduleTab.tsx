import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../api/client";
import type { ScheduleItem } from "../types";
import Tesseract from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const EVENT_TYPES = [
  "Coffee", "Workshop", "Breakfast", "Lunch", "Dinner",
  "Mastermind", "Speaker", "Drinks",
  "Walk", "Hike", "Cycle", "Climbing", "Tour", "Photoshoot",
];

const EVENT_TYPE_ICONS: Record<string, string> = {
  Coffee: "☕", Workshop: "🛠", Breakfast: "🥐", Lunch: "🥗", Dinner: "🍽",
  Mastermind: "🧠", Speaker: "🎤", Drinks: "🍸",
  Walk: "🚶", Hike: "🥾", Cycle: "🚴", Climbing: "🧗", Tour: "🗺", Photoshoot: "📸",
};

const VENUE_TYPE_ICONS: Record<string, string> = {
  Home: "🏠",
  Restaurant: "🍽", Pub: "🍺", Bar: "🍸", Hotel: "🏨", Ballroom: "✨",
  Park: "🌳", Museum: "🏛", Gallery: "🖼", "Conference Centre": "🏢",
  "Private Club": "🎩", Rooftop: "🌆", Vineyard: "🍷", Beach: "🏖",
  Garden: "🌿", Farm: "🌾",
};

interface Props {
  eventId: number;
  items: ScheduleItem[];
  onItemsChange: (items: ScheduleItem[]) => void;
  // Event-level dates — when the event is single-day (start == end),
  // new schedule items pre-fill their date so the organizer doesn't
  // have to type it for every item.
  eventStartDate?: string | null;
  eventEndDate?: string | null;
  // Counter signal from the parent. Each time the value increments
  // (e.g. the Seating tab's "Add a schedule item" CTA fires), we open
  // the new-item drawer automatically. A counter rather than a bool
  // means a second CTA click reopens even if the user dismissed the
  // drawer in between — there's nothing to reset.
  openAddSignal?: number;
}

function formatTime(dt: string | null) {
  if (!dt) return null;
  const d = new Date(dt);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Group items by date
function groupByDate(items: ScheduleItem[]): { date: string | null; items: ScheduleItem[] }[] {
  const groups: Record<string, ScheduleItem[]> = {};
  const noDate: ScheduleItem[] = [];
  for (const item of items) {
    if (!item.start_time) { noDate.push(item); continue; }
    const dateKey = new Date(item.start_time).toDateString();
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(item);
  }
  const result: { date: string | null; items: ScheduleItem[] }[] =
    Object.entries(groups).map(([date, items]) => ({ date, items }));
  if (noDate.length) result.push({ date: null, items: noDate });
  return result;
}

// 10:00 (10 AM, 24-hour format matching the <input type="time"> value
// shape) is the default start hour for any new schedule item — most
// PlaceCard events kick off mid-morning, and pre-filling beats forcing
// the user to choose for every welcome-drinks / gala-dinner row.
const EMPTY_FORM = {
  title: "", description: "", start_date: "", end_date: "", start_hour: "10:00", end_hour: "",
  venue_name: "", venue_type: "", location: "", notes: "",
  requires_seating: true,
  has_meal: false,
  meal_entrees: "",   // comma-separated
  meal_mains: "",
  meal_desserts: "",
  meal_drinks: "",
};

function _splitCsv(s: string): string[] {
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function _joinCsv(arr: string[] | undefined | null): string {
  return (arr ?? []).join(", ");
}

// Generate time options in 15-minute increments
function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const value = `${hh}:${mm}`;
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? "AM" : "PM";
      const label = `${hour12}:${mm} ${ampm}`;
      options.push({ value, label });
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

function formatTimeDisplay(value: string): string {
  if (!value) return "";
  const [hStr, mStr] = value.split(":");
  const h = parseInt(hStr);
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:${mStr} ${ampm}`;
}

function TimePicker({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Scroll to selected value when opening
  useEffect(() => {
    if (open && listRef.current && value) {
      const idx = TIME_OPTIONS.findIndex(o => o.value === value);
      if (idx >= 0) {
        const item = listRef.current.children[idx] as HTMLElement;
        if (item) item.scrollIntoView({ block: "center" });
      }
    }
  }, [open, value]);

  return (
    <div className="time-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="time-picker-input"
        onClick={() => setOpen(!open)}
      >
        {value ? formatTimeDisplay(value) : <span className="time-picker-placeholder">{placeholder || "Select time"}</span>}
        <span className="time-picker-icon">▾</span>
      </button>
      {open && (
        <div className="time-picker-dropdown" ref={listRef}>
          {TIME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`time-picker-option${opt.value === value ? " selected" : ""}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Parse a program document text into schedule item payloads */
function parseProgram(text: string) {
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  const items: { title: string; start_time: string | null; end_time: string | null; venue_name: string | null; venue_type: string | null; location: string | null; notes: string | null }[] = [];

  // Try to detect a date context from the document
  let currentDate: string | null = null;

  // Match common date patterns: "Friday, March 27, 2026" or "27/03/2026" or "2026-03-27"
  const datePatterns = [
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,\s]+(\w+ \d{1,2}[,\s]+\d{4})/i,
    /(\w+ \d{1,2}[,\s]+\d{4})/i,
  ];

  // Time pattern: "8:00 AM", "08:00", "8:00am", "08:00 - 10:00", "8:00 AM – 10:00 AM"
  const timeRe = /(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)\s*(?:[-–—to]+\s*(\d{1,2}[:.]\d{2}\s*(?:am|pm)?))?/i;

  // Match event type keywords
  const typeKeywords: Record<string, string> = {};
  for (const t of EVENT_TYPES) {
    typeKeywords[t.toLowerCase()] = t;
  }

  for (const line of lines) {
    // Check if line is a date header
    let isDate = false;
    for (const dp of datePatterns) {
      const dm = line.match(dp);
      if (dm) {
        const parsed = new Date(dm[1] ?? dm[0]);
        if (!isNaN(parsed.getTime())) {
          currentDate = parsed.toISOString().split("T")[0];
          isDate = true;
          break;
        }
        // Try more flexible parsing
        const flexParsed = new Date(line);
        if (!isNaN(flexParsed.getTime())) {
          currentDate = flexParsed.toISOString().split("T")[0];
          isDate = true;
          break;
        }
      }
    }
    if (isDate) continue;

    // Try to extract time and title from the line
    const timeMatch = line.match(timeRe);
    if (timeMatch) {
      const startTimeStr = timeMatch[1];
      const endTimeStr = timeMatch[2] || null;
      const titlePart = line.replace(timeMatch[0], "").replace(/^[\s\-–—:,]+/, "").trim();

      if (titlePart.length < 2) continue;

      // Parse times
      const parseTime = (t: string, date: string | null): string | null => {
        if (!t) return null;
        const clean = t.replace(".", ":").trim();
        const d = date ? new Date(date) : new Date();
        const parts = clean.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
        if (!parts) return null;
        let hours = parseInt(parts[1]);
        const mins = parseInt(parts[2]);
        const ampm = parts[3]?.toLowerCase();
        if (ampm === "pm" && hours < 12) hours += 12;
        if (ampm === "am" && hours === 12) hours = 0;
        d.setHours(hours, mins, 0, 0);
        return d.toISOString();
      };

      // Detect event type from title
      let detectedType: string | null = null;
      const titleLower = titlePart.toLowerCase();
      for (const [keyword, typeName] of Object.entries(typeKeywords)) {
        if (titleLower.includes(keyword)) {
          detectedType = typeName;
          break;
        }
      }

      items.push({
        title: titlePart,
        start_time: parseTime(startTimeStr, currentDate),
        end_time: endTimeStr ? parseTime(endTimeStr, currentDate) : null,
        venue_name: null,
        venue_type: detectedType,
        location: null,
        notes: null,
      });
    } else if (line.length > 3 && line.length < 200 && !line.match(/^[-=_*#]+$/)) {
      // Non-time line that looks like a title — add as an item without time
      // Skip lines that look like headers/separators
      const titleLower = line.toLowerCase();
      let detectedType: string | null = null;
      for (const [keyword, typeName] of Object.entries(typeKeywords)) {
        if (titleLower.includes(keyword)) {
          detectedType = typeName;
          break;
        }
      }

      items.push({
        title: line,
        start_time: currentDate ? new Date(currentDate).toISOString() : null,
        end_time: null,
        venue_name: null,
        venue_type: detectedType,
        location: null,
        notes: null,
      });
    }
  }
  return items;
}

export default function ScheduleTab({ eventId, items, onItemsChange, eventStartDate, eventEndDate, openAddSignal }: Props) {
  // The event's date in YYYY-MM-DD form, only set when the event is
  // a single-day event (start and end on the same day, or end is null).
  const eventSingleDate = (() => {
    if (!eventStartDate) return null;
    const start = eventStartDate.slice(0, 10);
    if (!eventEndDate || eventStartDate.slice(0, 10) === eventEndDate.slice(0, 10)) {
      return start;
    }
    return null;
  })();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [oneDay, setOneDay] = useState(true);

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  // Assign popover state
  const [assigningItemId, setAssigningItemId] = useState<number | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const [assignNotify, setAssignNotify] = useState(true);
  const [assignSaving, setAssignSaving] = useState(false);

  // Workspace users (current user + invited users would come from context/API)
  const WORKSPACE_USERS = [
    { name: "Dani Bradford", initials: "DB" },
    { name: "Matthew", initials: "M" },
    { name: "Surya", initials: "S" },
  ];

  const openAssign = (item: import("../types").ScheduleItem) => {
    setAssigningItemId(item.id);
    setAssignTo(item.assigned_to ?? "");
    setAssignNotes(item.assign_notes ?? "");
    setAssignNotify(true);
  };

  const handleAssignSave = async () => {
    if (assigningItemId === null) return;
    setAssignSaving(true);
    try {
      const updated = await api.updateScheduleItem(eventId, assigningItemId, {
        assigned_to: assignTo || null,
        assign_notes: assignNotes || null,
      });
      onItemsChange(items.map(i => i.id === assigningItemId ? updated : i));
      setAssigningItemId(null);
    } finally {
      setAssignSaving(false);
    }
  };

  const handleUnassign = async () => {
    if (assigningItemId === null) return;
    setAssignSaving(true);
    try {
      const updated = await api.updateScheduleItem(eventId, assigningItemId, {
        assigned_to: null,
        assign_notes: null,
      });
      onItemsChange(items.map(i => i.id === assigningItemId ? updated : i));
      setAssigningItemId(null);
    } finally {
      setAssignSaving(false);
    }
  };

  // Location autocomplete
  type Prediction = { place_id: string; description: string; main_text: string; secondary_text: string };
  type VenueResult = { place_id: string; name: string; address: string; rating?: number };
  const [locationSuggestions, setLocationSuggestions] = useState<Prediction[]>([]);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  // setNearbyVenues populates a server-side list of venues near the
  // selected location. Currently only the setter is read elsewhere in
  // the file; the list is not displayed independently (the user-facing
  // dropdown uses `filteredVenues` from a fresh search). Keep the
  // setter for the location → nearby fetch flow.
  const [, setNearbyVenues] = useState<VenueResult[]>([]);
  const [filteredVenues, setFilteredVenues] = useState<VenueResult[]>([]);
  const [showVenueSuggestions, setShowVenueSuggestions] = useState(false);
  const [venueName, setVenueName] = useState("");
  const locationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLocationInput = useCallback((value: string) => {
    if (locationTimer.current) clearTimeout(locationTimer.current);
    if (value.length < 3) {
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
      }
    }, 300);
  }, []);

  const selectLocation = useCallback((prediction: Prediction) => {
    setForm(f => ({ ...f, location: prediction.description }));
    setShowLocationSuggestions(false);
    setLocationSuggestions([]);
    // Fetch nearby venues for this location
    api.placesNearby(prediction.description).then(data => {
      setNearbyVenues(data.results);
      setFilteredVenues(data.results);
    }).catch(() => {});
  }, []);

  // (`filterVenues` was the old client-side filter against `nearbyVenues`;
  // replaced by `onVenueInput` which does a server-side Places search.)

  const selectVenue = useCallback((venue: VenueResult) => {
    setVenueName(venue.name);
    setShowVenueSuggestions(false);
    // Auto-populate the Location field with the venue's address. If the user
    // already typed a location, leave it alone — they may want it different.
    if (venue.address) {
      setForm(f => f.location ? f : { ...f, location: venue.address });
    }
  }, []);

  // Venue text search (works WITHOUT a location set, unlike the legacy
  // nearby-only search). Uses Google Places autocomplete with the
  // `establishment` type filter.
  const venueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVenueInput = useCallback((value: string) => {
    setVenueName(value);
    if (venueTimer.current) clearTimeout(venueTimer.current);
    if (value.trim().length < 3) {
      setFilteredVenues([]);
      setShowVenueSuggestions(false);
      return;
    }
    venueTimer.current = setTimeout(async () => {
      try {
        const data = await api.placesAutocomplete(value, "establishment");
        const results = data.predictions.map(p => ({
          place_id: p.place_id,
          name: p.main_text,
          address: p.secondary_text,
        }));
        setFilteredVenues(results);
        setShowVenueSuggestions(results.length > 0);
      } catch {
        setFilteredVenues([]);
        setShowVenueSuggestions(false);
      }
    }, 250);
  }, []);

  // Close dropdowns on blur
  useEffect(() => {
    const close = () => { setShowLocationSuggestions(false); setShowVenueSuggestions(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const openAdd = () => {
    // Pre-fill the date with the event's date when it's a single-day
    // event — saves the organizer from typing it for every item.
    setForm({
      ...EMPTY_FORM,
      start_date: eventSingleDate ?? "",
      end_date: eventSingleDate ?? "",
    });
    setVenueName("");
    setNearbyVenues([]);
    setFilteredVenues([]);
    setOneDay(true);
    setEditingId(null);
    setShowForm(true);
  };

  // Open the new-item drawer whenever the parent bumps the signal
  // counter. Used today by the Seating tab's "Add a schedule item"
  // CTA: it switches activeTab → schedule AND bumps the counter so
  // the user lands directly on the form, not on the empty schedule
  // list. Skips the initial render (counter === undefined) so we
  // don't auto-pop the drawer every time someone opens the tab.
  useEffect(() => {
    if (openAddSignal === undefined || openAddSignal === 0) return;
    openAdd();
    // openAdd is recreated on every render but its captured state
    // (eventSingleDate) is the only dependency we actually care about
    // — the signal counter is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAddSignal]);

  const openEdit = (item: ScheduleItem) => {
    setVenueName(item.venue_name ?? "");
    setNearbyVenues([]);
    setFilteredVenues([]);
    if (item.location) {
      api.placesNearby(item.location).then(data => {
        setNearbyVenues(data.results);
        setFilteredVenues(data.results);
      }).catch(() => {});
    }
    // Split datetime into date and time parts
    const extractDate = (dt: string | null) => {
      if (!dt) return "";
      const d = new Date(dt);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const extractTime = (dt: string | null) => {
      if (!dt) return "";
      const d = new Date(dt);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const startDate = extractDate(item.start_time);
    const endDate = extractDate(item.end_time);
    const isSameDay = !endDate || endDate === startDate;
    setOneDay(isSameDay);
    const mo = item.meal_options;
    const hasMeal = !!mo && (
      (mo.entrees?.length ?? 0) > 0 ||
      (mo.mains?.length ?? 0) > 0 ||
      (mo.desserts?.length ?? 0) > 0 ||
      (mo.drinks?.length ?? 0) > 0
    );
    setForm({
      title: item.title,
      description: item.description ?? "",
      start_date: startDate,
      end_date: isSameDay ? "" : endDate,
      start_hour: extractTime(item.start_time),
      end_hour: extractTime(item.end_time),
      venue_name: item.venue_name ?? "",
      venue_type: item.venue_type ?? "",
      location: item.location ?? "",
      notes: item.notes ?? "",
      requires_seating: item.requires_seating ?? false,
      has_meal: hasMeal,
      meal_entrees: _joinCsv(mo?.entrees),
      meal_mains: _joinCsv(mo?.mains),
      meal_desserts: _joinCsv(mo?.desserts),
      meal_drinks: _joinCsv(mo?.drinks),
    });
    setEditingId(item.id);
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    // Combine date + time into ISO strings
    const combineDateTime = (date: string, time: string): string | null => {
      if (!date) return null;
      // Store as a naive local datetime — the wall-clock time the organizer
      // picked, NOT converted to UTC. The backend's DATETIME column is
      // tz-naive, so a `.toISOString()` round trip would silently shift
      // every time by the user's local offset.
      const t = time || "00:00";
      return `${date}T${t}:00`;
    };
    const endDate = oneDay ? form.start_date : form.end_date;
    const mealOptions = form.has_meal
      ? {
          entrees:  _splitCsv(form.meal_entrees),
          mains:    _splitCsv(form.meal_mains),
          desserts: _splitCsv(form.meal_desserts),
          // Drinks are always the same two choices — no organizer config.
          drinks: ["Alcoholic", "Non-alcoholic"],
        }
      : null;
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      start_time: combineDateTime(form.start_date, form.start_hour),
      end_time: combineDateTime(endDate, form.end_hour),
      venue_name: venueName.trim() || null,
      venue_type: form.venue_type || null,
      location: form.location || null,
      notes: form.notes || null,
      requires_seating: form.requires_seating,
      meal_options: mealOptions,
    };
    try {
      if (editingId) {
        const updated = await api.updateScheduleItem(eventId, editingId, payload);
        onItemsChange(items.map(i => i.id === editingId ? updated : i));
      } else {
        const created = await api.createScheduleItem(eventId, payload);
        onItemsChange([...items, created]);
      }
      setShowForm(false);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (itemId: number) => {
    await api.deleteScheduleItem(eventId, itemId);
    onItemsChange(items.filter(i => i.id !== itemId));
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const extractText = async (file: File): Promise<string> => {
    const type = file.type;
    const name = file.name.toLowerCase();

    // Image files — use Tesseract OCR
    if (type.startsWith("image/") || name.match(/\.(jpg|jpeg|png|webp|bmp|tiff?)$/)) {
      const result = await Tesseract.recognize(file, "eng");
      return result.data.text;
    }

    // PDF files — use pdfjs-dist
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item: any) => item.str).join(" "));
      }
      return pages.join("\n");
    }

    // Text/CSV/other — read as text
    return await file.text();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const text = await extractText(file);
      const parsed = parseProgram(text);
      const created: ScheduleItem[] = [];
      for (const item of parsed) {
        const result = await api.createScheduleItem(eventId, item);
        created.push(result);
      }
      onItemsChange([...items, ...created]);
    } catch (err) {
      console.error("Failed to parse uploaded file:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const groups = groupByDate(items);

  return (
    <div className="schedule-tab">
      <div className="schedule-header">
        <div className="schedule-header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.pdf,.doc,.docx,.rtf,.jpg,.jpeg,.png,.webp"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          <button
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Parsing…" : "Upload Program"}
          </button>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Item</button>
          {items.length > 0 && (
            <button
              className="schedule-clear-btn"
              onClick={async () => {
                for (const item of items) {
                  await api.deleteScheduleItem(eventId, item.id);
                }
                onItemsChange([]);
              }}
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Sliding right drawer */}
      <div className={`schedule-drawer-overlay ${showForm ? "open" : ""}`} onClick={() => { setShowForm(false); setEditingId(null); }} />
      <div className={`schedule-drawer ${showForm ? "open" : ""}`}>
        <div className="schedule-drawer-header">
          <span className="schedule-drawer-title">
            {editingId ? "Edit Schedule Item" : "New Schedule Item"}
          </span>
          <button className="schedule-drawer-close" onClick={() => { setShowForm(false); setEditingId(null); }}>✕</button>
        </div>
        <form className="schedule-drawer-form" onSubmit={handleSave}>
          {editingId && (() => {
            const item = items.find(i => i.id === editingId);
            return item?.assigned_to ? (
              <div className="schedule-drawer-assignment">
                <div className="schedule-drawer-assignment-row">
                  <span className="schedule-drawer-assignment-avatar">
                    {item.assigned_to.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                  </span>
                  <div>
                    <span className="schedule-drawer-assignment-label">Task Assigned to</span>
                    <span className="schedule-drawer-assignment-name">{item.assigned_to}</span>
                  </div>
                </div>
                {item.assign_notes && (
                  <span className="schedule-drawer-assignment-notes">{item.assign_notes}</span>
                )}
              </div>
            ) : null;
          })()}
          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => set("title", e.target.value)}
              placeholder="e.g. Welcome Drinks, Gala Dinner, After Party"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              className="schedule-description-input"
              value={form.description}
              onChange={e => set("description", e.target.value)}
              placeholder="Brief description of this schedule item..."
              rows={2}
            />
          </div>
          <div className="form-date-header">
            <label>Date</label>
            <label className="schedule-oneday-checkbox">
              <input
                type="checkbox"
                checked={oneDay}
                onChange={e => {
                  const checked = e.target.checked;
                  setOneDay(checked);
                  if (!checked && !form.end_date && form.start_date) {
                    set("end_date", form.start_date);
                  }
                }}
              />
              <span>One-day</span>
            </label>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-sub-label">Start</label>
              <input type="date" value={form.start_date} onChange={e => set("start_date", e.target.value)} />
            </div>
            {!oneDay && (
              <div className="form-group">
                <label className="form-sub-label">End</label>
                <input type="date" value={form.end_date} onChange={e => set("end_date", e.target.value)} />
              </div>
            )}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Start Time</label>
              <TimePicker value={form.start_hour} onChange={v => set("start_hour", v)} placeholder="Start" />
            </div>
            <div className="form-group">
              <label>End Time</label>
              <TimePicker value={form.end_hour} onChange={v => set("end_hour", v)} placeholder="End" />
            </div>
          </div>
          <div className="form-group">
            <label>Event Type</label>
            <select value={form.venue_type} onChange={e => set("venue_type", e.target.value)}>
              <option value="">Select type…</option>
              {EVENT_TYPES.map(t => (
                <option key={t} value={t}>{EVENT_TYPE_ICONS[t]} {t}</option>
              ))}
            </select>
          </div>
          <div className="form-group autocomplete-wrap">
            <label>Venue Name</label>
            <input
              type="text"
              value={venueName}
              onChange={e => onVenueInput(e.target.value)}
              onFocus={() => filteredVenues.length > 0 && setShowVenueSuggestions(true)}
              placeholder="Search for a venue…"
              autoComplete="off"
            />
            {showVenueSuggestions && filteredVenues.length > 0 && (
              <ul className="autocomplete-list">
                {filteredVenues.map(v => (
                  <li key={v.place_id} onMouseDown={() => selectVenue(v)}>
                    <span className="autocomplete-main">{v.name}</span>
                    <span className="autocomplete-secondary">{v.address}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="form-group autocomplete-wrap">
            <label>Location / Address</label>
            <input
              type="text"
              value={form.location}
              onChange={e => { set("location", e.target.value); onLocationInput(e.target.value); }}
              onFocus={() => locationSuggestions.length > 0 && setShowLocationSuggestions(true)}
              placeholder="Auto-fills from venue, or type an address"
              autoComplete="off"
            />
            {showLocationSuggestions && locationSuggestions.length > 0 && (
              <ul className="autocomplete-list">
                {locationSuggestions.map(s => (
                  <li key={s.place_id} onMouseDown={() => selectLocation(s)}>
                    <span className="autocomplete-main">{s.main_text}</span>
                    <span className="autocomplete-secondary">{s.secondary_text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="form-group">
            <label>Notes</label>
            <input
              type="text"
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="Dress code, what to bring, etc."
            />
          </div>
          <label className="schedule-seating-checkbox">
            <input
              type="checkbox"
              checked={form.requires_seating}
              onChange={e => setForm(f => ({ ...f, requires_seating: e.target.checked }))}
            />
            <span>This event requires seating</span>
          </label>

          {/* ── Meal options (shown when this event involves a meal) ── */}
          <label className="schedule-seating-checkbox">
            <input
              type="checkbox"
              checked={form.has_meal}
              onChange={e => setForm(f => ({ ...f, has_meal: e.target.checked }))}
            />
            <span>This event has a meal</span>
          </label>
          {form.has_meal && (
            <div className="schedule-meal-options">
              <p className="schedule-meal-hint">
                List the choices guests can pick from, separated by commas. These appear
                as dropdowns on the attendee edit drawer and in any RSVP form for this event.
              </p>
              <div className="form-group">
                <label>Entrée options</label>
                <input
                  type="text"
                  value={form.meal_entrees}
                  onChange={e => set("meal_entrees", e.target.value)}
                  placeholder="e.g. Caesar salad, Tomato soup, Charcuterie"
                />
              </div>
              <div className="form-group">
                <label>Main options</label>
                <input
                  type="text"
                  value={form.meal_mains}
                  onChange={e => set("meal_mains", e.target.value)}
                  placeholder="e.g. Salmon, Chicken, Vegetarian Wellington"
                />
              </div>
              <div className="form-group">
                <label>Dessert options</label>
                <input
                  type="text"
                  value={form.meal_desserts}
                  onChange={e => set("meal_desserts", e.target.value)}
                  placeholder="e.g. Cheesecake, Fruit tart, Sorbet"
                />
              </div>
              <p className="schedule-meal-hint" style={{ margin: "2px 0 0" }}>
                Drink choice is always <strong>Alcoholic / Non-alcoholic</strong> — no setup needed.
              </p>
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add to Schedule"}
            </button>
            <button type="button" className="btn" onClick={() => { setShowForm(false); setEditingId(null); }}>
              Cancel
            </button>
          </div>
        </form>
      </div>

      {/* Assign popover */}
      {assigningItemId !== null && (
        <>
          <div className="assign-overlay" onClick={() => setAssigningItemId(null)} />
          <div className="assign-modal">
            <div className="assign-modal-header">
              <h3>Assign Task</h3>
              <button className="assign-close" onClick={() => setAssigningItemId(null)}>✕</button>
            </div>
            <div className="assign-modal-body">
              <div className="form-group">
                <label>Assign to</label>
                <div className="assign-user-list">
                  {WORKSPACE_USERS.map(u => (
                    <button
                      key={u.name}
                      type="button"
                      className={`assign-user-option ${assignTo === u.name ? "selected" : ""}`}
                      onClick={() => setAssignTo(u.name)}
                    >
                      <span className="assign-user-avatar">{u.initials}</span>
                      <span>{u.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={assignNotes}
                  onChange={e => setAssignNotes(e.target.value)}
                  placeholder="Instructions, details for this task..."
                  rows={3}
                />
              </div>
              <label className="assign-notify-toggle">
                <input
                  type="checkbox"
                  checked={assignNotify}
                  onChange={e => setAssignNotify(e.target.checked)}
                />
                <span>📱 Notify via WhatsApp</span>
              </label>
            </div>
            <div className="assign-modal-footer">
              {assignTo && (
                <button className="btn btn-sm assign-unassign-btn" onClick={handleUnassign} disabled={assignSaving}>
                  Unassign
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={() => setAssigningItemId(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAssignSave} disabled={assignSaving || !assignTo}>
                {assignSaving ? "Saving..." : "Assign"}
              </button>
            </div>
          </div>
        </>
      )}

      {items.length === 0 && !showForm ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗓</div>
          <p>No schedule items yet.</p>
          <p className="empty-state-sub">Add venues, timings and session details for your event.</p>
          <button className="btn btn-primary" onClick={openAdd}>+ Add First Item</button>
        </div>
      ) : (
        <div className="schedule-groups">
          {groups.map(group => (
            <div key={group.date ?? "no-date"} className="schedule-group">
              {group.date && (
                <div className="schedule-date-label">
                  {new Date(group.date).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </div>
              )}
              {!group.date && items.some(i => !i.start_time) && (
                <div className="schedule-date-label">No date set</div>
              )}
              <div className="schedule-items">
                {group.items.map(item => (
                  <div key={item.id} className="schedule-card">
                    <div className="schedule-card-time">
                      {item.start_time ? (
                        <>
                          <span className="schedule-time-main">{formatTime(item.start_time)}</span>
                          {item.end_time && (
                            <span className="schedule-time-end"> – {formatTime(item.end_time)}</span>
                          )}
                        </>
                      ) : (
                        <span className="schedule-time-none">TBC</span>
                      )}
                    </div>
                    <div className="schedule-card-body">
                      <div className="schedule-card-title">
                        {item.title}
                        {(() => {
                          const mo = item.meal_options;
                          const hasMeal = !!mo && (
                            (mo.entrees?.length ?? 0) > 0 ||
                            (mo.mains?.length ?? 0) > 0 ||
                            (mo.desserts?.length ?? 0) > 0 ||
                            (mo.drinks?.length ?? 0) > 0
                          );
                          if (!hasMeal) return null;
                          return (
                            <span className="schedule-meal-icon" title="This event has a meal" aria-label="Meal">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                {/* Utensils crossed (lucide) — fork + knife */}
                                <path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" />
                                <path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" />
                                <path d="m2.1 21.8 6.4-6.3" />
                                <path d="m19 5-7 7" />
                              </svg>
                            </span>
                          );
                        })()}
                      </div>
                      {(item.venue_name || item.venue_type) && (
                        <div className="schedule-card-venue">
                          {item.venue_type && (
                            <span className="schedule-venue-type">
                              {VENUE_TYPE_ICONS[item.venue_type] && (
                                <>{VENUE_TYPE_ICONS[item.venue_type]} </>
                              )}
                              {item.venue_type}
                            </span>
                          )}
                          {item.venue_name && <span className="schedule-venue-name">{item.venue_name}</span>}
                        </div>
                      )}
                      {item.notes && (
                        <div className="schedule-card-notes">
                          <span className="schedule-card-notes-mark" aria-hidden="true">*</span>
                          {item.notes}
                        </div>
                      )}
                      {item.assigned_to && (
                        <div className="schedule-card-assigned">
                          <span className="schedule-card-assigned-avatar">
                            {item.assigned_to.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                          </span>
                          <span>Task Assigned to {item.assigned_to}</span>
                        </div>
                      )}
                    </div>
                    <div className="schedule-card-actions">
                      <button className="schedule-assign-btn" onClick={() => openAssign(item)}>Assign</button>
                      <button className="schedule-edit-btn" onClick={() => openEdit(item)}>Edit</button>
                      <button className="schedule-delete-btn" onClick={() => handleDelete(item.id)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
