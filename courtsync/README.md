# CourtSync

Collaborative live basketball stat tracking. Parents and coaches join a game by link, QR code or code, each track one or more players with one-tap buttons, and a designated scorekeeper keeps the official score. Everything syncs live between phones through Supabase.

**Stack:** React 18 + TypeScript + Vite · Supabase (Postgres, anonymous auth, Realtime, RLS) · Cloudflare Pages.

> Status: v0.2 (security hardening, see `CHANGES.md`). It has **not yet been built, type-checked or run against a live Supabase project**. Do the setup below, run `npm run typecheck` and `npm run build`, then the acceptance test, before the first game.

---

## 1. Supabase setup (about 10 minutes)

1. Create a project at https://supabase.com (pick the region closest to your players).
2. **Enable anonymous sign-ins:** Authentication → Sign In / Providers → *Allow anonymous sign-ins* → on.
3. **Raise the anonymous sign-in rate limit:** Authentication → Rate Limits → *Anonymous users*. The default (30 per hour per IP) is too low when a whole gym shares one Wi-Fi. Set it to at least 200.
4. **Create the schema.** Either:
   - Dashboard: SQL Editor → paste `supabase/migrations/20261107000000_init.sql` → Run, or
   - CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
5. **Check Realtime:** Database → Publications → `supabase_realtime` should list `games, players, game_participants, tracker_assignments, stat_events, stat_corrections, score_events`. The migration adds them.
6. Copy **Project URL** and the **anon public key** from Project Settings → API. Do **not** use the `service_role` key anywhere in this app.

## 2. Run locally

```bash
npm install
cp .env.example .env.local      # then paste your URL and anon key
npm run dev -- --host           # --host lets phones on the same Wi-Fi open it
npm run typecheck               # optional strict type check
npm run build                   # production build into dist/
```

## 3. Deploy to Cloudflare Pages

1. Push this folder to `alkimiya-ia/CourtSync` (main branch):
   ```bash
   git init && git add . && git commit -m "CourtSync MVP"
   git branch -M main
   git remote add origin https://github.com/alkimiya-ia/CourtSync.git
   git push -u origin main
   ```
2. Cloudflare dashboard → Workers & Pages → Create → Pages → *Connect to Git* → choose `CourtSync`.
3. Build settings: Framework preset **Vite**, build command `npm run build`, output directory `dist`.
4. Environment variables (Production *and* Preview):
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
   - `NODE_VERSION` = `20`
5. Deploy. `public/_redirects` makes deep links like `/g/ABC123` work.
6. Optional: in Supabase → Authentication → URL Configuration, set *Site URL* to your Pages URL.

The deployed URL will look like `https://courtsync.pages.dev` (or `https://courtsync-xyz.pages.dev`).

## 4. Acceptance test (do this before game day)

Use four devices or four separate browser profiles / private windows (each gets its own anonymous user).

| Step | Who | Action | Expected |
| --- | --- | --- | --- |
| 1 | A | Home → *Create a game*. Teams "Hawks" / "Rockets". Hawks add #23, Rockets add #12. Name "Organizer". Create. | Share screen with code, link and QR. |
| 2 | B | Open the link. Name "Parent B", *Track players* → Join. Pick Hawks #23 → Start tracking. | Recording screen for #23. |
| 3 | C | Open the link. Name "Parent C", *Track players*. Pick Rockets #12. | Recording screen for #12. |
| 4 | D, then A | D opens the link, name "Scorer", *Keep the official score*. A sees a banner "Scorer wants to keep the official score" and taps **Approve**. | D's screen unlocks with +1/+2/+3. A's box score shows "Official · Scorer". |
| 5 | B | Tap **2 PT Made**. | Flash + "#23 2PT made +2" bar. Within ~1 s the status shows synced. |
| 6 | A, C, D | Open Box score. | #23 shows 2 PTS on every device without refreshing. Player pts Hawks = 2. |
| 7 | D | Tap **+2** under Hawks. | Official score 2–0 on every device; the B and C top bars update. |
| 8 | all | Check scoreboard. | Hawks 2 official, player pts 2, no discrepancy shown. |

