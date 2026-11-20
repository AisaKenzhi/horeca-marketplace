import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserStore, MemoryStore } from "@/data/storage";

describe("MemoryStore", () => {
  it("keeps values per key and returns null for a missing key", () => {
    const store = new MemoryStore();
    expect(store.get("a")).toBeNull();
    store.set("a", "1");
    expect(store.get("a")).toBe("1");
    store.remove("a");
    expect(store.get("a")).toBeNull();
  });

  it("clears every key", () => {
    const store = new MemoryStore();
    store.set("a", "1");
    store.set("b", "2");
    store.clear();
    expect(store.get("a")).toBeNull();
    expect(store.get("b")).toBeNull();
  });
});

describe("BrowserStore", () => {
  const KEY = "horeca-p0-test";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("round-trips values through localStorage", () => {
    const store = new BrowserStore(KEY);
    store.set("a", "1");
    store.set("b", "2");
    expect(store.get("a")).toBe("1");
    expect(store.get("b")).toBe("2");

    // A second instance over the same key sees the persisted data.
    const reopened = new BrowserStore(KEY);
    expect(reopened.get("a")).toBe("1");
    expect(reopened.get("b")).toBe("2");
  });

  it("removes a single key without touching the others", () => {
    const store = new BrowserStore(KEY);
    store.set("a", "1");
    store.set("b", "2");
    store.remove("a");
    expect(store.get("a")).toBeNull();
    expect(store.get("b")).toBe("2");
  });

  it("clears all persisted data", () => {
    const store = new BrowserStore(KEY);
    store.set("a", "1");
    store.clear();
    expect(store.get("a")).toBeNull();
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({}));
  });

  it("returns null for a key that is absent in both storage and the fallback", () => {
    const store = new BrowserStore(KEY);
    expect(store.get("missing")).toBeNull();
  });

  it("ignores corrupt JSON instead of throwing", () => {
    localStorage.setItem(KEY, "{not valid json");
    const store = new BrowserStore(KEY);
    expect(store.get("a")).toBeNull();
    // A write recovers by rewriting valid JSON.
    store.set("a", "1");
    expect(store.get("a")).toBe("1");
  });

  it("ignores stored JSON that is not an object", () => {
    localStorage.setItem(KEY, JSON.stringify(["not", "an", "object"]));
    const store = new BrowserStore(KEY);
    expect(store.get("a")).toBeNull();
    store.set("a", "1");
    expect(store.get("a")).toBe("1");
  });

  it("treats stored JSON null as empty", () => {
    localStorage.setItem(KEY, "null");
    const store = new BrowserStore(KEY);
    expect(store.get("a")).toBeNull();
  });

  it("degrades to the in-memory fallback when writes fail (storage full)", () => {
    const store = new BrowserStore(KEY);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    // The write is unpersisted, but the value is still served from memory.
    store.set("a", "1");
    expect(store.get("a")).toBe("1");
  });
});
