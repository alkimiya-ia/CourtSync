import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowCounterClockwise, CaretRight, CheckCircle, PlusMinus, Plus, Sun, Table, Trash } from '@phosphor-icons/react';
import { useGameCtx } from '../lib/useGame';
import { lineOf, pct, periodLabel, STAT_LABEL, STAT_POINTS, STAT_TYPES, timeOf, type StatType } from '../lib/stats';
import { vibrate } from '../lib/api';
import { Sheet, SyncBadge, toggleSun, useWakeLock } from '../components/ui';

type SheetState = null | 'history' | { edit: string };

export default function Live() {
  const g = useGameCtx();
  const nav = useNavigate();
  const { data, derived: d, userId } = g;
  useWakeLock();

  const storeKey = 'courtsync:cur:' + data.game.id;
  const [cur, setCur] = useState<string | null>(() => localStorage.getItem(storeKey));
  const [sheet, setSheet] = useState<SheetState>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: StatType; n: number } | null>(null);
  const [undone, setUndone] = useState<string | null>(null);
  const lastTap = useRef<{ k: string; t: number }>({ k: '', t: 0 });
  const freshTimer = useRef<number>();

  const mine = d.myAssignments;
  const curId = mine.some((a) => a.player_id === cur) ? cur! : mine[0]?.player_id;
  useEffect(() => { if (curId) localStorage.setItem(storeKey, curId); }, [curId, storeKey]);

  if (!mine.length) return <Navigate to="../pick" replace />;
  const player = d.playerById.get(curId!);
  if (!player) return <div className="center"><p className="muted">Loading player…</p></div>;
  const myRole = mine.find((a) => a.player_id === curId)?.role ?? 'primary';
  const playerEvents = d.effEvents.filter((e) => e.player_id === curId);
  const line = lineOf(playerEvents.filter((e) => !e.voided));
  const mineSet = new Set(mine.map((a) => a.player_id));
  const last = [...d.effEvents].reverse().find((e) => e.user_id === userId && mineSet.has(e.player_id) && !e.voided);
  const undoneEv = undone ? d.effEvents.find((e) => e.id === undone) : undefined;
  const pLabel = periodLabel(data.game.current_period, data.game.periods);
  const disabled = !d.canRecord;

  const tap = (type: StatType) => {
    if (disabled || !curId) return;
    const k = curId + type, t = Date.now();
    if (lastTap.current.k === k && t - lastTap.current.t < 350) return; // double-tap guard
    lastTap.current = { k, t };
    const id = g.recordStat(curId, type);
    vibrate();
    setUndone(null);
    setFlash({ type, n: t });
    setFresh(id);
    window.clearTimeout(freshTimer.current);
    freshTimer.current = window.setTimeout(() => setFresh(null), 2500);
  };
  const undo = () => { if (!last) return; g.correct(last.id, 'void'); setUndone(last.id); setFresh(null); vibrate(); };
  const restore = () => { if (!undoneEv) return; g.correct(undoneEv.id, 'restore'); setUndone(null); };

  const btn = (type: StatType, label?: string, cls = '') => (
    <button key={type} className={'sbtn ' + cls} onClick={() => tap(type)} disabled={disabled}>
      {label ?? STAT_LABEL[type]}
      {!cls && <small>{line.c[type]}</small>}
      {flash?.type === type && <span key={flash.n} className="flash">{STAT_POINTS[type] ? '+' + STAT_POINTS[type] : '✓'}</span>}
    </button>
  );

  const editEv = sheet && typeof sheet === 'object' ? d.effEvents.find((e) => e.id === sheet.edit) : undefined;
  const canEdit = !!editEv && d.canCorrect(editEv);

  return (
    <div className="screen tight">
      <div className="topbar" style={{ height: 44, margin: '0 -4px' }}>
        <button className="backbtn grow num" style={{ minWidth: 0, fontSize: 15, justifyContent: 'flex-start' }} onClick={() => nav('../box')} title="Scoreboard and box score">
          <span className="ellipsis">{d.team('home').name.slice(0, 3).toUpperCase()} {d.score.home} – {d.score.away} {d.team('away').name.slice(0, 3).toUpperCase()}</span>
          {data.game.scorekeeper_id ? <span className="small muted">{pLabel}</span> : <span className="tag dashed">UNVERIFIED</span>}
        </button>
        <SyncBadge g={g} />
        {d.isScorekeeper && <button className="iconbtn" title="Scorekeeper" onClick={() => nav('../score')} style={{ color: 'var(--a300)' }}><PlusMinus /></button>}
        <button className="iconbtn" title="Box score" onClick={() => nav('../box')}><Table /></button>
        <button className="iconbtn" title="Sunlight mode" onClick={toggleSun}><Sun /></button>
      </div>

      {!d.live && <div className="error">This game is {data.game.status === 'final' ? 'finished' : 'closed (link expired)'}. Stats are read-only.</div>}
      {disabled && d.live && <div className="error">You joined as a spectator. Switch to tracker to record.</div>}

      <div className="chips">
        {mine.map((a) => {
          const p = d.playerById.get(a.player_id)!;
          const pts = lineOf(d.effEvents.filter((e) => e.player_id === a.player_id && !e.voided)).pts;
          return (
            <button key={a.id} className="chip" aria-pressed={a.player_id === curId} onClick={() => { setCur(a.player_id); setUndone(null); setFresh(null); }}>
              <span className="n">{p.jersey}</span>
              <span className="t"><span className="ellipsis" style={{ maxWidth: 110 }}>{p.name || '#' + p.jersey}</span><small>{pts} pts · {a.role}</small></span>
            </button>
          );
        })}
        <button className="chip" style={{ borderStyle: 'dashed', borderColor: 'var(--n600)', padding: '0 14px' }} onClick={() => nav('../pick')}><Plus />Player</button>
      </div>

      <button className="statpanel" onClick={() => setSheet('history')}>
        <span className="row small muted" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span className="ellipsis">#{player.jersey} {player.name.toUpperCase()} · {d.team(d.sideOfPlayer(player.id)).name.toUpperCase()} · {myRole.toUpperCase()}</span>
          <span className="row" style={{ gap: 2 }}>History<CaretRight /></span>
        </span>
        <span className="top">
          <span className="row" style={{ alignItems: 'baseline', gap: 5 }}><b style={{ fontSize: 32, fontWeight: 500, lineHeight: 1 }}>{line.pts}</b><span className="k">PTS</span></span>
          {([['REB', line.reb], ['AST', line.c.AST], ['STL', line.c.STL], ['BLK', line.c.BLK], ['TO', line.c.TOV], ['PF', line.c.PF]] as const).map(([k, v]) => (
            <span key={k} className="cell"><b>{v}</b><span className="k">{k}</span></span>
          ))}
        </span>
        <span className="shoot">
          <span><span className="k">FG </span>{line.fgm}/{line.fga} <span className="muted small">{pct(line.fgm, line.fga)}</span></span>
          <span><span className="k">2P </span>{line.fg2m}/{line.fg2a} <span className="muted small">{pct(line.fg2m, line.fg2a)}</span></span>
          <span><span className="k">3P </span>{line.fg3m}/{line.fg3a} <span className="muted small">{pct(line.fg3m, line.fg3a)}</span></span>
          <span><span className="k">FT </span>{line.ftm}/{line.fta} <span className="muted small">{pct(line.ftm, line.fta)}</span></span>
        </span>
      </button>

      <div className={'lastbar' + (fresh && last?.id === fresh ? ' fresh' : '')}>
        {undoneEv ? (
          <>
            <Trash size={18} className="muted" />
            <span className="grow ellipsis">Removed {STAT_LABEL[undoneEv.type]} · #{d.playerById.get(undoneEv.player_id)?.jersey}</span>
            <button className="btn small" onClick={restore}>Restore</button>
          </>
        ) : last ? (
          <>
            <CheckCircle size={20} weight="fill" color="var(--accent)" />
            <button className="grow col" style={{ gap: 0, border: 0, background: 'none', textAlign: 'left', padding: 0, minWidth: 0 }} onClick={() => setSheet({ edit: last.id })}>
              <span className="ellipsis" style={{ fontWeight: 500 }}>#{d.playerById.get(last.player_id)?.jersey} {STAT_LABEL[last.type]} {STAT_POINTS[last.type] ? <span style={{ color: 'var(--a300)' }}>+{STAT_POINTS[last.type]}</span> : null}</span>
              <span className="small muted">{periodLabel(last.period, data.game.periods)} · {last.pending ? (g.sync === 'offline' ? 'Saved on phone' : 'Sending…') : 'Synced'}</span>
            </button>
            <button className="btn small" onClick={undo}><ArrowCounterClockwise />Undo</button>
          </>
        ) : (
          <span className="muted">Tap a stat to record it for #{player.jersey}</span>
        )}
      </div>

      <div className="pad">
        <div className="r" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>{btn('AST', 'Assist')}{btn('STL', 'Steal')}{btn('BLK', 'Block')}</div>
        <div className="r" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>{btn('TOV', 'Turnover')}{btn('PF', 'Foul')}</div>
        <div className="r" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>{btn('REB_OFF', 'Off. rebound')}{btn('REB_DEF', 'Def. rebound')}</div>
        <div className="shotlabels"><span>2 PT</span><span>3 PT</span><span>FREE THROW</span></div>
        <div className="r" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>{btn('FG2_MADE', 'Made', 'made')}{btn('FG3_MADE', 'Made', 'made')}{btn('FT_MADE', 'Made', 'made')}</div>
        <div className="r" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>{btn('FG2_MISS', 'Miss', 'miss')}{btn('FG3_MISS', 'Miss', 'miss')}{btn('FT_MISS', 'Miss', 'miss')}</div>
      </div>

      {sheet === 'history' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="row" style={{ justifyContent: 'space-between' }}><h3>#{player.jersey} {player.name} · events</h3><button className="btn small" onClick={() => setSheet(null)}>Close</button></div>
          <p className="small muted">Everyone's events for this player. Tap one of yours to change or remove it.</p>
          <div className="col" style={{ gap: 0 }}>
            {[...playerEvents].reverse().map((e) => (
              <button key={e.id} className={'list-row rule' + (e.voided ? ' strike' : '')} style={{ border: 0, background: 'none', textAlign: 'left', width: '100%' }} onClick={() => setSheet({ edit: e.id })}>
                <span className="small muted num" style={{ width: 52 }}>{periodLabel(e.period, data.game.periods)} {timeOf(e.client_ts)}</span>
                <span className="grow col" style={{ gap: 0 }}>
                  <span>{STAT_LABEL[e.type]}{e.edited ? ' (edited)' : ''}</span>
                  <span className="small muted">{d.nameOf(e.user_id)}{e.voided ? ' · removed' : ''}{e.pending ? ' · not synced yet' : ''}</span>
                </span>
              </button>
            ))}
            {!playerEvents.length && <p className="muted">No events yet.</p>}
          </div>
        </Sheet>
      )}

      {editEv && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="row" style={{ justifyContent: 'space-between' }}><h3>Edit event</h3><button className="btn small" onClick={() => setSheet(null)}>Done</button></div>
          <p className="small muted">#{d.playerById.get(editEv.player_id)?.jersey} · {periodLabel(editEv.period, data.game.periods)} {timeOf(editEv.client_ts)} · recorded by {d.nameOf(editEv.user_id)}{editEv.edited ? ` · originally ${STAT_LABEL[editEv.originalType]}` : ''}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
            {STAT_TYPES.map((t) => (
              <button key={t} className="btn small" disabled={!canEdit} style={{ minHeight: 50, borderColor: t === editEv.type ? 'var(--accent)' : undefined, background: t === editEv.type ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : undefined }}
                onClick={() => t !== editEv.type && g.correct(editEv.id, 'change_type', t)}>{STAT_LABEL[t]}</button>
            ))}
          </div>
          {editEv.voided
            ? <button className="btn block" disabled={!canEdit} onClick={() => g.correct(editEv.id, 'restore')}><ArrowCounterClockwise />Restore event</button>
            : <button className="btn block" disabled={!canEdit} onClick={() => { g.correct(editEv.id, 'void'); setSheet(null); }}><Trash />Remove event</button>}
          <p className="small muted">{canEdit ? 'Changes are added to the history; the original record is kept.' : `Only ${d.nameOf(editEv.user_id)} or the organizer can change this event.`}</p>
        </Sheet>
      )}
    </div>
  );
}
