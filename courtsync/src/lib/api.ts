import { ensureUser, supabase } from './supabase';
import type { Side } from './types';

export interface NewPlayer { side: Side; jersey: number; name: string }

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  await ensureUser();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export interface GamePreview {
  found: boolean; status?: 'live' | 'final'; expired?: boolean; member?: boolean;
  home?: string; away?: string; has_scorekeeper?: boolean;
}
export const gamePreview = (code: string) => rpc<GamePreview>('game_preview', { p_code: code });

export const createGame = (a: { home: string; away: string; periods: number; displayName: string; players: NewPlayer[]; keepScore: boolean }) =>
  rpc<{ game_id: string; code: string }>('create_game', {
    p_home: a.home, p_away: a.away, p_periods: a.periods, p_display_name: a.displayName, p_players: a.players, p_keep_score: a.keepScore,
  });

export const joinGame = (code: string, displayName: string, role: 'tracker' | 'spectator' | 'scorekeeper') =>
  rpc<{ game_id: string; code: string; scorekeeper: 'assigned' | 'requested' | null }>('join_game', { p_code: code, p_display_name: displayName, p_role: role });

/** Organizer: takes the role immediately. Anyone else: files a request for the organizer to approve. */
export const requestScorekeeper = (gameId: string) => rpc<'assigned' | 'requested'>('request_scorekeeper', { p_game: gameId });
export const respondScorekeeperRequest = (gameId: string, approve: boolean) => rpc('respond_scorekeeper_request', { p_game: gameId, p_approve: approve });
export const setScorekeeper = (gameId: string, userId: string | null) => rpc('set_scorekeeper', { p_game: gameId, p_user: userId });
export const setPeriod = (gameId: string, period: number) => rpc('set_period', { p_game: gameId, p_period: period });
export const finishGame = (gameId: string) => rpc('finish_game', { p_game: gameId });
export const reopenGame = (gameId: string) => rpc('reopen_game', { p_game: gameId });

/** Server decides primary/backup. */
export const startTracking = (gameId: string, playerIds: string[]) =>
  playerIds.length ? rpc('start_tracking', { p_game: gameId, p_players: playerIds }) : Promise.resolve(null);
export const stopTracking = (gameId: string, playerIds: string[]) =>
  playerIds.length ? rpc('stop_tracking', { p_game: gameId, p_players: playerIds }) : Promise.resolve(null);

export async function addPlayer(gameId: string, teamId: string, jersey: number, name: string) {
  const { error } = await supabase.from('players').insert({ game_id: gameId, team_id: teamId, jersey, name });
  if (error) throw error;
}

// Local helpers
export const getName = () => localStorage.getItem('courtsync:name') || '';
export const saveName = (n: string) => localStorage.setItem('courtsync:name', n.trim());

export interface RecentGame { code: string; title: string; ts: number }
export function rememberGame(code: string, title: string) {
  const list = recentGames().filter((g) => g.code !== code);
  list.unshift({ code, title, ts: Date.now() });
  try { localStorage.setItem('courtsync:recent', JSON.stringify(list.slice(0, 8))); } catch { /* ignore */ }
}
export function recentGames(): RecentGame[] {
  try { return JSON.parse(localStorage.getItem('courtsync:recent') || '[]'); } catch { return []; }
}
export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const isValidCode = (c: string) => /^[A-Z0-9]{6}$/.test(c);
export const formatCode = (c: string) => (c.length === 6 ? c.slice(0, 3) + '-' + c.slice(3) : c);
export const vibrate = () => { try { navigator.vibrate?.(15); } catch { /* not supported */ } };
