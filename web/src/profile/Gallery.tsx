/*
 * Every links-page design and every profile palette with sample content, for super admins to check
 * (jhino.com/_themes). Not linked from anywhere.
 */
import { useState } from 'react';
import { ProfileView } from './ProfileView';
import { PortfolioView, PALETTES } from './PortfolioView';
import { THEMES } from './themes';
import type { ProfileData } from './types';

export const SAMPLE: ProfileData = {
  username: 'surstudio', name: 'Sur Studio', bio: 'Photo and video studio in Kathmandu. Weddings, brands and podcasts.', location: 'Kathmandu',
  avatarUrl: null, theme: 'paper', home: 'links', branding: 'badge',
  socials: [{ kind: 'instagram', url: '#' }, { kind: 'tiktok', url: '#' }, { kind: 'youtube', url: '#' }, { kind: 'whatsapp', url: 'https://wa.me/9779800000000' }, { kind: 'email', url: 'mailto:hello@surstudio.com' }],
  items: [
    { id: 'a', type: 'link', title: 'Book a session', subtitle: 'Weekdays, 10 to 6', href: '#', url: 'https://surstudio.com/book', highlight: true },
    { id: 'b', type: 'link', title: 'Price list 2026', href: '#', url: 'https://surstudio.com/prices.pdf' },
    { id: 'c', type: 'header', title: 'Work' },
    { id: 'd', type: 'video', title: 'Showreel 2026', embed: 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ', href: '#' },
    { id: 'e', type: 'app', title: 'Client room: Himalayan Coffee', subtitle: 'Jhino app', href: '#' },
  ],
  portfolio: {
    headline: 'Photo and film for brands, weddings and podcasts', about: 'We are a small studio in Jhamsikhel. Since 2017 we have made brand films, wedding stories and podcast series for people across Nepal.',
    coverUrl: '/img/cut-pour-over.webp', cta: { label: 'Book a session', url: '#' },
    stats: [{ value: '9 yrs', label: 'making films' }, { value: '240+', label: 'weddings' }, { value: '1.2M', label: 'views last year' }],
    services: [{ name: 'Brand film', note: 'Concept, shoot and edit, up to 2 minutes', price: 'from NPR 80,000' }, { name: 'Wedding story', note: 'Two shooters, full day', price: 'from NPR 120,000' }, { name: 'Podcast', note: 'Three cameras, per episode', price: 'NPR 15,000' }],
    work: ['shoot-iced', 'shoot-lattes', 'shoot-cheers', 'shoot-beans', 'cut-pour-over'].map((n, i) => ({ id: n, url: `/img/${n}.webp`, caption: i === 0 ? 'Himalayan Coffee, spring' : '' })),
    palette: 'studio', type: 'sans',
  },
};

export function ProfileGallery() {
  const [which, setWhich] = useState<'links' | 'profile'>('links');
  return (
    <div style={{ padding: 24, display: 'grid', gap: 16, background: '#e9e7e2', minHeight: '100vh' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn sm" aria-pressed={which === 'links'} onClick={() => setWhich('links')}>Links designs</button>
        <button className="btn sm" aria-pressed={which === 'profile'} onClick={() => setWhich('profile')}>Profile palettes</button>
      </div>
      {which === 'links' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 390px)', gap: 16 }}>
          {THEMES.map((t) => (
            <div key={t.id}><p style={{ margin: '0 0 6px', font: '600 13px sans-serif' }}>{t.name} · {t.tier}</p>
              <div style={{ height: 760, overflow: 'auto', borderRadius: 12 }}><ProfileView data={{ ...SAMPLE, theme: t.id }} preview /></div></div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          {PALETTES.map((p, i) => (
            <div key={p.id}><p style={{ margin: '0 0 6px', font: '600 13px sans-serif' }}>{p.name}</p>
              <div style={{ borderRadius: 12, overflow: 'hidden' }}><PortfolioView data={SAMPLE} paletteId={p.id} type={i % 2 ? 'serif' : 'sans'} preview /></div></div>
          ))}
        </div>
      )}
    </div>
  );
}
