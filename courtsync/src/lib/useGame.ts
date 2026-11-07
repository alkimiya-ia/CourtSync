import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ensureUser, friendlyError, supabase } from './supabase';
import { Outbox, type OutboxItem, type OutboxTable } from './outbox';
import { applyCorrections, officialScore, STAT_POINTS, type StatType } from './stats';
import type { Assignment, Game, Participant, Player, ScoreEvent, Side, StatCorrection, StatEvent, Team } from './types';

export type SyncState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface GameData {
  game: Game; teams: Team[]; players: Player[]; participants: Participant[]; assignments: Assignment[];
  events: StatEvent[]; corrections: StatCorrection[]; scoreEvents: ScoreEvent[];
}
type ArrayKey = Exclude<keyof GameData, 'game'>;
export type LoadState =
  | { kind: 'loading' }
  | { kind: 'missing' }            // no game visible to this user (not found, or not a member yet)
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

const KEY_OF: Record<OutboxTable, 'events' | 'corrections' | 'scoreEvents'> = {
  stat_events: 'events', stat_corrections: 'corrections', score_events: 'scoreEvents',
};

async function fetchRows<T>(table: string, gameId: string, order?: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select('*').eq('game_id', gameId).range(from, from + 999);
    if (order) q = q.order(order);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

function upsertBy<T extends object>(arr: T[], row: T, key: keyof T): T[] {
  const i = arr.findIndex((x) => x[key] === row[key]);
  if (i < 0) return [...arr, row];
  const next = arr.slice();
  next[i] = { ...arr[i], ...row, pending: false };
  return next;
}

export function useGame(code: string) {
  const [userId, setUserId] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [data, setData] = useState<GameData | null>(null);
  const [sync, setSync] = useState<SyncState>(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connecting');
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const outboxRef = useRef<Outbox | null>(null);
  const loadingRef = useRef(false);
  const rerunRef = useRef(false);

  const fetchAll = useCallback(async (): Promise<void> => {
    if (loadingRef.current) { rerunRef.current = true; return; }
    loadingRef.current = true;
    try {
      const uid = await ensureUser();
      setUserId(uid);
      const { data: g, error } = await supabase.from('games').select('*').eq('code', code.toUpperCase()).maybeSingle();
      if (error) throw error;
      if (!g) { setData(null); setLoad({ kind: 'missing' }); return; }
      const id = (g as Game).id;
      const [teams, players, participants, assignments, events, corrections, scoreEvents] = await Promise.all([
        fetchRows<Team>('teams', id),
        fetchRows<Player>('players', id, 'jersey'),
        fetchRows<Participant>('game_participants', id),
        fetchRows<Assignment>('tracker_assignments', id),
        fetchRows<StatEvent>('stat_events', id, 'seq'),
        fetchRows<StatCorrection>('stat_corrections', id, 'seq'),
        fetchRows<ScoreEvent>('score_events', id, 'seq'),
      ]);
      setData({ game: g as Game, teams, players, participants, assignments, events, corrections, scoreEvents });
      setLoad({ kind: 'ready' });
    } catch (e) {
      // Keep showing what we have if we loaded once; only surface the error on first load.
      setLoad((l) => (l.kind === 'ready' ? l : { kind: 'error', message: friendlyError(e) }));
      if (!navigator.onLine) setSync('offline');
    } finally {
      loadingRef.current = false;
      if (rerunRef.current) { rerunRef.current = false; void fetchAll(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const gameId = data?.game.id ?? null;

  // Outbox for this game
  useEffect(() => {
    if (!gameId) return;
    const ob = new Outbox(gameId, (table, rows) => {
      const key = KEY_OF[table];
      setData((d) => {
        if (!d) return d;
        let arr = d[key] as { id: string }[];
        for (const r of rows) if (!arr.some((x) => x.id === r.id)) arr = [...arr, { ...(r as object), seq: null } as { id: string }];
        return { ...d, [key]: arr } as GameData;
      });
    });
    outboxRef.current = ob;
    const unsub = ob.subscribe(rerender);
    rerender();
    void ob.flush();
    return () => { unsub(); ob.dispose(); if (outboxRef.current === ob) outboxRef.current = null; };
  }, [gameId]);

  // Realtime subscription + reconciliation
  useEffect(() => {
    if (!gameId) return;
    let disposed = false;
    const f = (table: string) => ({ event: '*' as const, schema: 'public', table, filter: `game_id=eq.${gameId}` });
    const put = (key: ArrayKey, idKey: string) => (p: { eventType: string; new: unknown }) => {
      if (p.eventType === 'DELETE' || !p.new) return;
      const row = p.new as Record<string, unknown>;
      setData((d) => {
        if (!d) return d;
        const arr = d[key] as unknown as Record<string, unknown>[];
        return { ...d, [key]: upsertBy(arr, row, idKey) } as GameData;
      });
    };
    const ch = supabase
      .channel('game-' + gameId)
      .on('postgres_changes', f('stat_events'), put('events', 'id'))
      .on('postgres_changes', f('stat_corrections'), put('corrections', 'id'))
      .on('postgres_changes', f('score_events'), put('scoreEvents', 'id'))
      .on('postgres_changes', f('tracker_assignments'), put('assignments', 'id'))
      .on('postgres_changes', f('game_participants'), put('participants', 'user_id'))
      .on('postgres_changes', f('players'), put('players', 'id'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (p) => setData((d) => (d ? { ...d, game: { ...d.game, ...(p.new as Partial<Game>) } } : d)))
      .subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          setSync(navigator.onLine ? 'live' : 'offline');
          void fetchAll(); // reconcile anything missed while (re)connecting
          void outboxRef.current?.flush();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setSync(navigator.onLine ? 'reconnecting' : 'offline');
        }
      });

    const onOnline = () => { setSync('reconnecting'); outboxRef.current?.retryNow(); void fetchAll(); };
    const onOffline = () => setSync('offline');
    const onVisible = () => { if (document.visibilityState === 'visible') { outboxRef.current?.retryNow(); void fetchAll(); } };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
    };
  }, [gameId, fetchAll]);

  // Safety net: poll while the realtime channel is not live.
  useEffect(() => {
    if (!gameId || sync === 'live') return;
    const t = window.setInterval(() => { void outboxRef.current?.flush(); void fetchAll(); }, 10000);
    return () => window.clearInterval(t);
  }, [gameId, sync, fetchAll]);

  const ob = outboxRef.current;
  const queueVersion = (ob?.items.length ?? 0) + ':' + (ob?.rejected.length ?? 0);

  const derived = useMemo(() => {
    if (!data) return null;
    const pendingRows = <T,>(table: OutboxTable, server: { id: string }[]): T[] => {
      if (!ob) return [];
      const ids = new Set(server.map((r) => r.id));
      return ob.items.filter((i) => i.table === table && !ids.has(i.row.id)).map((i) => ({ ...i.row, pending: true }) as T);
    };
    const events = [...data.events, ...pendingRows<StatEvent>('stat_events', data.events)];
    const corrections = [...data.corrections, ...pendingRows<StatCorrection>('stat_corrections', data.corrections)];
    const scoreEvents = [...data.scoreEvents, ...pendingRows<ScoreEvent>('score_events', data.scoreEvents)];
    const effEvents = applyCorrections(events, corrections);
    const score = officialScore(scoreEvents);
    const me = data.participants.find((p) => p.user_id === userId) ?? null;
    const team = (side: Side): Team => data.teams.find((t) => t.side === side) ?? { id: '', game_id: data.game.id, side, name: side === 'home' ? 'Home' : 'Away' };
    const playerById = new Map(data.players.map((p) => [p.id, p]));
    const sideOfPlayer = (pid: string): Side => data.teams.find((t) => t.id === playerById.get(pid)?.team_id)?.side ?? 'home';
    const activeAssignments = data.assignments.filter((a) => !a.ended_at);
    const myAssignments = activeAssignments.filter((a) => a.user_id === userId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const nameOf = (uid: string) => (uid === userId ? 'You' : data.participants.find((p) => p.user_id === uid)?.display_name ?? 'Someone');
    const expired = new Date(data.game.expires_at).getTime() <= Date.now();
    const live = data.game.status === 'live' && !expired;
    const isOrganizer = data.game.organizer_id === userId;
    const isScorekeeper = live && data.game.scorekeeper_id === userId;
    const hasRequestedScorekeeper = data.game.scorekeeper_request_id === userId;
    const canRecord = live && !!me && me.role !== 'spectator';
    /** Mirrors the corrections RLS policy: own events, or any event for the organizer. */
    const canCorrect = (e: { user_id: string }) => canRecord && (e.user_id === userId || isOrganizer);
    const playerPoints = { home: 0, away: 0 };
    for (const e of effEvents) if (!e.voided) playerPoints[sideOfPlayer(e.player_id)] += STAT_POINTS[e.type];
    return {
      effEvents, score, me, team, playerById, sideOfPlayer, activeAssignments, myAssignments, nameOf,
      live, expired, isOrganizer, isScorekeeper, hasRequestedScorekeeper, canRecord, canCorrect, playerPoints,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, userId, queueVersion]);

  const now = () => new Date().toISOString();
  const uuid = () => crypto.randomUUID();

  const recordStat = (playerId: string, type: StatType): string | null => {
    if (!data || !userId || !ob) return null;
    const row = { id: uuid(), game_id: data.game.id, player_id: playerId, user_id: userId, type, period: data.game.current_period, client_ts: now() };
    ob.enqueue('stat_events', row);
    return row.id;
  };
  const correct = (eventId: string, action: StatCorrection['action'], newType: StatType | null = null) => {
    if (!data || !userId || !ob) return;
    ob.enqueue('stat_corrections', { id: uuid(), game_id: data.game.id, event_id: eventId, user_id: userId, action, new_type: action === 'change_type' ? newType : null, client_ts: now() });
  };
  const scoreWrite = (side: Side, kind: ScoreEvent['kind'], delta: number, targetId: string | null = null): string | null => {
    if (!data || !userId || !ob) return null;
    const row = { id: uuid(), game_id: data.game.id, side, kind, delta, target_id: targetId, user_id: userId, period: data.game.current_period, client_ts: now() };
    ob.enqueue('score_events', row);
    return row.id;
  };

  return {
    load, data, userId, sync, reload: fetchAll, derived,
    pending: ob?.items.length ?? 0,
    pendingItems: (ob?.items ?? []) as OutboxItem[],
    rejectedItems: ob?.rejected ?? [],
    syncError: ob?.lastError ?? null,
    retryNow: () => ob?.retryNow(),
    retryRejected: (id: string) => ob?.retryRejected(id),
    discardRejected: (id: string) => ob?.discardRejected(id),
    recordStat, correct, scoreWrite,
  };
}

export type GameApi = ReturnType<typeof useGame>;
export type ReadyGame = Omit<GameApi, 'data' | 'derived' | 'userId'> & {
  data: GameData; derived: NonNullable<GameApi['derived']>; userId: string;
};

export const GameContext = createContext<ReadyGame | null>(null);
export function useGameCtx(): ReadyGame {
  const g = useContext(GameContext);
  if (!g) throw new Error('useGameCtx outside GameContext');
  return g;
}
