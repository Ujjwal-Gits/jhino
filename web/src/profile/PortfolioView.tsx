/*
 * The profile page (jhino.com/<username>/profile, or the home page if the person chose it): a studio
 * portfolio, nothing like the links page. A cover, the name set large, what they do, a few numbers,
 * services with prices, their work, a film, where else to find them, and a way to get in touch.
 */
import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import type { ProfileData, ProfileItem, Social } from './types';
import { ArrowGlyph, CloseGlyph, GoGlyph, MailGlyph, PinGlyph, SOCIAL_LABEL, SocialIcon } from './glyphs';
import { Promo, hostOf, initialsOf } from './ProfileView';
import './fonts.css';
import './portfolio.css';

export interface PaletteMeta { id: string; name: string; bg: string; fg: string; muted: string; accent: string; accentFg: string; surface: string; line: string }
export const PALETTES: PaletteMeta[] = [
  { id: 'studio', name: 'Studio', bg: '#faf9f6', fg: '#151412', muted: '#6d6a63', accent: '#e0461f', accentFg: '#ffffff', surface: '#efece5', line: '#dcd8cf' },
  { id: 'night', name: 'Night', bg: '#0f0f0e', fg: '#efece5', muted: '#9a968c', accent: '#ff6a3d', accentFg: '#0f0f0e', surface: '#1a1a18', line: '#2e2d29' },
  { id: 'sand', name: 'Sand', bg: '#efe7da', fg: '#251f19', muted: '#76695a', accent: '#a4471f', accentFg: '#fff8ef', surface: '#e5dac8', line: '#d2c4ae' },
  { id: 'forest', name: 'Forest', bg: '#13291f', fg: '#ecf0e4', muted: '#a3b3a3', accent: '#d9b56a', accentFg: '#13291f', surface: '#1a3528', line: '#2d4a3b' },
  { id: 'navy', name: 'Navy', bg: '#0e1a2b', fg: '#e6ecf5', muted: '#94a4bb', accent: '#9cc1ff', accentFg: '#0e1a2b', surface: '#152338', line: '#253652' },
  { id: 'oxblood', name: 'Oxblood', bg: '#3a1216', fg: '#f4e5dc', muted: '#cda89c', accent: '#e9b87c', accentFg: '#3a1216', surface: '#46191e', line: '#62292f' },
  { id: 'stone', name: 'Stone', bg: '#e3e0da', fg: '#1e1d1b', muted: '#67635b', accent: '#1e1d1b', accentFg: '#e3e0da', surface: '#d8d4cc', line: '#c2bdb3' },
  { id: 'porcelain', name: 'Porcelain', bg: '#f5f7f8', fg: '#16222b', muted: '#667580', accent: '#2f6fb0', accentFg: '#ffffff', surface: '#ffffff', line: '#dde3e7' },
];
export const paletteById = (id: string) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];
const paletteVars = (p: PaletteMeta) => ({
  '--pp-bg': p.bg, '--pp-fg': p.fg, '--pp-muted': p.muted, '--pp-accent': p.accent, '--pp-accent-fg': p.accentFg, '--pp-surface': p.surface, '--pp-line': p.line,
} as CSSProperties);

const contactOf = (socials: Social[]) => ({
  email: socials.find((s) => s.kind === 'email')?.url ?? null,
  phone: socials.find((s) => s.kind === 'phone')?.url ?? null,
  whatsapp: socials.find((s) => s.kind === 'whatsapp')?.url ?? null,
});

