import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import type { Attendee } from "../types";
import { api } from "../api/client";
import AttendeeCard, { getDietaryBadges } from "./AttendeeCard";

// Minimal CSV parser that handles quoted fields and escaped quotes
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// Strip every non-alphanumeric character and lowercase — turns
// "First Name", "FIRST_NAME", "first-name", "firstname" all into
// the same key "firstname" so a single candidate list catches every
// common header variation a real-world spreadsheet might use.
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Lowercase + split on any non-alphanumeric character. Turns
// "What is your name?" into Set{"what","is","your","name"} so a
// candidate like "name" matches even when the question header buries
// the keyword in natural-language phrasing (Google Forms exports,
// Typeform CSVs, etc.).
function tokenize(h: string): Set<string> {
  return new Set(h.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

// Walk a row twice:
//   1. EXACT compact match against `candidates` — fast, lossless for
//      headers like "Email" / "Full Name" / "first_name" that compact
//      cleanly to a known token.
//   2. TOKEN fallback — for natural-language headers ("What is your
//      email address?"), accept any column whose tokenized form
//      contains any candidate AND none of `excludeTokens`. The
//      exclude list is how the full-name lookup avoids stealing
//      "First Name" / "Last Name" — those columns contain the word
//      "name" too but belong to the first/last buckets.
function pickField(
  row: Record<string, string>,
  rowTokens: Record<string, Set<string>>,
  candidates: string[],
  excludeTokens: string[] = [],
): string {
  // Pass 1 — exact compact match.
  for (const c of candidates) {
    const v = row[c];
    if (v != null && v !== "") return v;
  }
  // Pass 2 — any header whose tokens contain a candidate keyword.
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    const tokens = rowTokens[key];
    if (!tokens) continue;
    if (excludeTokens.some(e => tokens.has(e))) continue;
    if (candidates.some(c => tokens.has(c))) return value;
  }
  return "";
}

// Tokens that, when present in a header, mark the column as a NAME
// PART (first / last / etc) rather than a full-name column. The
// full-name lookup excludes these so "First Name" / "Last Name" don't
// accidentally claim the full-name slot just because they also
// contain the word "name".
const NAME_PART_TOKENS = [
  "first", "given", "forename", "fname",
  "last", "sur", "surname", "family", "lname",
];

// Map a row of {column_header → value} into an Attendee partial.
// Shared between CSV / XLSX / PDF paths so the column-name heuristics
// stay identical regardless of source format. The header keys handed
// in can be in any case / punctuation — normHeader collapses them.
function rowToAttendee(rawRow: Record<string, string>): Partial<Attendee> | null {
  // Re-key the row using the normalized header form so the candidate
  // lists below can match without worrying about case / spaces /
  // underscores / dashes. Trim values along the way. Parallel-key the
  // token set off the ORIGINAL header (before compacting) so multi-
  // word headers like "What is your name?" still tokenize cleanly.
  const row: Record<string, string> = {};
  const rowTokens: Record<string, Set<string>> = {};
  for (const [k, v] of Object.entries(rawRow)) {
    const compact = normHeader(k);
    row[compact] = String(v ?? "").trim();
    rowTokens[compact] = tokenize(k);
  }

  // Name resolution. Three-layer cascade:
  //   1. Exact / compact match for canonical full-name headers.
  //   2. First + Last split-column fallback (very common in CRM /
  //      Eventbrite / Mailchimp / Gmail-contacts exports).
  //   3. Token-based fallback for natural-language headers like
  //      "What is your name?" (Google Forms). Guarded by
  //      NAME_PART_TOKENS so it doesn't poach the first / last
  //      columns instead.
  let name = pickField(row, rowTokens,
    [
      "name", "fullname", "guestname", "attendeename", "personname",
      "displayname", "guest", "attendee", "person", "contact", "contactname",
    ],
    NAME_PART_TOKENS,
  );
  if (!name) {
    const first = pickField(row, rowTokens, [
      "firstname", "givenname", "first", "fname", "forename",
    ]);
    const last = pickField(row, rowTokens, [
      "lastname", "surname", "familyname", "last", "lname",
    ]);
    if (first || last) {
      name = [first, last].filter(Boolean).join(" ").trim();
    }
  }
  if (!name) return null;

  const email = pickField(row, rowTokens, [
    "email", "emailaddress", "mail", "emailid", "primaryemail",
  ]) || null;

  const phone = pickField(row, rowTokens, [
    "phone", "phonenumber", "tel", "telephone", "mobile", "mobilenumber",
    "cell", "cellphone", "contactnumber",
  ]) || null;

  const country = pickField(row, rowTokens, [
    "country", "countryregion", "nation", "region",
  ]) || null;

  const dietary = pickField(row, rowTokens, [
    "dietary", "dietaryrequirements", "dietaryneeds", "dietaryrestrictions",
    "diet", "allergies", "foodallergies", "restrictions", "specialdiet",
    "specialrequests", "specialrequirements",
  ]) || null;

  const notes = pickField(row, rowTokens, [
    "notes", "note", "comments", "comment", "remarks", "message",
  ]) || null;

  const rsvpRaw = pickField(row, rowTokens, [
    "rsvp", "rsvpstatus", "status", "response", "attendance",
  ]);
  const rsvp = rsvpRaw ? rsvpRaw.toLowerCase() : "pending";

  return {
    name,
    email,
    phone,
    country,
    dietary_requirements: dietary,
    notes,
    rsvp_status: rsvp,
  };
}

function parseAttendeeCSV(text: string): Partial<Attendee>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const rows: Partial<Attendee>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] ?? "").trim(); });
    const att = rowToAttendee(row);
    if (att) rows.push(att);
  }
  return rows;
}

