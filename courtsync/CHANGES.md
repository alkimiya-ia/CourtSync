# CourtSync v0.2 — changes from v0.1

Nothing in this release has been compiled, type-checked, or run against Supabase. The changes were made by reading and editing the code. Run `npm install && npm run typecheck && npm run build`, apply the migration to a fresh Supabase project, and run the README acceptance test before game day.

## Database — `supabase/migrations/20261107000000_init.sql` (rewritten)

v0.1 was never deployed, so the single init migration was replaced rather than adding an incremental one. **If you already applied v0.1 to a project, reset that database** (or use a new project) before applying this file.

1. **Stat events need an assignment** (`stat_events_insert` policy and the new `was_tracking()` helper). The author must be the caller, in an open game. An *active* assignment always qualifies, regardless of the device clock. An *ended* assignment qualifies only for events whose `client_ts` falls inside that assignment's window (±2 min), and only within 12 h of the stop. That lets offline backlog sync but stops a former tracker from backdating events. `client_ts` must be between 1 day ago and 10 minutes from now. **Explicit exception:** the organizer may record for any player.
2. **Corrections restricted** (`corrections_insert`). Only the event's original author or the organizer may correct it, and only in an open game. The composite FK `(event_id, game_id) → stat_events(id, game_id)` makes cross-game corrections impossible at the constraint level. A check now requires `new_type` if and only if `action = 'change_type'`.
3. **Tracker assignments are server-controlled.** The client INSERT/UPDATE policies and the role trigger were removed, and the table privileges revoked. New `start_tracking(game, players[])` and `stop_tracking(game, players[])` RPCs lock the player row, decide primary/backup, and promote the oldest backup when a primary stops. A unique partial index allows one active primary per player. Users can't change their own or anyone else's role.
4. **Scorekeeper policy.** New `games.scorekeeper_request_id` and `scorekeeper_requested_at` columns.
   - A non-organizer who asks (at join, or later) creates a request. They do not get the role.
   - `respond_scorekeeper_request(game, approve)` is organizer-only and atomic (row lock plus a single update).
   - `set_scorekeeper` (organizer) assigns, transfers or clears the role.
   - The organizer gets the role immediately when they ask.
   - `claim_scorekeeper` (first-come) was removed.
   - A CHECK prevents the same user being both scorekeeper and requester.
5. **Game lifetime.** New `games.expires_at` (2 days). `game_open()` requires `status = 'live'` and an unexpired game; every write path checks it. `join_game` lets newcomers join a finished or expired game only as spectators, and raises `GAME_CLOSED` otherwise. `reopen_game` extends the expiry.
6. **`game_preview(code)` RPC** returns found / status / expired / member / team names, so the app can explain bad codes and closed games before joining.
7. **Hardening:**
   - Every SECURITY DEFINER function uses `set search_path = ''` with schema-qualified names.
   - `EXECUTE` is revoked from PUBLIC, anon and authenticated on all functions, then granted only on the RLS helpers and public RPCs. `gen_game_code` and `normalize_code` are internal.
   - Table privileges are revoked: no client INSERT/UPDATE/DELETE on `games`, `teams`, `game_participants` or `tracker_assignments`, and no UPDATE/DELETE on `players` or the event tables.
   - Composite foreign keys ensure players, assignments, events, corrections and score-event targets all belong to the same game.
   - Score void/restore must target a `score`/`adjust` row on the same side.
   - Input validation in `create_game` (lengths, periods, player count, side) and in `join_game` (name).
   - Game creation is atomic. Joining as scorekeeper while another request is pending rolls back the whole join.

## Frontend

| File | Change | Why |
| --- | --- | --- |
| `src/lib/outbox.ts` | Rejected rows are persisted in `localStorage` (`courtsync:rejected:<game>`) with error, code and time. New `retryRejected`, `discardRejected`, `retryNow`, `dispose`. Empty queues remove their storage key. | Item 5: rejected events survived only in memory and were lost on reload, with no way to review them. |
| `src/components/ui.tsx` | `SyncBadge` is now a button that opens a **Sync sheet**: connection state, the waiting queue with attempt counts, "Send now", and the "Not accepted" list with Retry / Discard per item and the server's reason. | Item 5: expose errors and give a safe retry/review workflow. |
| `src/lib/useGame.ts` | Exposes `pendingItems`, `rejectedItems`, `retryNow`, `retryRejected`, `discardRejected`. Derived state adds `expired`, `hasRequestedScorekeeper` and `canCorrect()` (mirrors the RLS rule); `live` and `isScorekeeper` account for expiry. Realtime handler typing reworked (no `as never` casts on a key that could be `game`). Load errors pass through `friendlyError`. `ReadyGame` is built with `Omit` instead of an intersection of conflicting types. | Items 1, 2, 4, 5, 6, 8. |
| `src/lib/api.ts` | `startTracking` / `stopTracking` call the new RPCs and take player ids. Added `gamePreview`, `requestScorekeeper`, `respondScorekeeperRequest` and `isValidCode`. Removed `claimScorekeeper`. | Items 3, 4, 6. |
| `src/lib/supabase.ts` | `friendlyError` maps the new SQL errors (`GAME_CLOSED`, `SCOREKEEPER_REQUEST_PENDING`, `PLAYER_NOT_IN_GAME`, `NO_REQUEST`, `INVALID_*`, `NOT_PARTICIPANT`) plus RLS `42501` and unique-violation `23505`. | Item 6. |
| `src/lib/types.ts` | `Game` gains `scorekeeper_request_id`, `scorekeeper_requested_at`, `expires_at`. | Schema change. |
| `src/pages/GameRoute.tsx` | Malformed codes show "That isn't a game code". The join gate calls `game_preview`: unknown code → "Game not found"; finished/expired → join as viewer only ("View results"); load errors → message with "Try again". New organizer banner to approve/decline scorekeeper requests on every screen. `rememberGame` moved out of render into an effect. `React.ReactNode` (UMD global, a compile error in modules) replaced with an imported `ReactNode`. | Items 4, 6, 8. |
| `src/pages/Pick.tsx` | Uses the tracking RPCs. Redirects to the box score when the game is closed. | Items 3, 6. |
| `src/pages/Live.tsx` | The edit sheet disables change/remove for events you didn't record (unless you're the organizer) and says who can. Closed-game message covers expiry. Guard against a missing player row instead of a non-null assertion crash. | Items 2, 6, 8. |
| `src/pages/Score.tsx` | "I'll keep score" became a request flow: "Ask to keep score" / "Ask to take over" / "Keep score myself" (organizer), plus a "Request sent, waiting for organizer" state. | Item 4. |
| `src/pages/Box.tsx` | Request instead of claim. Participant list shows who asked to keep score. Closed state covers expiry (EXPIRED tag; the organizer can "Extend game by a day"). | Items 4, 6. |
| `README.md` | Status line, acceptance-test step 4 (organizer approval), new checks (rejected writes, bad links), and an updated security description. | Docs. |

Unchanged: `Home.tsx`, `Create.tsx`, `Share.tsx`, `stats.ts`, `styles.css`, `App.tsx`, `main.tsx` and build config. The recording, scorekeeper and box-score layouts are unchanged apart from the controls noted above.

## Known gaps (not addressed in this release)

- No automated tests. The acceptance test in the README is manual.
- No duplicate-observation review between primary and backup trackers; both are counted.
- Anonymous identities are per browser; clearing site data loses access to earlier games.
- `npm run build` does not type-check; run `npm run typecheck` separately.
