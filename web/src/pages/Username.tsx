import { useEffect, useState } from 'react';
import { get } from '../api';
import { Icon } from '../ui';

/*
 * The username: the name in every address someone makes (jhino.com/<username> is their page;
 * their apps and short links live under it). Checked as it is typed; the server checks again.
 */

type Check = { state: 'idle' | 'checking' | 'ok' | 'bad'; reason?: string };
export const cleanUsername = (s: string) => s.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 30);
export const suggestFrom = (s: string) => cleanUsername(s.split('@')[0].normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, ''));

/** `admin`: a super admin setting someone's name, who may use general words (faq, services…). */
export function useUsernameCheck(name: string, current?: string | null, admin = false): Check {
  const [c, setC] = useState<Check>({ state: 'idle' });
  useEffect(() => {
    if (!name) { setC({ state: 'idle' }); return; }
    if (current && name === current.toLowerCase()) { setC({ state: 'ok' }); return; }
    setC({ state: 'checking' });
    let live = true;
    const t = setTimeout(() => {
      get<{ available: boolean; reason?: string }>(`/api/usernames/check?name=${encodeURIComponent(name)}${admin ? '&admin=1' : ''}`).then(
        (r) => { if (live) setC(r.available ? { state: 'ok' } : { state: 'bad', reason: r.reason }); },
        () => { if (live) setC({ state: 'idle' }); },
      );
    }, 280);
    return () => { live = false; clearTimeout(t); };
  }, [name, current, admin]);
  return c;
}

export function UsernameField({ value, onChange, check, label = 'Username', autoFocus = false }: { value: string; onChange: (v: string) => void; check: Check; label?: string; autoFocus?: boolean }) {
  return (
    <div className="field addr-field">
      <label htmlFor="uname">{label}</label>
      <div className={`addr-input ${check.state}`}>
        <span className="addr-host mono">{location.host}/</span>
        <input id="uname" className="mono" value={value} maxLength={30} autoComplete="username" spellCheck={false} autoFocus={autoFocus}
          placeholder="your-studio" onChange={(e) => onChange(cleanUsername(e.target.value))} aria-invalid={check.state === 'bad'} aria-describedby="uname-s" />
        <span className="addr-state" aria-hidden="true">
          {check.state === 'checking' && <span className="spin" />}
          {check.state === 'ok' && <Icon name="check" size={16} />}
          {check.state === 'bad' && <Icon name="close" size={16} />}
        </span>
      </div>
      <small id="uname-s" className={`hint ${check.state === 'bad' ? 'error-text' : ''}`} aria-live="polite">
        {check.state === 'bad' ? check.reason : check.state === 'ok' ? <>Yours. Your page is <span className="mono">{location.host}/{value}</span>, and your apps live under it.</> : 'Your page and every address you make use it. Letters, numbers, - and _.'}
      </small>
    </div>
  );
}
