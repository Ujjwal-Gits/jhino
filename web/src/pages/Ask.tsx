import { useEffect, useState } from 'react';
import { ApiError, get, post, type User } from '../api';
import { Link } from '../context';
import { Wordmark } from '../Logo';
import { PageLoader } from '../Loader';
import { Avatar, ago } from '../ui';
import '../tools.css';

/*
 * jhino.com/<username>/ask: anyone can send the person an anonymous question, with no sign-in. Answers the
 * person posts show below. Nothing about the sender is stored (server/mini.ts).
 */
/** Page themes the owner can pick. bg: page colour; ink: text on it; btn/btnInk: button on the white card. All pairs pass WCAG AA. */
export const ASK_THEMES = [
  { id: 'ember', name: 'Ember', bg: '#C2340E', ink: '#ffffff', btn: '#C2340E', btnInk: '#ffffff' },
  { id: 'tide', name: 'Tide', bg: '#0A5C9E', ink: '#ffffff', btn: '#0A5C9E', btnInk: '#ffffff' },
  { id: 'moss', name: 'Moss', bg: '#1B6B43', ink: '#ffffff', btn: '#1B6B43', btnInk: '#ffffff' },
  { id: 'plum', name: 'Plum', bg: '#7A2E6B', ink: '#ffffff', btn: '#7A2E6B', btnInk: '#ffffff' },
  { id: 'sun', name: 'Sun', bg: '#FFC531', ink: '#141414', btn: '#141414', btnInk: '#ffffff' },
  { id: 'ink', name: 'Ink', bg: '#141414', ink: '#ffffff', btn: '#C2340E', btnInk: '#ffffff' },
];
export const askTheme = (id?: string) => ASK_THEMES.find((t) => t.id === id) ?? ASK_THEMES[0];
interface AskInfo { username: string; name: string; avatarUrl: string | null; enabled: boolean; prompt: string; theme: string; answered: { id: string; body: string; answer: string; answeredAt: string; pinned: boolean }[] }

export function AskPage({ name, user }: { name: string; user: User | null }) {
  const [d, setD] = useState<AskInfo | null | 'missing'>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [err, setErr] = useState('');
  useEffect(() => { get<AskInfo>(`/api/ask/${encodeURIComponent(name)}`).then((r) => { setD(r); document.title = `Ask ${r.name} anything | Jhino`; }, () => setD('missing')); }, [name]);
  if (d === null) return <PageLoader />;
  if (d === 'missing') return <main className="ask-page"><div className="ask-card"><h1>Nobody here</h1><p className="hint">There is no one with that username.</p><Link to="/" className="btn">Go to Jhino</Link></div></main>;
  const mine = user?.username?.toLowerCase() === d.username.toLowerCase();
  const th = askTheme(d.theme);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setState('busy');
    try { await post(`/api/ask/${d.username}`, { body: text }); setState('sent'); setText(''); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not send. Try again.'); setState('idle'); }
  };
  const cta = (
    <a className="ask-cta" href={user ? '/home/ask' : '/signup'}>
      <span><b>{user ? 'Your own question link' : 'Get your own anonymous link'}</b><small>{user ? 'Share it in your bio' : 'Free, takes a minute. Put it in your bio.'}</small></span>
      <i aria-hidden="true">&rarr;</i>
    </a>
  );
  return (
    <main className="ask-page" style={{ '--ask-bg': th.bg, '--ask-ink': th.ink, '--ask-btn': th.btn, '--ask-btn-ink': th.btnInk } as React.CSSProperties}>
      <a className="ask-who" href={`/${d.username}`}><Avatar name={d.name} src={d.avatarUrl} size="lg" /><span><b>{d.name}</b><small>@{d.username}</small></span></a>
      <div className="ask-card">
        {state === 'sent' ? (
          <div className="ask-sent" role="status">
            <div className="ask-burst" aria-hidden="true">
              <svg viewBox="0 0 64 64" className="ask-tick"><circle cx="32" cy="32" r="30" /><path d="M19 33l9 9 17-19" /></svg>
              {Array.from({ length: 8 }, (_, i) => <span key={i} style={{ '--a': `${i * 45}deg` } as React.CSSProperties} />)}
            </div>
            <b>Sent!</b>
            <p>{d.name} gets it and has no idea who you are.</p>
            <button className="btn lg ask-again" onClick={() => setState('idle')}>Ask another</button>
          </div>
        ) : !d.enabled ? <p className="ask-closed">{d.name} is not taking questions right now.</p> : (
          <form onSubmit={send}>
            <label className="ask-q">
              <span>{d.prompt}</span>
              <textarea className="textarea" rows={4} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your question…" autoFocus />
            </label>
            <div className="ask-foot"><small className="mono">{text.length}/500</small><span className="ask-anon">Anonymous: no sign-in, no name</span></div>
            {err && <p className="error-text" role="alert">{err}</p>}
            <button className="btn primary lg ask-send" disabled={state === 'busy' || text.trim().length < 2}>{state === 'busy' && <span className="spin" />}Send anonymously</button>
          </form>
        )}
        {mine && <p className="hint">This is your question page. <Link to="/home/ask" className="link">Open your inbox</Link></p>}
      </div>

      {state === 'sent' && cta}

      {!!d.answered.length && (
        <section className="ask-list" aria-label="Answered questions">
          <h2>Answered</h2>
          <ul>{d.answered.map((q) => (
            <li key={q.id}>
              <p className="tp-bubble">{q.body}</p>
              <p className="ask-a">{q.answer}</p>
              <small className="hint">{q.pinned ? 'Pinned · ' : ''}{ago(q.answeredAt)}</small>
            </li>
          ))}</ul>
        </section>
      )}
      {state !== 'sent' && cta}
      <a className="ask-brand" href="/" aria-label="Jhino"><Wordmark className="ask-mark" /></a>
    </main>
  );
}
