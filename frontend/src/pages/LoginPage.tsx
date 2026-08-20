import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import logoSvg from "../assets/placecard-logo.svg";

/**
 * Passwordless-first login page.
 *
 * Primary flow: user types their email → we send a magic link → they click
 * it in their inbox → they're signed in. Same code path for new signups
 * and returning users (Supabase's `signInWithOtp` auto-creates the account
 * on first click). No password storage, no password reset, no forgotten-
 * password support tickets.
 *
 * Fallback: a small "Use password instead" link at the bottom flips into
 * the legacy email + password form. Kept alive for anyone who bookmarked
 * the old flow or who genuinely prefers passwords; new / returning users
 * default to the magic-link path.
 *
 * Callback handling: when the user clicks the email link, Supabase
 * redirects them back to https://app.placecard-events.app/ with the
 * access token in the URL hash. The Supabase client library auto-parses
 * that on load and fires SIGNED_IN via `onAuthStateChange`, which the
 * AuthProvider already listens to. No dedicated callback route needed.
 */
export default function LoginPage() {
  const { signIn, signUp, signInWithMagicLink } = useAuth();

  // /signup is the marketing-site's "create account" CTA. Land users
  // there in the same magic-link flow (Supabase creates the user on
  // first click); the URL just controls the small copy tweak below.
  const isSignupUrl = typeof window !== "undefined" && window.location.pathname === "/signup";

  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [passwordSignupSuccess, setPasswordSignupSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // In the password fallback, still let the user toggle between sign-in
  // and sign-up (needed because sign-up captures a name for the profile).
  const [passwordMode, setPasswordMode] = useState<"login" | "signup">(
    isSignupUrl ? "signup" : "login",
  );

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signInWithMagicLink(email);
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setLinkSent(true);
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    if (passwordMode === "login") {
      const { error } = await signIn(email, password);
      if (error) setError(error.message);
    } else {
      if (!name.trim()) { setError("Name is required"); setLoading(false); return; }
      const { error } = await signUp(email, password, name);
      if (error) {
        setError(error.message);
      } else {
        setPasswordSignupSuccess(true);
      }
    }
    setLoading(false);
  };

  // Post-magic-link-sent confirmation. Same shape as the old password-
  // signup success screen so the visual pattern is consistent.
  if (linkSent) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo"><img src={logoSvg} alt="PlaceCard" className="login-logo-img" /></div>
          <div className="login-success">
            <h2>Check your email</h2>
            <p>
              We sent a login link to <strong>{email}</strong>. Click the link in
              your inbox to sign in — it stays valid for one hour. No password
              needed.
            </p>
            <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 16 }}>
              Not seeing it? Check your spam folder, or{" "}
              <button
                className="link-btn"
                onClick={() => { setLinkSent(false); setError(null); }}
              >
                try a different email address
              </button>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (passwordSignupSuccess) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo"><img src={logoSvg} alt="PlaceCard" className="login-logo-img" /></div>
          <div className="login-success">
            <h2>Check your email</h2>
            <p>We sent a confirmation link to <strong>{email}</strong>. Click the link to activate your account.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Magic-link (default) form ─────────────────────────────────────────
  if (mode === "magic") {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo"><img src={logoSvg} alt="PlaceCard" className="login-logo-img" /></div>
          <h2 className="login-title">
            {isSignupUrl ? "Create your account" : "Sign in to PlaceCard"}
          </h2>
          <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 20px", textAlign: "center" }}>
            No password needed — we'll email you a one-tap login link.
          </p>

          <form onSubmit={handleMagicLink} className="login-form">
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="btn btn-primary login-btn" disabled={loading || !email}>
              {loading ? "Sending link…" : "Send login link"}
            </button>
          </form>

          <div className="login-switch">
            <p style={{ fontSize: 13, color: "#94a3b8" }}>
              Prefer a password?{" "}
              <button
                className="link-btn"
                onClick={() => { setMode("password"); setError(null); }}
              >
                Sign in with password
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Password fallback ─────────────────────────────────────────────────
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo"><img src={logoSvg} alt="PlaceCard" className="login-logo-img" /></div>
        <h2 className="login-title">
          {passwordMode === "login" ? "Sign in with password" : "Create account"}
        </h2>

        <form onSubmit={handlePasswordSubmit} className="login-form">
          {passwordMode === "signup" && (
            <div className="form-group">
              <label>Full name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Name Here"
                required
              />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div className="password-input-wrap">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                )}
              </button>
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? "Loading..." : passwordMode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div className="login-switch">
          {passwordMode === "login" ? (
            <p>Don't have an account? <button className="link-btn" onClick={() => { setPasswordMode("signup"); setError(null); }}>Sign up</button></p>
          ) : (
            <p>Already have an account? <button className="link-btn" onClick={() => { setPasswordMode("login"); setError(null); }}>Sign in</button></p>
          )}
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 12 }}>
            <button className="link-btn" onClick={() => { setMode("magic"); setError(null); }}>
              ← Back to magic-link login
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
