import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Link as LinkIcon, ShareNetwork } from '@phosphor-icons/react';
import { useGameCtx } from '../lib/useGame';
import { formatCode } from '../lib/api';

export default function Share() {
  const g = useGameCtx();
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);
  const { game } = g.data;
  const url = `${window.location.origin}/g/${game.code}`;
  const title = `${g.derived.team('home').name} vs ${g.derived.team('away').name}`;

  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: 'CourtSync · ' + title, text: `Join ${title} on CourtSync`, url }); } catch { /* cancelled */ } } else void copy(); };

  return (
    <div className="screen">
      <div className="topbar" />
      <div className="col" style={{ gap: 6 }}>
        <span className="label" style={{ color: 'var(--a300)' }}>Game created</span>
        <h1>{title}</h1>
        <p className="muted">Other parents scan this with their phone camera, or open the link.</p>
      </div>
      <div className="card row" style={{ gap: 16, alignItems: 'center' }}>
        <div className="qr"><QRCodeSVG value={url} size={132} bgColor="#f3f5fe" fgColor="#161826" level="M" /></div>
        <div className="col" style={{ gap: 2 }}>
          <span className="label">Game code</span>
          <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '.08em' }}>{formatCode(game.code)}</span>
          <span className="small muted" style={{ wordBreak: 'break-all' }}>{url.replace(/^https?:\/\//, '')}</span>
        </div>
      </div>
      <div className="row">
        <button className="btn grow" onClick={copy}>{copied ? <Check /> : <LinkIcon />}{copied ? 'Copied' : 'Copy link'}</button>
        <button className="btn grow" onClick={share}><ShareNetwork />Share</button>
      </div>
      <p className="small muted">Anyone with the code can join and record stats. As organizer you can finish the game and assign the scorekeeper from the box score screen.</p>
      <div className="col" style={{ marginTop: 'auto' }}>
        <button className="btn primary block" onClick={() => nav('../pick')}>Track players</button>
        <div className="row">
          <button className="btn grow" onClick={() => nav('../score')}>Scorekeeper</button>
          <button className="btn grow" onClick={() => nav('../box')}>Box score</button>
        </div>
      </div>
    </div>
  );
}
