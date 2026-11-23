import { describe, expect, it } from "vitest";
import { isBrowserSafeSupabaseKey } from "./client";

function jwt(role: string): string {
  const payload = btoa(JSON.stringify({ role }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

describe("browser Supabase key configuration", () => {
  it("accepts the new publishable key format and a legacy anon JWT", () => {
    expect(isBrowserSafeSupabaseKey("sb_publishable_test-key")).toBe(true);
    expect(isBrowserSafeSupabaseKey(jwt("anon"))).toBe(true);
  });

  it("rejects service-role JWTs and secret keys even when set as publishable", () => {
    expect(isBrowserSafeSupabaseKey(jwt("service_role"))).toBe(false);
    expect(isBrowserSafeSupabaseKey("sb_secret_test-key")).toBe(false);
  });

  it("rejects malformed or unrelated credentials", () => {
    expect(isBrowserSafeSupabaseKey("not-a-key")).toBe(false);
    expect(isBrowserSafeSupabaseKey(jwt("authenticated"))).toBe(false);
  });
});
