import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { Event, Attendee, Table, SeatingArrangement, CustomForm } from "../types";
import AttendeeList from "../components/AttendeeList";
import SeatingBoard from "../components/SeatingBoard";
import ScheduleTab from "../components/ScheduleTab";
import EventMapCard from "../components/EventMapCard";
import CollateralTab, { type DesignsByType, type SelectedDesignByType, type LatestGenerationCountByType } from "../components/CollateralTab";
import FormBuilder from "../components/FormBuilder";
import FormSendDialog from "../components/FormSendDialog";
import RestaurantShareDialog from "../components/RestaurantShareDialog";
import EventDrawer from "../components/EventDrawer";
import { fileToCompressedDataUrl } from "../utils/image";
import type { ScheduleItem } from "../types";

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

type Tab = "attendees" | "seating" | "masterminds" | "schedule" | "collateral";
type DrawShape = "round" | "rectangular" | "oval" | "chair-row";

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const id = Number(eventId);

  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [arrangements, setArrangements] = useState<SeatingArrangement[]>([]);
  const [activeArrangement, setActiveArrangement] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("attendees");
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editEventDrawerOpen, setEditEventDrawerOpen] = useState(false);
  const [attendeeSearch, setAttendeeSearch] = useState("");
  const [drawMode, setDrawMode] = useState(false);
  const [drawShape, setDrawShape] = useState<DrawShape>("rectangular");
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [selectedScheduleEvent, setSelectedScheduleEvent] = useState("");
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [showFormSend, setShowFormSend] = useState(false);
  const [showRestaurantShare, setShowRestaurantShare] = useState<null | "attendees" | "seating">(null);
  const [eventForm, setEventForm] = useState<CustomForm | null>(null);
  const [maximizeConversation, setMaximizeConversation] = useState(false);
  const [autoSeating, setAutoSeating] = useState(false);
  // autoSeatRef removed — previously exposed for parent-triggered
  // auto-seating; SeatingBoard now handles its own auto-seat button.
  const initedRef = useRef(false);

  // ── Brand state (persists across tab switches) ──
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 1000, 1000, 0.82);
      const updated = await api.updateEvent(id, { image_data: dataUrl } as any);
      setEvent(updated);
    } catch (err) {
      console.error("Image upload failed:", err);
    } finally {
      setImageUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const [brandUrl, setBrandUrl] = useState("");
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [brandFont, setBrandFont] = useState<string | null>(null);

  // Generated designs + selection live here so they survive tab switches —
  // CollateralTab unmounts when the user navigates to another tab, and we
  // don't want the designs to disappear with it. The DB-backed listDesigns
  // hydrates this on mount so refreshes / AttendeeDetail navigation also
  // recover the set without burning fresh Gemini calls.
  const [designsByType, setDesignsByType] = useState<DesignsByType>({
    "tented-name-cards": [],
    "name-cards": [],
    programs: [],
  });
  const [selectedDesignByType, setSelectedDesignByType] = useState<SelectedDesignByType>({
    "tented-name-cards": null,
    "name-cards": null,
    programs: null,
  });
  // Session-scoped — the PlaceCard AI tab shows only the most recent
  // generation (top N slice of designsByType). Lifted here so a switch
  // between Attendees and Collateral within the same event doesn't lose
  // the "what did I just generate" view, but starts fresh on a route
  // change (which unmounts EventDetail) — at that point the user can
  // pull the full history from the My Designs tab.
  const [latestGenerationCountByType, setLatestGenerationCountByType] = useState<LatestGenerationCountByType>({
    "tented-name-cards": 0,
    "name-cards": 0,
    programs: 0,
  });

  // ── Attendee edit drawer ──
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [editingAttendee, setEditingAttendee] = useState<Attendee | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editDietarySelect, setEditDietarySelect] = useState("");
  const [editDietaryOther, setEditDietaryOther] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editRsvp, setEditRsvp] = useState("pending");
  const [editSaving, setEditSaving] = useState(false);

  // ── Meal selections (stored in attendee.responses.meal_selections) ──
  type MealField = "entree" | "main" | "dessert" | "drink";
  type Meal = { venue: string; fields: { type: MealField; value: string }[] };
  const DEFAULT_MEAL_FIELDS: MealField[] = ["entree", "main", "dessert", "drink"];
  const MEAL_FIELD_LABEL: Record<MealField, string> = {
    entree: "Entree",
    main: "Main",
    dessert: "Dessert",
    drink: "Drink",
  };
  const newBlankMeal = (): Meal => ({
    venue: "",
    fields: DEFAULT_MEAL_FIELDS.map(t => ({ type: t, value: "" })),
  });
  const [editMeals, setEditMeals] = useState<Meal[]>([]);

  const DIETARY_OPTIONS = ["", "Vegetarian", "Vegan", "Gluten-free", "Other"];

  const openEditDrawer = (attendee: Attendee) => {
    setEditingAttendee(attendee);
    setEditName(attendee.name);
    setEditEmail(attendee.email || "");
    setEditPhone(attendee.phone || "");
    setEditCountry(attendee.country || "");
    const diet = attendee.dietary_requirements || "";
    const knownOption = DIETARY_OPTIONS.find(o => o.toLowerCase() === diet.toLowerCase());
    if (knownOption) {
      setEditDietarySelect(knownOption);
      setEditDietaryOther("");
    } else if (diet) {
      setEditDietarySelect("Other");
      setEditDietaryOther(diet);
    } else {
      setEditDietarySelect("");
      setEditDietaryOther("");
    }
    setEditNotes(attendee.notes || "");
    setEditRsvp(attendee.rsvp_status || "pending");

    // Hydrate meal selections from attendee.responses.meal_selections
    const savedMeals = (attendee.responses as any)?.meal_selections;
    if (Array.isArray(savedMeals) && savedMeals.length > 0) {
      setEditMeals(
        savedMeals.map((m: any) => ({
          venue: typeof m?.venue === "string" ? m.venue : "",
          fields: DEFAULT_MEAL_FIELDS
            .filter(t => typeof m?.[t] === "string" && m[t] !== undefined)
            .map(t => ({ type: t, value: m[t] })),
        })),
      );
    } else {
      setEditMeals([]);
    }

    setEditDrawerOpen(true);
  };

  const closeEditDrawer = () => {
    setEditDrawerOpen(false);
    setEditingAttendee(null);
  };

  const handleSaveAttendee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAttendee || !editName.trim()) return;
    setEditSaving(true);
    try {
      // Flatten meals to the shape we persist in responses.meal_selections
      const mealsPayload = editMeals
        .map(m => {
          const obj: Record<string, string> = {};
          if (m.venue.trim()) obj.venue = m.venue.trim();
          for (const f of m.fields) {
            if (f.value.trim()) obj[f.type] = f.value.trim();
          }
          return obj;
        })
        .filter(m => Object.keys(m).length > 0);

      const existingResponses =
        (editingAttendee.responses && typeof editingAttendee.responses === "object"
          ? { ...editingAttendee.responses }
          : {}) as Record<string, any>;
      if (mealsPayload.length > 0) {
        existingResponses.meal_selections = mealsPayload;
      } else {
        delete existingResponses.meal_selections;
      }

      const updated = await api.updateAttendee(id, editingAttendee.id, {
        name: editName.trim(),
        email: editEmail.trim() || null,
        phone: editPhone.trim() || null,
        country: editCountry.trim() || null,
        dietary_requirements: (editDietarySelect === "Other" ? editDietaryOther.trim() : editDietarySelect) || null,
        notes: editNotes.trim() || null,
        rsvp_status: editRsvp,
        responses: Object.keys(existingResponses).length > 0 ? existingResponses : null,
      } as any);
      setAttendees(prev => prev.map(a => a.id === editingAttendee.id ? updated : a));
      closeEditDrawer();
    } finally {
      setEditSaving(false);
    }
  };

  const loadData = useCallback(async () => {
    const [ev, att, tbl, arr, sched, forms, savedDesigns] = await Promise.all([
      api.getEvent(id),
      api.listAttendees(id),
      api.listTables(id),
      api.listArrangements(id),
      api.listSchedule(id),
      api.listForms(id),
      // Hydrate persisted designs so navigating to AttendeeDetail or
      // hard-refreshing the page recovers the set without burning
      // another round of Gemini generation calls.
      api.listDesigns(id).catch(() => ({} as Record<string, never>)),
    ]);
    setEvent(ev);
    setAttendees(att);
    setTables(tbl);
    setScheduleItems(sched);
    if (forms.length > 0) setEventForm(forms[0]);
    setDesignsByType({
      "tented-name-cards": (savedDesigns as any)["tented-name-cards"] ?? [],
      "name-cards": (savedDesigns as any)["name-cards"] ?? [],
      programs: (savedDesigns as any)["programs"] ?? [],
    });

    // Ensure each schedule item that requires seating has a corresponding arrangement
    let allArr = arr;
    const seatedItems = sched.filter(s => s.requires_seating);
    if (!initedRef.current && seatedItems.length > 0) {
      initedRef.current = true;
      for (const item of seatedItems) {
        if (!allArr.find(a => a.name === item.title)) {
          const created = await api.createArrangement(id, { name: item.title });
          allArr = [...allArr, created];
        }
      }
    }
    setArrangements(allArr);

    // Default to first seated schedule item's arrangement
    if (seatedItems.length > 0 && !selectedScheduleEvent) {
      const firstTitle = seatedItems[0].title;
      setSelectedScheduleEvent(firstTitle);
      const matchingArr = allArr.find(a => a.name === firstTitle);
      if (matchingArr) setActiveArrangement(matchingArr.id);
    } else if (allArr.length > 0 && !activeArrangement) {
      setActiveArrangement(allArr[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);


  const handleAddAttendee = async (data: Partial<Attendee>) => {
    const created = await api.createAttendee(id, data);
    setAttendees((prev) => [...prev, created]);
  };

  const handleDeleteAttendee = async (attendeeId: number) => {
    await api.deleteAttendee(id, attendeeId);
    setAttendees((prev) => prev.filter((a) => a.id !== attendeeId));
  };

  const handleDrawTable = async (
    name: string, shape: Table["shape"],
    width: number, height: number, capacity: number,
    x: number, y: number
  ) => {
    const created = await api.createTable(id, { name, shape, capacity, width, height, x_position: x, y_position: y });
    setTables((prev) => [...prev, created]);
    setDrawMode(false);
  };

  const handleTableResize = async (tableId: number, width: number, height: number, capacity: number) => {
    const updated = await api.updateTable(id, tableId, { width, height, capacity });
    setTables((prev) => prev.map(t => t.id === tableId ? updated : t));
  };

  const handleDeleteTable = async (tableId: number) => {
    await api.deleteTable(id, tableId);
    setTables((prev) => prev.filter((t) => t.id !== tableId));
  };

  const handleRenameTable = async (tableId: number, name: string) => {
    const updated = await api.updateTable(id, tableId, { name });
    setTables((prev) => prev.map(t => t.id === tableId ? updated : t));
  };

  const handleTableMove = async (tableId: number, x: number, y: number) => {
    await api.updateTable(id, tableId, { x_position: x, y_position: y });
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, x_position: x, y_position: y } : t))
    );
  };

  const handleTableRotate = async (tableId: number, rotation: number) => {
    // Optimistic local update — snappier than waiting for the round-trip
    setTables(prev => prev.map(t => (t.id === tableId ? { ...t, rotation } : t)));
    try {
      await api.updateTable(id, tableId, { rotation });
    } catch (err) {
      console.error("Failed to rotate table:", err);
    }
  };

  const handleDropAttendee = async (attendeeId: number, tableId: number, seatNumber: number) => {
    if (!activeArrangement) return;
    const assignment = await api.assignSeat(id, activeArrangement, {
      attendee_id: attendeeId,
      table_id: tableId,
      seat_number: seatNumber,
    });
    setArrangements((prev) =>
      prev.map((arr) =>
        arr.id === activeArrangement
          ? { ...arr, seat_assignments: [...arr.seat_assignments.filter((sa) => sa.attendee_id !== attendeeId), assignment] }
          : arr
      )
    );
  };

  const handleRemoveSeat = async (assignmentId: number) => {
    if (!activeArrangement) return;
    await api.removeSeat(id, activeArrangement, assignmentId);
    setArrangements((prev) =>
      prev.map((arr) =>
        arr.id === activeArrangement
          ? { ...arr, seat_assignments: arr.seat_assignments.filter((sa) => sa.id !== assignmentId) }
          : arr
      )
    );
  };

  // (handleCreateArrangement removed — arrangements are now created
  // automatically when a schedule item is marked `requires_seating`.)

  // Sync arrangement names when schedule items are renamed/added/removed
  const handleScheduleItemsChange = async (newItems: ScheduleItem[]) => {
    // Detect renamed items: same id, different title
    for (const newItem of newItems) {
      const oldItem = scheduleItems.find(s => s.id === newItem.id);
      if (oldItem && oldItem.title !== newItem.title) {
        // Find matching arrangement by old name and rename it
        const matchingArr = arrangements.find(a => a.name === oldItem.title);
        if (matchingArr) {
          try {
            const updated = await api.updateArrangement(id, matchingArr.id, { name: newItem.title });
            setArrangements(prev => prev.map(a => a.id === matchingArr.id ? { ...a, name: updated.name } : a));
            // Update selected dropdown if this was the selected event
            if (selectedScheduleEvent === oldItem.title) {
              setSelectedScheduleEvent(newItem.title);
            }
          } catch (err) {
            console.error("Failed to sync arrangement name:", err);
          }
        }
      }
    }

    // Create arrangements for newly added items that require seating
    for (const newItem of newItems) {
      if (newItem.requires_seating && !scheduleItems.find(s => s.id === newItem.id)) {
        const existing = arrangements.find(a => a.name === newItem.title);
        if (!existing) {
          try {
            const created = await api.createArrangement(id, { name: newItem.title });
            setArrangements(prev => [...prev, created]);
          } catch (err) {
            console.error("Failed to create arrangement:", err);
          }
        }
      }
    }

    setScheduleItems(newItems);
  };

  // Auto-seat handler — lives here so it can access all arrangements
  const handleAutoSeatAll = async () => {
    if (maximizeConversation) {
      setAutoSeating(true);
      try {
      // Reload fresh arrangement data from server to avoid stale IDs
      const allArrangements = await api.listArrangements(id);

      // Clear all seat assignments across all arrangements
      for (const arr of allArrangements) {
        for (const sa of arr.seat_assignments) {
          try { await api.removeSeat(id, arr.id, sa.id); } catch { /* already removed */ }
        }
      }

      // Build seat slots per arrangement
      const arrSlots = allArrangements.map(arr => {
        const slots: { tableId: number; seatNum: number }[] = [];
        for (const table of tables) {
          for (let sn = 1; sn <= table.capacity; sn++) {
            slots.push({ tableId: table.id, seatNum: sn });
          }
        }
        return { arrId: arr.id, slots };
      });

      // Track who sat together (by table) in previous arrangements
      const satTogether = new Map<number, Set<number>>();

      const updatedArrangements = allArrangements.map(a => ({ ...a, seat_assignments: [] as typeof a.seat_assignments }));

      for (let ai = 0; ai < arrSlots.length; ai++) {
        const { arrId, slots } = arrSlots[ai];
        const shuffled = [...attendees].sort(() => Math.random() - 0.5);

        // Group slots by table
        const tableSlots = new Map<number, number[]>();
        for (const s of slots) {
          if (!tableSlots.has(s.tableId)) tableSlots.set(s.tableId, []);
          tableSlots.get(s.tableId)!.push(s.seatNum);
        }

        // Assign attendees to tables, minimizing overlap with previous tablemates
        const tableIds = [...tableSlots.keys()];
        const assigned = new Set<number>();
        const tableAssignments = new Map<number, number[]>();

        for (const tid of tableIds) tableAssignments.set(tid, []);

        for (const attendee of shuffled) {
          if (assigned.has(attendee.id)) continue;
          const prevNeighbors = satTogether.get(attendee.id) ?? new Set();

          // Find table with least overlap with people this attendee has already sat with
          let bestTable = tableIds[0];
          let bestOverlap = Infinity;
          for (const tid of tableIds) {
            const current = tableAssignments.get(tid)!;
            if (current.length >= (tableSlots.get(tid)?.length ?? 0)) continue;
            const overlap = current.filter(aid => prevNeighbors.has(aid)).length;
            if (overlap < bestOverlap) {
              bestOverlap = overlap;
              bestTable = tid;
            }
          }

          const tableSeats = tableSlots.get(bestTable)!;
          const currentAssigned = tableAssignments.get(bestTable)!;
          if (currentAssigned.length < tableSeats.length) {
            currentAssigned.push(attendee.id);
            assigned.add(attendee.id);
          }
        }

        // Create assignments via API
        for (const [tableId, attendeeIds] of tableAssignments) {
          const seats = tableSlots.get(tableId)!;
          for (let i = 0; i < attendeeIds.length; i++) {
            const assignment = await api.assignSeat(id, arrId, {
              attendee_id: attendeeIds[i],
              table_id: tableId,
              seat_number: seats[i],
            });
            const arrIdx = updatedArrangements.findIndex(a => a.id === arrId);
            if (arrIdx >= 0) updatedArrangements[arrIdx].seat_assignments.push(assignment);
          }

          // Update satTogether so the next arrangement avoids these pairings
          for (const aid of attendeeIds) {
            if (!satTogether.has(aid)) satTogether.set(aid, new Set());
            for (const other of attendeeIds) {
              if (other !== aid) satTogether.get(aid)!.add(other);
            }
          }
        }
      }

      setArrangements(updatedArrangements);
      // Switch to the first arrangement
      if (updatedArrangements.length > 0) {
        setActiveArrangement(updatedArrangements[0].id);
        if (scheduleItems.length > 0) {
          setSelectedScheduleEvent(updatedArrangements[0].name);
        }
      }
      } finally {
        // Show overlay for at least 1.2s so the animation is visible
        await new Promise(r => setTimeout(r, 1200));
        setAutoSeating(false);
      }
    } else {
      // Simple: just fill empty seats in current arrangement
      if (!activeArrangement) return;
      const arr = arrangements.find(a => a.id === activeArrangement);
      if (!arr) return;
      const seated = new Set(arr.seat_assignments.map(sa => sa.attendee_id));
      const unseated = attendees.filter(a => !seated.has(a.id));
      if (unseated.length === 0) return;

      const emptySeats: { tableId: number; seatNum: number }[] = [];
      for (const table of tables) {
        for (let sn = 1; sn <= table.capacity; sn++) {
          if (!arr.seat_assignments.some(sa => sa.table_id === table.id && sa.seat_number === sn)) {
            emptySeats.push({ tableId: table.id, seatNum: sn });
          }
        }
      }

      let updatedArr = { ...arr };
      for (let i = 0; i < Math.min(unseated.length, emptySeats.length); i++) {
        const assignment = await api.assignSeat(id, activeArrangement, {
          attendee_id: unseated[i].id,
          table_id: emptySeats[i].tableId,
          seat_number: emptySeats[i].seatNum,
        });
        updatedArr = { ...updatedArr, seat_assignments: [...updatedArr.seat_assignments, assignment] };
      }
      setArrangements(prev => prev.map(a => a.id === activeArrangement ? updatedArr : a));
    }
  };

  // Check if all attendees are seated in current arrangement
  const currentSeatedCount = arrangements.find(a => a.id === activeArrangement)?.seat_assignments.length ?? 0;
  const allSeated = !maximizeConversation && currentSeatedCount >= attendees.length;

  if (!event) return <div className="page loading">Loading...</div>;

  const currentArrangement = arrangements.find((a) => a.id === activeArrangement);
  const seatedIds = new Set(currentArrangement?.seat_assignments.map((sa) => sa.attendee_id) || []);

  return (
    <div className="page page-event">
      <div className="page-header">
        <Link to="/" className="back-to-events-btn" aria-label="Back to events">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Events
        </Link>
      </div>

      <div className="event-layout">
        <aside className="event-sidebar">
          {/* Hero image — shows uploaded image if set, else the gradient
              placeholder with a category emoji. */}
          <div className={`event-sidebar-image ${event.image_data ? "event-sidebar-image-photo" : ""}`}>
            {event.image_data ? (
              <img src={event.image_data} alt={event.name} className="event-sidebar-image-photo-img" />
            ) : (
              <span className="event-sidebar-image-icon" aria-hidden="true">
                {(event.event_category === "wedding" && "💍")
                  || (event.event_category === "retreat" && "🌿")
                  || (event.event_category === "social" && "🥂")
                  || "✨"}
              </span>
            )}

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImageUpload}
            />
            <button
              type="button"
              className="event-image-upload-btn"
              onClick={() => imageInputRef.current?.click()}
              disabled={imageUploading}
              title={event.image_data ? "Replace image" : "Upload image"}
              aria-label={event.image_data ? "Replace image" : "Upload image"}
            >
              {imageUploading ? (
                <span className="event-image-upload-spinner" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              )}
            </button>

            {event.public_token && (
              <a
                className="event-link-btn"
                href={`/event/${event.public_token}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open public event page in a new tab"
              >
                <span>Event Link</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
          </div>

          <div className="event-sidebar-info">
          <div className="editable-title event-sidebar-title">
            {editingName ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={async () => {
                  if (nameInput.trim() && nameInput !== event.name) {
                    const updated = await api.updateEvent(id, { name: nameInput.trim() });
                    setEvent(updated);
                  }
                  setEditingName(false);
                }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "Escape") {
                    setEditingName(false);
                  }
                }}
              />
            ) : (
              <>
                <h1 onClick={() => { setNameInput(event.name); setEditingName(true); }}>
                  {event.name}
                </h1>
                <button
                  type="button"
                  className="event-sidebar-edit-btn"
                  onClick={() => setEditEventDrawerOpen(true)}
                  title="Edit event details"
                  aria-label="Edit event details"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
                {event.public_token && (
                  <a
                    href={`/event/${event.public_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="event-sidebar-edit-btn"
                    title="Open public event page"
                    aria-label="Open public event page"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </>
            )}
          </div>

          {(event.start_date || event.location) && (
            <div className="event-sidebar-meta">
              {event.start_date && (
                <div className="event-sidebar-meta-line">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span>{formatDateRange(event.start_date, event.end_date)}</span>
                </div>
              )}
              {event.location && (
                <div className="event-sidebar-meta-line">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{event.location}</span>
                </div>
              )}
            </div>
          )}

          {event.description && (
            <p className="event-sidebar-description">{event.description}</p>
          )}
          </div>

          {/* Map sits inside the sticky sidebar so its vertical position
              doesn't jump every time the main column changes height
              (different tabs render content of very different heights —
              empty Attendees vs Seating canvas). The card self-hides if
              neither venue nor location is set. */}
          <EventMapCard venue={event.venue} location={event.location} />
        </aside>

        <div className="event-main">

      <div className="tabs">
        <button
          className={`tab ${activeTab === "attendees" ? "active" : ""}`}
          onClick={() => setActiveTab("attendees")}
          aria-label="Attendees"
        >
          <svg className="tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span className="tab-label">Attendees</span>
        </button>
        <button
          className={`tab ${activeTab === "schedule" ? "active" : ""}`}
          onClick={() => setActiveTab("schedule")}
          aria-label="Schedule"
        >
          <svg className="tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="tab-label">Schedule</span>
        </button>
        <button
          className={`tab ${activeTab === "seating" ? "active" : ""}`}
          onClick={() => setActiveTab("seating")}
          aria-label="Seating"
        >
          <svg className="tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span className="tab-label">Seating</span>
        </button>
        <button
          className={`tab ${activeTab === "collateral" ? "active" : ""}`}
          onClick={() => setActiveTab("collateral")}
          aria-label="Make Magic"
        >
          <svg className="tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z" />
          </svg>
          <span className="tab-label">Make Magic</span>
        </button>
      </div>

      {activeTab === "attendees" && (
        <>
          {/* Show the action banner whenever there are attendees OR a
              form exists — covers the "form created but no attendees
              yet" gap that previously left the page empty. */}
          {(attendees.length > 0 || eventForm) && (
            <div className="attendee-form-banner">
              {attendees.length > 0 && (
                <input
                  type="text"
                  className="attendee-banner-search"
                  placeholder="Search by name, country..."
                  value={attendeeSearch}
                  onChange={e => setAttendeeSearch(e.target.value)}
                />
              )}
              {eventForm && (
                <>
                  <button className="attendee-form-banner-btn" onClick={() => setShowFormSend(true)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
                    Send Form
                  </button>
                  <button className="attendee-form-banner-btn" onClick={() => setShowFormBuilder(true)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit Form
                  </button>
                </>
              )}
              {/* Share Attendee List only makes sense once there are
                  attendees to share. */}
              {attendees.length > 0 && (
                <button className="attendee-form-banner-btn" onClick={() => setShowRestaurantShare("attendees")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"/>
                    <circle cx="6" cy="12" r="3"/>
                    <circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                  Share Attendee List
                </button>
              )}
            </div>
          )}

          <AttendeeList
            attendees={attendees}
            onAdd={handleAddAttendee}
            onDelete={handleDeleteAttendee}
            onEdit={openEditDrawer}
            seatedIds={seatedIds}
            onCreateForm={() => setShowFormBuilder(true)}
            hasForm={!!eventForm}
            filter={attendeeSearch}
            onFilterChange={setAttendeeSearch}
          />

          {showFormBuilder && (
            <>
              <div className="invite-overlay" onClick={() => setShowFormBuilder(false)} />
              <div className="form-builder-overlay">
                <FormBuilder
                  eventId={id}
                  eventName={event.name}
                  eventDescription={event.description}
                  existingForm={eventForm}
                  onSaved={(form) => {
                    setEventForm(form);
                    setShowFormBuilder(false);
                    setShowFormSend(true);
                  }}
                  onCancel={() => setShowFormBuilder(false)}
                />
              </div>
            </>
          )}

          {showFormSend && eventForm && (
            <FormSendDialog
              eventId={id}
              form={eventForm}
              attendees={attendees}
              onClose={() => setShowFormSend(false)}
              onSent={() => loadData()}
            />
          )}

        </>
      )}

      {showRestaurantShare && (
        <RestaurantShareDialog
          eventId={id}
          variant={showRestaurantShare}
          onClose={() => setShowRestaurantShare(null)}
        />
      )}

      {activeTab === "schedule" && (
        <ScheduleTab
          eventId={id}
          items={scheduleItems}
          onItemsChange={handleScheduleItemsChange}
          eventStartDate={event?.start_date ?? null}
          eventEndDate={event?.end_date ?? null}
        />
      )}

      {activeTab === "collateral" && (
        <CollateralTab
          eventId={id}
          scheduleItems={scheduleItems}
          arrangements={arrangements}
          tables={tables}
          attendees={attendees}
          eventCategory={event?.event_category ?? null}
          eventVenueType={event?.venue_type ?? null}
          eventName={event?.name ?? null}
          brandUrl={brandUrl}
          onBrandUrlChange={setBrandUrl}
          brandColors={brandColors}
          onBrandColorsChange={setBrandColors}
          brandFont={brandFont}
          onBrandFontChange={setBrandFont}
          designsByType={designsByType}
          onDesignsByTypeChange={setDesignsByType}
          selectedDesignByType={selectedDesignByType}
          onSelectedDesignByTypeChange={setSelectedDesignByType}
          latestGenerationCountByType={latestGenerationCountByType}
          onLatestGenerationCountByTypeChange={setLatestGenerationCountByType}
        />
      )}

      {activeTab === "seating" && (
        <div className="seating-view">
          {attendees.length > 0 && (
            <div className="attendee-form-banner seating-banner">
              <select
                className="btn btn-sm seating-banner-select"
                value={selectedScheduleEvent}
                onChange={e => {
                  const val = e.target.value;
                  setSelectedScheduleEvent(val);
                  // Switch to the matching arrangement
                  const matchingArr = arrangements.find(a => a.name === val);
                  if (matchingArr) setActiveArrangement(matchingArr.id);
                }}
                style={{ cursor: "pointer" }}
              >
                {scheduleItems.filter(item => item.requires_seating).map(item => (
                  <option key={item.id} value={item.title}>
                    {item.title}
                  </option>
                ))}
              </select>
              <button className="attendee-form-banner-btn seating-banner-share" onClick={() => setShowRestaurantShare("seating")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"/>
                  <circle cx="6" cy="12" r="3"/>
                  <circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
                <span className="banner-btn-label-full">Share Seating Chart</span>
                <span className="banner-btn-label-short">Share</span>
              </button>
            </div>
          )}
          <div className="seating-toolbar">
            <div className="arrangement-selector">
              <button
                className="btn btn-sm btn-primary"
                onClick={handleAutoSeatAll}
                disabled={allSeated}
                style={{ height: 36, padding: "0 20px", whiteSpace: "nowrap", opacity: allSeated ? 0.5 : 1 }}
              >
                ✦ Auto-Seat
              </button>
              <label className="toolbar-checkbox">
                <input
                  type="checkbox"
                  checked={maximizeConversation}
                  onChange={e => setMaximizeConversation(e.target.checked)}
                />
                <span>Maximize Conversation</span>
              </label>
            </div>

            <div className="table-controls">
              {/* Split button: icon draws the table, chevron opens the shape menu */}
              <div className={`split-btn ${drawMode && drawShape !== "chair-row" ? "split-btn-active" : ""}`}>
                <button
                  type="button"
                  className="split-btn-main"
                  onClick={() => {
                    if (drawMode && drawShape !== "chair-row") {
                      setDrawMode(false);
                    } else {
                      if (drawShape === "chair-row") setDrawShape("rectangular");
                      setDrawMode(true);
                    }
                  }}
                  title={drawMode && drawShape !== "chair-row" ? "Cancel Draw" : `Add ${drawShape.charAt(0).toUpperCase() + drawShape.slice(1)} Table`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="4" rx="1"/>
                    <line x1="5" y1="10" x2="5" y2="19"/>
                    <line x1="19" y1="10" x2="19" y2="19"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="split-btn-chevron"
                  onClick={() => setShapeMenuOpen(v => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={shapeMenuOpen}
                  title="Change table shape"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {shapeMenuOpen && (
                  <>
                    <div className="split-btn-backdrop" onClick={() => setShapeMenuOpen(false)} />
                    <ul className="split-btn-menu" role="listbox">
                      {(["rectangular", "round", "oval"] as const).map(shape => (
                        <li
                          key={shape}
                          role="option"
                          aria-selected={drawShape === shape}
                          className={`split-btn-menu-item ${drawShape === shape ? "split-btn-menu-item-active" : ""}`}
                          onClick={() => {
                            setDrawShape(shape);
                            setShapeMenuOpen(false);
                          }}
                        >
                          {shape.charAt(0).toUpperCase() + shape.slice(1)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <button
                className={`btn btn-sm ${drawMode && drawShape === "chair-row" ? "btn-active-draw" : "btn-primary"}`}
                onClick={() => {
                  if (drawMode && drawShape === "chair-row") {
                    setDrawMode(false);
                  } else {
                    setDrawShape("chair-row");
                    setDrawMode(true);
                  }
                }}
                title={drawMode && drawShape === "chair-row" ? "Cancel Draw" : "Draw Chair Row"}
                style={{ height: 36, minWidth: 52, padding: "0 12px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 11V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6"/><path d="M4 11h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z"/><line x1="6" y1="15" x2="6" y2="21"/><line x1="18" y1="15" x2="18" y2="21"/></svg>
              </button>
              {selectedTableId && !drawMode && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => { handleDeleteTable(selectedTableId); setSelectedTableId(null); }}
                >
                  Delete Table
                </button>
              )}
            </div>
          </div>

          {autoSeating && (
            <div className="auto-seat-overlay">
              <div className="auto-seat-card">
                <div className="auto-seat-dots">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span key={i} className="auto-seat-dot" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <span className="auto-seat-label">Maximizing Conversation</span>
                <div className="auto-seat-bar">
                  <div className="auto-seat-bar-fill" />
                </div>
              </div>
            </div>
          )}

          {/* Frame always renders so users see the seating workspace even
              before any arrangement / tables exist. */}
          <div className="seating-canvas-frame">
            <SeatingBoard
              tables={tables}
              attendees={attendees}
              seatAssignments={currentArrangement?.seat_assignments ?? []}
              onTableMove={handleTableMove}
              onDropAttendee={handleDropAttendee}
              onRemoveSeat={handleRemoveSeat}
              onTableResize={handleTableResize}
              onRotateTable={handleTableRotate}
              selectedTableId={selectedTableId}
              onSelectTable={setSelectedTableId}
              drawMode={drawMode}
              drawShape={drawShape}
              onDrawTable={handleDrawTable}
              onCancelDraw={() => setDrawMode(false)}
              onDeleteTable={(tableId) => { handleDeleteTable(tableId); setSelectedTableId(null); }}
              onRenameTable={handleRenameTable}
              maximizeConversation={maximizeConversation}
              onMaximizeConversationChange={setMaximizeConversation}
            />
          </div>
        </div>
      )}
        </div>
      </div>

      {/* ── Attendee Edit Drawer ── */}
      {editDrawerOpen && <div className="drawer-backdrop" onClick={closeEditDrawer} />}
      <div className={`drawer ${editDrawerOpen ? "drawer-open" : ""}`}>
        <div className="drawer-header">
          <h2 className="drawer-title">Edit Attendee</h2>
          <button className="drawer-close" onClick={closeEditDrawer}>✕</button>
        </div>
        <form className="drawer-body" onSubmit={handleSaveAttendee}>
          <div className="form-group">
            <label>Name *</label>
            <input type="text" className="form-input" value={editName} onChange={e => setEditName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" className="form-input" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input type="tel" className="form-input" value={editPhone} onChange={e => setEditPhone(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Country</label>
            <input type="text" className="form-input" value={editCountry} onChange={e => setEditCountry(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Dietary Requirements</label>
            <select className="form-input" value={editDietarySelect} onChange={e => { setEditDietarySelect(e.target.value); if (e.target.value !== "Other") setEditDietaryOther(""); }}>
              <option value="">None</option>
              <option value="Vegetarian">Vegetarian</option>
              <option value="Vegan">Vegan</option>
              <option value="Gluten-free">Gluten-free</option>
              <option value="Other">Other</option>
            </select>
            {editDietarySelect === "Other" && (
              <input type="text" className="form-input" style={{ marginTop: 8 }} value={editDietaryOther} onChange={e => setEditDietaryOther(e.target.value)} placeholder="Specify dietary requirements" />
            )}
          </div>

          {/* ── Meal Selection — sources venues + options from schedule items ── */}
          {(() => {
            // Build the catalogue of meal venues from schedule items that have
            // meal_options configured. The Venue dropdown lists these; picking
            // one populates the course dropdowns from that item's options.
            const mealScheduleItems = scheduleItems.filter(si => {
              const mo = si.meal_options;
              if (!mo) return false;
              return (
                (mo.entrees?.length ?? 0) > 0 ||
                (mo.mains?.length ?? 0) > 0 ||
                (mo.desserts?.length ?? 0) > 0 ||
                (mo.drinks?.length ?? 0) > 0
              );
            });
            const mealVenueOptions = mealScheduleItems.map(si => ({
              label: si.title,
              title: si.title,
              options: si.meal_options!,
            }));

            const COURSE_KEY_TO_OPTIONS: Record<MealField, keyof typeof mealVenueOptions[0]["options"]> = {
              entree: "entrees",
              main: "mains",
              dessert: "desserts",
              drink: "drinks",
            };

            return (
              <div className="form-group meal-selection-group">
                <label>Meal Selection</label>

                {mealScheduleItems.length === 0 ? (
                  <p className="form-hint" style={{ margin: "4px 0 8px" }}>
                    No meals configured yet. Add meal options to a schedule item on the Schedule tab.
                  </p>
                ) : (
                  <>
                    {editMeals.length === 0 && (
                      <div className="meal-empty">
                        <button
                          type="button"
                          className="btn btn-sm meal-add-btn"
                          onClick={() => setEditMeals([newBlankMeal()])}
                        >
                          + Add meal
                        </button>
                      </div>
                    )}
                    {editMeals.map((meal, mIdx) => {
                      const venueEntry = mealVenueOptions.find(v => v.label === meal.venue);
                      return (
                        <div key={mIdx} className="meal-block">
                          <div className="meal-block-header">
                            <select
                              className="form-input meal-venue-input"
                              value={meal.venue}
                              onChange={e =>
                                setEditMeals(prev =>
                                  prev.map((m, i) => (i === mIdx ? { ...m, venue: e.target.value } : m)),
                                )
                              }
                            >
                              <option value="">Venue</option>
                              {mealVenueOptions.map(v => (
                                <option key={v.label} value={v.label}>{v.label}</option>
                              ))}
                            </select>
                            {editMeals.length > 1 && (
                              <button
                                type="button"
                                className="meal-remove-block"
                                title="Remove this meal"
                                onClick={() => setEditMeals(prev => prev.filter((_, i) => i !== mIdx))}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          {meal.fields.map((f, fIdx) => {
                            const courseOptionKey = COURSE_KEY_TO_OPTIONS[f.type];
                            const courseOptions = venueEntry ? venueEntry.options[courseOptionKey] : [];
                            const hasOptions = (courseOptions?.length ?? 0) > 0;
                            return (
                              <div key={`${f.type}-${fIdx}`} className="meal-field-row">
                                <select
                                  className="form-input meal-field-select"
                                  value={f.value}
                                  onChange={e =>
                                    setEditMeals(prev =>
                                      prev.map((m, i) =>
                                        i === mIdx
                                          ? {
                                              ...m,
                                              fields: m.fields.map((ff, j) =>
                                                j === fIdx ? { ...ff, value: e.target.value } : ff,
                                              ),
                                            }
                                          : m,
                                      ),
                                    )
                                  }
                                  disabled={!venueEntry || !hasOptions}
                                >
                                  <option value="">
                                    {venueEntry
                                      ? hasOptions
                                        ? MEAL_FIELD_LABEL[f.type]
                                        : `${MEAL_FIELD_LABEL[f.type]} — no options`
                                      : `${MEAL_FIELD_LABEL[f.type]} — pick a venue first`}
                                  </option>
                                  {hasOptions &&
                                    courseOptions!.map(opt => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  {/* Preserve a previously-saved value that no longer matches */}
                                  {f.value && !courseOptions?.includes(f.value) && (
                                    <option value={f.value}>{f.value} (custom)</option>
                                  )}
                                </select>
                                <button
                                  type="button"
                                  className="meal-field-remove"
                                  title={`Remove ${MEAL_FIELD_LABEL[f.type]} row`}
                                  onClick={() =>
                                    setEditMeals(prev =>
                                      prev.map((m, i) =>
                                        i === mIdx
                                          ? { ...m, fields: m.fields.filter((_, j) => j !== fIdx) }
                                          : m,
                                      ),
                                    )
                                  }
                                >
                                  –
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {editMeals.length > 0 && (
                      <button
                        type="button"
                        className="meal-add-block"
                        onClick={() => setEditMeals(prev => [...prev, newBlankMeal()])}
                      >
                        + Add another meal
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          <div className="form-group">
            <label>RSVP Status</label>
            <select className="form-input" value={editRsvp} onChange={e => setEditRsvp(e.target.value)}>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="declined">Declined</option>
            </select>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea className="form-input" rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)} />
          </div>
          <div className="drawer-footer">
            <button type="submit" className="btn btn-primary" disabled={editSaving || !editName.trim()}>
              {editSaving ? "Saving..." : "Save Changes"}
            </button>
            <button type="button" className="btn" onClick={closeEditDrawer}>Cancel</button>
          </div>
        </form>
      </div>

      <EventDrawer
        open={editEventDrawerOpen}
        event={event}
        onClose={() => setEditEventDrawerOpen(false)}
        onSaved={(updated) => {
          setEvent(updated);
          setEditEventDrawerOpen(false);
        }}
      />
    </div>
  );
}
