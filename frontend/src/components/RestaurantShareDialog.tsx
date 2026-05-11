import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { copyToClipboard } from "../utils/clipboard";
import { useAuth } from "../contexts/AuthContext";

type Variant = "attendees" | "seating";

interface Props {
  eventId: number;
  variant: Variant;
  onClose: () => void;
}

const COPY: Record<Variant, { title: string; subtitle: string; sendLabel: string }> = {
  attendees: {
    title: "Share Attendee List",
    subtitle: "Send a read-only attendee list with dietary requirements — email, phone, and notes are never shared.",
    sendLabel: "restaurant",
  },
  seating: {
    title: "Share Seating Chart",
    subtitle: "Send the seating chart with each guest's dietary requirements directly to the caterer/restaurant.",
    sendLabel: "restaurant",
  },
};

export default function RestaurantShareDialog({ eventId, variant, onClose }: Props) {
  const copy = COPY[variant];
  const { user } = useAuth();
  const defaultOrganizerName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "";
  const defaultOrganizerEmail = user?.email || "";

  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // Email-sending state
  const [sendViaEmail, setSendViaEmail] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [organizerName, setOrganizerName] = useState(defaultOrganizerName);
  const [organizerEmail, setOrganizerEmail] = useState(defaultOrganizerEmail);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: string[]; failed: string[] } | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getRestaurantLink(eventId, variant)
      .then(res => setUrl(res.share_url))
      .catch(e => setError(e.message || "Failed to load share link."))
      .finally(() => setLoading(false));
  }, [eventId, variant]);

  const parseEmails = (): string[] =>
    emailText
      .split(/[,\n;]+/)
      .map(e => e.trim())
      .filter(e => e && e.includes("@"));

  const recipientCount = useMemo(() => parseEmails().length, [emailText]);

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.generateRestaurantLink(eventId, variant);
      setUrl(res.share_url);
    } catch (e: any) {
      setError(e.message || "Failed to create link.");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.revokeRestaurantLink(eventId, variant);
      setUrl(null);
      setConfirmRevoke(false);
    } catch (e: any) {
      setError(e.message || "Failed to revoke link.");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError("Couldn't copy automatically — select the link and copy it manually (⌘/Ctrl+C).");
      setTimeout(() => setError(null), 4000);
    }
  };

  const handleSend = async () => {
    const emails = parseEmails();
    if (emails.length === 0) {
      setError("Enter at least one valid email address.");
      return;
    }
    if (!organizerName.trim()) {
      setError("Your name is required so the restaurant knows who sent this.");
      return;
    }
    setError(null);
    setSending(true);
    setSendResult(null);
    try {
      const res = await api.sendRestaurantLink(eventId, variant, {
        emails,
        organizer_name: organizerName.trim(),
        organizer_email: organizerEmail.trim() || undefined,
        message: message.trim() || undefined,
      });
      // Reflect any newly-generated URL from the backend
      if (!url) setUrl(res.share_url);
      setSendResult({ sent: res.sent, failed: res.failed });
      if (res.sent.length > 0) {
        setEmailText("");
        setMessage("");
      }
    } catch (e: any) {
      setError(e.message || "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="invite-overlay" onClick={onClose} />
      <div className="invite-modal form-send-modal">
        <div className="invite-modal-header">
          <h3>{copy.title}</h3>
          <button className="invite-close" onClick={onClose}>✕</button>
        </div>

        <div className="invite-modal-body">
          <p className="form-hint" style={{ marginBottom: 12 }}>
            {copy.subtitle}
          </p>

          {loading && <p>Loading…</p>}

          {!loading && !url && (
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={busy}
              style={{ width: "100%" }}
            >
              {busy ? "Generating…" : "Generate share link"}
            </button>
          )}

          {!loading && url && (
            <>
              <div className="form-send-link-section">
                <label>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <span>Shareable Link</span>
                </label>
                <div className="form-send-link-row">
                  <input
                    type="text"
                    value={url}
                    readOnly
                    className="form-send-link-input"
                    onFocus={e => e.currentTarget.select()}
                    onClick={e => e.currentTarget.select()}
                  />
                  <button className="btn btn-sm rs-copy-btn" onClick={handleCopy}>
                    {copied ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {!confirmRevoke ? (
                <div className="rs-action-row">
                  <button
                    className="btn"
                    onClick={() => setConfirmRevoke(true)}
                    disabled={busy}
                  >
                    Revoke link
                  </button>
                  <div className="rs-regen-wrap">
                    <button
                      className="btn btn-primary"
                      onClick={handleGenerate}
                      disabled={busy}
                    >
                      {busy ? "Regenerating…" : "Regenerate link"}
                    </button>
                    <span className="rs-regen-hint">Invalidates old link</span>
                  </div>
                </div>
              ) : (
                <div className="rs-confirm">
                  <p className="form-hint" style={{ margin: 0 }}>
                    Revoking this link will immediately stop anyone from viewing it. You can generate a new one anytime.
                  </p>
                  <div className="rs-confirm-actions">
                    <button className="btn" onClick={() => setConfirmRevoke(false)} disabled={busy}>
                      Cancel
                    </button>
                    <button className="btn btn-danger" onClick={handleRevoke} disabled={busy}>
                      {busy ? "Revoking…" : "Revoke"}
                    </button>
                  </div>
                </div>
              )}

              <label className="rs-send-toggle">
                <input
                  type="checkbox"
                  checked={sendViaEmail}
                  onChange={e => setSendViaEmail(e.target.checked)}
                />
                <span>Email restaurants</span>
              </label>

              {sendViaEmail && (
                <>
                  <div className="form-send-divider" />

                  {/* ── Email the link directly ── */}
                  <div className="rs-send-section">
                    <div className="form-group">
                      <label>Restaurant email(s)</label>
                      <textarea
                        value={emailText}
                        onChange={e => setEmailText(e.target.value)}
                        placeholder="restaurant@example.com, catering@example.com"
                        rows={2}
                      />
                      {recipientCount > 0 && (
                        <span className="form-hint">
                          {recipientCount} recipient{recipientCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>

                    <div className="form-group">
                      <label>Personal message (optional)</label>
                      <textarea
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        placeholder="Hi — please see attached attendee details for our event on March 27. Let me know if you have any questions."
                        rows={3}
                      />
                    </div>

                    <div className="rs-from-row">
                      <div className="form-group" style={{ flex: 1 }}>
                        <label>From name *</label>
                        <input
                          type="text"
                          value={organizerName}
                          onChange={e => setOrganizerName(e.target.value)}
                          placeholder="Your name"
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label>From email</label>
                        <input
                          type="email"
                          value={organizerEmail}
                          onChange={e => setOrganizerEmail(e.target.value)}
                          placeholder="you@example.com"
                        />
                      </div>
                    </div>
                    <span className="form-hint">
                      The restaurant will see: "You've been sent event details by {organizerName || "Your name"}
                      {organizerEmail ? ` (${organizerEmail})` : ""}." Replies go to this address.
                    </span>

                    <button
                      className="btn btn-primary"
                      onClick={handleSend}
                      disabled={sending || recipientCount === 0 || !organizerName.trim()}
                      style={{ width: "100%", marginTop: 12 }}
                    >
                      {sending
                        ? "Sending…"
                        : `Send to ${recipientCount || 0} restaurant${recipientCount === 1 ? "" : "s"}`}
                    </button>

                    {sendResult && sendResult.sent.length > 0 && (
                      <p className="edit-user-success" style={{ marginTop: 8 }}>
                        Sent to {sendResult.sent.join(", ")}.
                        {sendResult.failed.length > 0 && ` Failed: ${sendResult.failed.join(", ")}.`}
                      </p>
                    )}
                    {sendResult && sendResult.sent.length === 0 && sendResult.failed.length > 0 && (
                      <p className="edit-user-error" style={{ marginTop: 8 }}>
                        Failed to send to: {sendResult.failed.join(", ")}.
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {error && <p className="edit-user-error">{error}</p>}
        </div>
      </div>
    </>
  );
}
