import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  hasKey: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setKey: (openRouterApiKey: string) => Promise<void>;
  removeKey: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const me = await api.get<AuthUser>("/api/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function login(email: string, password: string) {
    const me = await api.post<AuthUser>("/api/auth/login", { email, password });
    setUser(me);
  }

  async function signup(email: string, password: string, displayName: string) {
    const me = await api.post<AuthUser>("/api/auth/signup", { email, password, displayName });
    setUser(me);
  }

  async function logout() {
    await api.post<{ ok: boolean }>("/api/auth/logout", {});
    setUser(null);
  }

  async function setKey(openRouterApiKey: string) {
    await api.put<{ ok: boolean }>("/api/auth/key", { openRouterApiKey });
    setUser((current) => (current ? { ...current, hasKey: true } : current));
  }

  async function removeKey() {
    await api.delete<{ ok: boolean }>("/api/auth/key");
    setUser((current) => (current ? { ...current, hasKey: false } : current));
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refresh, setKey, removeKey }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
