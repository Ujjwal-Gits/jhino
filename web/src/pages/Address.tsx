import { useEffect, useState } from 'react';
import { get } from '../api';
import { Link, useSession } from '../context';
import { Icon } from '../ui';

/*
 * An app's own address, jhino.com/<name>, and who can open it. Used when uploading, in Create app,
 * and in Share. The name is checked as it is typed; the server checks again when saving.
 */

export type Access = 'private' | 'public' | 'password';
export interface OpenSettings { access: Access; password: string }

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
export const HOST = () => location.host;
/** Where a person's addresses live: jhino.com/<username>/ */
export const addrBase = (username?: string | null) => (username ? `${location.host}/${username}` : location.host);

type Check = { state: 'idle' | 'checking' | 'ok' | 'bad'; reason?: string };
/** Is this name free? Checked a moment after typing stops. */
export function useNameCheck(name: string, except: { app?: string; link?: string; top?: boolean } = {}): Check {
  const [c, setC] = useState<Check>({ state: 'idle' });
  useEffect(() => {
    if (!name) { setC({ state: 'idle' }); return; }
    setC({ state: 'checking' });
    let live = true;
    const t = setTimeout(() => {
      const q = new URLSearchParams({
        name,
        ...(except.app ? { app: except.app } : {}),
        ...(except.link ? { link: except.link } : {}),
        ...(except.top ? { top: '1' } : {}),
      });
      get<{ available: boolean; reason?: string }>(`/api/addresses/check?${q}`).then(
        (r) => { if (live) setC(r.available ? { state: 'ok' } : { state: 'bad', reason: r.reason }); },
        () => { if (live) setC({ state: 'idle' }); },
      );
    }, 280);
    return () => { live = false; clearTimeout(t); };
  }, [name, except.app, except.link, except.top]);
  return c;
}

/** A small "Plus" tag that says a feature needs a paid plan, and goes to the plans. */
export function PlanTag({ plan = 'Plus' }: { plan?: string }) {
  return <Link to="/account/plan" className="plan-tag" title={`On ${plan} and up. See plans.`}>{plan}</Link>;
}

export function AddressField({
  value,
  onChange,
  check,
  appId,
  optional = true,
  mode = 'standard',
}: {
  value: string;
  onChange: (v: string) => void;
  check: Check;
  appId?: string;
  optional?: boolean;
  mode?: 'standard' | 'root';
}) {
  const { user } = useSession();
  const f = user.features;
  const id = `addr-${appId ?? 'new'}`;
  const isRoot = mode === 'root';
  const prefix = isRoot ? `${HOST()}/` : `${addrBase(user.username)}/`;

  return (
    <div className="field addr-field">
      <label htmlFor={id}>Address {optional && <em>optional</em>}</label>
      <div className={`addr-input ${check.state}`}>
        <span className="addr-host mono">{prefix}</span>
        <input
          id={id}
          className="mono"
          value={value}
          maxLength={50}
          autoComplete="off"
          spellCheck={false}
          placeholder={isRoot ? 'a, abc, 1, or your-name' : 'your-studio'}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-'))}
          aria-invalid={check.state === 'bad'}
          aria-describedby={`${id}-s`}
        />
        <span className="addr-state" aria-hidden="true">
          {check.state === 'checking' && <span className="spin" />}
          {check.state === 'ok' && <Icon name="check" size={16} />}
          {check.state === 'bad' && <Icon name="close" size={16} />}
        </span>
      </div>
      <small id={`${id}-s`} className={`hint ${check.state === 'bad' ? 'error-text' : ''}`} aria-live="polite">
        {check.state === 'bad' ? (
          check.reason
        ) : check.state === 'ok' ? (
          <>
            Free. It opens at <span className="mono">{prefix}{value}</span>{isRoot ? ', directly without username.' : ', exactly that address.'}
          </>
        ) : isRoot ? (
          <>Direct root address on {HOST()}. 1 to 50 lowercase letters, numbers or dashes (e.g. /a, /abc, /1).</>
        ) : (
          <>
            Lowercase letters, numbers and dashes. {f && f.addresses < 1e6 ? `Your plan includes ${f.addresses} address${f.addresses === 1 ? '' : 'es'}.` : ''}
          </>
        )}
      </small>
    </div>
  );
}

/** Who can open it: the people you add, anyone with the address or link, or anyone with a password. */
export function OpenChoice({ value, onChange, compact = false }: { value: OpenSettings; onChange: (v: OpenSettings) => void; compact?: boolean }) {
  const { user } = useSession();
  const pwOk = !!user.features?.passwordLinks;
  const opts: [Access, string, string][] = [
    ['public', 'Anyone with the address', 'Opens straight away, like a website.'],
    ['password', 'Anyone with the password', 'Asks once for a password you choose.'],
    ['private', 'Only people I add', 'Each signs in with their own ID.'],
  ];
  return (
    <div className="field">
      <span>Who can open it</span>
      <div className={`open-choice ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="Who can open it">
        {opts.map(([k, l, d]) => {
          const locked = k === 'password' && !pwOk;
          return (
            <button key={k} type="button" role="radio" aria-checked={value.access === k} aria-disabled={locked} className="oc-opt"
              onClick={() => { if (!locked) onChange({ ...value, access: k }); }}>
              <span className="radio" />
              <span className="oc-t"><b>{l}{locked && <PlanTag />}</b>{!compact && <small>{d}</small>}</span>
            </button>
          );
        })}
      </div>
      {value.access === 'password' && (
        <input className="input" type="text" autoComplete="new-password" minLength={4} maxLength={100} placeholder="Password for visitors (4 or more characters)"
          value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} aria-label="Password for visitors" />
      )}
    </div>
  );
}

/** Ready to send with a new app: the address and how it opens. */
export function addressPayload(slug: string, open: OpenSettings) {
  return { slug: slug || undefined, access: open.access, password: open.access === 'password' ? open.password : undefined };
}
export const openReady = (slug: string, check: Check, open: OpenSettings) =>
  (!slug || check.state === 'ok') && (open.access !== 'password' || open.password.length >= 4);
