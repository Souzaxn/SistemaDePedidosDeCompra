import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { profileApi } from "../lib/api";

export interface Profile {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const profileRequest = useRef(0);

  const fetchProfile = async (u: User) => {
    const request = ++profileRequest.current;
    const stored = await profileApi.getById(u.id);
    if (request !== profileRequest.current) return;
    if (stored) {
      setProfile({
        ...(stored as Profile),
        name: String(stored.name || "").trim() || u.email || "",
        email: String(stored.email || "").trim() || u.email || "",
      });
      return;
    }
    setProfile({
      id: u.id,
      name: u.email || "",
      email: u.email || "",
      is_admin: false,
    });
  };

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          fetchProfile(s.user).finally(() => setLoading(false));
        } else {
          setProfile(null);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (import.meta.env.DEV) console.error("Authentication initialization failed", caught);
        setError(true);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setProfile(null);
        fetchProfile(s.user);
      } else {
        profileRequest.current += 1;
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) return "E-mail ou senha incorretos";
      return null;
    } catch {
      return "E-mail ou senha incorretos";
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
