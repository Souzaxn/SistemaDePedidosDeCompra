import { createClient } from "@supabase/supabase-js";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

export const supabaseConfigured = Boolean(configuredUrl && configuredAnonKey);
const supabaseUrl = configuredUrl || "https://invalid.local";
const supabaseAnonKey = configuredAnonKey || "invalid-anon-key";

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export const SERVER_URL = `${supabaseUrl}/functions/v1/server/make-server-e3b494b7`;

export const verifySupabaseConnection = async () => {
  if (!supabaseConfigured) return false;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
};