Extra checks worth doing:

- **Reconnect:** put B in airplane mode, record 3 events (status shows a cloud with a count), turn the network back on. The events appear on the other devices and nothing is duplicated.
- **Undo:** B taps Undo. #23 drops back on every device; Box → game history shows it struck through.
- **Permissions:** C opens `/g/<code>/score`. The buttons are hidden and the screen says who keeps score. In B's history sheet, events recorded by C can be viewed but not edited.
- **Rejected writes:** put B offline, record an event for #23, then (still offline) go to Pick, untick #23 and tick another player. Back online, the #23 event should still be accepted (it was recorded while tracking). Anything the server refuses appears under the sync icon as "to review" with Retry / Discard and survives a page reload.
- **Bad links:** open `/g/XXXXXX` (unknown code) and `/g/abc` (malformed). Both show a clear message, not a blank page.
- **Finish:** A → Box score → *Finish game*. Recording buttons disable everywhere; results stay viewable.

## 5. How it works

- **Events, not totals.** Every tap inserts one immutable row in `stat_events` with a client-generated UUID. Undo and edits insert rows in `stat_corrections`. Totals, percentages and box scores are computed from events in the app.
- **Official score is separate.** The scorekeeper's +1/+2/+3 go to `score_events`; player stats never change it. The UI shows the difference between official and player points without changing either value.
- **Idempotent sync.** Writes go to a local queue in `localStorage` first (`src/lib/outbox.ts`), then are sent with `INSERT … ON CONFLICT (id) DO NOTHING`. Retries can't create duplicates. Failed sends retry with backoff (1 s → 30 s) and again on reconnect/foreground.
- **Live updates.** Each device subscribes to Supabase Realtime for its game (`src/lib/useGame.ts`). On every (re)subscribe it refetches the full game state, so anything missed while disconnected is reconciled. If Realtime is down it polls every 10 s.
- **Rejected writes are kept.** If the server refuses a queued row (RLS, constraint), it moves to a persisted "not accepted" list (tap the sync icon) where it can be retried or discarded. Nothing is dropped silently.
- **Permissions (RLS).** Only participants can read a game. A stat event can only be inserted by its author, in an open game, for a player the author is (or was, at that moment) assigned to track; the organizer is the one explicit exception and may record for any player. Corrections are limited to the event's original author or the organizer, in the same game. Only the user in `games.scorekeeper_id` can insert score events. All other writes go through security-definer RPCs (empty `search_path`, explicit checks); clients have no UPDATE/DELETE on any table.
- **Tracking roles.** `start_tracking` / `stop_tracking` RPCs decide primary/backup on the server (row-locked, one primary per player enforced by a unique index). When a primary stops, the oldest backup is promoted. Clients cannot write assignments directly.
- **Scorekeeper.** Non-organizers *request* the role; the organizer approves or declines (banner on every screen), or assigns / transfers / removes it from the box score. Approval is a single locked update.
- **Game lifetime.** Games expire 2 days after creation (`games.expires_at`). Finished or expired games are read-only; newcomers can only join to view results. The organizer can reopen/extend.

### Data model

`games` · `teams` (home/away) · `players` · `game_participants` · `tracker_assignments` · `stat_events` · `stat_corrections` · `score_events`. See the migration for columns, constraints and policies.

### Privacy

Players are records, not accounts. Use first names or initials only. Game data is visible only to people who joined that game. Nothing is public.

## 6. Known limitations (MVP)

- **Offline:** events are queued locally and retried. This path is implemented but **untested on real devices**, so treat it as best effort until the reconnect check above passes. Closing the tab while offline keeps the queue in `localStorage`; it is sent the next time that game is opened.
- No duplicate-observation review between primary and backup trackers yet (both are counted). Agree in the gym that one person tracks each player.
- No game clock; events record period + device time. The scorekeeper or organizer advances the period.
- Anonymous identities live in the browser. Clearing site data or switching browser loses the link to earlier games.
- Haptics depend on the device (Android vibrates; iOS Safari does not support the Vibration API).
