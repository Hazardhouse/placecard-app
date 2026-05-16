import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { api } from "../api/client";

type Section = "users" | "billing" | "settings";
type Role = "Admin" | "Editor" | "Viewer";

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

interface MessageUsage {
  sms_used: number;
  sms_limit: number;
  whatsapp_used: number;
  whatsapp_limit: number;
  plan: string;
}

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
  const currentName = authUser?.user_metadata?.full_name || authUser?.email?.split("@")[0] || "User";
  const currentEmail = authUser?.email || "";
  const currentInitials = currentName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const active: Section = section === "billing" ? "billing" : section === "settings" ? "settings" : "users";

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

  const [users, setUsers] = useState<User[]>([
    { id: "1", initials: currentInitials, name: currentName, email: currentEmail, phone: "", role: "Admin", status: "active" },
  ]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("Viewer");

  const [, setInviteError] = useState<string | null>(null);

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
  const [msgUsage, setMsgUsage] = useState<MessageUsage>({
    sms_used: 0, sms_limit: 500, whatsapp_used: 0, whatsapp_limit: 500, plan: "Pro",
  });
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);

  const loadNotifSettings = useCallback(async () => {
    try {
      const [settings, usage] = await Promise.all([
        api.getNotificationSettings(),
        api.getMessageUsage(),
      ]);
      setNotifSettings(prev => ({ ...prev, ...settings }));
      setMsgUsage(usage);
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
      await fetch("http://localhost:8000/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
    } catch {
      // Backend invite is optional — still add to UI
    }
    const initials = inviteEmail.slice(0, 2).toUpperCase();
    setUsers(prev => [...prev, {
      id: String(Date.now()),
      initials,
      name: inviteEmail.split("@")[0],
      email: inviteEmail.trim(),
      phone: invitePhone.trim(),
      role: inviteRole,
      status: "pending",
    }]);
    setInviteEmail("");
    setInvitePhone("");
    setInviteRole("Viewer");
    setShowInvite(false);
  };

  const handleRoleChange = (userId: string, role: Role) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
  };

  const handleRemoveUser = (userId: string) => {
    setUsers(prev => prev.filter(u => u.id !== userId));
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
            className={`account-nav-item ${active === "billing" ? "active" : ""}`}
            onClick={() => goToSection("/account/billing")}
          >
            Billing
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

              {/* Users table */}
              <div className="account-users-table">
                <div className="account-users-header">
                  <span className="au-col-user">User</span>
                  <span className="au-col-role">Permission</span>
                  <span className="au-col-status">Status</span>
                  <span className="au-col-actions"></span>
                </div>
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

          {active === "billing" && (
            <div className="account-section">
              <h2>Billing</h2>
              <div className="account-billing-card">
                <div className="account-billing-plan">
                  <span className="account-plan-name">Pro Plan</span>
                  <span className="account-plan-price">$29/mo</span>
                </div>
                <p className="account-billing-desc">Unlimited events, attendees, and seating charts. 500 SMS + 500 WhatsApp messages/mo.</p>
                <button className="btn btn-sm">Change Plan</button>
              </div>
              <div className="account-billing-card" style={{ marginTop: 16 }}>
                <h3>Payment Method</h3>
                <p className="account-billing-desc">Visa ending in 4242</p>
                <button className="btn btn-sm">Update</button>
              </div>
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
                      <label>Notification channels</label>
                      <div className="settings-channel-options">
                        <label className="settings-channel-card">
                          <input
                            type="checkbox"
                            checked={notifSettings.sms_enabled}
                            onChange={e => setNotifSettings(s => ({ ...s, sms_enabled: e.target.checked }))}
                          />
                          <div className="settings-channel-info">
                            <span className="settings-channel-icon">💬</span>
                            <span className="settings-channel-name">SMS</span>
                          </div>
                          <span className="settings-channel-desc">Text message to attendee phone numbers</span>
                        </label>
                        <label className="settings-channel-card">
                          <input
                            type="checkbox"
                            checked={notifSettings.whatsapp_enabled}
                            onChange={e => setNotifSettings(s => ({ ...s, whatsapp_enabled: e.target.checked }))}
                          />
                          <div className="settings-channel-info">
                            <span className="settings-channel-icon">📱</span>
                            <span className="settings-channel-name">WhatsApp</span>
                          </div>
                          <span className="settings-channel-desc">WhatsApp message to attendee phone numbers</span>
                        </label>
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
                      <div className="settings-channel-options">
                        <label className="settings-channel-card">
                          <input
                            type="checkbox"
                            checked={notifSettings.organizer_whatsapp_enabled}
                            onChange={e => setNotifSettings(s => ({ ...s, organizer_whatsapp_enabled: e.target.checked }))}
                          />
                          <div className="settings-channel-info">
                            <span className="settings-channel-icon">📱</span>
                            <span className="settings-channel-name">WhatsApp</span>
                          </div>
                          <span className="settings-channel-desc">WhatsApp message to team member's number</span>
                        </label>
                      </div>
                    </div>

                    <p className="settings-info" style={{ marginTop: 8 }}>
                      Team members need a WhatsApp number in their profile to receive notifications. Message includes task name, event details, and assignment notes.
                    </p>
                  </div>
                )}
              </div>

              {/* Message Usage */}
              <div className="settings-card" style={{ marginTop: 16 }}>
                <h3>Message Usage</h3>
                <p className="settings-desc">
                  Your <strong>{msgUsage.plan}</strong> plan includes {msgUsage.sms_limit.toLocaleString()} SMS and {msgUsage.whatsapp_limit.toLocaleString()} WhatsApp messages per month.
                </p>

                <div className="settings-usage-meters">
                  <div className="settings-usage-item">
                    <div className="settings-usage-header">
                      <span>💬 SMS</span>
                      <span className="settings-usage-count">{msgUsage.sms_used.toLocaleString()} / {msgUsage.sms_limit.toLocaleString()}</span>
                    </div>
                    <div className="settings-usage-bar">
                      <div
                        className={`settings-usage-fill ${msgUsage.sms_used / msgUsage.sms_limit > 0.9 ? "warning" : ""}`}
                        style={{ width: `${Math.min(100, (msgUsage.sms_used / msgUsage.sms_limit) * 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="settings-usage-item">
                    <div className="settings-usage-header">
                      <span>📱 WhatsApp</span>
                      <span className="settings-usage-count">{msgUsage.whatsapp_used.toLocaleString()} / {msgUsage.whatsapp_limit.toLocaleString()}</span>
                    </div>
                    <div className="settings-usage-bar">
                      <div
                        className={`settings-usage-fill ${msgUsage.whatsapp_used / msgUsage.whatsapp_limit > 0.9 ? "warning" : ""}`}
                        style={{ width: `${Math.min(100, (msgUsage.whatsapp_used / msgUsage.whatsapp_limit) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <p className="settings-info">
                  Usage resets on the 1st of each month. Need more messages?{" "}
                  <a href="#" onClick={e => { e.preventDefault(); goToSection("/account/billing"); }}>Upgrade your plan</a>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Print Orders section ──────────────────────────────────────────────
//
// Lives inside the Billing tab. Lists the current user's print orders
// newest-first, with cost, status, and a tracking link when available.
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

  useEffect(() => {
    api.listPrintOrders()
      .then(setOrders)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="account-billing-card" style={{ marginTop: 16 }}>
        <h3>Orders</h3>
        <p className="account-billing-desc">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="account-billing-card" style={{ marginTop: 16 }}>
        <h3>Orders</h3>
        <p style={{ color: "#dc2626", fontSize: 14, margin: 0 }}>Could not load orders: {error}</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="account-billing-card" style={{ marginTop: 16 }}>
        <h3>Orders</h3>
        <p className="account-billing-desc">You haven't placed any print orders yet. Once you do, they'll show up here with their status and tracking info.</p>
      </div>
    );
  }

  return (
    <div className="account-billing-card" style={{ marginTop: 16 }}>
      <h3>Orders</h3>
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
                <tr key={o.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 6px" }}>#{o.id}</td>
                  <td style={{ padding: "10px 6px", color: "#475569" }}>{o.event_name ?? "—"}</td>
                  <td style={{ padding: "10px 6px", color: "#475569" }}>{new Date(o.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: "10px 6px" }}>{formatOrderMoney(o.total_amount_cents, o.currency)}</td>
                  <td style={{ padding: "10px 6px" }}>
                    <span style={{ color: status.color, fontWeight: 500 }}>{status.label}</span>
                  </td>
                  <td style={{ padding: "10px 6px" }}>
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
    </div>
  );
}
