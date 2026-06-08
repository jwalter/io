import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseInstance: SupabaseClient | null = null;
let initialized = false;

export async function initSupabase(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const res = await fetch("/api/auth/config");
    if (!res.ok) return;
    const { supabaseUrl, supabaseAnonKey } = await res.json();
    if (supabaseUrl && supabaseAnonKey) {
      supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
    }
  } catch {
    // Backend unreachable — supabase stays null
  }
}

export function getSupabase(): SupabaseClient | null {
  return supabaseInstance;
}
