import { Icon } from '../ui';
import { slugify } from './Address';

/*
 * "Show on Google": the page title, meta description and keyword an app is listed with, checked as they
 * are typed. Used in Share, and when uploading. The server checks the same limits when saving.
 */

/** Added to every page title on Google (the server adds it too). */
export const SEO_SUFFIX = ' | Jhino';

export interface SeoDraft { title: string; description: string; keyword: string }
export const emptySeo = (): SeoDraft => ({ title: '', description: '', keyword: '' });

/** Inside the limits the server takes: title 3-70, description 50-200, keyword 2-60. */
export const seoReady = (f: SeoDraft) => {
  const t = f.title.trim().length, d = f.description.trim().length, k = f.keyword.trim().length;
  return t >= 3 && t <= 70 && d >= 50 && d <= 200 && k >= 2 && k <= 60;
};

/** How a page looks in Google's results: the address, the title, the description. */
export function SerpPreview({ path, title, description }: { path: string; title: string; description: string }) {
  const crumbs = path.split('/').filter(Boolean);
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + ' …' : s);
  return (
    <div className="serp" aria-label="How it may look on Google">
      <span className="serp-site"><span className="serp-fav" aria-hidden="true" /><span><b>Jhino</b><small>{location.host}{crumbs.length ? ` › ${crumbs.join(' › ')}` : ''}</small></span></span>
      <span className="serp-title">{cut(title, 62)}</span>
      <span className="serp-desc">{description ? cut(description, 160) : 'Write a description: it shows here.'}</span>
    </div>
  );
}

/** Page title, meta description and primary keyword, with live checks and a Google preview. */
export function SeoFields({ value: f, onChange, path, fallbackTitle, suffix = SEO_SUFFIX }: {
  value: SeoDraft;
  onChange: (f: SeoDraft) => void;
  /** The page's address, like /ujjwal/my-app or /my-app. */
  path: string;
  fallbackTitle: string;
  suffix?: string;
}) {
  const kw = f.keyword.trim().toLowerCase();
  const titleLen = f.title.trim().length + suffix.length;
  const descLen = f.description.trim().length;
  const checks: [boolean, string][] = [
    [titleLen >= 30 && titleLen <= 60, `Title: ${titleLen} of 30 to 60 characters, "${suffix.trim()}" included`],
    [descLen >= 120 && descLen <= 160, `Description: ${descLen} of 120 to 160 characters`],
    [!!kw && f.title.toLowerCase().includes(kw), 'The keyword is in the title'],
    [!!kw && f.description.toLowerCase().includes(kw), 'The keyword is in the description'],
    [!!kw && path.includes(slugify(kw)), 'The keyword is in the address'],
  ];
  return (
    <>
      <label className="field"><span>Page title <em>{titleLen}/60</em></span>
        <span className="seo-title-in"><input className="input" required minLength={3} maxLength={70} value={f.title} onChange={(e) => onChange({ ...f, title: e.target.value })} placeholder="Wedding photographer in Kathmandu" /><span className="mono">{suffix.trim()}</span></span>
      </label>
      <label className="field"><span>Meta description <em>{descLen}/160</em></span>
        <textarea className="textarea" rows={3} required minLength={50} maxLength={200} value={f.description} onChange={(e) => onChange({ ...f, description: e.target.value })} placeholder="What the page offers, for whom and where, in one or two sentences. Search results show about 160 characters." />
      </label>
      <label className="field"><span>Primary keyword</span>
        <input className="input" required minLength={2} maxLength={60} value={f.keyword} onChange={(e) => onChange({ ...f, keyword: e.target.value })} placeholder="The words people type into Google to find this" />
      </label>
      <ul className="seo-checks" aria-label="Checks">
        {checks.map(([ok, t]) => <li key={t} className={ok ? 'ok' : ''}><Icon name={ok ? 'check' : 'info'} size={13} />{t}</li>)}
      </ul>
      <SerpPreview path={path} title={`${f.title.trim() || fallbackTitle}${suffix}`} description={f.description.trim()} />
    </>
  );
}
