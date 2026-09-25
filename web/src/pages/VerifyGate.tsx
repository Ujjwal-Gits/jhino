import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, post, type User } from '../api';
import { useToast } from '../ui';
import { CodeStep, type CodeInfo } from './CodeEntry';

/*
 * A customer whose email is not confirmed sees this over the dashboard until it is: send the code
 * to that email, or change to a real email and confirm that one. Their apps and data stay as they
 * are behind it; only the email changes.
 */
type Step = { k: 'start' } | { k: 'code'; email: string; info: CodeInfo } | { k: 'change' } | { k: 'code-new'; email: string; password: string; info: CodeInfo };

export function VerifyGate({ user, onDone }: { user: User; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>({ k: 'start' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ email: '', password: '' });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, [step.k]);

  const send = async () => {
    setBusy(true); setError('');
    try { const r = await post<CodeInfo & { email?: string }>('/api/account/verify/resend'); setStep({ k: 'code', email: r.email ?? user.email, info: r }); }
    catch (e) {
      // Asked again too soon: the code already went out; show the boxes anyway.
      if (e instanceof ApiError && (e.code === 'CODE_TOO_SOON' || e.code === 'CODE_SEND_LIMIT')) setStep({ k: 'code', email: user.email, info: { note: e.message } });
      else setError(e instanceof ApiError ? e.message : 'Could not send the code.');
    }
    setBusy(false);
  };
  const change = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { const r = await post<CodeInfo & { pendingEmail: string }>('/api/account/email', f); setStep({ k: 'code-new', email: r.pendingEmail, password: f.password, info: r }); }
    catch (e2) { setError(e2 instanceof ApiError ? e2.message : 'Could not change it.'); }
    setBusy(false);
  };
  const confirm = async (code: string) => {
    await post('/api/auth/verify-code', { code });
    await onDone();
    toast('Email confirmed');
  };
  const signOut = async () => { try { await post('/api/auth/logout'); } finally { location.href = '/'; } };

  return (
    <div className="vgate" role="dialog" aria-modal="true" aria-labelledby="vgate-h">
      <div className="vgate-card" ref={box} tabIndex={-1}>
        <p className="vgate-mark" aria-hidden="true">jhino<i /></p>
        {step.k === 'start' && (
          <div className="vgate-body">
            <h2 id="vgate-h">Confirm your email</h2>
            <p className="muted">To keep your account safe, confirm the email you sign in with. Your apps and everything in them stay exactly as they are.</p>
            <div className="vgate-addr"><span className="muted small">Your email</span><b>{user.email}</b></div>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button className="btn primary lg" onClick={send} disabled={busy}>{busy && <span className="spin" />}Send me the code</button>
            <button className="btn lg" onClick={() => { setError(''); setStep({ k: 'change' }); }}>This is not a real email: change it</button>
          </div>
        )}
        {step.k === 'change' && (
          <form className="vgate-body" onSubmit={change} noValidate>
            <h2 id="vgate-h">Use a different email</h2>
            <p className="muted">We send a code to the new address. Once you confirm it, it becomes your sign-in email. Nothing else changes.</p>
            <label className="field"><span>New email</span><input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoFocus /></label>
            <label className="field"><span>Your password</span><input className="input" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /><small className="hint">To check it is you.</small></label>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button className="btn primary lg" disabled={busy || !f.email || !f.password}>{busy && <span className="spin" />}Send the code</button>
            <button type="button" className="link" onClick={() => setStep({ k: 'start' })}>Back</button>
          </form>
        )}
        {step.k === 'code' && (
          <CodeStep title="Enter the code" email={step.email} info={step.info} onSubmit={confirm}
            onResend={() => post<CodeInfo>('/api/account/verify/resend')}
            extra={<button type="button" className="link" onClick={() => setStep({ k: 'change' })}>Use a different email</button>} />
        )}
        {step.k === 'code-new' && (
          <CodeStep title="Enter the code" email={step.email} info={step.info} onSubmit={confirm}
            onResend={() => post<CodeInfo>('/api/account/email', { email: step.email, password: step.password })}
            extra={<button type="button" className="link" onClick={() => setStep({ k: 'change' })}>Change the address</button>} />
        )}
        <p className="vgate-out"><button type="button" className="link small" onClick={signOut}>Sign out</button></p>
      </div>
    </div>
  );
}
