import { t, tr, useLanguage } from '../lib/i18n';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CaretLeft, CheckSquare, Plus, Square } from '@phosphor-icons/react';
import { useGameCtx } from '../lib/useGame';
import { addPlayer, joinGame, startTracking, stopTracking } from '../lib/api';
import { friendlyError } from '../lib/supabase';
import type { Side } from '../lib/types';

export default function Pick() {
  useLanguage();
  const g = useGameCtx();
  const nav = useNavigate();
  const { data, derived: d, userId } = g;
  const mineIds = new Set(d.myAssignments.map((a) => a.player_id));
  const [side, setSide] = useState<Side>(() => (d.myAssignments[0] ? d.sideOfPlayer(d.myAssignments[0].player_id) : 'home'));
  const [sel, setSel] = useState<Set<string>>(() => new Set(mineIds));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [newNum, setNewNum] = useState('');
  const [newName, setNewName] = useState('');

  const team = d.team(side);
  const roster = data.players.filter((p) => p.team_id === team.id).sort((a, b) => a.jersey - b.jersey);
  const others = (pid: string) => d.activeAssignments.filter((a) => a.player_id === pid && a.user_id !== userId);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const start = async () => {
    setBusy(true); setErr('');
    try {
      await stopTracking(data.game.id, d.myAssignments.filter((a) => !sel.has(a.player_id)).map((a) => a.player_id));
      await startTracking(data.game.id, [...sel].filter((id) => !mineIds.has(id)));
      await g.reload();
      nav('../play');
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };

  const add = async () => {
    const n = Number(newNum);
    if (newNum === '' || roster.some((p) => p.jersey === n)) { setErr('That number is already on this team.'); return; }
    try { await addPlayer(data.game.id, team.id, n, newName.trim()); setNewNum(''); setNewName(''); setErr(''); await g.reload(); }
    catch (e) { setErr(friendlyError(e)); }
  };

  if (!d.live) return <Navigate to="../box" replace />;

  if (d.me?.role === 'spectator') {
    return (
      <div className="screen">
        <div className="topbar"><button className="backbtn" onClick={() => nav('../box')}><CaretLeft size={20} />{t("Box score")}</button></div>
        <h2>{t("You joined as a spectator")}</h2>
        <p className="muted">{t("Switch to tracker to record player stats.")}</p>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" onClick={async () => {
          try { await joinGame(data.game.code, d.me!.display_name, 'tracker'); await g.reload(); } catch (e) { setErr(friendlyError(e)); }
        }}>{t("Become a tracker")}</button>
      </div>
    );
  }

  return (
    <div className="screen" style={{ paddingBottom: 0 }}>
      <div className="topbar"><button className="backbtn" onClick={() => nav(d.myAssignments.length ? '../play' : '../box')}><CaretLeft size={20} />{d.myAssignments.length ? t("Record") : t("Box score")}</button></div>
      <div className="col" style={{ gap: 4 }}>
        <h2>{t("Who are you tracking?")}</h2>
        <p className="muted">{t("Pick one or more. You can switch later.")}</p>
      </div>
      <div className="seg">
        {(['home', 'away'] as Side[]).map((s) => <button key={s} aria-pressed={side === s} onClick={() => setSide(s)} className="ellipsis">{d.team(s).name}</button>)}
      </div>
      <div className="col" style={{ gap: 6 }}>
        {roster.length === 0 && <p className="muted small">{t("No players on this team yet.")}</p>}
        {roster.map((p) => {
          const o = others(p.id);
          const on = sel.has(p.id);
          return (
            <button key={p.id} className="pick-row" aria-pressed={on} onClick={() => toggle(p.id)}>
              <span className="jersey">{p.jersey}</span>
              <span className="grow col" style={{ gap: 0 }}>
                <span>{p.name || t("Player #") + p.jersey}</span>
                <span className="small muted">{o.length ? t("Tracked by ") + o.map((a) => d.nameOf(a.user_id)).join(', ') + (on && !mineIds.has(p.id) ? t(" · you’ll be backup") : '') : t('Nobody tracking')}</span>
              </span>
              {on ? <CheckSquare size={24} weight="fill" color="var(--accent)" /> : <Square size={24} color="var(--n600)" />}
            </button>
          );
        })}
      </div>
      {d.isOrganizer && (
        <div className="row">
          <input className="input num" style={{ width: 64, textAlign: 'center', padding: 0 }} placeholder="#" inputMode="numeric" maxLength={2} value={newNum} onChange={(e) => setNewNum(e.target.value.replace(/\D/g, ''))} />
          <input className="input grow" placeholder={t("Add player (first name)")} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
          <button className="iconbtn" aria-label={t("Add player")} disabled={newNum === ''} onClick={add}><Plus /></button>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', padding: '12px 0 20px', background: 'var(--bg)' }}>
        <button className="btn primary block" disabled={!sel.size || busy} onClick={start}>
          {busy ? t("Saving…") : sel.size === 0 ? t("Pick at least one player") : sel.size === 1 ? t("Start tracking") : tr(`Track ${sel.size} players`)}
        </button>
      </div>
    </div>
  );
}
