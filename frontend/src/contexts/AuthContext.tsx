import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { api, type ProfileShape } from "../api/client";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  // The signed-in user's host profile. Lazily loaded after auth resolves
  // and shared app-wide so views like "Hosted by @handle" don't have to
  // re-fetch on every page mount.
  myProfile: ProfileShape | null;
  refreshMyProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateUser: (updates: { name?: string; email?: string; password?: string }) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [myProfile, setMyProfile] = useState<ProfileShape | null>(null);

  const refreshMyProfile = useCallback(async () => {
    if (!user) {
      setMyProfile(null);
      return;
    }
    try {
      const hint = (user.user_metadata as { full_name?: string } | undefined)?.full_name;
      const p = await api.getMyProfile(hint);
      setMyProfile(p);
    } catch {
      // Don't block the app if /me errors (e.g. backend migration not
      // yet deployed). Components that need it gate on `myProfile`.
      setMyProfile(null);
    }
  }, [user]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load (and auto-provision) the host profile whenever auth settles.
  // Cleared on sign-out so a sign-in as a different user picks up
  // fresh profile data.
  useEffect(() => {
    if (!user) {
      setMyProfile(null);
      return;
    }
    void refreshMyProfile();
  }, [user, refreshMyProfile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const updateUser = async (updates: { name?: string; email?: string; password?: string }) => {
    const payload: Record<string, unknown> = {};
    if (updates.email) payload.email = updates.email;
    if (updates.password) payload.password = updates.password;
    if (updates.name) payload.data = { full_name: updates.name };
    const { error } = await supabase.auth.updateUser(payload);
    return { error: error as Error | null };
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, myProfile, refreshMyProfile, signIn, signUp, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
