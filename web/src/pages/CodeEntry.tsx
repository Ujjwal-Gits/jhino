import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api';
import { Link } from '../context';

/*
 * The one-time code, as six boxes: type, paste the whole code, or let the phone fill it in from
 * the email (autocomplete="one-time-code"). A real <input> sits under the boxes, so screen readers,
 * paste and autofill all work; the boxes only draw it.
 */
export function CodeBoxes({ value, onChange, onComplete, disabled, invalid, autoFocus = true, label = 'The 6-digit code' }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; invalid?: boolean; autoFocus?: boolean; label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const set = (raw: string) => {
    const v = raw.replace(/\D/g, '').slice(0, 6);
    onChange(v);
    if (v.length === 6) onComplete?.(v);
  };
  // "Paste code": one tap after copying it from the email (the browser may ask once to allow it).
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
  const paste = async () => {
    try { const t = (await navigator.clipboard.readText()).match(/\d{6}/)?.[0]; if (t) set(t); else ref.current?.focus(); }
    catch { ref.current?.focus(); }
  };
  return (
    <div className={`otp ${invalid ? 'bad' : ''} ${disabled ? 'off' : ''}`} onClick={() => ref.current?.focus()}>
      <input ref={ref} className="otp-input" value={value} onChange={(e) => set(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} disabled={disabled} aria-label={label} aria-invalid={invalid || undefined} spellCheck={false} />
      <div className="otp-cells" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => {
          const active = focus && (i === value.length || (i === 5 && value.length === 6));
          const cell = <span key={i} className={`otp-cell ${value[i] ? 'full' : ''} ${active ? 'on' : ''}`}>{value[i] ?? ''}{active && !value[i] && <i className="otp-caret" />}</span>;
          return i === 3 ? [<span key="gap" className="otp-gap" />, cell] : cell;
        })}
      </div>
      {canPaste && !disabled && value.length < 6 && (
        <button type="button" className="otp-paste" onClick={(e) => { e.stopPropagation(); paste(); }}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9 4h6v3H9zM7 5H5v15h14V5h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>Paste code
        </button>
      )}
    </div>
  );
}

/** Minutes and seconds left until the code expires; null when unknown. */
function useLeft(expiresAt?: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) { setLeft(null); return; }
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export interface CodeInfo { sends?: number; maxSends?: number; expiresAt?: string; again?: boolean; note?: string }

/**
 * The whole step: where the code went, the boxes, how long it works, and "send it again"
 * (the same code, while it works; up to five times).
 */
export function CodeStep({ title, email, info, onSubmit, onResend, children, submitLabel = 'Confirm', extra }: {
  title: string; email: string; info: CodeInfo;
  onSubmit: (code: string) => Promise<void>;
  onResend: () => Promise<CodeInfo>;
  children?: ReactNode; submitLabel?: string; extra?: ReactNode;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<CodeInfo>(info);
  const [cool, setCool] = useState(20);
  const [note, setNote] = useState(info.note ?? '');
  useEffect(() => { setState(info); setNote(info.note ?? ''); }, [info]);
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool((c) => c - 1), 1000); return () => clearTimeout(t); }, [cool]);
  const left = useLeft(state.expiresAt);
  const expired = left === 0;

  const submit = async (e?: FormEvent, v = code) => {
    e?.preventDefault();
    if (v.length !== 6 || busy) return;
    setBusy(true); setError('');
    try { await onSubmit(v); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not check the code.'); setCode(''); setBusy(false); }
  };
  const resend = async () => {
    setError(''); setNote('');
    try {
      const r = await onResend();
      setState((s) => ({ ...s, ...r }));
      setNote(r.note ?? (r.again ? 'We sent the same code again.' : 'We sent a new code.'));
      setCool(20);
    } catch (err) {
      const e2 = err instanceof ApiError ? err : null;
      setNote(e2?.message ?? 'Could not send it. Try again in a moment.');
      const wait = Number((e2?.data as { retryAfter?: number } | undefined)?.retryAfter);
      if (wait > 0) setCool(Math.min(wait, 300));
    }
  };
  const sendsLeft = state.maxSends && state.sends ? state.maxSends - state.sends : null;

  return (
    <form className="code-step" onSubmit={submit} noValidate>
      <h2>{title}</h2>
      <p className="muted">We sent a 6-digit code to <b className="code-to">{email}</b>.</p>
      <CodeBoxes value={code} onChange={(v) => { setCode(v); setError(''); }} onComplete={(v) => submit(undefined, v)} disabled={busy} invalid={!!error} />
      <p className="code-meta" aria-live="polite">
        {left == null ? 'The code works for 5 minutes.' : expired ? <span className="warn">This code has expired. Send a new one.</span> : <>Works for <span className="mono">{mmss(left)}</span></>}
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {children}
      <button className="btn primary lg" disabled={busy || code.length !== 6}>{busy && <span className="spin" />}{submitLabel}</button>
      <div className="code-help">
        <span>No email? Check spam, then</span>{' '}
        <button type="button" className="link" onClick={resend} disabled={cool > 0}>{cool > 0 ? `send again in ${cool}s` : expired ? 'send a new code' : 'send it again'}</button>
        {sendsLeft != null && !expired && sendsLeft < 4 && <span className="muted">({sendsLeft} more {sendsLeft === 1 ? 'time' : 'times'})</span>}
      </div>
      {note && <p className="hint" role="status">{note}</p>}
      {extra}
    </form>
  );
}

/**
 * jhino.com/verify/code#123456, opened from "Copy code" in an email: copies the code (at once where the
 * browser allows it, otherwise with one tap). The code sits after "#", so it never reaches the server.
 */
export function CopyCodePage() {
  const [code] = useState(() => (/^#(\d{6})$/.exec(location.hash)?.[1] ?? ''));
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } };
  useEffect(() => {
    history.replaceState(null, '', location.pathname); // keep the code out of the address bar and history
    if (code) copy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className="copycode">
      <p className="copycode-mark">jhino<i /></p>
      {!code ? (
        <div className="copycode-card"><h1>Nothing to copy</h1><p className="muted">Open the "Copy code" button in your latest Jhino email again.</p><Link to="/login" className="btn primary lg">Go to Jhino</Link></div>
      ) : (
        <div className="copycode-card">
          <p className="copycode-l">Your code</p>
          <p className="copycode-code mono" aria-label={`Code ${code.split('').join(' ')}`}>{code}</p>
          <button className={`btn lg ${copied ? '' : 'primary'}`} onClick={copy}>{copied ? 'Copied ✓' : 'Copy code'}</button>
          <p className="muted">{copied ? 'Go back to Jhino and tap “Paste code”, or paste it into the boxes.' : 'Tap the button, then go back to Jhino and paste it.'}</p>
          <p className="hint">It works for 5 minutes. Never share it; Jhino will never ask you for it.</p>
        </div>
      )}
    </main>
  );
}
