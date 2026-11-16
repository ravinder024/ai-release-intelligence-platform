import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  hasKey: boolean;
  role: "user" | "admin";
  provider: "local" | "google";
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
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

  async function login(identifier: string, password: string) {
    const trimmed = identifier.trim();
    const payload = trimmed.includes("@") ? { email: trimmed, password } : { username: trimmed, password };
    const me = await api.post<AuthUser>("/api/auth/login", payload);
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

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
