import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "../api/client";
import { copyToClipboard } from "../utils/clipboard";
import type { Attendee, CustomForm, FormInvitation } from "../types";

interface Props {
  eventId: number;
  form: CustomForm;
  attendees?: Attendee[];
  onClose: () => void;
  onSent: () => void;
}

// Minimal CSV parser — handles quoted fields with escaped quotes
function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function extractEmailsFromCSV(text: string): string[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const emailIdx = headers.findIndex(h => h === "email" || h === "email address" || h === "e-mail");
  const emails: string[] = [];
  // If there's a header row with an email column, use that; otherwise scan every cell
  const startRow = emailIdx >= 0 ? 1 : 0;
  for (let i = startRow; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (emailIdx >= 0) {
      const val = (cells[emailIdx] ?? "").trim();
      if (val && val.includes("@")) emails.push(val);
    } else {
      for (const cell of cells) {
        const v = cell.trim();
        if (v.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) emails.push(v);
      }
    }
  }
  return emails;
}

export default function FormSendDialog({ eventId, form, attendees = [], onClose, onSent }: Props) {
  const [emailText, setEmailText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<FormInvitation[]>([]);
  const [copied, setCopied] = useState(false);
  const [selectedAttendeeIds, setSelectedAttendeeIds] = useState<Set<number>>(new Set());
  const [showAttendeePicker, setShowAttendeePicker] = useState(false);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const formUrl = `${window.location.origin}/forms/${form.share_token}`;

  useEffect(() => {
    api.listFormInvitations(eventId, form.id).then(setInvitations).catch(() => {});
  }, [eventId, form.id]);

  // Only attendees with valid-looking emails
  const attendeesWithEmails = useMemo(
    () => attendees.filter(a => a.email && a.email.includes("@")),
    [attendees],
  );

  const parseTypedEmails = (): string[] =>
    emailText
      .split(/[,\n;]+/)
      .map(e => e.trim())
      .filter(e => e && e.includes("@"));

  // Combined unique recipient list: typed + selected attendees
  const allRecipients = useMemo(() => {
    const set = new Set<string>();
    for (const e of parseTypedEmails()) set.add(e.toLowerCase());
    for (const id of selectedAttendeeIds) {
      const att = attendees.find(a => a.id === id);
      if (att?.email) set.add(att.email.toLowerCase());
    }
    return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailText, selectedAttendeeIds, attendees]);

  const toggleAttendee = (id: number) => {
    setSelectedAttendeeIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllAttendees = () => {
    setSelectedAttendeeIds(new Set(attendeesWithEmails.map(a => a.id)));
  };

  const clearSelectedAttendees = () => {
    setSelectedAttendeeIds(new Set());
  };

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvMsg(null);
    try {
      const text = await file.text();
      const emails = extractEmailsFromCSV(text);
      if (emails.length === 0) {
        setCsvMsg("No valid email addresses found in that file.");
      } else {
        // Append to textarea, deduping against what's already typed
        const existing = new Set(parseTypedEmails().map(e => e.toLowerCase()));
        const fresh = emails.filter(e => !existing.has(e.toLowerCase()));
        const appended = fresh.length > 0
          ? (emailText.trim() ? emailText.trim() + "\n" : "") + fresh.join("\n")
          : emailText;
        setEmailText(appended);
        setCsvMsg(`Imported ${fresh.length} email${fresh.length !== 1 ? "s" : ""} from CSV${emails.length - fresh.length > 0 ? ` (${emails.length - fresh.length} duplicate${emails.length - fresh.length !== 1 ? "s" : ""} skipped)` : ""}.`);
      }
    } catch {
      setCsvMsg("Failed to read that file.");
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = "";
      setTimeout(() => setCsvMsg(null), 4000);
    }
  };

  const handleSend = async () => {
    if (allRecipients.length === 0) {
      setError("Please enter at least one valid email address.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const results = await api.sendFormInvitations(eventId, form.id, allRecipients);
      setInvitations(prev => [...prev, ...results]);
      setEmailText("");
      setSelectedAttendeeIds(new Set());
      setSent(true);
      setTimeout(() => setSent(false), 3000);
      onSent();
    } catch (e: any) {
      setError(e.message || "Failed to send invitations.");
    } finally {
      setSending(false);
    }
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(formUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError("Couldn't copy automatically — select the link and copy it manually (⌘/Ctrl+C).");
      setTimeout(() => setError(null), 4000);
    }
  };

  const recipientCount = allRecipients.length;

  return (
    <>
      <div className="invite-overlay" onClick={onClose} />
      <div className="invite-modal form-send-modal">
        <div className="invite-modal-header">
          <h3>Send Form</h3>
          <button className="invite-close" onClick={onClose}>✕</button>
        </div>

        <div className="invite-modal-body">
          <div className="form-send-link-section">
            <label>Shareable Link</label>
            <div className="form-send-link-row">
              <input
                type="text"
                value={formUrl}
                readOnly
                className="form-send-link-input"
                onFocus={e => e.currentTarget.select()}
                onClick={e => e.currentTarget.select()}
              />
              <button className="btn btn-sm" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <span className="form-hint">Share this link directly or use the email option below.</span>
          </div>

          <div className="form-send-divider" />

          <div className="form-group">
            <div className="form-send-recipients-header">
              <label style={{ margin: 0 }}>Recipients</label>
              <div className="form-send-recipient-actions">
                {attendeesWithEmails.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setShowAttendeePicker(v => !v)}
                  >
                    {showAttendeePicker ? "Hide attendees" : `Select from attendees (${attendeesWithEmails.length})`}
                  </button>
                )}
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={handleCSVUpload}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-icon"
                  onClick={() => csvInputRef.current?.click()}
                  title="Import emails from CSV"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span className="btn-icon-label">CSV</span>
                </button>
              </div>
            </div>

            {showAttendeePicker && attendeesWithEmails.length > 0 && (
              <div className="form-send-attendee-picker">
                <div className="form-send-attendee-picker-actions">
                  <button type="button" className="btn btn-sm" onClick={selectAllAttendees}>Select all</button>
                  <button type="button" className="btn btn-sm" onClick={clearSelectedAttendees}>Clear</button>
                  <span className="form-hint" style={{ marginLeft: "auto" }}>
                    {selectedAttendeeIds.size} selected
                  </span>
                </div>
                <div className="form-send-attendee-list">
                  {attendeesWithEmails.map(a => (
                    <label key={a.id} className="form-send-attendee-row">
                      <input
                        type="checkbox"
                        checked={selectedAttendeeIds.has(a.id)}
                        onChange={() => toggleAttendee(a.id)}
                      />
                      <span className="form-send-attendee-name">{a.name}</span>
                      <span className="form-send-attendee-email">{a.email}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <textarea
              value={emailText}
              onChange={e => setEmailText(e.target.value)}
              placeholder="Type or paste email addresses separated by commas or new lines&#10;e.g. guest1@email.com, guest2@email.com"
              rows={4}
              style={{ marginTop: 10 }}
            />
            {csvMsg && <span className="form-hint">{csvMsg}</span>}
            {recipientCount > 0 && (
              <span className="form-hint">
                {recipientCount} recipient{recipientCount !== 1 ? "s" : ""} ready to send
              </span>
            )}
          </div>

          {error && <p className="edit-user-error">{error}</p>}
          {sent && <p className="edit-user-success">Invitations sent successfully!</p>}

          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={sending || recipientCount === 0}
            style={{ width: "100%" }}
          >
            {sending ? "Sending..." : `Send to ${recipientCount} Guest${recipientCount !== 1 ? "s" : ""}`}
          </button>

          {invitations.length > 0 && (
            <div className="form-send-history">
              <h4>Sent Invitations</h4>
              <div className="form-send-invitation-list">
                {invitations.map(inv => (
                  <div key={inv.id} className="form-send-invitation-row">
                    <span className="form-send-invitation-email">{inv.email}</span>
                    <span className={`form-send-invitation-status ${inv.status}`}>
                      {inv.status === "sent" ? "Sent" : inv.status === "failed" ? "Failed" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
