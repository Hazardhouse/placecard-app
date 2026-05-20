import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import EventList from "./pages/EventList";
import EventDetail from "./pages/EventDetail";
import AttendeeDetail from "./pages/AttendeeDetail";
import AccountPage from "./pages/AccountPage";
import LoginPage from "./pages/LoginPage";
import PublicForm from "./pages/PublicForm";
import RestaurantView from "./pages/RestaurantView";
import PublicEvent from "./pages/PublicEvent";
// ProfilePage + SalonPage imports intentionally removed — both routes
// are hidden behind a / redirect for the launch window. Components
// still live at pages/ProfilePage.tsx and pages/SalonPage.tsx for
// when the social layer is re-enabled.
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { PendingInvitesProvider, usePendingInvites } from "./contexts/PendingInvitesContext";
import { WorkspaceMembersProvider, useWorkspaceMembers } from "./contexts/WorkspaceMembersContext";
import type { WorkspaceMember } from "./api/client";
import logoSvg from "./assets/placecard-logo.svg";
import "./App.css";

/**
 * Two-character initials for a member, with fallbacks across the
 * shape's nullable fields. Mirrors the logic AccountPage uses for the
 * Users-panel avatars so the same person reads the same in both places.
 */
function memberInitials(m: WorkspaceMember): string {
  const source = m.display_name || m.email || "?";
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .map(part => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Friendly tooltip label for an avatar: "Dani Bradford (Owner)" or
 * "support@lonerucksack.com (Editor)" when no display name exists.
 */
function memberTooltip(m: WorkspaceMember): string {
  const name = m.display_name || m.email || "Member";
  const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
  return `${name} (${role})`;
}

/**
 * Cluster of initials circles rendered to the left of "Hi, {name}" in
 * the app header. Hidden for solo workspaces (one active member = no
 * collaboration UI needed). Caps the visible stack and folds the
 * remainder into a "+N" pill, capped so the header doesn't blow out.
 */
function MemberAvatars() {
  const { user } = useAuth();
  const { members } = useWorkspaceMembers();
  // Pending / declined / removed rows are bookkeeping — only active
  // collaborators belong in the presence cluster.
  const active = members.filter(m => m.status === "active");
  if (active.length <= 1) return null;
  // Show the caller first so "DB" anchors the cluster from the left.
  const sorted = [...active].sort((a, b) => {
    if (a.user_id === user?.id) return -1;
    if (b.user_id === user?.id) return 1;
    return 0;
  });
  const MAX_VISIBLE = 4;
  const visible = sorted.slice(0, MAX_VISIBLE);
  const overflow = sorted.length - MAX_VISIBLE;
  return (
    <div className="header-avatars" aria-label="Workspace members">
      {visible.map(m => (
        <span key={m.id} className="header-avatar" title={memberTooltip(m)}>
          {memberInitials(m)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="header-avatar header-avatar-overflow" title={`${overflow} more`}>
          +{overflow}
        </span>
      )}
    </div>
  );
}

function UserDropdown() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  // Pending workspace invites for the current user. Surfaced as a small
  // count badge on the trigger so invitees who navigate away from the
  // post-login Account landing still have a clear signpost back to the
  // accept UI. count===0 hides the badge entirely.
  const { count: pendingInvitesCount } = usePendingInvites();

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";

  // Stash where the user came from so the Account page's back arrow can
  // return there, jumping past any submenu navigation that happens inside
  // Account itself.
  const goToAccount = (path: string) => {
    setOpen(false);
    const from = location.pathname.startsWith("/account") ? "/" : location.pathname;
    navigate(path, { state: { from } });
  };

  return (
    <div className="user-dropdown-wrap">
      <button className="user-dropdown-trigger" onClick={() => setOpen(!open)}>
        Hi, {displayName}
        {pendingInvitesCount > 0 && (
          <span
            className="user-dropdown-badge"
            aria-label={`${pendingInvitesCount} pending workspace invite${pendingInvitesCount === 1 ? "" : "s"}`}
            title={`${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? "" : "s"} — open Account to accept`}
          >
            {pendingInvitesCount}
          </span>
        )}
        <span className={`user-dropdown-caret ${open ? "open" : ""}`} />
      </button>
      {open && (
        <>
          <div className="user-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="user-dropdown-menu">
            <button className="user-dropdown-item" onClick={() => goToAccount("/account")}>
              Account
              {pendingInvitesCount > 0 && (
                <span className="user-dropdown-item-badge">{pendingInvitesCount}</span>
              )}
            </button>
            <button
              className="user-dropdown-item user-dropdown-logout"
              onClick={async () => {
                setOpen(false);
                await signOut();
                // Reset the URL so the post-logout LoginPage doesn't
                // inherit /events/123 (looks broken) or /signup (would
                // default to Create-account form when we want Sign-in).
                navigate("/", { replace: true });
              }}
            >
              Logout
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProtectedLayout() {
  const { user, loading } = useAuth();

  // Tag <body> on every authenticated page so the gradient background turns on
  useEffect(() => {
    document.body.classList.add("on-app-page");
    return () => { document.body.classList.remove("on-app-page"); };
  }, []);

  if (loading) {
    return (
      <div className="app">
        <div className="page loading" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="logo"><img src={logoSvg} alt="PlaceCard" className="logo-img" /></Link>
        <div className="header-right">
          {/* Cluster of initials circles for every active member of the
              caller's workspace. Auto-hides for solo accounts. Stays in
              sync with AccountPage mutations via WorkspaceMembersContext. */}
          <MemberAvatars />
          <UserDropdown />
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<EventList />} />
          <Route path="/events/:eventId" element={<EventDetail />} />
          <Route path="/events/:eventId/attendees/:attendeeId" element={<AttendeeDetail />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/:section" element={<AccountPage />} />
          <Route path="/login" element={<PostAuthLanding />} />
          {/* Marketing CTAs link unauthenticated visitors to /signup
              (LoginPage opens in signup mode). Once they're in, that
              URL is meaningless — bounce them to the dashboard, or
              to /account when there's an invite waiting (newly-signed-up
              invitees who arrived via the workspace-invite email). */}
          <Route path="/signup" element={<PostAuthLanding />} />
        </Routes>
      </main>
    </div>
  );
}

/**
 * Post-auth landing redirect used by /login and /signup.
 *
 * For a brand-new invitee, the click path is: workspace-invite email →
 * /signup → create account → Supabase auth resolves → this component
 * fires. Without it, the hardcoded `<Navigate to="/" />` dumped the
 * invitee onto an empty events page with no signpost to the accept
 * panel. Now: if there's a pending invite, route to /account where
 * the "Pending invites for you" section sits at the top of the Users
 * panel. Otherwise — solo signups, post-logout bounce — fall through
 * to / as before.
 *
 * Waits on `loading` so we don't flash a redirect to / before the
 * invites fetch resolves.
 */
function PostAuthLanding() {
  const { count, loading } = usePendingInvites();
  if (loading) {
    return (
      <div
        className="page loading"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}
      >
        <p>Loading...</p>
      </div>
    );
  }
  return <Navigate to={count > 0 ? "/account" : "/"} replace />;
}

function RootDispatcher() {
  const location = useLocation();
  // Public host profile + salon pages are intentionally hidden for the
  // launch window — focus is on the print revenue path, not the social
  // / discoverability layer. Any /@handle or /@handle/salon-slug URL
  // (old shared links, bookmarks, marketing) redirects to / so the
  // visitor lands on the authenticated app instead of a dead surface.
  //
  // Re-enabling is a one-line revert: restore the SalonPage + ProfilePage
  // branches below. The components, routes, models and migrations are all
  // still in place — only the entry point is hidden.
  if (location.pathname.startsWith("/@") && location.pathname.length > 2) {
    return <Navigate to="/" replace />;
  }
  return <ProtectedLayout />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PendingInvitesProvider>
         <WorkspaceMembersProvider>
          <Routes>
            <Route path="/forms/:shareToken" element={<PublicForm />} />
            <Route path="/restaurant/:variant/:shareToken" element={<RestaurantView />} />
            <Route path="/event/:token" element={<PublicEvent />} />
            {/* Catch-all dispatcher. React Router 7's path-to-regexp only
                recognises `:param` after a slash and `*` as a standalone
                or trailing-slash segment, so `/@:handle` and `/@*` both
                fail to match `/@dani`. RootDispatcher reads useLocation
                at runtime and routes the `@`-prefixed paths to the public
                ProfilePage, everything else into the authenticated layout.
                Keeps the `placecard-events.app/@dani` marketing URL. */}
            <Route path="/*" element={<RootDispatcher />} />
          </Routes>
         </WorkspaceMembersProvider>
        </PendingInvitesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
