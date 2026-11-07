import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CaretRight, Plus } from '@phosphor-icons/react';
import { formatCode, normalizeCode, recentGames } from '../lib/api';

export default function Home() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const norm = normalizeCode(code);
  const recent = recentGames();
  const go = () => norm.length === 6 && nav('/g/' + norm);

  return (
    <div className="screen">
      <div className="topbar"><b style={{ fontWeight: 500 }}>CourtSync</b></div>
      <div className="col" style={{ gap: 6 }}>
        <h1>Join a game</h1>
        <p className="muted">Scan the game's QR code with your phone camera, or enter the code.</p>
      </div>
      <div className="row">
        <input className="input code grow" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder="ABC-123" maxLength={8} autoCapitalize="characters" autoComplete="off" inputMode="text" aria-label="Game code" />
        <button className="btn primary" style={{ minHeight: 52 }} disabled={norm.length !== 6} onClick={go}>Join</button>
      </div>
      <div style={{ marginTop: 'auto' }} className="col">
        {recent.length > 0 && <div className="label">Recent games</div>}
        {recent.map((g) => (
          <Link key={g.code} to={'/g/' + g.code} className="list-row rule" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="grow col" style={{ gap: 0 }}><span>{g.title}</span><span className="small muted">{formatCode(g.code)} · {new Date(g.ts).toLocaleDateString()}</span></span>
            <CaretRight className="muted" />
          </Link>
        ))}
        <button className="btn block" onClick={() => nav('/create')}><Plus />Create a game</button>
      </div>
    </div>
  );
}
