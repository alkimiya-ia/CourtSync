import { supabase } from './supabase';

export type OutboxTable = 'stat_events' | 'stat_corrections' | 'score_events';
export interface OutboxItem { table: OutboxTable; row: Record<string, unknown> & { id: string }; attempts: number }
export interface RejectedItem extends OutboxItem { error: string; code: string; at: string }

// Postgres classes where retrying the same request can't succeed:
// 42 = permission / RLS (42501), 23 = constraint, 22 = bad data, P0 = raised by our SQL.
const PERMANENT = /^(42|23|22|P0)/;

/**
 * Local pending-event queue, one per game.
 * Every write is saved to localStorage first, then sent in order with
 * INSERT … ON CONFLICT (id) DO NOTHING, so resending after a timeout never duplicates.
 * Transient failures retry with backoff. Rows the server refuses are moved to a persisted
 * "rejected" list for the user to review (retry or discard); nothing is dropped silently.
 */
export class Outbox {
  items: OutboxItem[] = [];
  rejected: RejectedItem[] = [];
  lastError: string | null = null;
  private key: string;
  private rejKey: string;
  private flushing = false;
  private timer: number | undefined;
  private backoff = 1000;
  private listeners = new Set<() => void>();
  private onSent: (table: OutboxTable, rows: OutboxItem['row'][]) => void;

  constructor(gameId: string, onSent: (table: OutboxTable, rows: OutboxItem['row'][]) => void) {
    this.key = 'courtsync:outbox:' + gameId;
    this.rejKey = 'courtsync:rejected:' + gameId;
    this.onSent = onSent;
    this.items = read<OutboxItem[]>(this.key, []);
    this.rejected = read<RejectedItem[]>(this.rejKey, []);
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach((f) => f()); }
  private save() { write(this.key, this.items); write(this.rejKey, this.rejected); }

  dispose() { window.clearTimeout(this.timer); this.listeners.clear(); }

  enqueue(table: OutboxTable, row: OutboxItem['row']) {
    this.items.push({ table, row, attempts: 0 });
    this.save(); this.emit();
    void this.flush();
  }

  /** Send now, skipping any backoff wait. */
  retryNow() { window.clearTimeout(this.timer); this.backoff = 1000; void this.flush(); }

  /** Put a rejected row back in the queue (e.g. after the user starts tracking that player again). */
  retryRejected(id: string) {
    const i = this.rejected.findIndex((r) => r.row.id === id);
    if (i < 0) return;
    const [r] = this.rejected.splice(i, 1);
    this.items.push({ table: r.table, row: r.row, attempts: 0 });
    this.save(); this.emit();
    this.retryNow();
  }

  discardRejected(id: string) {
    this.rejected = this.rejected.filter((r) => r.row.id !== id);
    this.save(); this.emit();
  }

  private schedule() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }

  private reject(it: OutboxItem, error: { message: string; code?: string }) {
    this.rejected.push({ ...it, error: error.message, code: error.code ?? '', at: new Date().toISOString() });
    this.lastError = error.message;
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.items.length) return;
    this.flushing = true;
    try {
      while (this.items.length) {
        const table = this.items[0].table;
        let n = 0;
        while (n < this.items.length && n < 50 && this.items[n].table === table) n++;
        const batch = this.items.slice(0, n);
        const { error } = await supabase.from(table).upsert(batch.map((b) => b.row), { onConflict: 'id', ignoreDuplicates: true });
        if (error) {
          if (error.code && PERMANENT.test(error.code)) {
            // One bad row fails the whole batch: send individually so valid rows still go through.
            await this.sendOneByOne(batch.length);
            continue;
          }
          batch.forEach((b) => b.attempts++);
          this.lastError = error.message;
          this.save(); this.emit();
          this.schedule();
          return;
        }
        this.items.splice(0, n);
        this.lastError = null;
        this.backoff = 1000;
        this.save();
        this.onSent(table, batch.map((b) => b.row));
        this.emit();
      }
    } catch (e) {
      this.lastError = (e as Error).message;
      this.save(); this.emit();
      this.schedule();
    } finally {
      this.flushing = false;
    }
  }

  private async sendOneByOne(n: number) {
    for (let i = 0; i < n && this.items.length; i++) {
      const it = this.items[0];
      const { error } = await supabase.from(it.table).upsert(it.row, { onConflict: 'id', ignoreDuplicates: true });
      if (error && !(error.code && PERMANENT.test(error.code))) throw error; // transient: outer loop retries later
      this.items.shift();
      if (error) this.reject(it, error);
      else this.onSent(it.table, [it.row]);
      this.save(); this.emit();
    }
  }
}

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try {
    if (Array.isArray(value) && value.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or disabled: queue stays in memory for this session */ }
}
