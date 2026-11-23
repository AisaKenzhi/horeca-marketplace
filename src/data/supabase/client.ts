import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let cachedClient: SupabaseClient<Database> | null = null;
let clientWasChecked = false;

/** Reject credentials that can bypass browser-facing RLS, even if misconfigured as publishable. */
export function isBrowserSafeSupabaseKey(key: string): boolean {
  const normalized = key.trim();
  if (!normalized || normalized.startsWith("sb_secret_")) return false;
  if (normalized.startsWith("sb_publishable_")) return true;

  const parts = normalized.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const claims: unknown = JSON.parse(decoded);
    return (
      typeof claims === "object" &&
      claims !== null &&
      "role" in claims &&
      claims.role === "anon"
    );
  } catch {
    return false;
  }
}

/** Uses only browser-safe Supabase project URL and publishable/legacy anon key. */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (clientWasChecked) return cachedClient;
  clientWasChecked = true;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || !isBrowserSafeSupabaseKey(key)) return null;

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
