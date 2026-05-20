import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { usePendingInvites } from "../contexts/PendingInvitesContext";
import { useWorkspaceMembers } from "../contexts/WorkspaceMembersContext";
import { supabase } from "../lib/supabase";
// SalonShape type import removed alongside the orphan SalonsManagerSection
// (see comment block below). Re-add when the salon UI comes back.
import { api, type ProfileShape, type PendingInvite } from "../api/client";
import { fileToCompressedDataUrl } from "../utils/image";

type Section = "users" | "profile" | "billing" | "orders" | "settings";
type Role = "Owner" | "Admin" | "Editor" | "Viewer";

interface NotificationSettings {
  event_reminders: boolean;
  reminder_minutes: number;
  include_google_maps_link: boolean;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  organizer_reminders: boolean;
  organizer_reminder_minutes: number;
  organizer_whatsapp_enabled: boolean;
}

// MessageUsage interface removed alongside the hidden Message Usage
// panel (commit 1233b9e). SMS / WhatsApp send paths are Phase II;
// when they ship, restore the interface + the panel.

interface User {
  id: string;
  initials: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: "active" | "pending";
}

const ROLES: Role[] = ["Admin", "Editor", "Viewer"];

export default function AccountPage() {
  const { user: authUser, updateUser: authUpdateUser } = useAuth();
  // The header-dropdown badge reads from the same PendingInvitesContext,
  // so accept / decline here calls `refresh()` to keep the count in
  // lockstep without having to plumb a prop through.
  const { refresh: refreshGlobalPendingInvites } = usePendingInvites();
  // The header avatars cluster reads from the same WorkspaceMembersContext.
  // Every mutation that adds or removes a member (invite / accept / decline
  // / remove / role-change) calls this so the header updates immediately.
  const { refresh: refreshGlobalMembers } = useWorkspaceMembers();
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const active: Section =
    section === "profile" ? "profile"
    : section === "billing" ? "billing"
    : section === "orders" ? "orders"
    : section === "settings" ? "settings"
    : "users";

  // Capture the route the user came from BEFORE entering Account (set as
  // location.state.from when the dropdown navigates here). The /account
  // and /account/:section routes are separate Routes, so switching between
  // them remounts this component — which is why the sub-nav handlers
  // below have to forward `state.from` so the referrer survives the
  // remount. Falls back to /events if there's no referrer (direct link,
  // page reload).
  const [returnTo] = useState<string>(() => {
    const from = (location.state as { from?: string } | null)?.from;
    return from && !from.startsWith("/account") ? from : "/";
  });
  const goToSection = (path: string) => navigate(path, { state: { from: returnTo } });

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("Viewer");

  const [inviteError, setInviteError] = useState<string | null>(null);

  // Load workspace members + any invites the current user has been
  // offered. Server is the source of truth — no more frontend-only
  // stub data. Both calls are cheap; fire them in parallel.
  const refreshUsers = useCallback(async () => {
    try {
      const [members, invites] = await Promise.all([
        api.listWorkspaceMembers(),
        api.listMyPendingInvites(),
      ]);
      setUsers(members.map(m => {
        // Owner-membership rows backfilled by the original migration
        // have `invited_email = NULL` (owners weren't "invited"), so the
        // Users-panel row for the workspace owner shows up without an
        // email. When the row IS the current authenticated user, fall
        // back to their JWT email so the panel reads consistently with
        // every other row.
        const emailFromAuth =
          m.user_id && m.user_id === authUser?.id ? authUser?.email ?? "" : "";
        const memberEmail = m.email || emailFromAuth;
        const display = m.display_name || (memberEmail ? memberEmail.split("@")[0] : "");
        const initials = (m.display_name || memberEmail || "?")
          .split(/\s+|@/)
          .filter(Boolean)
          .map(p => p[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);
        const role: Role = (
          m.role.charAt(0).toUpperCase() + m.role.slice(1)
        ) as Role;
        return {
          id: String(m.id),
          initials,
          name: display,
          email: memberEmail,
          phone: "",
          role,
          status: m.status === "active" ? "active" : "pending",
        };
      }));
      setPendingInvites(invites);
    } catch {
      // keep current state — surface error elsewhere if needed
    } finally {
      setUsersLoading(false);
    }
    // authUser is read inside (to fill the owner row's missing email)
    // — needs to be in the dep array so a fresh login picks up the new
    // identity instead of staying bound to the previous one.
  }, [authUser?.id, authUser?.email]);

  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers]);

  // Edit user state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCurrentPassword, setEditCurrentPassword] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editConfirmPassword, setEditConfirmPassword] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const openEditUser = (user: User) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditPhone(user.phone);
    setEditCurrentPassword("");
    setEditPassword("");
    setEditConfirmPassword("");
    setEditError(null);
    setEditSuccess(false);
  };

  const handleEditSave = async () => {
    if (!editingUser) return;
    setEditError(null);
    setEditSuccess(false);

    if (!editCurrentPassword) {
      setEditError("Please enter your current password to save changes.");
      return;
    }
    if (editPassword && editPassword !== editConfirmPassword) {
      setEditError("New passwords do not match.");
      return;
    }
    if (editPassword && editPassword.length < 6) {
      setEditError("New password must be at least 6 characters.");
      return;
    }

    setEditSaving(true);
    try {
      // Verify current password first
      if (editingUser.id === "1") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: editingUser.email,
          password: editCurrentPassword,
        });
        if (signInError) {
          setEditError("Current password is incorrect.");
          setEditSaving(false);
          return;
        }

        const updates: { name?: string; email?: string; password?: string } = {};
        if (editName.trim() !== editingUser.name) updates.name = editName.trim();
        if (editEmail.trim() !== editingUser.email) updates.email = editEmail.trim();
        if (editPassword) updates.password = editPassword;

        if (Object.keys(updates).length > 0) {
          const { error } = await authUpdateUser(updates);
          if (error) {
            setEditError(error.message);
            return;
          }
        }
      }

      // Update local state
      const newInitials = editName.trim().split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
      setUsers(prev => prev.map(u =>
        u.id === editingUser.id
          ? { ...u, name: editName.trim(), email: editEmail.trim(), phone: editPhone.trim(), initials: newInitials }
          : u
      ));
      setEditSuccess(true);
      setTimeout(() => {
        setEditingUser(null);
        setEditSuccess(false);
      }, 1200);
    } catch {
      setEditError("Failed to update user.");
    } finally {
      setEditSaving(false);
    }
  };

  // Notification settings
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>({
    event_reminders: true,
    reminder_minutes: 60,
    include_google_maps_link: true,
    sms_enabled: false,
    whatsapp_enabled: false,
    organizer_reminders: true,
    organizer_reminder_minutes: 30,
    organizer_whatsapp_enabled: true,
  });
  // msgUsage state removed alongside the hidden Message Usage panel.
  // Restore both interface + state when SMS/WhatsApp ships.
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);

  const loadNotifSettings = useCallback(async () => {
    // api.getMessageUsage() is intentionally skipped here while the
    // Message Usage block is hidden — no point round-tripping for a
    // panel that doesn't render. msgUsage stays at its default zeros
    // so anything that still reads it doesn't crash; re-enable the
    // fetch when the block comes back in Phase II.
    try {
      const settings = await api.getNotificationSettings();
      setNotifSettings(prev => ({ ...prev, ...settings }));
    } catch {
      // Use defaults
    }
  }, []);

  useEffect(() => {
    if (active === "settings") loadNotifSettings();
  }, [active, loadNotifSettings]);

  const saveNotifSettings = async () => {
    setNotifSaving(true);
    setNotifSaved(false);
    try {
      await api.updateNotificationSettings(notifSettings);
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 2000);
    } catch {
      // silent
    } finally {
      setNotifSaving(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteError(null);
    try {
      // role is sent lowercased (server expects 'admin'|'editor'|'viewer').
      await api.inviteWorkspaceMember({
        email: inviteEmail.trim(),
        role: inviteRole.toLowerCase() as "admin" | "editor" | "viewer",
      });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not send invite.");
      return;
    }
    // Reload from server so the new pending row appears with its real id.
    void refreshUsers();
    void refreshGlobalMembers();
    setInviteEmail("");
    setInvitePhone("");
    setInviteRole("Viewer");
    setShowInvite(false);
  };

  const handleRoleChange = async (userId: string, role: Role) => {
    // Optimistic: update locally so the dropdown feels responsive.
    // The server is the source of truth — if it rejects (403,
    // can't-demote-owner, etc) we refresh from server to revert.
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    try {
      if (role === "Owner") return;  // owners aren't reassignable
      await api.updateWorkspaceMemberRole(
        Number(userId),
        role.toLowerCase() as "admin" | "editor" | "viewer",
      );
    } catch {
      // Server rejected — pull truth back.
    }
    void refreshUsers();
    void refreshGlobalMembers();
  };

  const handleRemoveUser = async (userId: string) => {
    try {
      await api.removeWorkspaceMember(Number(userId));
    } catch {
      // Silent — surface in a future Slice 4 polish if it matters.
    }
    void refreshUsers();
    void refreshGlobalMembers();
  };

  // Surfaced to the user via inviteError next to the action buttons.
  // Previously these handlers swallowed errors silently, which masked
  // the real bug Dani hit on 2026-05-18: accept 404'd because the
  // membership row's user_id was NULL while the strict check required
  // user_id == caller. Owner kept seeing "Pending" forever with no
  // feedback in the UI. Backend now does the looser match — but if
  // anything else regresses, this surface tells us immediately.
  const handleAcceptInvite = async (memberId: number) => {
    setInviteError(null);
    try {
      await api.acceptPendingInvite(memberId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to accept invite.";
      setInviteError(msg);
      console.error("Accept invite failed", err);
    }
    void refreshUsers();
    void refreshGlobalPendingInvites();
    // An accept turns a pending row into an active member, so the
    // header avatars cluster needs a refresh too — the new collaborator
    // should appear there immediately.
    void refreshGlobalMembers();
  };

  const handleDeclineInvite = async (memberId: number) => {
    setInviteError(null);
    try {
      await api.declinePendingInvite(memberId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to decline invite.";
      setInviteError(msg);
      console.error("Decline invite failed", err);
    }
    void refreshUsers();
    void refreshGlobalPendingInvites();
    void refreshGlobalMembers();
  };

  return (
    <div className="page account-page">
      <button className="account-back" onClick={() => navigate(returnTo)}><span className="account-back-caret" /> Account</button>
      <div className="account-layout">
        <nav className="account-nav">
          <button
            className={`account-nav-item ${active === "users" ? "active" : ""}`}
            onClick={() => goToSection("/account")}
          >
            Users
          </button>
          <button
            className={`account-nav-item ${active === "profile" ? "active" : ""}`}
            onClick={() => goToSection("/account/profile")}
          >
            Host
          </button>
          <button
            className={`account-nav-item ${active === "billing" ? "active" : ""}`}
            onClick={() => goToSection("/account/billing")}
          >
            Billing
          </button>
          <button
            className={`account-nav-item ${active === "orders" ? "active" : ""}`}
            onClick={() => goToSection("/account/orders")}
          >
            Orders
          </button>
          <button
            className={`account-nav-item ${active === "settings" ? "active" : ""}`}
            onClick={() => goToSection("/account/settings")}
          >
            Settings
          </button>
        </nav>

        <div className="account-content">
          {active === "users" && (
            <div className="account-section">
              <div className="account-section-header">
                <h2>Users</h2>
                <button className="btn btn-primary btn-sm" onClick={() => setShowInvite(true)}>+ Invite User</button>
              </div>

              {/* Invite modal */}
              {showInvite && (
                <>
                  <div className="invite-overlay" onClick={() => setShowInvite(false)} />
                  <div className="invite-modal">
                    <div className="invite-modal-header">
                      <h3>Invite User</h3>
                      <button className="invite-close" onClick={() => setShowInvite(false)}>✕</button>
                    </div>
                    <div className="invite-modal-body">
                      <div className="form-group">
                        <label>Email address</label>
                        <input
                          type="email"
                          placeholder="colleague@company.com"
                          value={inviteEmail}
                          onChange={e => setInviteEmail(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="form-group">
                        <label>WhatsApp Number</label>
                        <input
                          type="tel"
                          placeholder="+1 (555) 123-4567"
                          value={invitePhone}
                          onChange={e => setInvitePhone(e.target.value)}
                        />
                        <span className="form-hint">Used for task assignment notifications</span>
                      </div>
                      <div className="form-group">
                        <label>Role</label>
                        <select value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}>
                          {ROLES.map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      <div className="invite-permissions-info">
                        <div className="invite-perm-row"><strong>Admin</strong> — Full access. Manage users, billing, and all events.</div>
                        <div className="invite-perm-row"><strong>Editor</strong> — Create and edit events, attendees, and seating.</div>
                        <div className="invite-perm-row"><strong>Viewer</strong> — View-only access to events and seating charts.</div>
                      </div>
                      {inviteError && (
                        <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{inviteError}</p>
                      )}
                    </div>
                    <div className="invite-modal-footer">
                      <button className="btn" onClick={() => setShowInvite(false)}>Cancel</button>
                      <button className="btn btn-primary" onClick={handleInvite} disabled={!inviteEmail.trim()}>
                        Send Invite
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Edit user modal */}
              {editingUser && (
                <>
                  <div className="invite-overlay" onClick={() => setEditingUser(null)} />
                  <div className="invite-modal">
                    <div className="invite-modal-header">
                      <h3>Edit Profile</h3>
                      <button className="invite-close" onClick={() => setEditingUser(null)}>✕</button>
                    </div>
                    <div className="invite-modal-body">
                      <div className="form-group">
                        <label>Full Name</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          placeholder="Full name"
                          autoFocus
                        />
                      </div>
                      <div className="form-group">
                        <label>Email</label>
                        <input
                          type="email"
                          value={editEmail}
                          onChange={e => setEditEmail(e.target.value)}
                          placeholder="Email address"
                        />
                      </div>
                      <div className="form-group">
                        <label>WhatsApp Number</label>
                        <input
                          type="tel"
                          value={editPhone}
                          onChange={e => setEditPhone(e.target.value)}
                          placeholder="+1 (555) 123-4567"
                        />
                        <span className="form-hint">Used for task assignment notifications</span>
                      </div>
                      <div className="form-group">
                        <label>Current Password *</label>
                        <div className="password-input-wrap">
                          <input
                            type={showCurrentPw ? "text" : "password"}
                            value={editCurrentPassword}
                            onChange={e => setEditCurrentPassword(e.target.value)}
                            placeholder="Required to save changes"
                          />
                          <button type="button" className="password-toggle" onClick={() => setShowCurrentPw(v => !v)} tabIndex={-1}>
                            {showCurrentPw ? (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="form-group">
                        <label>New Password</label>
                        <div className="password-input-wrap">
                          <input
                            type={showNewPw ? "text" : "password"}
                            value={editPassword}
                            onChange={e => setEditPassword(e.target.value)}
                            placeholder="Leave blank to keep current"
                          />
                          <button type="button" className="password-toggle" onClick={() => setShowNewPw(v => !v)} tabIndex={-1}>
                            {showNewPw ? (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="form-group">
                        <label>Confirm Password</label>
                        <div className="password-input-wrap">
                          <input
                            type={showConfirmPw ? "text" : "password"}
                            value={editConfirmPassword}
                            onChange={e => setEditConfirmPassword(e.target.value)}
                            placeholder="Confirm new password"
                          />
                          <button type="button" className="password-toggle" onClick={() => setShowConfirmPw(v => !v)} tabIndex={-1}>
                            {showConfirmPw ? (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            )}
                          </button>
                        </div>
                      </div>
                      {editError && <p className="edit-user-error">{editError}</p>}
                      {editSuccess && <p className="edit-user-success">Updated successfully!</p>}
                    </div>
                    <div className="invite-modal-footer">
                      <button className="btn" onClick={() => setEditingUser(null)}>Cancel</button>
                      <button className="btn btn-primary" onClick={handleEditSave} disabled={editSaving}>
                        {editSaving ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Pending invites the current user has been offered.
                  Shown on the Users panel above the workspace's own
                  user list so accepting/declining is one click away. */}
              {pendingInvites.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#0f172a" }}>
                    Pending invites for you
                  </h3>
                  {pendingInvites.map(inv => (
                    <div
                      key={inv.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 14px",
                        border: "1px solid #e2e8f0",
                        borderRadius: 10,
                        background: "#f8fafc",
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ fontSize: 14, color: "#1e293b" }}>
                        <strong>
                          {inv.invited_by_display_name || "A host"}
                        </strong>{" "}
                        invited you to <strong>{inv.workspace_name}</strong>{" "}
                        <span style={{ color: "#64748b" }}>
                          as a {inv.role}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleDeclineInvite(inv.id)}
                        >
                          Decline
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleAcceptInvite(inv.id)}
                        >
                          Accept
                        </button>
                      </div>
                    </div>
                  ))}
                  {inviteError && (
                    <p style={{ color: "#dc2626", fontSize: 13, margin: "4px 0 0" }}>
                      {inviteError}
                    </p>
                  )}
                </div>
              )}

              {/* Users table */}
              <div className="account-users-table">
                <div className="account-users-header">
                  <span className="au-col-user">User</span>
                  <span className="au-col-role">Permission</span>
                  <span className="au-col-status">Status</span>
                  <span className="au-col-actions"></span>
                </div>
                {usersLoading && (
                  <div style={{ padding: "12px 14px", color: "#64748b", fontSize: 14 }}>
                    Loading members…
                  </div>
                )}
                {!usersLoading && users.length === 0 && (
                  <div style={{ padding: "12px 14px", color: "#64748b", fontSize: 14 }}>
                    No members yet.
                  </div>
                )}
                {users.map(user => (
                  <div key={user.id} className="account-user-row">
                    <div className="au-col-user">
                      <div className="account-user-avatar">{user.initials}</div>
                      <div>
                        <button className="account-user-name account-user-name-btn" onClick={() => openEditUser(user)}>{user.name}</button>
                        <div className="account-user-email">{user.email}</div>
                      </div>
                    </div>
                    <div className="au-col-role">
                      <select
                        className="role-select"
                        value={user.role}
                        onChange={e => handleRoleChange(user.id, e.target.value as Role)}
                      >
                        {ROLES.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div className="au-col-status">
                      <span className={`status-badge ${user.status}`}>
                        {user.status === "active" ? "Active" : "Pending"}
                      </span>
                    </div>
                    <div className="au-col-actions">
                      {user.id !== "1" && (
                        <button className="remove-user-btn" onClick={() => handleRemoveUser(user.id)}>Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {active === "profile" && (
            <div className="account-section">
              <h2>Host</h2>
              <ProfileEditorSection />
              {/* SalonsManagerSection intentionally hidden for the
                  launch window. Component still lives below — re-enable
                  by uncommenting this line when the social / discovery
                  layer is turned back on. */}
              {/* <SalonsManagerSection /> */}
            </div>
          )}

          {active === "billing" && (
            <div className="account-section">
              <h2>Billing</h2>
              <div className="account-billing-card">
                <div className="account-billing-plan">
                  <span className="account-plan-name">Free Plan</span>
                </div>
                <p className="account-billing-desc">
                  All features included. Print orders are billed per
                  order at checkout — no subscription, no saved payment
                  method needed.
                </p>
                {/* "Change Plan" button intentionally hidden — paid
                    tiers don't exist yet. Re-enable when subscription
                    tiers ship in Phase II. */}
              </div>
              {/* Payment Method card hidden — PlaceCard doesn't store a
                  default payment method on file because there's no
                  subscription billing yet. Stripe holds the card
                  details transiently during each print-order checkout
                  via PaymentIntents. When subscriptions land, this
                  card comes back wired to a real source of truth (the
                  customer's Stripe payment methods list). */}
            </div>
          )}

          {active === "orders" && (
            <div className="account-section">
              <h2>Orders</h2>
              <PrintOrdersSection />
            </div>
          )}

          {active === "settings" && (
            <div className="account-section">
              <h2>Settings</h2>

              {/* Event Notifications */}
              <div className="settings-card">
                <h3>Event Notifications</h3>
                <p className="settings-desc">Automatically send reminders to attendees before scheduled events.</p>

                <label className="settings-toggle-row">
                  <input
                    type="checkbox"
                    checked={notifSettings.event_reminders}
                    onChange={e => setNotifSettings(s => ({ ...s, event_reminders: e.target.checked }))}
                  />
                  <span>Send event reminders to attendees</span>
                </label>

                {notifSettings.event_reminders && (
                  <div className="settings-sub-options">
                    <div className="settings-field">
                      <label>Reminder timing</label>
                      <select
                        value={notifSettings.reminder_minutes}
                        onChange={e => setNotifSettings(s => ({ ...s, reminder_minutes: Number(e.target.value) }))}
                      >
                        <option value={30}>30 minutes before</option>
                        <option value={60}>1 hour before</option>
                        <option value={120}>2 hours before</option>
                        <option value={1440}>1 day before</option>
                      </select>
                    </div>

                    <div className="settings-field">
                      <label>Notification channel</label>
                      {/* SMS + WhatsApp channels are Phase II — the
                          send paths aren't live yet (see Twilio gate in
                          launch checklist). For launch we show email
                          only. The notif_settings columns sms_enabled /
                          whatsapp_enabled stay on the backend so when
                          Phase II ships, the schema doesn't migrate;
                          we just un-hide the other channel cards. */}
                      <div className="settings-channel-options">
                        <div className="settings-channel-card" style={{ borderColor: "#1b4fff", background: "#f1f5ff" }}>
                          <div className="settings-channel-info">
                            <span className="settings-channel-icon">✉️</span>
                            <span className="settings-channel-name">Email</span>
                          </div>
                          <span className="settings-channel-desc">Email reminder to attendee email addresses</span>
                        </div>
                      </div>
                    </div>

                    <label className="settings-toggle-row">
                      <input
                        type="checkbox"
                        checked={notifSettings.include_google_maps_link}
                        onChange={e => setNotifSettings(s => ({ ...s, include_google_maps_link: e.target.checked }))}
                      />
                      <span>Include Google Maps link in notification</span>
                    </label>
                  </div>
                )}

                <div className="settings-actions">
                  <button className="btn btn-primary btn-sm" onClick={saveNotifSettings} disabled={notifSaving}>
                    {notifSaving ? "Saving..." : notifSaved ? "Saved!" : "Save Settings"}
                  </button>
                </div>
              </div>

              {/* Organizer Notifications */}
              <div className="settings-card" style={{ marginTop: 16 }}>
                <h3>Organizer Notifications</h3>
                <p className="settings-desc">Send reminders to team members who have been assigned tasks before events start.</p>

                <label className="settings-toggle-row">
                  <input
                    type="checkbox"
                    checked={notifSettings.organizer_reminders}
                    onChange={e => setNotifSettings(s => ({ ...s, organizer_reminders: e.target.checked }))}
                  />
                  <span>Send task reminders to assigned team members</span>
                </label>

                {notifSettings.organizer_reminders && (
                  <div className="settings-sub-options">
                    <div className="settings-field">
                      <label>Reminder timing</label>
                      <select
                        value={notifSettings.organizer_reminder_minutes}
                        onChange={e => setNotifSettings(s => ({ ...s, organizer_reminder_minutes: Number(e.target.value) }))}
                      >
                        <option value={15}>15 minutes before</option>
                        <option value={30}>30 minutes before</option>
                        <option value={60}>1 hour before</option>
                        <option value={120}>2 hours before</option>
                      </select>
                    </div>

                    <div className="settings-field">
                      <label>Notification channel</label>
                      {/* WhatsApp organizer pings are Phase II (same
                          reason as the attendee channels above). Email
                          is the only live channel for launch. */}
                      <div className="settings-channel-options">
                        <div className="settings-channel-card" style={{ borderColor: "#1b4fff", background: "#f1f5ff" }}>
                          <div className="settings-channel-info">
                            <span className="settings-channel-icon">✉️</span>
                            <span className="settings-channel-name">Email</span>
                          </div>
                          <span className="settings-channel-desc">Email message to team member's address</span>
                        </div>
                      </div>
                    </div>

                    <p className="settings-info" style={{ marginTop: 8 }}>
                      Team members need an email address in their profile to receive notifications. Message includes task name, event details, and assignment notes.
                    </p>
                  </div>
                )}
              </div>

              {/* Message Usage block intentionally hidden for the
                  launch window. SMS + WhatsApp send paths aren't live
                  (Phase II) so showing a 0/500 usage meter only
                  confuses. The MessageUsage interface + state are
                  also left in place below — they don't hydrate
                  anymore since the API call is disabled, and they
                  carry zero runtime cost while idle. Re-enable when
                  Twilio is wired and per-plan caps actually exist. */}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Print Orders section ──────────────────────────────────────────────
//
// Status flips happen server-side: pending → paid (Stripe webhook),
// paid → fulfilled (operator marks tracking via the printing router
// — automated when the print-vendor API integration lands).

interface PrintOrderRow {
  id: number;
  status: string;
  total_amount_cents: number;
  currency: string;
  content_type: string;
  quantity: number;
  quantity_tier: number;
  event_id: number;
  event_name: string | null;
  shipping_name: string;
  shipping_city: string;
  shipping_country: string;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_url: string | null;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
}

function formatOrderMoney(cents: number, currency: string): string {
  const symbol = currency.toUpperCase() === "GBP" ? "£" : "$";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

function orderStatusLabel(status: string): { label: string; color: string } {
  switch (status) {
    case "pending":   return { label: "Pending payment", color: "#f59e0b" };
    case "paid":      return { label: "Paid · awaiting fulfilment", color: "#1b4fff" };
    case "fulfilled": return { label: "Shipped", color: "#16a34a" };
    case "failed":    return { label: "Payment failed", color: "#dc2626" };
    default:          return { label: status, color: "#64748b" };
  }
}

function trackingHref(order: PrintOrderRow): string | null {
  if (!order.tracking_number) return null;
  if (order.tracking_url) return order.tracking_url;
  // Fallback when the operator entered the number + carrier but not
  // the deep-link URL: build a generic search.
  const q = encodeURIComponent(
    `${order.tracking_carrier ?? ""} tracking ${order.tracking_number}`.trim()
  );
  return `https://www.google.com/search?q=${q}`;
}

function PrintOrdersSection() {
  const [orders, setOrders] = useState<PrintOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  useEffect(() => {
    api.listPrintOrders()
      .then(setOrders)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="account-billing-card">
        <p className="account-billing-desc">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="account-billing-card">
        <p style={{ color: "#dc2626", fontSize: 14, margin: 0 }}>Could not load orders: {error}</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="account-billing-card">
        <p className="account-billing-desc">You haven't placed any print orders yet. Once you do, they'll show up here with their status and tracking info.</p>
      </div>
    );
  }

  return (
    <div className="account-billing-card">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
              <th style={{ padding: "8px 6px", fontWeight: 600, color: "#64748b", fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>Order</th>
              <th style={{ padding: "8px 6px", fontWeight: 600, color: "#64748b", fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>Event</th>
              <th style={{ padding: "8px 6px", fontWeight: 600, color: "#64748b", fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>Date</th>
              <th style={{ padding: "8px 6px", fontWeight: 600, color: "#64748b", fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>Total</th>
              <th style={{ padding: "8px 6px", fontWeight: 600, color: "#64748b", fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>Status</th>
              <th style={{ padding: "8px 6px", fontWeight: 600, color: "#64748b", fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>Tracking</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => {
              const status = orderStatusLabel(o.status);
              const trackHref = trackingHref(o);
              return (
                <tr
                  key={o.id}
                  onClick={() => setSelectedOrderId(o.id)}
                  style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                  className="orders-row-clickable"
                >
                  <td style={{ padding: "10px 6px" }}>#{o.id}</td>
                  <td style={{ padding: "10px 6px", color: "#475569" }}>{o.event_name ?? "—"}</td>
                  <td style={{ padding: "10px 6px", color: "#475569" }}>{new Date(o.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: "10px 6px" }}>{formatOrderMoney(o.total_amount_cents, o.currency)}</td>
                  <td style={{ padding: "10px 6px" }}>
                    <span style={{ color: status.color, fontWeight: 500 }}>{status.label}</span>
                  </td>
                  <td style={{ padding: "10px 6px" }} onClick={e => e.stopPropagation()}>
                    {trackHref ? (
                      <a href={trackHref} target="_blank" rel="noopener noreferrer" style={{ color: "#1b4fff" }}>
                        {o.tracking_carrier ?? "Track"} {o.tracking_number}
                      </a>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedOrderId !== null && (
        <OrderDetailModal orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
      )}
    </div>
  );
}


// ── Order detail modal ────────────────────────────────────────────────

type PrintOrderDetail = Awaited<ReturnType<typeof api.getPrintOrder>>;

function OrderDetailModal({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const [order, setOrder] = useState<PrintOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getPrintOrder(orderId)
      .then(o => { if (!cancelled) setOrder(o); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [orderId]);

  // Close on Escape — modal pattern used elsewhere in this file.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const status = order ? orderStatusLabel(order.status) : null;
  const trackHref = order ? trackingHref({
    tracking_number: order.tracking_number,
    tracking_carrier: order.tracking_carrier,
    tracking_url: order.tracking_url,
  } as PrintOrderRow) : null;

  return (
    <>
      <div className="invite-overlay" onClick={onClose} />
      <div className="invite-modal" style={{ maxWidth: 720, width: "94vw" }}>
        <div className="invite-modal-header">
          <h3>{order ? `Order #${order.id}` : "Order"}</h3>
          <button className="invite-close" onClick={onClose}>✕</button>
        </div>
        <div className="invite-modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {!order && !error && <p className="account-billing-desc">Loading order…</p>}
          {error && <p style={{ color: "#dc2626", fontSize: 14 }}>Could not load order: {error}</p>}
          {order && status && (
            <>
              {/* Status row */}
              <div style={{ marginBottom: 16 }}>
                <span style={{ color: status.color, fontWeight: 600 }}>{status.label}</span>
                <span style={{ color: "#64748b", marginLeft: 12, fontSize: 13 }}>
                  Placed {new Date(order.created_at).toLocaleString()}
                </span>
                {order.paid_at && (
                  <div style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>
                    Paid {new Date(order.paid_at).toLocaleString()}
                  </div>
                )}
                {order.fulfilled_at && (
                  <div style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>
                    Shipped {new Date(order.fulfilled_at).toLocaleString()}
                  </div>
                )}
                {trackHref && (
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    Tracking:{" "}
                    <a href={trackHref} target="_blank" rel="noopener noreferrer" style={{ color: "#1b4fff" }}>
                      {order.tracking_carrier ?? "Track"} {order.tracking_number}
                    </a>
                  </div>
                )}
              </div>

              {/* Two-column: design preview + summary */}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr)", gap: 20, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
                    Design
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, background: "#f8fafc" }}>
                    <img
                      src={`data:${order.design_mime_type};base64,${order.design_image_b64}`}
                      alt="Card design"
                      style={{ width: "100%", height: "auto", borderRadius: 4, display: "block" }}
                    />
                  </div>
                  {order.event_name && (
                    <div style={{ marginTop: 8, fontSize: 13, color: "#475569" }}>
                      <strong>Event:</strong> {order.event_name}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
                    Specs
                  </div>
                  <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
                    <tbody>
                      <SpecRow label="Type" value={order.content_type.replace(/-/g, " ")} />
                      <SpecRow label="Quantity" value={`${order.quantity_tier} cards (${order.attendees_count} attendees)`} />
                      <SpecRow label="Paper" value={order.paper_stock} />
                      <SpecRow label="Finish" value={order.finish} />
                      <SpecRow label="Colour" value={order.color_spec === "4/4" ? "Full colour, both sides" : order.color_spec} />
                      <SpecRow label="Turnaround" value={`${order.turnaround_days} day${order.turnaround_days === 1 ? "" : "s"}`} />
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Price breakdown */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
                  Price breakdown
                </div>
                <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
                  <tbody>
                    {/* Used to read "Cards (×25)" using order.quantity_tier
                        — dropped because it confused customers ordering
                        fewer cards than the tier (e.g. 2 cards priced at
                        the 25-card tier read as 25 being bought). */}
                    <PriceRow label="Cards" cents={order.base_amount_cents} currency={order.currency} />
                    {order.rush && (
                      <PriceRow label="Rush turnaround" cents={order.rush_amount_cents} currency={order.currency} />
                    )}
                    {order.remove_branding && (
                      <PriceRow label="Remove PlaceCard branding" cents={order.remove_branding_amount_cents} currency={order.currency} />
                    )}
                    <PriceRow label="Shipping" cents={order.shipping_amount_cents} currency={order.currency} />
                    <tr style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "10px 6px", fontWeight: 600 }}>Total</td>
                      <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 600 }}>
                        {formatOrderMoney(order.total_amount_cents, order.currency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Shipping address */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
                  Shipping to
                </div>
                <div style={{ fontSize: 14, color: "#1e293b", lineHeight: 1.5 }}>
                  <div>{order.shipping_name}</div>
                  {order.shipping_company && <div>{order.shipping_company}</div>}
                  <div>{order.shipping_address1}</div>
                  {order.shipping_address2 && <div>{order.shipping_address2}</div>}
                  <div>
                    {order.shipping_city}
                    {order.shipping_state ? `, ${order.shipping_state}` : ""}
                    {" "}{order.shipping_zip}
                  </div>
                  <div>{order.shipping_country}</div>
                  {order.shipping_email && (
                    <div style={{ color: "#64748b", marginTop: 4 }}>{order.shipping_email}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: "4px 0", color: "#64748b", width: "40%" }}>{label}</td>
      <td style={{ padding: "4px 0", color: "#1e293b", textTransform: "capitalize" }}>{value}</td>
    </tr>
  );
}

function PriceRow({ label, cents, currency }: { label: string; cents: number; currency: string }) {
  return (
    <tr>
      <td style={{ padding: "6px 6px", color: "#475569" }}>{label}</td>
      <td style={{ padding: "6px 6px", textAlign: "right", color: "#1e293b" }}>
        {formatOrderMoney(cents, currency)}
      </td>
    </tr>
  );
}


// ── Salons manager — REMOVED for launch ─────────────────────────────
//
// SalonsManagerSection + SalonCard + SalonEditorDrawer used to live
// here. Removed in the build-cleanup commit because tsconfig.app.json
// enforces `noUnusedLocals` and the trio became dead code when the
// Host tab stopped calling them (commit 7064138 hid the social
// layer for launch). Backend salon routes / models / migrations are
// untouched — restoring this UI is `git show 7064138^:frontend/src/pages/AccountPage.tsx`
// and pasting back the three functions + their import.


// ── Profile editor ────────────────────────────────────────────────────
//
// Lets the host edit their public profile: display name, @handle, photo,
// bio, city, and visibility. Handle changes are validated live against
// /api/profiles/handle/available so the user gets feedback before save.
// Photo upload runs through the same compression pipeline as event hero
// images, then POSTs the base64 to /api/profiles/me/photo for Supabase
// Storage upload.

function ProfileEditorSection() {
  const { user: authUser, refreshMyProfile } = useAuth();
  const [profile, setProfile] = useState<ProfileShape | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Local form state (kept separate from `profile` so unsaved edits
  // don't clobber the server snapshot until save succeeds).
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");

  const [handleStatus, setHandleStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [handleReason, setHandleReason] = useState<string | null>(null);
  const handleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Initial load — also provisions the profile server-side on first call.
  // displayNameHint comes from Supabase user_metadata so the auto-handle
  // isn't derived from the email local-part when a real name is available.
  useEffect(() => {
    const hint = authUser?.user_metadata?.full_name as string | undefined;
    api.getMyProfile(hint)
      .then(p => {
        setProfile(p);
        setDisplayName(p.display_name);
        setHandle(p.handle);
        setBio(p.bio ?? "");
        setCity(p.city ?? "");
        setVisibility(p.visibility);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [authUser]);

  // Live handle-availability check. Debounced so we don't pummel the
  // backend on every keystroke.
  useEffect(() => {
    if (handleTimer.current) clearTimeout(handleTimer.current);
    if (!profile) return;
    if (handle === profile.handle) {
      setHandleStatus("idle");
      setHandleReason(null);
      return;
    }
    if (handle.length < 3) {
      setHandleStatus("idle");
      setHandleReason(null);
      return;
    }
    setHandleStatus("checking");
    handleTimer.current = setTimeout(async () => {
      try {
        const r = await api.checkHandleAvailable(handle);
        if (r.available) {
          setHandleStatus("available");
          setHandleReason(null);
        } else {
          setHandleStatus("taken");
          setHandleReason(r.reason);
        }
      } catch {
        setHandleStatus("idle");
      }
    }, 300);
    return () => {
      if (handleTimer.current) clearTimeout(handleTimer.current);
    };
  }, [handle, profile]);

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setSaveError(null);
    try {
      // 400×400 is plenty for a circular avatar; compressing keeps the
      // upload + display fast and stays under the backend's 5 MB cap.
      const dataUrl = await fileToCompressedDataUrl(file, 400, 400, 0.85);
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("Could not read image data.");
      const [, mime, b64] = match;
      const res = await api.uploadProfilePhoto(b64, mime);
      setProfile(p => (p ? { ...p, photo_url: res.photo_url } : p));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Photo upload failed.");
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!profile) return;
    if (handleStatus === "taken") {
      setSaveError(handleReason ?? "Pick a different handle.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api.updateMyProfile({
        display_name: displayName,
        handle: handle === profile.handle ? undefined : handle,
        bio: bio || null,
        city: city || null,
        visibility,
      });
      setProfile(updated);
      setHandle(updated.handle);
      setHandleStatus("idle");
      setSaved(true);
      // Push the change up to AuthContext so the header dropdown +
      // "Hosted by" attributions across the app refresh immediately.
      void refreshMyProfile();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="account-billing-card">
        <p style={{ color: "#dc2626", fontSize: 14 }}>Could not load profile: {loadError}</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="account-billing-card">
        <p className="account-billing-desc">Loading…</p>
      </div>
    );
  }

  const initials = displayName
    .split(" ")
    .map(p => p[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="account-billing-card" style={{ maxWidth: 640 }}>
      {/* Photo + name row */}
      <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 24 }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #e91e8f, #1b4fff)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            flexShrink: 0,
            fontSize: 28,
            fontWeight: 600,
          }}
        >
          {profile.photo_url ? (
            <img
              src={profile.photo_url}
              alt={profile.display_name}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span>{initials}</span>
          )}
        </div>
        <div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handlePhotoSelected}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => photoInputRef.current?.click()}
            disabled={photoBusy}
          >
            {photoBusy ? "Uploading…" : profile.photo_url ? "Replace photo" : "Upload photo"}
          </button>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 6, marginBottom: 0 }}>
            JPEG, PNG, or WebP. Resized to 400×400 before upload.
          </p>
        </div>
      </div>

      {/* Display name */}
      <div className="form-group">
        <label>Display name</label>
        <input
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="How your name shows on your profile"
          maxLength={120}
        />
      </div>

      {/* Handle + "Your profile: placecard-events.app/@..." link both
          intentionally hidden for the launch window. The public
          profile page they pointed at is also hidden in App.tsx (see
          RootDispatcher) — exposing the handle UI here without a live
          public page to land on would be misleading. The `handle`
          state is still wired up so existing values save fine when
          the form is submitted; we just don't surface it to the user.
          Re-enable by un-commenting this block when the social layer
          is turned back on. */}

      {/* City */}
      <div className="form-group">
        <label>City</label>
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="London, New York…"
          maxLength={120}
        />
        <span className="form-hint">Optional. Shown on your profile under your name.</span>
      </div>

      {/* Bio */}
      <div className="form-group">
        <label>Short bio</label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value.slice(0, 280))}
          placeholder="A line or two about you and what you host."
          rows={3}
          maxLength={280}
        />
        <span className="form-hint">{bio.length} / 280</span>
      </div>

      {/* Profile-visibility dropdown + "View public profile →" link
          both hidden alongside the public profile page itself (commit
          7064138). The `visibility` state below still defaults to
          "public" and gets sent on save so existing rows aren't
          downgraded; we just don't surface the choice. */}

      {saveError && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{saveError}</p>}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving || handleStatus === "taken"}
        >
          {saving ? "Saving…" : saved ? "Saved!" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
