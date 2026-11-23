import { afterEach, describe, expect, it, vi } from "vitest";

function jwt(role: string): string {
  const payload = btoa(JSON.stringify({ role }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

async function loadClientModule() {
  vi.resetModules();
  return import("./client");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("browser Supabase key configuration", () => {
  it("accepts the new publishable key format and a legacy anon JWT", async () => {
    const { isBrowserSafeSupabaseKey } = await loadClientModule();
    expect(isBrowserSafeSupabaseKey("sb_publishable_test-key")).toBe(true);
    expect(isBrowserSafeSupabaseKey(jwt("anon"))).toBe(true);
  });

  it("rejects service-role JWTs and secret keys even when set as publishable", async () => {
    const { isBrowserSafeSupabaseKey } = await loadClientModule();
    expect(isBrowserSafeSupabaseKey(jwt("service_role"))).toBe(false);
    expect(isBrowserSafeSupabaseKey("sb_secret_test-key")).toBe(false);
  });

  it("rejects malformed, empty, and unrelated credentials", async () => {
    const { isBrowserSafeSupabaseKey } = await loadClientModule();
    expect(isBrowserSafeSupabaseKey("not-a-key")).toBe(false);
    expect(isBrowserSafeSupabaseKey("   ")).toBe(false);
    expect(isBrowserSafeSupabaseKey("x..z")).toBe(false);
    expect(isBrowserSafeSupabaseKey("x.e30.z")).toBe(false);
    expect(isBrowserSafeSupabaseKey("x.%%%! .z")).toBe(false);
    expect(isBrowserSafeSupabaseKey(jwt("authenticated"))).toBe(false);
    expect(isBrowserSafeSupabaseKey("sb_publishable_test-key ")).toBe(true);
  });

  it("returns no client for missing URL, missing key, or an unsafe configured key", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test-key");
    const missingUrl = await loadClientModule();
    expect(missingUrl.getSupabaseClient()).toBeNull();

    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const missingKey = await loadClientModule();
    expect(missingKey.getSupabaseClient()).toBeNull();

    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_secret_test-key");
    const unsafeKey = await loadClientModule();
    expect(unsafeKey.getSupabaseClient()).toBeNull();
  });

  it("creates and reuses a browser client with publishable or legacy anon configuration", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test-key");
    const publishableModule = await loadClientModule();
    const publishableClient = publishableModule.getSupabaseClient();
    expect(publishableClient).not.toBeNull();
    expect(publishableModule.getSupabaseClient()).toBe(publishableClient);

    vi.stubEnv("VITE_SUPABASE_URL", "https://legacy.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", jwt("anon"));
    const legacyModule = await loadClientModule();
    expect(legacyModule.getSupabaseClient()).not.toBeNull();
  });

  it("caches an empty result and safely handles client-construction errors", async () => {
    const emptyModule = await loadClientModule();
    expect(emptyModule.getSupabaseClient()).toBeNull();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test-key");
    expect(emptyModule.getSupabaseClient()).toBeNull();

    vi.stubEnv("VITE_SUPABASE_URL", "not-a-url");
    const invalidUrlModule = await loadClientModule();
    expect(invalidUrlModule.getSupabaseClient()).toBeNull();
  });
});
