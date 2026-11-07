import { t, tr, useLanguage } from '../lib/i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';
import { CaretLeft, ShieldCheck } from '@phosphor-icons/react';
import { GameContext, useGame, useGameCtx, type ReadyGame } from '../lib/useGame';
import { formatCode, gamePreview, getName, isValidCode, joinGame, rememberGame, respondScorekeeperRequest, saveName, type GamePreview } from '../lib/api';
import { friendlyError } from '../lib/supabase';
import { Splash } from '../components/ui';

export default function GameRoute() {
  useLanguage();
  const { code = '' } = useParams();
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!isValidCode(norm)) return <Problem title={t("That isn't a game code")} text="Game codes have 6 letters and numbers, like ABC-123." />;
  return <GameLoader code={norm} />;
}

function GameLoader({ code }: { code: string }) {
  useLanguage();
  const g = useGame(code);
  if (g.load.kind === 'loading') return <Splash />;
  if (g.load.kind === 'error' && !g.data) {
    return <Problem title={t("Could not load the game")} text={g.load.message} action={<button className="btn primary block" onClick={() => void g.reload()}>{t("Try again")}</button>} />;
  }
  if (g.load.kind === 'missing' || !g.data || !g.derived?.me) return <JoinGate code={code} onJoined={g.reload} />;
  const ready = g as ReadyGame;
  return (
    <GameContext.Provider value={ready}>
      <ScorekeeperRequestBanner />
      <Outlet />
    </GameContext.Provider>
  );
}

/** /g/:code — send each participant to the screen that fits their role. */
export function GameIndex() {
  const g = useGameCtx();
  const t = g.derived;
  useEffect(() => { rememberGame(g.data.game.code, `${t.team('home').name} vs ${t.team('away').name}`);   // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.data.game.code]);
  if (!t.live) return <Navigate to="box" replace />;
  if ((t.isScorekeeper || t.hasRequestedScorekeeper) && !t.myAssignments.length) return <Navigate to="score" replace />;
  if (t.me?.role === 'spectator') return <Navigate to="box" replace />;
  if (t.myAssignments.length) return <Navigate to="play" replace />;
  if (t.isOrganizer) return <Navigate to="box" replace />;
  return <Navigate to="pick" replace />;
}

/** Organizer sees pending scorekeeper requests on every screen. */
function ScorekeeperRequestBanner() {
  useLanguage();
  const g = useGameCtx();
  const [err, setErr] = useState('');
  const req = g.data.game.scorekeeper_request_id;
  if (!g.derived.isOrganizer || !req || !g.derived.live) return null;
  const respond = async (ok: boolean) => { try { setErr(''); await respondScorekeeperRequest(g.data.game.id, ok); await g.reload(); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <div style={{ position: 'fixed', top: 'calc(8px + env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 16px)', maxWidth: 464, zIndex: 30 }}
      className="card col" role="alert">
      <span className="row small"><ShieldCheck size={16} color="var(--accent)" /><b style={{ fontWeight: 500 }}>{g.derived.nameOf(req)}</b>&nbsp;wants to keep the official score{g.data.game.scorekeeper_id ? ` (replacing ${g.derived.nameOf(g.data.game.scorekeeper_id)})` : ''}.</span>
      {err && <span className="small" style={{ color: 'var(--a300)' }}>{err}</span>}
      <div className="row"><button className="btn small grow" onClick={() => respond(false)}>{t("Decline")}</button><button className="btn small grow primary" style={{ fontSize: 14, minHeight: 38 }} onClick={() => respond(true)}>{t("Approve")}</button></div>
    </div>
  );
}

function Problem({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="screen">
      <div className="topbar"><Link to="/" className="backbtn" style={{ color: 'inherit', textDecoration: 'none' }}><CaretLeft size={20} />Home</Link></div>
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      <div className="col" style={{ marginTop: 'auto' }}>{action}<Link to="/" className="btn block" style={{ color: 'inherit', textDecoration: 'none' }}>{t("Enter another code")}</Link></div>
    </div>
  );
}

function JoinGate({ code, onJoined }: { code: string; onJoined: () => Promise<void> }) {
  const [preview, setPreview] = useState<GamePreview | null>(null);
  const [err, setErr] = useState('');
  const load = () => { setErr(''); setPreview(null); gamePreview(code).then(setPreview).catch((e) => setErr(friendlyError(e))); };
  useEffect(load, [code]);

  if (err) return <Problem title={t("Could not check the game")} text={err} action={<button className="btn primary block" onClick={load}>{t("Try again")}</button>} />;
  if (!preview) return <Splash text="Checking game code…" />;
  if (!preview.found) return <Problem title={t("Game not found")} text={`No game uses the code ${formatCode(code)}. Check it with the organizer.`} />;
  // Member but data not visible yet (e.g. just joined, or a transient read error): reload.
  if (preview.member) return <Problem title={t("Could not open the game")} text="You are part of this game but it did not load." action={<button className="btn primary block" onClick={() => void onJoined()}>{t("Try again")}</button>} />;
  const closed = preview.status !== 'live' || !!preview.expired;
  return <JoinForm code={code} preview={preview} closed={closed} onJoined={onJoined} />;
}

function JoinForm({ code, preview, closed, onJoined }: { code: string; preview: GamePreview; closed: boolean; onJoined: () => Promise<void> }) {
  useLanguage();
  const nav = useNavigate();
  const [name, setName] = useState(getName());
  const [role, setRole] = useState<'tracker' | 'scorekeeper' | 'spectator'>(closed ? 'spectator' : 'tracker');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const join = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try {
      saveName(name);
      await joinGame(code, name.trim(), role);
      await onJoined();
      nav(`/g/${code}/${role === 'tracker' ? 'pick' : role === 'scorekeeper' ? 'score' : 'box'}`, { replace: true });
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };

  const options = [
    ['tracker', t("Track players"), t("Record stats for one or more players")],
    ['scorekeeper', t("Keep the official score"), preview.has_scorekeeper ? 'Someone already keeps score; the organizer must approve a change' : t("The organizer approves the scorekeeper")],
    ['spectator', t("Just watch"), t("Live scoreboard and box score")],
  ] as const;

  return (
    <div className="screen">
      <div className="topbar"><button className="backbtn" onClick={() => nav('/')}><CaretLeft size={20} />Home</button></div>
      <div className="col" style={{ gap: 6 }}>
        <span className="label" style={{ color: 'var(--a300)' }}>Game {formatCode(code)}</span>
        <h1>{preview.home} vs {preview.away}</h1>
        <p className="muted">{closed ? (preview.status === 'final' ? t("This game has finished. You can view the results.") : t("This game link has expired. You can view the results.")) : t("No account needed. Your name is shown to others in this game.")}</p>
      </div>
      <input className="input" placeholder={t("Your name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
      {!closed && (
        <div className="col"><span className="label">{t("I want to")}</span>
          {options.map(([v, t, s]) => (
            <button key={v} className="pick-row" aria-pressed={role === v} onClick={() => setRole(v)}>
              <span className="grow col" style={{ gap: 0 }}><span>{t}</span><span className="small muted">{s}</span></span>
            </button>
          ))}
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <button className="btn primary block" style={{ marginTop: 'auto' }} disabled={!name.trim() || busy} onClick={join}>
        {busy ? t("Joining…") : closed ? t("View results") : t("Join game")}
      </button>
    </div>
  );
}
