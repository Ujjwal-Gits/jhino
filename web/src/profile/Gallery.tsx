/*
 * Internal review page for the 30 public-page themes (mounted at /_themes for super admins).
 * Renders every theme with the same sample page, in either layout, at phone or desktop width.
 * Query params preselect state: ?layout=profile&w=desktop&theme=<id>&photo=1.
 * With ?theme=<id>&live=1 it renders that one page full-screen, as visitors see it (promo included).
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { ProfileView } from './ProfileView';
import { ThemeThumb } from './ThemeThumb';
import { THEMES } from './themes';
import type { Branding, Layout, ProfileData, Tier } from './types';

const BRANDING: Record<Tier, Branding> = { free: 'popup', plus: 'badge', pro: 'none' };

function sample(theme: string, tier: Tier, layout: Layout, withPhoto: boolean): ProfileData {
  return {
    username: 'surstudio',
    name: 'Sur Studio',
    bio: 'Photo and video studio in Jhamsikhel. Portraits, food, and small-brand campaigns, shot and cut in-house.',
    location: 'Kathmandu',
    avatarUrl: withPhoto ? '/img/shoot-lattes.webp' : null,
    theme,
    layout,
    branding: BRANDING[tier],
    socials: [
      { kind: 'instagram', url: 'https://instagram.com/surstudio' },
      { kind: 'tiktok', url: 'https://tiktok.com/@surstudio' },
      { kind: 'youtube', url: 'https://youtube.com/@surstudio' },
      { kind: 'whatsapp', url: 'https://wa.me/9779800000000' },
      { kind: 'email', url: 'mailto:hello@surstudio.com.np' },
      { kind: 'website', url: 'https://surstudio.com.np' },
    ],
    items: [
      { id: 'h1', type: 'header', title: 'Work' },
      { id: 'l1', type: 'link', title: 'Showreel 2026', href: '/go/l1', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', thumb: withPhoto ? '/img/shoot-beans.webp' : null },
      { id: 'l2', type: 'link', title: 'Book a session', subtitle: 'Portraits, products, events', href: '/go/l2', url: 'https://cal.com/surstudio', highlight: true },
      { id: 'l3', type: 'link', title: 'Price list (PDF)', href: '/go/l3', url: 'https://surstudio.com.np/prices-2026.pdf' },
      { id: 't1', type: 'text', text: 'Walk-ins are welcome on Saturdays from 11 to 4. For weddings and campaigns, book at least two weeks ahead so we can scout the location with you.' },
      { id: 'v1', type: 'video', title: 'Behind the scenes: Himalayan Coffee', embed: 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ', href: '/go/v1' },
      { id: 'a1', type: 'app', title: 'Client room: Himalayan Coffee', subtitle: 'Proofs, picks and downloads', href: '/a/himalayan-coffee' },
    ],
  };
}

const ui: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#efeeea', color: '#141414', font: '14px/1.45 "Schibsted Grotesk Variable", Arial, sans-serif', padding: '28px 24px 80px' },
  bar: { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 24 },
  seg: { display: 'inline-flex', border: '1px solid #cfccc5', borderRadius: 7, overflow: 'hidden', background: '#fff' },
  thumbs: { display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 36 },
  grid: { display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' },
  card: { display: 'grid', gap: 10 },
  meta: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' },
  frame: { overflow: 'hidden', border: '1px solid #d6d3cc', borderRadius: 10, background: '#fff' },
};

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span style={ui.seg}>
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
          style={{ padding: '7px 12px', border: 0, font: 'inherit', cursor: 'pointer', background: value === v ? '#141414' : 'transparent', color: value === v ? '#fff' : '#141414' }}>
          {label}
        </button>
      ))}
    </span>
  );
}

export function ProfileGallery() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [layout, setLayout] = useState<Layout>(params.get('layout') === 'profile' ? 'profile' : 'links');
  const [width, setWidth] = useState<'phone' | 'desktop'>(params.get('w') === 'desktop' ? 'desktop' : 'phone');
  const [tier, setTier] = useState<'all' | Tier>('all');
  const only = params.get('theme');
  const photo = params.get('photo');
  const frameW = width === 'phone' ? 390 : 1240;

  if (only && params.get('live')) {
    const t = THEMES.find((x) => x.id === only) ?? THEMES[0];
    return <ProfileView data={sample(t.id, t.tier, layout, photo === '1')} />;
  }

  const list = THEMES.filter((t) => (tier === 'all' || t.tier === tier) && (!only || t.id === only));

  return (
    <div style={ui.page}>
      <div style={ui.bar}>
        <strong style={{ fontSize: 16, marginRight: 8 }}>Page themes ({THEMES.length})</strong>
        <Seg value={layout} onChange={setLayout} options={[['links', 'Links'], ['profile', 'Profile']]} />
        <Seg value={width} onChange={setWidth} options={[['phone', 'Phone 390'], ['desktop', 'Desktop 1240']]} />
        <Seg value={tier} onChange={setTier} options={[['all', 'All'], ['free', 'Free'], ['plus', 'Plus'], ['pro', 'Pro']]} />
      </div>

      {!only && (
        <div style={ui.thumbs}>
          {list.map((t) => (
            <figure key={t.id} style={{ margin: 0, display: 'grid', gap: 6, justifyItems: 'start' }}>
              <ThemeThumb id={t.id} />
              <figcaption style={{ fontSize: 12, color: '#4b4a47' }}>{t.name}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <div style={ui.grid}>
        {list.map((t, i) => (
          <section key={t.id} style={{ ...ui.card, width: frameW }} data-theme-card={t.id}>
            <div style={ui.meta}>
              <strong>{t.name}</strong>
              <code style={{ color: '#75736e' }}>{t.id}</code>
              <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: t.tier === 'free' ? '#1f7a4d' : t.tier === 'plus' ? '#9a5b00' : '#b3261e' }}>{t.tier}</span>
              <span style={{ color: '#75736e' }}>{t.blurb}</span>
            </div>
            <div style={{ ...ui.frame, width: frameW }} data-frame={t.id}>
              <ProfileView data={sample(t.id, t.tier, layout, photo ? photo === '1' : i % 2 === 1)} preview />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
