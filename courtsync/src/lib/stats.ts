import type { ScoreEvent, StatCorrection, StatEvent } from './types';

export const STAT_TYPES = [
  'FG2_MADE', 'FG2_MISS', 'FG3_MADE', 'FG3_MISS', 'FT_MADE', 'FT_MISS',
  'REB_OFF', 'REB_DEF', 'AST', 'STL', 'BLK', 'TOV', 'PF',
] as const;
export type StatType = (typeof STAT_TYPES)[number];

export const STAT_LABEL: Record<StatType, string> = {
  FG2_MADE: '2PT made', FG2_MISS: '2PT miss', FG3_MADE: '3PT made', FG3_MISS: '3PT miss',
  FT_MADE: 'FT made', FT_MISS: 'FT miss', REB_OFF: 'Off. rebound', REB_DEF: 'Def. rebound',
  AST: 'Assist', STL: 'Steal', BLK: 'Block', TOV: 'Turnover', PF: 'Foul',
};
export const STAT_POINTS: Record<StatType, number> = {
  FG2_MADE: 2, FG2_MISS: 0, FG3_MADE: 3, FG3_MISS: 0, FT_MADE: 1, FT_MISS: 0,
  REB_OFF: 0, REB_DEF: 0, AST: 0, STL: 0, BLK: 0, TOV: 0, PF: 0,
};

export type Counts = Record<StatType, number>;
export interface Line {
  c: Counts; pts: number; reb: number;
  fgm: number; fga: number; fg2m: number; fg2a: number; fg3m: number; fg3a: number; ftm: number; fta: number;
}

export const zeroCounts = (): Counts => Object.fromEntries(STAT_TYPES.map((t) => [t, 0])) as Counts;

export function lineOf(events: { type: StatType }[]): Line {
  const c = zeroCounts();
  for (const e of events) c[e.type]++;
  const fg2a = c.FG2_MADE + c.FG2_MISS, fg3a = c.FG3_MADE + c.FG3_MISS, fta = c.FT_MADE + c.FT_MISS;
  return {
    c, pts: 2 * c.FG2_MADE + 3 * c.FG3_MADE + c.FT_MADE, reb: c.REB_OFF + c.REB_DEF,
    fgm: c.FG2_MADE + c.FG3_MADE, fga: fg2a + fg3a, fg2m: c.FG2_MADE, fg2a, fg3m: c.FG3_MADE, fg3a, ftm: c.FT_MADE, fta,
  };
}

export const pct = (m: number, a: number) => (a ? Math.round((m / a) * 100) + '%' : '–');

type Ordered = { seq?: number | null; client_ts: string };
export const bySeq = (a: Ordered, b: Ordered) =>
  (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) || a.client_ts.localeCompare(b.client_ts);

export interface EffEvent extends StatEvent {
  voided: boolean; edited: boolean; originalType: StatType; correctedBy?: string;
}

/** Applies corrections (in server order, pending last) to produce each event's effective state. */
export function applyCorrections(events: StatEvent[], corrections: StatCorrection[]): EffEvent[] {
  const map = new Map<string, EffEvent>();
  for (const e of events) map.set(e.id, { ...e, voided: false, edited: false, originalType: e.type });
  for (const c of [...corrections].sort(bySeq)) {
    const e = map.get(c.event_id);
    if (!e) continue;
    e.correctedBy = c.user_id;
    if (c.action === 'void') e.voided = true;
    else if (c.action === 'restore') e.voided = false;
    else if (c.action === 'change_type' && c.new_type) { e.type = c.new_type; e.edited = true; }
  }
  return [...map.values()].sort(bySeq);
}

export interface EffScore extends ScoreEvent { voided: boolean; voidedBy?: string; voidedAt?: string }

/** Official score from score events only. Player stats never feed into this. */
export function officialScore(events: ScoreEvent[]) {
  const entries = new Map<string, EffScore>();
  for (const e of [...events].sort(bySeq)) {
    if (e.kind === 'score' || e.kind === 'adjust') entries.set(e.id, { ...e, voided: false });
    else if (e.target_id) {
      const t = entries.get(e.target_id);
      if (t) { t.voided = e.kind === 'void'; t.voidedBy = e.user_id; t.voidedAt = e.client_ts; }
    }
  }
  let home = 0, away = 0;
  for (const e of entries.values()) if (!e.voided) e.side === 'home' ? (home += e.delta) : (away += e.delta);
  return { home, away, entries: [...entries.values()] };
}

export const periodLabel = (p: number, periods: number) => (p <= periods ? (periods === 2 ? 'H' : 'Q') + p : 'OT' + (p - periods > 1 ? p - periods : ''));

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
