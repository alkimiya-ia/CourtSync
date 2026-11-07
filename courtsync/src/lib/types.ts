import type { StatType } from './stats';

export type Side = 'home' | 'away';
export type Role = 'organizer' | 'tracker' | 'scorekeeper' | 'spectator';

export interface Game {
  id: string;
  code: string;
  periods: number;
  current_period: number;
  status: 'live' | 'final';
  organizer_id: string;
  scorekeeper_id: string | null;
  scorekeeper_request_id: string | null;
  scorekeeper_requested_at: string | null;
  created_at: string;
  expires_at: string;
  finished_at: string | null;
}
export interface Team { id: string; game_id: string; side: Side; name: string }
export interface Player { id: string; game_id: string; team_id: string; jersey: number; name: string }
export interface Participant { game_id: string; user_id: string; display_name: string; role: Role; joined_at: string }
export interface Assignment {
  id: string; game_id: string; player_id: string; user_id: string;
  role: 'primary' | 'backup'; created_at: string; ended_at: string | null;
}
export interface StatEvent {
  id: string; seq?: number | null; game_id: string; player_id: string; user_id: string;
  type: StatType; period: number; client_ts: string; pending?: boolean;
}
export interface StatCorrection {
  id: string; seq?: number | null; game_id: string; event_id: string; user_id: string;
  action: 'void' | 'restore' | 'change_type'; new_type: StatType | null; client_ts: string; pending?: boolean;
}
export interface ScoreEvent {
  id: string; seq?: number | null; game_id: string; side: Side;
  kind: 'score' | 'adjust' | 'void' | 'restore'; delta: number; target_id: string | null;
  user_id: string; period: number; client_ts: string; pending?: boolean;
}
