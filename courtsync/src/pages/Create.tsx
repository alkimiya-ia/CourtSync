import { t, tr, useLanguage } from '../lib/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretLeft, Plus, X } from '@phosphor-icons/react';
import { createGame, getName, rememberGame, saveName, type NewPlayer } from '../lib/api';
import { friendlyError } from '../lib/supabase';
import type { Side } from '../lib/types';

interface Row { key: number; jersey: string; name: string }
const blank = (k: number): Row => ({ key: k, jersey: '', name: '' });

export default function Create() {
  useLanguage();
  const nav = useNavigate();
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [periods, setPeriods] = useState(4);
  const [name, setName] = useState(getName());
  const [keepScore, setKeepScore] = useState(false);
  const [tab, setTab] = useState<Side>('home');
  const [rows, setRows] = useState<Record<Side, Row[]>>({ home: [blank(1), blank(2)], away: [blank(3)] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const upd = (side: Side, key: number, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [side]: r[side].map((x) => (x.key === key ? { ...x, ...patch } : x)) }));

  const players: NewPlayer[] = (['home', 'away'] as Side[]).flatMap((side) =>
    rows[side].filter((r) => r.jersey !== '').map((r) => ({ side, jersey: Number(r.jersey), name: r.name.trim() })));
  const dupes = (['home', 'away'] as Side[]).some((side) => {
    const nums = rows[side].filter((r) => r.jersey !== '').map((r) => r.jersey);
    return new Set(nums).size !== nums.length;
  });
  const valid = home.trim() && away.trim() && name.trim() && !dupes;

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr('');
    try {
      saveName(name);
      const r = await createGame({ home: home.trim(), away: away.trim(), periods, displayName: name.trim(), players, keepScore });
      rememberGame(r.code, `${home.trim()} vs ${away.trim()}`);
      nav(`/g/${r.code}/share`, { replace: true });
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };

  return (
    <div className="screen">
      <div className="topbar"><button className="backbtn" onClick={() => nav('/')}><CaretLeft size={20} />{t("Back")}</button></div>
      <h1>{t("New game")}</h1>

      <div className="col"><span className="label">{t("Teams")}</span>
        <input className="input" placeholder={t("Home team")} value={home} onChange={(e) => setHome(e.target.value)} maxLength={60} />
        <input className="input" placeholder={t("Away team")} value={away} onChange={(e) => setAway(e.target.value)} maxLength={60} />
      </div>

      <div className="col"><span className="label">{t("Periods")}</span>
        <div className="seg">
          {[4, 2].map((p) => <button key={p} aria-pressed={periods === p} onClick={() => setPeriods(p)}>{p === 4 ? t("4 quarters") : t("2 halves")}</button>)}
        </div>
      </div>

      <div className="col"><span className="label">{t("Players (optional, can be added later)")}</span>
        <div className="seg">
          <button aria-pressed={tab === 'home'} onClick={() => setTab('home')} className="ellipsis">{home.trim() || 'Home'}</button>
          <button aria-pressed={tab === 'away'} onClick={() => setTab('away')} className="ellipsis">{away.trim() || t("Away")}</button>
        </div>
        {rows[tab].map((r) => (
          <div className="row" key={r.key}>
            <input className="input num" style={{ width: 64, textAlign: 'center', padding: 0 }} placeholder="#" inputMode="numeric" maxLength={2}
              value={r.jersey} onChange={(e) => upd(tab, r.key, { jersey: e.target.value.replace(/\D/g, '') })} />
            <input className="input grow" placeholder={t("First name (optional)")} value={r.name} maxLength={60}
              onChange={(e) => upd(tab, r.key, { name: e.target.value })} />
            <button className="iconbtn" aria-label={t("Remove")} onClick={() => setRows((x) => ({ ...x, [tab]: x[tab].filter((y) => y.key !== r.key) }))}><X /></button>
          </div>
        ))}
        <button className="btn dashed" onClick={() => setRows((x) => ({ ...x, [tab]: [...x[tab], blank(Date.now())] }))}><Plus />{t("Add player")}</button>
        {dupes && <p className="small" style={{ color: 'var(--a300)' }}>{t("Each jersey number can only be used once per team.")}</p>}
        <p className="small muted">{t("For privacy, use first names or initials only.")}</p>
      </div>

      <div className="col"><span className="label">{t("You")}</span>
        <input className="input" placeholder={t("Your name (shown to others in the game)")} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <label className="row" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={keepScore} onChange={(e) => setKeepScore(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} />
          <span>{t("I'll keep the official score")}</span>
        </label>
        <p className="small muted">{t("You can also make someone else scorekeeper after they join.")}</p>
      </div>

      {err && <div className="error">{err}</div>}
      <button className="btn primary block" disabled={!valid || busy} onClick={submit}>{busy ? t("Creating…") : t("Create game")}</button>
    </div>
  );
}
