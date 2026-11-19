/**
 * Storage abstraction for the P0 prototype.
 *
 * The prototype keeps its state in the browser only. We expose a tiny KV
 * interface so it can run fully in-memory (tests) or on localStorage (dev
 * session). No network, no remote database, no Supabase is used here.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

/** localStorage-backed store. Falls back to memory when storage is unavailable. */
export class BrowserStore implements KeyValueStore {
  private readonly fallback = new MemoryStore();
  private readonly usable: boolean;

  constructor(private readonly storageKey = "horeca-p0") {
    this.usable = typeof localStorage !== "undefined";
  }

  private readAll(): Record<string, string> {
    if (!this.usable) return {};
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw === null) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object") return {};
      return parsed as Record<string, string>;
    } catch {
      return {};
    }
  }

  private writeAll(all: Record<string, string>): void {
    if (!this.usable) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(all));
    } catch {
      // Storage full or blocked: degrade to the in-memory fallback silently.
      this.fallback.clear();
    }
  }

  get(key: string): string | null {
    const all = this.readAll();
    const value = all[key];
    if (value !== undefined) return value;
    return this.fallback.get(key);
  }

  set(key: string, value: string): void {
    const all = this.readAll();
    all[key] = value;
    this.writeAll(all);
    this.fallback.set(key, value);
  }

  remove(key: string): void {
    const all = this.readAll();
    delete all[key];
    this.writeAll(all);
    this.fallback.remove(key);
  }

  clear(): void {
    this.writeAll({});
    this.fallback.clear();
  }
}
