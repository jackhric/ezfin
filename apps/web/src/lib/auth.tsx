import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Me } from "@/lib/api";

interface AuthState {
  loading: boolean;
  setupRequired: boolean;
  user: Me | null;
  error?: string;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    Pick<AuthState, "loading" | "setupRequired" | "user" | "error">
  >({
    loading: true,
    setupRequired: false,
    user: null,
  });

  const refresh = useCallback(async () => {
    try {
      const s = await api.authStatus();
      setState({ loading: false, setupRequired: s.setupRequired, user: s.user });
    } catch (e) {
      setState({
        loading: false,
        setupRequired: false,
        user: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
