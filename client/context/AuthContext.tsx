import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@shared/api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (params: { email: string; password: string; name?: string; phone?: string | null }) => Promise<User>;
  logout: () => void;
  refreshUser: (id?: string) => Promise<User | null>;
  leaderboard: { id: string; name: string; points: number; role?: string }[];
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const LOCAL_KEY = "city-issue-reporter:user";

const authorityWhitelist = new Set([
  "test.authority@gov.in",
  "admin@test.com",
  "authority@test.com",
  "officer@test.com",
]);

function determineRole(email: string): User["role"] {
  if (email.toLowerCase().endsWith("@gov.in") || authorityWhitelist.has(email.toLowerCase())) return "authority";
  return "citizen";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<{ id: string; name: string; points: number; role?: string }[]>([]);

  useEffect(() => {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) setUser(JSON.parse(raw));
    setLoading(false);

    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch('/api/leaderboard');
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setLeaderboard(data);
      } catch (e) {
        // ignore
      }
    };
    load();
    const iv = setInterval(load, 10000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  const login: AuthContextValue["login"] = async ({ email, password, name, phone }) => {
    if ((!email && !phone) || !password) throw new Error("Email or phone and password required");
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, phone, password, name }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Login failed');
      }
      const srv: User = await res.json();
      localStorage.setItem(LOCAL_KEY, JSON.stringify(srv));
      setUser(srv);
      return srv;
    } catch (e: any) {
      throw new Error(e?.message || 'Login failed');
    }
  };

  const logout = () => {
    localStorage.removeItem(LOCAL_KEY);
    setUser(null);
  };

  const refreshUser: AuthContextValue["refreshUser"] = async (id) => {
    const myId = id || (user && user.id);
    if (!myId) return null;
    try {
      const res = await fetch(`/api/users/${myId}`);
      if (!res.ok) return null;
      const data: User = await res.json();
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      setUser(data);
      return data;
    } catch (e) {
      return null;
    }
  };

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const iv = setInterval(() => {
      if (!mounted) return;
      refreshUser().catch(() => {});
    }, 10000);
    return () => { mounted = false; clearInterval(iv); };
  }, [user]);

  const value = useMemo(() => ({ user, loading, login, logout, refreshUser, leaderboard }), [user, loading, leaderboard]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
