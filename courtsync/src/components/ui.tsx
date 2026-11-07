import { t, tr, useLanguage } from '../lib/i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowClockwise, CloudArrowUp, CloudCheck, CloudSlash, Trash, WarningCircle } from '@phosphor-icons/react';
import type { ReadyGame } from '../lib/useGame';
import { STAT_LABEL, timeOf, type StatType } from '../lib/stats';
import type { OutboxItem } from '../lib/outbox';

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true"><div className="grab" />{children}</div>
    </>
  );
}

/** Compact, non-blocking sync indicator. Tap for details, retry and rejected-event review. */
export function SyncBadge({ g }: { g: ReadyGame }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const { sync, pending, rejectedItems } = g;
  let body: ReactNode;
  if (rejectedItems.length) body = <span className="tag accent"><WarningCircle size={14} />{rejectedItems.length} to review</span>;
  else if (sync === 'offline') body = <span className="tag"><CloudSlash size={14} />{pending || t("Offline")}</span>;
  else if (sync !== 'live') body = <span className="tag"><CloudArrowUp size={14} />{pending || '…'}</span>;
  else if (pending) body = <CloudArrowUp size={18} />;
  else body = <CloudCheck size={18} />;
  const title = rejectedItems.length ? t("Some events were not accepted") : sync === 'offline' ? 'Offline: saved on this device' : pending ? `Sending ${pending}` : sync === 'live' ? t("All changes synced") : t("Connecting");
  return (
    <>
      <button className="iconbtn" style={{ width: 'auto', minWidth: 36, padding: '0 4px' }} title={title} aria-label={title} onClick={() => setOpen(true)}>{body}</button>
      {open && <SyncSheet g={g} onClose={() => setOpen(false)} />}
    </>
  );
}

function describe(g: ReadyGame, it: OutboxItem): string {
  const r = it.row as Record<string, unknown>;
  const d = g.derived;
  if (it.table === 'stat_events') {
    const p = d.playerById.get(String(r.player_id));
    return `#${p?.jersey ?? '?'} ${tr(STAT_LABEL[r.type as StatType]) ?? r.type}`;
  }
  if (it.table === 'stat_corrections') return r.action === 'change_type' ? `Edit → ${tr(STAT_LABEL[r.new_type as StatType])}` : r.action === 'void' ? t("Undo / remove event") : t("Restore event");
  const side = r.side === 'home' || r.side === 'away' ? d.team(r.side).name : '';
  if (r.kind === 'void') return `Void score entry · ${side}`;
  if (r.kind === 'restore') return `Restore score entry · ${side}`;
  const n = Number(r.delta);
  return `Official score ${n > 0 ? '+' : '−'}${Math.abs(n)} ${side}`;
}

function SyncSheet({ g, onClose }: { g: ReadyGame; onClose: () => void }) {
  useLanguage();
  const { sync, pendingItems, rejectedItems, syncError } = g;
  const status = sync === 'live' ? 'Connected · live updates on' : sync === 'offline' ? 'Offline · events are saved on this device' : 'Reconnecting…';
  return (
    <Sheet onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>{t("Sync")}</h3><button className="btn small" onClick={onClose}>{t("Close")}</button></div>
      <p className="small muted">{status}</p>

      <div className="label">Waiting to send · {pendingItems.length}</div>
      {pendingItems.length > 0 ? (
        <>
          <div className="col" style={{ gap: 0 }}>
            {pendingItems.slice(0, 20).map((it) => (
              <div key={it.row.id} className="list-row rule">
                <span className="small muted num" style={{ width: 52 }}>{timeOf(String(it.row.client_ts))}</span>
                <span className="grow">{describe(g, it)}</span>
                {it.attempts > 0 && <span className="small muted">{it.attempts} tries</span>}
              </div>
            ))}
          </div>
          {syncError && <p className="small muted">Last error: {syncError}</p>}
          <button className="btn block" onClick={() => g.retryNow()}><ArrowClockwise />{t("Send now")}</button>
        </>
      ) : <p className="small muted">{t("Nothing waiting.")}</p>}

      <div className="label">Not accepted · {rejectedItems.length}</div>
      {rejectedItems.length > 0 ? (
        <>
          <p className="small muted">The server refused these, usually because you were no longer tracking that player, you are not the scorekeeper, or the game was finished. Retry after fixing the cause, or discard.</p>
          <div className="col" style={{ gap: 0 }}>
            {rejectedItems.map((it) => (
              <div key={it.row.id} className="list-row rule" style={{ alignItems: 'flex-start' }}>
                <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
                  <span>{describe(g, it)}</span>
                  <span className="small muted">{timeOf(String(it.row.client_ts))} · {it.error}</span>
                </span>
                <button className="btn small" onClick={() => g.retryRejected(it.row.id)}><ArrowClockwise />{t("Retry")}</button>
                <button className="btn small" onClick={() => g.discardRejected(it.row.id)} aria-label="Discard"><Trash /></button>
              </div>
            ))}
          </div>
        </>
      ) : <p className="small muted">{t("None.")}</p>}
    </Sheet>
  );
}

export function Splash({ text = 'Loading…' }: { text?: string }) {
  useLanguage();
  return <div className="center"><p className="muted">{tr(text)}</p></div>;
}

/** Keeps the screen on while recording (where supported). */
export function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const req = async () => { try { lock = (await nav.wakeLock?.request('screen')) ?? null; } catch { /* denied */ } };
    void req();
    const vis = () => { if (document.visibilityState === 'visible') void req(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release(); };
  }, []);
}

export function toggleSun() {
  const on = document.documentElement.classList.toggle('sun');
  try { localStorage.setItem('courtsync:sun', on ? '1' : '0'); } catch { /* ignore */ }
}
