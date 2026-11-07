import { t, tr, useLanguage } from '../lib/i18n';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowCounterClockwise, CaretLeft, CaretRight, CheckCircle, LockSimple, ShieldCheck, Trash, Warning } from '@phosphor-icons/react';
import { useGameCtx } from '../lib/useGame';
import { bySeq, periodLabel, timeOf } from '../lib/stats';
import { requestScorekeeper, setPeriod, vibrate } from '../lib/api';
import { friendlyError } from '../lib/supabase';
import { SyncBadge, useWakeLock } from '../components/ui';
import type { ScoreEvent, Side } from '../lib/types';

export default function Score() {
  useLanguage();
  const g = useGameCtx();
  const nav = useNavigate();
  const { data, derived: d, userId } = g;
  useWakeLock();
  const [fresh, setFresh] = useState<string | null>(null);
  const [undone, setUndone] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ k: string; n: number } | null>(null);
  const [err, setErr] = useState('');
  const lastTap = useRef({ k: '', t: 0 });
  const freshTimer = useRef<number>();

  const { game } = data;
  const canWrite = d.isScorekeeper && d.live;
  const canPeriod = (d.isScorekeeper || d.isOrganizer) && d.live;
  const skName = game.scorekeeper_id ? d.nameOf(game.scorekeeper_id) : null;
  const entries = [...d.score.entries].sort(bySeq).reverse();
  const last = entries.find((e) => e.user_id === userId && !e.voided);
  const undoneEntry = undone ? entries.find((e) => e.id === undone) : undefined;
  const diff = { home: d.score.home - d.playerPoints.home, away: d.score.away - d.playerPoints.away };
  const label = (e: ScoreEvent) => `${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)} ${d.team(e.side).name}${e.kind === 'adjust' ? ' (correction)' : ''}`;

  const add = (side: Side, delta: number) => {
    if (!canWrite) return;
    const k = side + delta, t = Date.now();
    if (lastTap.current.k === k && t - lastTap.current.t < 350) return;
    lastTap.current = { k, t };
    const id = g.scoreWrite(side, delta > 0 ? 'score' : 'adjust', delta);
    vibrate(); setUndone(null); setFlash({ k, n: t }); setFresh(id);
    window.clearTimeout(freshTimer.current);
    freshTimer.current = window.setTimeout(() => setFresh(null), 2500);
  };
  const voidEntry = (e: ScoreEvent) => g.scoreWrite(e.side, 'void', 0, e.id);
  const restoreEntry = (e: ScoreEvent) => g.scoreWrite(e.side, 'restore', 0, e.id);
  const changePeriod = async (p: number) => { try { setErr(''); await setPeriod(game.id, p); } catch (e) { setErr(friendlyError(e)); } };
  const claim = async () => { try { setErr(''); await requestScorekeeper(game.id); await g.reload(); } catch (e) { setErr(friendlyError(e)); } };

  const col = (side: Side) => (
    <div className="scorecol" key={side}>
      <div className="card num" style={{ padding: '10px 12px' }}>
        <div className="label ellipsis">{d.team(side).name}</div>
        <div className="bigscore">{d.score[side]}</div>
        <div className="small muted" style={{ marginTop: 4 }}>
          Player pts {d.playerPoints[side]}
          {diff[side] !== 0 && <span style={{ color: 'var(--a300)' }}> · {diff[side] > 0 ? `+${diff[side]} unattributed` : `${-diff[side]} over`}</span>}
        </div>
      </div>
      {canWrite && [3, 2, 1].map((n) => (
        <button key={n} className="plus" onClick={() => add(side, n)}>+{n}
          {flash?.k === side + n && <span key={flash.n} className="flash" style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--accent) 50%, transparent)', animation: 'flash .3s ease-out forwards' }} />}
        </button>
      ))}
      {canWrite && <button className="btn small" style={{ minHeight: 44 }} onClick={() => add(side, -1)}>{t("−1 correction")}</button>}
    </div>
  );

  return (
    <div className="screen" style={{ paddingTop: 0, gap: 10 }}>
      <div className="topbar">
        <button className="backbtn" onClick={() => nav(d.myAssignments.length ? '../play' : '../box')}><CaretLeft size={20} />{d.myAssignments.length ? t("Record") : t("Box score")}</button>
        <span className="grow" style={{ fontWeight: 500 }}>{t("Official score")}</span>
        <SyncBadge g={g} />
        <div className="row" style={{ gap: 0, border: '1px solid var(--divider)', borderRadius: 8, height: 40, marginLeft: 4 }}>
          <button className="iconbtn" style={{ width: 34, height: 38 }} disabled={!canPeriod || game.current_period <= 1} onClick={() => changePeriod(game.current_period - 1)} aria-label={t("Previous period")}><CaretLeft /></button>
          <span className="num" style={{ minWidth: 32, textAlign: 'center', fontWeight: 500 }}>{periodLabel(game.current_period, game.periods)}</span>
          <button className="iconbtn" style={{ width: 34, height: 38 }} disabled={!canPeriod} onClick={() => changePeriod(game.current_period + 1)} aria-label={t("Next period")}><CaretRight /></button>
        </div>
      </div>

      <div className="row small" style={{ color: 'var(--n300)' }}>
        {skName ? <ShieldCheck size={16} color="var(--accent)" /> : <Warning size={16} />}
        {skName ? (d.isScorekeeper ? t("Official · you are the scorekeeper") : `Official · kept by ${skName}`) : t("Unverified · no scorekeeper yet")}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>{col('home')}{col('away')}</div>

      {canWrite && (
        <div className={'lastbar' + (fresh && last?.id === fresh ? ' fresh' : '')}>
          {undoneEntry ? (<>
            <Trash size={18} className="muted" /><span className="grow ellipsis">Voided {label(undoneEntry)}</span>
            <button className="btn small" onClick={() => { restoreEntry(undoneEntry); setUndone(null); }}>{t("Restore")}</button>
          </>) : last ? (<>
            <CheckCircle size={20} weight="fill" color="var(--accent)" />
            <span className="grow col" style={{ gap: 0, minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 500 }}>{label(last)}</span><span className="small muted">{periodLabel(last.period, game.periods)} · {last.pending ? t("Sending…") : t("Synced")}</span></span>
            <button className="btn small" onClick={() => { voidEntry(last); setUndone(last.id); setFresh(null); }}><ArrowCounterClockwise />{t("Undo")}</button>
          </>) : <span className="muted">{t("Tap +1, +2 or +3 when a basket counts")}</span>}
        </div>
      )}

      {!canWrite && d.live && (
        <div className="card row" style={{ alignItems: 'flex-start' }}>
          <LockSimple size={18} style={{ flex: 'none', marginTop: 2 }} />
          <div className="col grow" style={{ gap: 8 }}>
            <span className="small">{d.hasRequestedScorekeeper
              ? 'Request sent. The organizer needs to approve it; this screen unlocks as soon as they do.'
              : skName ? `${skName} keeps the official score. Only the organizer can hand it over.` : 'Nobody is keeping the official score. The score shows as unverified until someone does.'}</span>
            {!d.hasRequestedScorekeeper && <button className="btn small" onClick={claim}>{d.isOrganizer ? t("Keep score myself") : skName ? t("Ask to take over") : t("Ask to keep score")}</button>}
          </div>
        </div>
      )}
      {err && <div className="error">{err}</div>}

      <div className="label" style={{ marginTop: 6 }}>{t("Score log · every change is kept")}</div>
      <div className="col" style={{ gap: 0 }}>
        {entries.map((e) => (
          <div key={e.id} className="list-row rule">
            <span className="small muted num" style={{ width: 70 }}>{periodLabel(e.period, game.periods)} {timeOf(e.client_ts)}</span>
            <span className={'grow col' + (e.voided ? ' strike' : '')} style={{ gap: 0, minWidth: 0 }}>
              <span>{label(e)}</span>
              <span className="small muted ellipsis">{d.nameOf(e.user_id)}{e.voided && e.voidedBy ? ` · voided by ${d.nameOf(e.voidedBy)}` : ''}{e.pending ? ' · not synced yet' : ''}</span>
            </span>
            {canWrite && (e.voided
              ? <button className="btn small" onClick={() => restoreEntry(e)}>{t("Restore")}</button>
              : <button className="btn small" onClick={() => voidEntry(e)}>Void</button>)}
          </div>
        ))}
        {!entries.length && <p className="muted small">{t("No score entries yet.")}</p>}
      </div>
    </div>
  );
}
