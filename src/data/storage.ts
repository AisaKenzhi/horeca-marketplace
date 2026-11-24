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

  /** Snapshot of all mirrored keys, used when persistence is unavailable. */
  record(): Record<string, string> {
    return Object.fromEntries(this.map);
  }
}

/** localStorage-backed store. Falls back to memory when storage is unavailable. */
export class BrowserStore implements KeyValueStore {
  private readonly fallback = new MemoryStore();
  private readonly usable: boolean;
  /** True after a failed write: the memory mirror is then authoritative. */
  private degraded: boolean;

  constructor(private readonly storageKey = "horeca-p0") {
    this.usable = typeof localStorage !== "undefined";
    this.degraded = !this.usable;
  }

  private readAll(): Record<string, string> {
    if (!this.usable) return {};
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw === null) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Record<string, string>;
    } catch {
      return {};
    }
  }

  private writeAll(all: Record<string, string>): boolean {
    if (!this.usable) return false;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(all));
      return true;
    } catch {
      // Storage full or blocked: degrade to the in-memory mirror.
      return false;
    }
  }

  private mirror(all: Record<string, string>): void {
    this.fallback.clear();
    for (const [key, value] of Object.entries(all)) this.fallback.set(key, value);
  }

  private current(): Record<string, string> {
    return this.degraded ? this.fallback.record() : this.readAll();
  }

  get(key: string): string | null {
    // Once a write has failed, persisted data may be stale, so the mirror wins.
    if (this.degraded) return this.fallback.get(key);
    const value = this.readAll()[key];
    if (value !== undefined) return value;
    return this.fallback.get(key);
  }

  set(key: string, value: string): void {
    const all = this.current();
    all[key] = value;
    const written = this.writeAll(all);
    this.degraded = !written;
    if (written) this.fallback.clear();
    else this.mirror(all);
  }

  remove(key: string): void {
    const all = this.current();
    delete all[key];
    const written = this.writeAll(all);
    this.degraded = !written;
    if (written) this.fallback.clear();
    else this.mirror(all);
  }

  clear(): void {
    const written = this.writeAll({});
    this.degraded = !written;
    this.fallback.clear();
  }
}