export function PortfolioView({ data, preview = false, paletteId, type }: { data: ProfileData; preview?: boolean; paletteId?: string; type?: 'sans' | 'serif' }) {
  const p = data.portfolio;
  const pal = paletteById(paletteId ?? p.palette);
  const stop = preview ? (e: MouseEvent) => e.preventDefault() : undefined;
  const [open, setOpen] = useState<number | null>(null);
  const items = data.items.filter((i) => preview || !i.hidden);
  const film = items.find((i): i is Extract<ProfileItem, { type: 'video' }> => i.type === 'video');
  const links = items.filter((i): i is Extract<ProfileItem, { type: 'link' | 'app' }> => i.type === 'link' || i.type === 'app');
  const contact = contactOf(data.socials);
  const others = data.socials.filter((s) => !['email', 'phone'].includes(s.kind));
  const about = p.about || data.bio;
  const cta = p.cta ?? (contact.whatsapp ? { label: 'Message on WhatsApp', url: contact.whatsapp } : contact.email ? { label: 'Email', url: contact.email } : null);
  return (
    <div className="pp" data-palette={pal.id} data-type={type ?? p.type} data-preview={preview ? '' : undefined} style={paletteVars(pal)}>
      <div className="pp-cover">{p.coverUrl ? <img src={p.coverUrl} alt="" /> : <span className="pp-cover-mark" aria-hidden="true">{initialsOf(data.name, data.username)}</span>}</div>

      <div className="pp-wrap">
        <header className="pp-id">
          {data.avatarUrl
            ? <img className="pp-avatar" src={data.avatarUrl} alt={`Photo of ${data.name || data.username}`} width={132} height={132} />
            : <span className="pp-avatar pp-initials" aria-hidden="true">{initialsOf(data.name, data.username)}</span>}
          <div className="pp-who">
            <h1 className="pp-name">{data.name || data.username}</h1>
            {p.headline && <p className="pp-headline">{p.headline}</p>}
            <p className="pp-meta">
              {data.location && <span><PinGlyph />{data.location}</span>}
              <span className="pp-handle">@{data.username}</span>
            </p>
          </div>
          <div className="pp-actions">
            {cta && <a className="pp-btn primary" href={cta.url} target="_blank" rel="noopener" onClick={stop}>{cta.label}<ArrowGlyph /></a>}
            {contact.email && cta?.url !== contact.email && <a className="pp-btn" href={contact.email} onClick={stop}><MailGlyph />Email</a>}
          </div>
        </header>

        {others.length > 0 && (
          <ul className="pp-socials" aria-label="Elsewhere">
            {others.map((s, i) => <li key={s.kind + i}><a href={s.url} target="_blank" rel="noopener" onClick={stop}><SocialIcon kind={s.kind} /><span>{SOCIAL_LABEL[s.kind]}</span></a></li>)}
          </ul>
        )}

        {p.stats.length > 0 && (
          <dl className="pp-stats" data-n={p.stats.length}>
            {p.stats.map((s, i) => <div key={i}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
          </dl>
        )}

        {about && (
          <section className="pp-sec pp-about" aria-labelledby="pp-about-h">
            <h2 id="pp-about-h">About</h2>
            <p>{about}</p>
          </section>
        )}

        {p.services.length > 0 && (
          <section className="pp-sec" aria-labelledby="pp-svc-h">
            <h2 id="pp-svc-h">Services</h2>
            <ul className="pp-services">
              {p.services.map((s, i) => (
                <li key={i}>
                  <div><b>{s.name}</b>{s.note && <span>{s.note}</span>}</div>
                  {s.price && <em>{s.price}</em>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {p.work.length > 0 && (
          <section className="pp-sec pp-work-sec" aria-labelledby="pp-work-h">
            <h2 id="pp-work-h">Work</h2>
            <ul className="pp-work" data-odd={p.work.length % 2 ? '' : undefined}>
              {p.work.map((w, i) => (
                <li key={w.id} data-s={tileSize(i, p.work.length)}>
                  <button type="button" onClick={() => setOpen(i)} aria-label={w.caption ? `Open: ${w.caption}` : `Open image ${i + 1}`}>
                    <img src={w.url} alt={w.caption} loading="lazy" />
                  </button>
                  {w.caption && <span className="pp-cap">{w.caption}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {film && (
          <section className="pp-sec pp-film" aria-labelledby="pp-film-h">
            <h2 id="pp-film-h">{film.title || 'Film'}</h2>
            <div className="pp-film-box"><iframe src={film.embed} title={film.title || 'Film'} loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>
          </section>
        )}

        {links.length > 0 && (
          <section className="pp-sec" aria-labelledby="pp-links-h">
            <h2 id="pp-links-h">Links</h2>
            <ul className="pp-links">
              {links.map((l) => (
                <li key={l.id} data-hidden={l.hidden ? '' : undefined}>
                  <a href={l.href} target="_blank" rel="noopener" onClick={stop}>
                    <b>{l.title}</b><span>{l.subtitle || (l.type === 'link' ? hostOf(l.url) : 'Jhino app')}</span><GoGlyph />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(contact.email || contact.phone || contact.whatsapp) && (
          <section className="pp-contact" aria-labelledby="pp-contact-h">
            <h2 id="pp-contact-h">Work with {(data.name || data.username).split(' ')[0]}</h2>
            <div className="pp-contact-row">
              {contact.whatsapp && <a className="pp-btn primary" href={contact.whatsapp} target="_blank" rel="noopener" onClick={stop}><SocialIcon kind="whatsapp" />WhatsApp</a>}
              {contact.email && <a className="pp-btn" href={contact.email} onClick={stop}><MailGlyph />{contact.email.replace(/^mailto:/, '')}</a>}
              {contact.phone && <a className="pp-btn" href={contact.phone} onClick={stop}><SocialIcon kind="phone" />{contact.phone.replace(/^tel:/, '')}</a>}
            </div>
          </section>
        )}

        {data.branding !== 'none' && (
          <footer className="pp-foot"><a className="pf-badge" href="/" onClick={stop}>Made with <span className="pf-wordmark">jhino<i aria-hidden="true" /></span></a></footer>
        )}
      </div>

      {open !== null && p.work[open] && <Lightbox work={p.work} index={open} onClose={() => setOpen(null)} onGo={setOpen} />}
      {data.branding === 'popup' && !preview && <Promo username={data.username} />}
    </div>
  );
}

function Lightbox({ work, index, onClose, onGo }: { work: { url: string; caption: string }[]; index: number; onClose: () => void; onGo: (i: number) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onGo((index + 1) % work.length);
      if (e.key === 'ArrowLeft') onGo((index - 1 + work.length) % work.length);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [index, work.length, onClose, onGo]);
  const w = work[index];
  return (
    <div className="pp-lb" role="dialog" aria-modal="true" aria-label="Work" onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={w.url} alt={w.caption} />
        <figcaption><span>{w.caption}</span><span className="pp-lb-n">{index + 1} / {work.length}</span></figcaption>
      </figure>
      {work.length > 1 && <>
        <button className="pp-lb-nav prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); onGo((index - 1 + work.length) % work.length); }}><ArrowGlyph /></button>
        <button className="pp-lb-nav next" aria-label="Next" onClick={(e) => { e.stopPropagation(); onGo((index + 1) % work.length); }}><ArrowGlyph /></button>
      </>}
      <button className="pp-lb-close" aria-label="Close" onClick={onClose}><CloseGlyph /></button>
    </div>
  );
}

/** Rows always fill on a six-column grid: a large first photo when the count divides by three, else pairs first, then threes. */
function tileSize(i: number, n: number) {
  if (n === 1) return 'full';
  if (n % 3 === 0) return i === 0 ? 'big' : 'third';
  return i < (n % 3 === 1 ? 4 : 2) ? 'half' : 'third';
}
