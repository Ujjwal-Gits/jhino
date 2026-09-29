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
interface AskInfo { username: string; name: string; avatarUrl: string | null; enabled: boolean; prompt: string; answered: { id: string; body: string; answer: string; answeredAt: string; pinned: boolean }[] }

export function AskPage({ name, user }: { name: string; user: User | null }) {
  const [d, setD] = useState<AskInfo | null | 'missing'>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [err, setErr] = useState('');
  useEffect(() => { get<AskInfo>(`/api/ask/${encodeURIComponent(name)}`).then((r) => { setD(r); document.title = `Ask ${r.name} anything | Jhino`; }, () => setD('missing')); }, [name]);
  if (d === null) return <PageLoader />;
  if (d === 'missing') return <main className="ask-page"><div className="ask-card"><h1>Nobody here</h1><p className="hint">There is no one with that username.</p><Link to="/" className="btn">Go to Jhino</Link></div></main>;
  const mine = user?.username?.toLowerCase() === d.username.toLowerCase();
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setState('busy');
    try { await post(`/api/ask/${d.username}`, { body: text }); setState('sent'); setText(''); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not send. Try again.'); setState('idle'); }
  };
  return (
    <main className="ask-page">
      <div className="ask-card">
        <a className="ask-who" href={`/${d.username}`}><Avatar name={d.name} src={d.avatarUrl} size="lg" /><span><b>{d.name}</b><small>@{d.username}</small></span></a>
        {state === 'sent' ? (
          <div className="ask-sent" role="status">
            <b>Sent</b>
            <p>{d.name} gets it without knowing who you are.</p>
            <button className="btn" onClick={() => setState('idle')}>Ask another</button>
          </div>
        ) : !d.enabled ? <p className="ask-closed">{d.name} is not taking questions right now.</p> : (
          <form onSubmit={send}>
            <label className="ask-q">
              <span>{d.prompt}</span>
              <textarea className="textarea" rows={4} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything…" autoFocus />
            </label>
            <div className="ask-foot"><small className="mono">{text.length}/500</small><span className="ask-anon">Anonymous: no sign-in, no name</span></div>
            {err && <p className="error-text">{err}</p>}
            <button className="btn primary lg ask-send" disabled={state === 'busy' || text.trim().length < 2}>{state === 'busy' && <span className="spin" />}Send anonymously</button>
          </form>
        )}
        {mine && <p className="hint">This is your question page. <Link to="/home/ask" className="link">Open your inbox</Link></p>}
      </div>

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
      <a className="ask-own" href={user ? '/home/ask' : '/signup'}>{user ? 'Your own question link' : 'Get your own question link'}<Wordmark className="ask-mark" /></a>
    </main>
  );
}
