/*
 * The links page (jhino.com/<username>/links, or the home page if the person chose it). One calm
 * structure for every design: a photo, the name, a line, socials, then full-width buttons. A design
 * (themes.ts) only changes colour, type and how the buttons are drawn.
 */
import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import type { ProfileData, ProfileItem } from './types';
import { themeById, themeVars } from './themes';
import { AppGlyph, CloseGlyph, GoGlyph, PinGlyph, SOCIAL_LABEL, SocialIcon } from './glyphs';
import './fonts.css';
import './profile.css';

const PROMO_KEY = 'jhino:promo-dismissed';

export const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./, '').split(/[/?#]/)[0] || url; }
};
export const initialsOf = (name: string, username: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || username || '?').slice(0, 1)).toUpperCase();
};

export function ProfileView({ data, preview = false, themeId }: { data: ProfileData; preview?: boolean; themeId?: string }) {
  const t = themeById(themeId ?? data.theme);
  const stop = preview ? (e: MouseEvent) => e.preventDefault() : undefined;
  const items = data.items.filter((i) => preview || !i.hidden);
  return (
    <div className="pf" data-theme={t.id} data-btn={t.btn} data-caps={t.caps ? '' : undefined} data-preview={preview ? '' : undefined} style={themeVars(t)}>
      <main className="pf-page">
        <header className="pf-head">
          {data.avatarUrl
            ? <img className="pf-avatar" src={data.avatarUrl} alt={`Photo of ${data.name || data.username}`} width={112} height={112} />
            : <span className="pf-avatar pf-initials" aria-hidden="true">{initialsOf(data.name, data.username)}</span>}
          <h1 className="pf-name">{data.name || data.username}</h1>
          {data.bio && <p className="pf-bio">{data.bio}</p>}
          {data.location && <p className="pf-meta"><PinGlyph />{data.location}</p>}
          {data.socials.length > 0 && (
            <ul className="pf-socials">
              {data.socials.map((s, i) => (
                <li key={s.kind + i}>
                  <a className="pf-social" href={s.url} target="_blank" rel="noopener" aria-label={SOCIAL_LABEL[s.kind] ?? 'Link'} onClick={stop}><SocialIcon kind={s.kind} /></a>
                </li>
              ))}
            </ul>
          )}
        </header>

        <section className="pf-items" aria-label="Links">
          {items.map((item, i) => <Item key={item.id} item={item} index={i} stop={stop} />)}
          {!items.length && preview && <p className="pf-empty">Your links will show here.</p>}
        </section>

        {data.branding !== 'none' && (
          <footer className="pf-foot">
            <a className="pf-badge" href="/" onClick={stop}>Made with <span className="pf-wordmark">jhino<i aria-hidden="true" /></span></a>
          </footer>
        )}
      </main>
      {data.branding === 'popup' && !preview && <Promo username={data.username} />}
    </div>
  );
}

function Item({ item, index, stop }: { item: ProfileItem; index: number; stop?: (e: MouseEvent) => void }) {
  const style = { '--i': index } as CSSProperties;
  const hidden = item.hidden ? '' : undefined;
  switch (item.type) {
    case 'header':
      return <h2 className="pf-section" style={style} data-hidden={hidden}>{item.title}</h2>;
    case 'text':
      return <p className="pf-text" style={style} data-hidden={hidden}>{item.text}</p>;
    case 'video':
      return (
        <figure className="pf-video" style={style} data-hidden={hidden}>
          <div className="pf-video-box">
            <iframe src={item.embed} title={item.title || 'Video'} loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          </div>
          {item.title && <figcaption>{item.title}</figcaption>}
        </figure>
      );
    case 'app':
      return (
        <a className="pf-link" href={item.href} target="_blank" rel="noopener" style={style} onClick={stop} data-hidden={hidden}>
          <span className="pf-link-icon" aria-hidden="true"><AppGlyph /></span>
          <span className="pf-link-text"><b>{item.title}</b>{item.subtitle && <small>{item.subtitle}</small>}</span>
          <span className="pf-link-go" aria-hidden="true"><GoGlyph /></span>
        </a>
      );
    case 'link': {
      const host = hostOf(item.url);
      return (
        <a className="pf-link" href={item.href} target="_blank" rel="noopener" style={style} onClick={stop} data-highlight={item.highlight ? '' : undefined} data-hidden={hidden}>
          <span className="pf-link-icon" aria-hidden="true">{item.thumb ? <img src={item.thumb} alt="" loading="lazy" /> : <span className="pf-letter">{(host[0] || '•').toUpperCase()}</span>}</span>
          <span className="pf-link-text"><b>{item.title}</b>{item.subtitle && <small>{item.subtitle}</small>}</span>
          <span className="pf-link-go" aria-hidden="true"><GoGlyph /></span>
        </a>
      );
    }
  }
}

/** Free pages: a small note after a few seconds. Remembered for the visit once closed. */
export function Promo({ username }: { username: string }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem(PROMO_KEY)) return; } catch { /* storage blocked: show it anyway */ }
    const t = window.setTimeout(() => setMounted(true), 4000);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!mounted) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    return () => cancelAnimationFrame(r);
  }, [mounted]);
  const close = () => {
    setOpen(false);
    try { sessionStorage.setItem(PROMO_KEY, '1'); } catch { /* ignore */ }
    window.setTimeout(() => setMounted(false), 320);
  };
  if (!mounted) return null;
  return (
    <div className="pf-promo" role="dialog" aria-label="Made with Jhino" data-open={open ? '' : undefined}>
      <span className="pf-promo-mark" aria-hidden="true">j<i /></span>
      <p>This page is made with Jhino<a href={`/signup?ref=${encodeURIComponent(username)}`}>Make yours, free</a></p>
      <button type="button" className="pf-promo-close" aria-label="Close" onClick={close}><CloseGlyph /></button>
    </div>
  );
}

export { ProfileView as LinksView };
