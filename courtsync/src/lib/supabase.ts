import { t } from './i18n';
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configMissing = !url || !key;

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'courtsync-auth' },
  realtime: { params: { eventsPerSecond: 20 } },
});

let sessionPromise: Promise<string> | null = null;

/** Returns the current user id, signing in anonymously on first use. Session persists in localStorage. */
export function ensureUser(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) return data.session.user.id;
      const { data: signed, error } = await supabase.auth.signInAnonymously();
      if (error || !signed.user) {
        sessionPromise = null;
        throw error ?? new Error('Sign-in failed');
      }
      return signed.user.id;
    })();
  }
  return sessionPromise;
}

/** Human-readable message for RPC/PostgREST errors raised by our SQL functions and policies. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  const msg = err?.message ?? String(e);
  const code = err?.code ?? '';
  const map: [string, string][] = [
    ['GAME_NOT_FOUND', 'No game found with that code. Check the code and try again.'],
    ['GAME_CLOSED', 'This game has finished or expired. You can still view the results.'],
    ['SCOREKEEPER_REQUEST_PENDING', 'Someone else has already asked to keep score. Ask the organizer, or join as a tracker.'],
    ['NO_REQUEST', 'There is no pending scorekeeper request.'],
    ['NOT_ORGANIZER', 'Only the organizer can do that.'],
    ['NOT_PARTICIPANT', 'You are not part of this game.'],
    ['NOT_ALLOWED', 'You do not have permission for that.'],
    ['PLAYER_NOT_IN_GAME', 'That player is not in this game.'],
    ['INVALID_NAME', 'Enter a name between 1 and 40 characters.'],
    ['INVALID_INPUT', 'Some of the details are not valid. Check names, periods and jersey numbers.'],
    ['NOT_AUTHENTICATED', 'Could not sign you in. Reload the page and try again.'],
  ];
  for (const [k, v] of map) if (msg.includes(k)) return t(v);
  if (code === '42501' || msg.includes('row-level security')) return t("Not allowed: you may not be tracking this player, or the game is closed.");
  if (code === '23505') return t("That already exists (for example, a duplicate jersey number).");
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) return t("No connection. Try again when you are online.");
  if (msg.toLowerCase().includes('anonymous sign-ins are disabled')) return t("Anonymous sign-in is disabled in Supabase (Auth → Providers → Anonymous).");
  return msg;
}
