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
import ProfilePage from "./pages/ProfilePage";
import SalonPage from "./pages/SalonPage";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import logoSvg from "./assets/placecard-logo.svg";
import "./App.css";

function UserDropdown() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();

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
        <span className={`user-dropdown-caret ${open ? "open" : ""}`} />
      </button>
      {open && (
        <>
          <div className="user-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="user-dropdown-menu">
            <button className="user-dropdown-item" onClick={() => goToAccount("/account")}>
              Account
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
          {/* Multi-user presence avatars will render here once the
              invite flow persists team members. Hidden for solo
              accounts (the only mode today). */}
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
          <Route path="/login" element={<Navigate to="/" replace />} />
          {/* Marketing CTAs link unauthenticated visitors to /signup
              (LoginPage opens in signup mode). Once they're in, that
              URL is meaningless — bounce them to the dashboard. */}
          <Route path="/signup" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function RootDispatcher() {
  const location = useLocation();
  // `@`-prefixed root paths render public host / salon pages. Otherwise
  // we fall through to the authenticated app. This sidesteps RR7's
  // inability to match a `:param` directly after a literal `@`.
  if (location.pathname.startsWith("/@") && location.pathname.length > 2) {
    const rest = location.pathname.slice(2); // "dani" or "dani/dinners"
    const [handle, salonSlug, ...extra] = rest.split("/").filter(Boolean);
    if (handle && salonSlug && extra.length === 0) {
      return <SalonPage handle={handle.toLowerCase()} salonSlug={salonSlug.toLowerCase()} />;
    }
    return <ProfilePage />;
  }
  return <ProtectedLayout />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
