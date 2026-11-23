import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let cachedClient: SupabaseClient<Database> | null = null;
let clientWasChecked = false;

/** Uses only browser-safe Supabase project URL and publishable/legacy anon key. */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (clientWasChecked) return cachedClient;
  clientWasChecked = true;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;

  try {
    cachedClient = createClient<Database>(url, key, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  } catch {
    cachedClient = null;
  }
  return cachedClient;
}