// Parse XLS / XLSX via SheetJS. Reads the first sheet, normalizes header
// names to lowercase, then runs each row through the shared rowToAttendee.
async function parseAttendeeExcel(file: File): Promise<Partial<Attendee>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  if (!firstSheet) return [];
  const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  const rows: Partial<Attendee>[] = [];
  for (const raw of json) {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      lower[k.toString().trim().toLowerCase()] = v == null ? "" : String(v).trim();
    }
    const att = rowToAttendee(lower);
    if (att) rows.push(att);
  }
  return rows;
}

// PDFs require server-side parsing (pdfplumber). The backend extracts the
// table rows; we run each one through the same rowToAttendee mapper.
async function parseAttendeePdf(file: File): Promise<Partial<Attendee>[]> {
  const result = await api.parsePdfTable(file);
  const out: Partial<Attendee>[] = [];
  for (const row of result.rows) {
    const att = rowToAttendee(row);
    if (att) out.push(att);
  }
  return out;
}

interface Props {
  attendees: Attendee[];
  onAdd: (data: Partial<Attendee>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onEdit: (attendee: Attendee) => void;
  seatedIds?: Set<number>;
  onCreateForm?: () => void;
  hasForm?: boolean;
  // Optional controlled search — when supplied, the parent owns the search
  // input (e.g. rendered next to the banner above) and AttendeeList just
  // filters by it. Falls back to internal state otherwise.
  filter?: string;
  onFilterChange?: (v: string) => void;
}

type DietFilter = "Vegan" | "Vegetarian" | "Gluten-free";

const DIET_CHIPS: { key: DietFilter; icon: string; color: string; bg: string; match: string[] }[] = [
  { key: "Vegan",       icon: "🌱", color: "#15803d", bg: "#dcfce7", match: ["végan", "vegan"] },
  { key: "Vegetarian",  icon: "🌿", color: "#166534", bg: "#f0fdf4", match: ["végétarien", "vegetarian"] },
  { key: "Gluten-free", icon: "🌾", color: "#92400e", bg: "#fef3c7", match: ["sans gluten", "gluten-free", "gluten free"] },
];

function matchesDietFilter(attendee: Attendee, filters: Set<DietFilter>): boolean {
  if (filters.size === 0) return true;
  const d = (attendee.dietary_requirements ?? "").toLowerCase();
  return [...filters].every(f => {
    const chip = DIET_CHIPS.find(c => c.key === f)!;
    return chip.match.some(m => d.includes(m));
  });
}

export default function AttendeeList({ attendees, onAdd, onDelete, onEdit, seatedIds, onCreateForm, hasForm, filter: filterProp, onFilterChange }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [dietary, setDietary] = useState("");
  const [rsvp, setRsvp] = useState("pending");
  const [internalFilter, setInternalFilter] = useState("");
  const filter = filterProp ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;
  const [dietFilters, setDietFilters] = useState<Set<DietFilter>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const csvInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    // Dispatch on file extension. XLSX/XLS → SheetJS; PDF → backend
    // pdfplumber; anything else falls through to the plain CSV path.
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isExcel = ext === "xlsx" || ext === "xls";
    const isPdf = ext === "pdf";
    const fileLabel = isPdf ? "PDF" : isExcel ? "Excel" : "CSV";
    try {
      const rows = isPdf
        ? await parseAttendeePdf(file)
        : isExcel
          ? await parseAttendeeExcel(file)
          : parseAttendeeCSV(await file.text());
      if (rows.length === 0) {
        // We try every common name-column variant (Name, Full Name,
        // Guest, Attendee, First Name + Last Name, …) — if NONE matched,
        // the file genuinely doesn't have a column we can identify as
        // a person. Tell the user the shapes we look for so they can
        // rename a column to match without guessing.
        setUploadMsg(
          `No attendees found in your ${fileLabel} file. We look for a column called Name, Full Name, Guest, Attendee, or a pair of First Name + Last Name. Rename a column to match and try again.`,
        );
        return;
      }
      let imported = 0;
      for (const row of rows) {
        try {
          await onAdd(row);
          imported++;
        } catch {
          // skip bad rows, continue
        }
      }
      setUploadMsg(`Imported ${imported} of ${rows.length} attendees.`);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : `Failed to parse ${fileLabel} file.`;
      setUploadMsg(msg);
    } finally {
      setUploading(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
      setTimeout(() => setUploadMsg(null), 4000);
    }
  };

  const toggleDiet = (key: DietFilter) => {
    setDietFilters(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onAdd({ name, email: email || null, country: country || null, dietary_requirements: dietary || null, rsvp_status: rsvp });
    setName(""); setEmail(""); setCountry(""); setDietary(""); setRsvp("pending");
    setShowForm(false);
  };

  const filtered = attendees.filter(a =>
    (a.name.toLowerCase().includes(filter.toLowerCase()) ||
     a.email?.toLowerCase().includes(filter.toLowerCase()) ||
     a.country?.toLowerCase().includes(filter.toLowerCase())) &&
    matchesDietFilter(a, dietFilters)
  );

  return (
    <div className="attendee-list">
      <div className="list-header">
        {attendees.length > 0 ? (
          <div className="diet-chips">
            {DIET_CHIPS.map(chip => {
              const active = dietFilters.has(chip.key);
              const count = attendees.filter(a => matchesDietFilter(a, new Set([chip.key]))).length;
              if (count === 0) return null;
              return (
                <button
                  key={chip.key}
                  className={`diet-chip ${active ? "diet-chip-active" : ""}`}
                  style={active ? { color: chip.color, background: chip.bg, borderColor: chip.color } : {}}
                  onClick={() => toggleDiet(chip.key)}
                >
                  {chip.icon} {chip.key} <span className="diet-chip-count">{count}</span>
                </button>
              );
            })}
          </div>
        ) : <span />}
        <div className="list-header-actions">
          {attendees.length > 0 && filterProp === undefined && (
            <input
              type="text"
              className="header-search"
              placeholder="Search by name, country..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          )}
          {!showForm && (
            <button className="btn btn-primary add-attendee-btn" onClick={() => setShowForm(true)}>
              <span className="add-attendee-plus">+</span>
              <span className="add-attendee-label"> Add Attendee</span>
            </button>
          )}
          {!showForm && (
            <>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.xls,.xlsx,.pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
                style={{ display: "none" }}
                onChange={handleCSVUpload}
              />
              <button
                className="btn btn-icon"
                onClick={() => csvInputRef.current?.click()}
                disabled={uploading}
                title="Import attendees from CSV, Excel, or PDF"
                aria-label="Import attendees from CSV, Excel, or PDF"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="btn-icon-label">CSV</span>
              </button>
            </>
          )}
          {attendees.length > 0 && (
            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === "list" ? "view-toggle-btn-active" : ""}`}
                onClick={() => setViewMode("list")}
                title="List view"
                aria-label="List view"
                aria-pressed={viewMode === "list"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === "board" ? "view-toggle-btn-active" : ""}`}
                onClick={() => setViewMode("board")}
                title="Board view"
                aria-label="Board view"
                aria-pressed={viewMode === "board"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
      {uploadMsg && (
        <div className="csv-upload-msg">{uploadMsg}</div>
      )}

      {showForm && (
        <form className="inline-form inline-form-rows" onSubmit={handleSubmit}>
          <div className="inline-form-row">
            <input type="text" placeholder="Name *" value={name} onChange={e => setName(e.target.value)} required />
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="text" placeholder="Country" value={country} onChange={e => setCountry(e.target.value)} />
          </div>
          <div className="inline-form-row">
            <input type="text" placeholder="Dietary requirements" value={dietary} onChange={e => setDietary(e.target.value)} />
            <select value={rsvp} onChange={e => setRsvp(e.target.value)}>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="declined">Declined</option>
            </select>
            <button type="submit" className="btn btn-primary">Save</button>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {attendees.length === 0 && !hasForm && onCreateForm && (
        <button className="attendee-form-cta" onClick={onCreateForm}>
          <span className="attendee-form-cta-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </span>
          <span className="attendee-form-cta-label">Add a Form</span>
          <span className="attendee-form-cta-sub">Gather Your Attendee Data</span>
        </button>
      )}

      {viewMode === "board" && (
        <div className="attendee-card-grid">
          {filtered.map(attendee => (
            <AttendeeCard
              key={attendee.id}
              attendee={attendee}
              onEdit={onEdit}
              onDelete={onDelete}
              seated={seatedIds?.has(attendee.id)}
            />
          ))}
          {filtered.length === 0 && attendees.length > 0 && (
            <div className="empty-state">
              No attendees match your filters.
            </div>
          )}
        </div>
      )}

      {viewMode === "list" && (
        <div className="attendee-list-view">
          <div className="alv-header">
            <span className="alv-col alv-col-name">Name</span>
            <span className="alv-col alv-col-email">Email</span>
            <span className="alv-col alv-col-country">Country</span>
            <span className="alv-col alv-col-rsvp">RSVP</span>
            <span className="alv-col alv-col-dietary">Dietary</span>
            <span className="alv-col alv-col-actions"></span>
          </div>
          {filtered.map(attendee => {
            const rsvp = attendee.rsvp_status || "pending";
            const dietBadges = getDietaryBadges(attendee.dietary_requirements);
            return (
              <div
                key={attendee.id}
                className="alv-row"
                onClick={() => navigate(`/events/${attendee.event_id}/attendees/${attendee.id}`)}
              >
                <span className="alv-col alv-col-name">
                  {attendee.name}
                  {seatedIds?.has(attendee.id) && <span className="alv-seated-dot" title="Seated" />}
                </span>
                <span className="alv-col alv-col-email">{attendee.email || "—"}</span>
                <span className="alv-col alv-col-country">{attendee.country || "—"}</span>
                <span className="alv-col alv-col-rsvp">
                  <span className={`alv-rsvp alv-rsvp-${rsvp}`}>{rsvp}</span>
                </span>
                <span className="alv-col alv-col-dietary">
                  {dietBadges.length === 0 ? (
                    <span className="alv-dietary-empty">—</span>
                  ) : (
                    dietBadges.map((b, i) => (
                      <span key={i} className="alv-diet-badge" style={{ background: b.bg, color: b.color }}>
                        {b.icon} {b.label}
                      </span>
                    ))
                  )}
                </span>
                <span className="alv-col alv-col-actions" onClick={e => e.stopPropagation()}>
                  <button className="alv-btn" onClick={() => onEdit(attendee)}>Edit</button>
                  <button className="alv-btn alv-btn-danger" onClick={() => onDelete(attendee.id)}>Remove</button>
                </span>
              </div>
            );
          })}
          {filtered.length === 0 && attendees.length > 0 && (
            <div className="empty-state">No attendees match your filters.</div>
          )}
        </div>
      )}
    </div>
  );
}
