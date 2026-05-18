import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, type PendingInvite } from "../api/client";
import { useAuth } from "./AuthContext";

/**
 * App-wide source of truth for "pending workspace invites for the
 * current user." Two consumers today:
 *   - The header dropdown trigger renders a small badge with the count
 *     so invitees who land on a deep link (or who close the email and
 *     navigate elsewhere) still see "1 invite waiting."
 *   - The post-auth landing route reads `count` to decide whether to
 *     send the user to /account (where the accept UI lives) or to / .
 *
 * AccountPage still owns its own copy of the list for the panel render
 * — it just calls `refresh()` here on accept / decline so the badge
 * updates in lockstep.
 */
interface PendingInvitesState {
  invites: PendingInvite[];
  count: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

const PendingInvitesContext = createContext<PendingInvitesState | null>(null);

export function PendingInvitesProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  // Start `loading=true` so PostAuthLanding doesn't flash a redirect to
  // `/` before the first fetch resolves. Goes false after auth settles
  // and the (possibly empty) fetch completes.
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setInvites([]);
      setLoading(false);
      return;
    }
    try {
      const list = await api.listMyPendingInvites();
      setInvites(list);
    } catch {
      // Non-critical — leave the prior list in place. The badge will
      // simply be stale until the next refresh; we don't block the app.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // Wait for auth to resolve before firing. The hook itself short-
    // circuits when user is null, so we'd just clear-and-no-op anyway.
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  return (
    <PendingInvitesContext.Provider
      value={{ invites, count: invites.length, loading, refresh }}
    >
      {children}
    </PendingInvitesContext.Provider>
  );
}

export function usePendingInvites() {
  const ctx = useContext(PendingInvitesContext);
  if (!ctx) throw new Error("usePendingInvites must be used within PendingInvitesProvider");
  return ctx;
}
