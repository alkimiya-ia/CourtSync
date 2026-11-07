import LanguageSwitch from '../components/LanguageSwitch';
import { t, tr, useLanguage } from '../lib/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretLeft, PlusMinus, ShareNetwork, ShieldCheck, Warning } from '@phosphor-icons/react';
import { useGameCtx } from '../lib/useGame';
import { lineOf, pct, periodLabel, STAT_LABEL, timeOf, type Line } from '../lib/stats';
import { finishGame, reopenGame, requestScorekeeper, setScorekeeper } from '../lib/api';
import { friendlyError } from '../lib/supabase';
import { Sheet, SyncBadge } from '../components/ui';
import type { Player, Side } from '../lib/types';

export default function Box() {
  useLanguage();
  const g = useGameCtx();
  const nav = useNavigate();
  const { data, derived: d } = g;
  const { game } = data;
  const [side, setSide] = useState<Side>('home');
  const [detail, setDetail] = useState<Player | null>(null);
  const [err, setErr] = useState('');
  const run = async (f: () => Promise<unknown>) => { try { setErr(''); await f(); await g.reload(); } catch (e) { setErr(friendlyError(e)); } };

  const team = d.team(side);
  const roster = data.players.filter((p) => p.team_id === team.id).sort((a, b) => a.jersey - b.jersey);
  const lineFor = (pid: string) => lineOf(d.effEvents.filter((e) => e.player_id === pid && !e.voided));
  const rows = roster.map((p) => ({ p, l: lineFor(p.id), by: d.activeAssignments.filter((a) => a.player_id === p.id) }));
  const tot = lineOf(d.effEvents.filter((e) => !e.voided && d.sideOfPlayer(e.player_id) === side));
  const untracked = rows.filter((r) => !r.by.length).map((r) => '#' + r.p.jersey);
  const skName = game.scorekeeper_id ? d.nameOf(game.scorekeeper_id) : null;
  const recent = [...d.effEvents].reverse().slice(0, 40);
  const final = !d.live; // finished or expired

  const Cells = ({ l }: { l: Line }) => (<><td>{l.pts}</td><td>{l.reb}</td><td>{l.c.AST}</td><td>{l.c.STL}</td><td>{l.c.BLK}</td><td>{l.c.TOV}</td><td>{l.c.PF}</td></>);

  return (
    <div className="screen" style={{ paddingTop: 0 }}>
      <div className="topbar">
        <button className="backbtn" onClick={() => nav(d.myAssignments.length && !final ? '../play' : '/')}><CaretLeft size={20} />{d.myAssignments.length && !final ? t("Record") : 'Home'}</button>
        <span className="grow" />
        <LanguageSwitch />
        <SyncBadge g={g} />
        {d.isScorekeeper && !final && <button className="iconbtn" title={t("Scorekeeper")} style={{ color: 'var(--a300)' }} onClick={() => nav('../score')}><PlusMinus /></button>}
        <button className="iconbtn" title="Share game" onClick={() => nav('../share')}><ShareNetwork /></button>
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <div className="row small" style={{ justifyContent: 'space-between' }}>
          <span className="row" style={{ gap: 6, color: 'var(--n300)' }}>
            {skName ? <ShieldCheck size={16} color="var(--accent)" /> : <Warning size={16} />}
            {skName ? `Official · ${skName}` : t("Unverified score")}
          </span>
          {final ? <span className="tag accent">{game.status === 'final' ? t("FINAL") : t("EXPIRED")}</span> : <span className="muted">{periodLabel(game.current_period, game.periods)} · live</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }} className="num">
          {(['home', 'away'] as Side[]).map((s) => {
            const diff = d.score[s] - d.playerPoints[s];
            return (
              <div key={s} style={{ textAlign: s === 'away' ? 'right' : 'left' }}>
                <div className="small muted ellipsis">{d.team(s).name}</div>
                <div className="bigscore" style={{ fontSize: 44 }}>{d.score[s]}</div>
                <div className="small muted">Player pts {d.playerPoints[s]}{diff !== 0 && <span style={{ color: 'var(--a300)' }}> · {diff > 0 ? `+${diff} unattributed` : `${-diff} over`}</span>}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="seg">
        {(['home', 'away'] as Side[]).map((s) => <button key={s} aria-pressed={side === s} onClick={() => setSide(s)} className="ellipsis">{d.team(s).name}</button>)}
      </div>

      <table className="box">
        <thead><tr><th>{t("Player")}</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th></tr></thead>
        <tbody>
          {rows.map(({ p, l, by }) => (
            <tr key={p.id} onClick={() => setDetail(p)} style={{ opacity: by.length ? 1 : 0.6 }}>
              <td><div className="ellipsis" style={{ maxWidth: 150 }}><span className="muted" style={{ display: 'inline-block', width: 24 }}>{p.jersey}</span>{p.name || '—'}</div>
                <div className="small muted" style={{ paddingLeft: 24 }}>{l.fgm}/{l.fga} FG · {by.length ? by.map((a) => d.nameOf(a.user_id)).join(', ') : t("not tracked")}</div></td>
              <Cells l={l} />
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>{t("Team (tracked)")}</td><Cells l={tot} /></tr></tfoot>
      </table>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }} className="num">
        {([['FG', tot.fgm, tot.fga], ['3P', tot.fg3m, tot.fg3a], ['FT', tot.ftm, tot.fta]] as const).map(([k, m, a]) => (
          <div key={k} className="card" style={{ padding: '8px 10px' }}><div className="label">{k}</div><div>{m}/{a} <span className="small muted">{pct(m, a)}</span></div></div>
        ))}
      </div>
      {untracked.length > 0 && <p className="small muted">Not tracked: {untracked.join(', ')}. Their stats are missing, so player points can be lower than the official score.</p>}

      {!final && (
        <div className="row">
          {d.me?.role !== 'spectator' && <button className="btn grow" onClick={() => nav('../pick')}>{t("Track players")}</button>}
          {!d.isScorekeeper && !d.hasRequestedScorekeeper && (!game.scorekeeper_id || d.isOrganizer) && <button className="btn grow" onClick={() => run(() => requestScorekeeper(game.id))}>{d.isOrganizer ? t("Keep score") : t("Ask to keep score")}</button>}
          {d.hasRequestedScorekeeper && <span className="small muted grow">{t("Scorekeeper request sent to the organizer.")}</span>}
        </div>
      )}

      <div className="label" style={{ marginTop: 8 }}>{t("Game history")}</div>
      <div className="col" style={{ gap: 0 }}>
        {recent.map((e) => {
          const p = d.playerById.get(e.player_id);
          return (
            <div key={e.id} className={'list-row rule' + (e.voided ? ' strike' : '')}>
              <span className="small muted num" style={{ width: 70 }}>{periodLabel(e.period, game.periods)} {timeOf(e.client_ts)}</span>
              <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
                <span className="ellipsis">#{p?.jersey} {p?.name} · {tr(STAT_LABEL[e.type])}{e.edited ? ' (edited)' : ''}</span>
                <span className="small muted">{d.team(d.sideOfPlayer(e.player_id)).name} · {d.nameOf(e.user_id)}</span>
              </span>
            </div>
          );
        })}
        {!recent.length && <p className="small muted">{t("No stats recorded yet.")}</p>}
      </div>

      <div className="label" style={{ marginTop: 8 }}>{t("People in this game")}</div>
      <div className="col" style={{ gap: 0 }}>
        {data.participants.map((p) => {
          const isSk = game.scorekeeper_id === p.user_id;
          const tracks = d.activeAssignments.filter((a) => a.user_id === p.user_id).map((a) => '#' + d.playerById.get(a.player_id)?.jersey);
          return (
            <div key={p.user_id} className="list-row rule">
              <span className="grow col" style={{ gap: 0 }}>
                <span>{d.nameOf(p.user_id)}{p.user_id === game.organizer_id ? t(" · organizer") : ''}{isSk ? ' · scorekeeper' : ''}{game.scorekeeper_request_id === p.user_id ? ' · asked to keep score' : ''}</span>
                <span className="small muted">{tracks.length ? 'Tracking ' + tracks.join(', ') : p.role === 'spectator' ? t("Watching") : t("Not tracking")}</span>
              </span>
              {d.isOrganizer && !final && (isSk
                ? <button className="btn small" onClick={() => run(() => setScorekeeper(game.id, null))}>{t("Remove scorekeeper")}</button>
                : <button className="btn small" onClick={() => run(() => setScorekeeper(game.id, p.user_id))}>{t("Make scorekeeper")}</button>)}
            </div>
          );
        })}
      </div>

      {err && <div className="error">{err}</div>}
      {d.isOrganizer && (final
        ? <button className="btn block" onClick={() => run(() => reopenGame(game.id))}>{game.status === 'final' ? t("Reopen game") : t("Extend game by a day")}</button>
        : <button className="btn block" onClick={() => { if (confirm(t("Finish the game? Stats and score become read-only."))) void run(() => finishGame(game.id)); }}>{t("Finish game")}</button>)}

      {detail && <PlayerSheet p={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function PlayerSheet({ p, onClose }: { p: Player; onClose: () => void }) {
  const g = useGameCtx();
  const { derived: d, data } = g;
  const evs = d.effEvents.filter((e) => e.player_id === p.id);
  const l = lineOf(evs.filter((e) => !e.voided));
  return (
    <Sheet onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>#{p.jersey} {p.name}</h3><button className="btn small" onClick={onClose}>{t("Close")}</button></div>
      <div className="card num" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        {([['PTS', l.pts], ['REB', `${l.reb}`], ['OREB', l.c.REB_OFF], ['DREB', l.c.REB_DEF], ['AST', l.c.AST], ['STL', l.c.STL], ['BLK', l.c.BLK], ['TO', l.c.TOV], ['PF', l.c.PF],
          ['FG', `${l.fgm}/${l.fga} ${pct(l.fgm, l.fga)}`], ['2P', `${l.fg2m}/${l.fg2a} ${pct(l.fg2m, l.fg2a)}`], ['3P', `${l.fg3m}/${l.fg3a} ${pct(l.fg3m, l.fg3a)}`], ['FT', `${l.ftm}/${l.fta} ${pct(l.ftm, l.fta)}`]] as const).map(([k, v]) => (
          <div key={k}><div className="label">{k}</div><div>{v}</div></div>
        ))}
      </div>
      <div className="col" style={{ gap: 0 }}>
        {[...evs].reverse().map((e) => (
          <div key={e.id} className={'list-row rule' + (e.voided ? ' strike' : '')}>
            <span className="small muted num" style={{ width: 70 }}>{periodLabel(e.period, data.game.periods)} {timeOf(e.client_ts)}</span>
            <span className="grow">{tr(STAT_LABEL[e.type])}</span>
            <span className="small muted">{d.nameOf(e.user_id)}</span>
          </div>
        ))}
        {!evs.length && <p className="small muted">{t("No events for this player.")}</p>}
      </div>
    </Sheet>
  );
}
