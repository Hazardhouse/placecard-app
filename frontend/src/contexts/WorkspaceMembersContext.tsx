import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, type WorkspaceMember } from "../api/client";
import { useAuth } from "./AuthContext";

/**
 * App-wide source of truth for "members of the caller's personal
 * workspace." Two consumers today:
 *   - The header avatars cluster (left of the user dropdown) renders
 *     a stack of initials circles when the workspace has more than
 *     one active member. Hidden for solo accounts.
 *   - The AccountPage Users panel still has its own copy of the list
 *     for the rich table view, but calls `refresh()` here after any
 *     mutation (invite / role change / remove / accept / decline) so
 *     the header stays in sync without prop-drilling.
 *
 * The list comes from /api/workspaces/me/members which returns rows
 * in all statuses (pending / active / declined / removed). Consumers
 * are responsible for filtering — the header avatars filter to active
 * only, AccountPage shows pending + active.
 */
interface WorkspaceMembersState {
  members: WorkspaceMember[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const WorkspaceMembersContext = createContext<WorkspaceMembersState | null>(null);

export function WorkspaceMembersProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setMembers([]);
      setLoading(false);
      return;
    }
    try {
      const list = await api.listWorkspaceMembers();
      setMembers(list);
    } catch {
      // Non-critical — leave the prior list in place. The avatars cluster
      // will simply be stale until the next refresh; we don't block the
      // app on a transient members-fetch failure.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  return (
    <WorkspaceMembersContext.Provider value={{ members, loading, refresh }}>
      {children}
    </WorkspaceMembersContext.Provider>
  );
}

export function useWorkspaceMembers() {
  const ctx = useContext(WorkspaceMembersContext);
  if (!ctx) throw new Error("useWorkspaceMembers must be used within WorkspaceMembersProvider");
  return ctx;
}
