import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { AuthChangeEvent, User, Session } from "@supabase/supabase-js";
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
  const currentUserId = useRef<string | null>(null);

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
    const applySession = (s: Session | null, event?: AuthChangeEvent) => {
      const nextUser = s?.user ?? null;
      const nextUserId = nextUser?.id ?? null;

      if (!nextUserId) {
        if (event === "SIGNED_OUT" || currentUserId.current) {
          currentUserId.current = null;
          profileRequest.current += 1;
          setSession(null);
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
        return;
      }

      if (currentUserId.current === nextUserId) {
        return;
      }

      currentUserId.current = nextUserId;
      setSession(s);
      setUser(nextUser);
      fetchProfile(nextUser).finally(() => setLoading(false));
    };

    supabase.auth.getSession()
      .then(({ data: { session: s } }) => {
        applySession(s, "INITIAL_SESSION");
      })
      .catch((caught) => {
        if (import.meta.env.DEV) console.error("Authentication initialization failed", caught);
        setError(true);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      applySession(s, event);
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
    currentUserId.current = null;
    profileRequest.current += 1;
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
