/*
 * Icons for the public pages, drawn for Jhino on a 24×24 grid, monochrome (currentColor). They are
 * our own drawings of each network, not official brand marks.
 */
import type { ReactNode } from 'react';
import type { SocialKind } from './types';

export function PinGlyph() {
  return <Svg className="pf-ico pf-ico-pin">{S('M12 20.5s-6-5.4-6-10.3a6 6 0 0 1 12 0c0 4.9-6 10.3-6 10.3z M12 12.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z')}</Svg>;
}
export function ArrowGlyph() {
  return <Svg className="pf-ico">{S('M5 12h14 M13 6l6 6-6 6')}</Svg>;
}
export function MailGlyph() {
  return <Svg className="pf-ico">{S('M3.8 7.2l8.2 5.9 8.2-5.9')}<rect x="3.2" y="5.6" width="17.6" height="12.8" rx="2" /></Svg>;
}

export const S = (d: string) => <path d={d} />;

const GLYPHS: Record<SocialKind, ReactNode> = {
  instagram: (<><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="3.9" /><circle cx="17.1" cy="6.9" r="0.9" fill="currentColor" stroke="none" /></>),
  facebook: (<><circle cx="12" cy="12" r="8.5" />{S('M15.2 7.6h-1.3a2.4 2.4 0 0 0-2.4 2.4v10.4 M9.1 12.6h5.6')}</>),
  tiktok: S('M13.2 4v11.3a3.6 3.6 0 1 1-3.6-3.6 M13.2 4c.4 2.7 2.3 4.6 5.1 4.8'),
  youtube: (<><rect x="2.8" y="5.6" width="18.4" height="12.8" rx="4" /><path d="M10.2 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none" /></>),
  x: S('M4.2 4.2h4.3l11.3 15.6h-4.3z M19.4 4.2l-6.2 6.9 M10.8 12.9l-6.2 6.9'),
  linkedin: (<><rect x="3.5" y="3.5" width="17" height="17" rx="3" />{S('M8 10.6v6 M8 7.4v.1 M11.6 16.6v-6 M11.6 13.2a2.5 2.5 0 0 1 5 0v3.4')}</>),
  whatsapp: S('M4.3 19.7l1.2-3.7a8.2 8.2 0 1 1 2.9 2.7z M9.4 8.6c.1 3 2.8 5.8 5.9 6l.9-1.3-1.8-1-1 .6a4.4 4.4 0 0 1-2.4-2.4l.6-1-1-1.8z'),
  viber: S('M7 4.3h10a3 3 0 0 1 3 3v6.3a3 3 0 0 1-3 3h-4.6L8.3 19.8v-3.2H7a3 3 0 0 1-3-3V7.3a3 3 0 0 1 3-3z M12 7.6a3.3 3.3 0 0 1 3.2 3.3 M12 9.7a1.2 1.2 0 0 1 1.1 1.2'),
  telegram: S('M3.6 11.4l16.6-6.6-2.9 14.6-5.2-3.9-2.8 2.9-.4-4.7 7.6-6.3-9.6 5.2z'),
  threads: S('M15.7 12v1.3a2.4 2.4 0 0 0 4.8 0V12a8.5 8.5 0 1 0-3.4 6.8 M15.7 12a3.7 3.7 0 1 1-7.4 0 3.7 3.7 0 0 1 7.4 0z'),
  pinterest: (<><circle cx="12" cy="12" r="8.5" />{S('M10.9 20.3l1.9-7.6 M9.4 11.3a3 3 0 1 1 3.4 3.1')}</>),
  snapchat: S('M12 3.8c-2.9 0-4.9 2.1-4.9 4.9v2.1l-1.7.5c.4.9 1.3 1.2 1.9 1.4-.7 1.8-1.9 2.9-3.6 3.4.5.8 1.5.9 2.4 1 .2.6.3 1.2.8 1.2.6 0 1.4-.4 2.6-.1 1 .3 1.5 1.3 2.5 1.3s1.5-1 2.5-1.3c1.2-.3 2 .1 2.6.1.5 0 .6-.6.8-1.2.9-.1 1.9-.2 2.4-1-1.7-.5-2.9-1.6-3.6-3.4.6-.2 1.5-.5 1.9-1.4l-1.7-.5V8.7c0-2.8-2-4.9-4.9-4.9z'),
  spotify: (<><circle cx="12" cy="12" r="8.5" />{S('M7.4 9.6c3-.9 6.6-.7 9.3.8 M7.9 12.7c2.5-.7 5.1-.5 7.4.8 M8.5 15.6c2-.5 3.9-.3 5.6.6')}</>),
  soundcloud: S('M3.8 16.5v-2.4 M6.3 16.5v-4.6 M8.8 16.5V9.9 M11.3 16.5V8.3a4.8 4.8 0 0 1 8 3.3 2.5 2.5 0 0 1-.3 4.9z'),
  behance: S('M3.5 6.8h4a2.4 2.4 0 0 1 0 4.8h-4z M3.5 11.6h4.6a2.7 2.7 0 0 1 0 5.4H3.5z M3.5 6.8V17 M14.3 13.7h6.2a3.1 3.1 0 1 0-.9 2.3 M14.8 8h4.8'),
  dribbble: (<><circle cx="12" cy="12" r="8.5" />{S('M4.6 9c4.3 1 9.4.2 12.9-3 M3.7 13.2c4.6-1.3 10.6-.6 14.4 4 M8.8 4.2c3 3.5 5.4 9.4 6.1 15.6')}</>),
  github: S('M12 3.6c-4.6 0-8.3 3.6-8.3 8.2 0 3.6 2.4 6.7 5.7 7.8.4.1.6-.2.6-.4v-1.6c-2.3.5-2.8-1-2.8-1-.4-1-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.3.9 1.3.9.7 1.3 2 .9 2.4.7 M14.4 19.6c.3 0 .5-.2.5-.4v-2.3c0-.8-.3-1.3-.6-1.6 2.1-.2 4.3-1 4.3-4.6 0-1-.4-1.9-1-2.5.1-.3.4-1.3-.1-2.6 0 0-.8-.3-2.6 1a8.8 8.8 0 0 0-4.8 0c-1.8-1.3-2.6-1-2.6-1-.5 1.3-.2 2.3-.1 2.6a3.6 3.6 0 0 0-1 2.5c0 3.6 2.2 4.4 4.3 4.6'),
  discord: (<>{S('M8.2 6.3a13 13 0 0 1 7.6 0c1.6 2.3 2.5 4.8 2.6 8.3a10 10 0 0 1-4.1 2.2l-.9-1.6 M8.2 6.3c-1.6 2.3-2.5 4.8-2.6 8.3a10 10 0 0 0 4.1 2.2l.9-1.6 M8.1 14.6c2.6 1 5.2 1 7.8 0')}<circle cx="9.7" cy="11.6" r="1.1" fill="currentColor" stroke="none" /><circle cx="14.3" cy="11.6" r="1.1" fill="currentColor" stroke="none" /></>),
  twitch: S('M5.2 3.8h14.3v9.5l-3.8 3.8h-3.8l-2.9 2.9v-2.9H5.2z M10.9 7.8v4 M15.1 7.8v4'),
  messenger: S('M12 3.6c-4.7 0-8.4 3.4-8.4 7.9 0 2.4 1 4.5 2.9 6v3l2.8-1.5c.9.3 1.8.4 2.7.4 4.7 0 8.4-3.4 8.4-7.9S16.7 3.6 12 3.6z M7.6 13.8l3-3.1 2 1.7 3.4-3.4'),
  email: (<><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="2" />{S('M3.8 7.2l8.2 5.9 8.2-5.9')}</>),
  phone: S('M6.6 3.8h2.9l1.4 3.9-1.9 1.3a10 10 0 0 0 6 6l1.3-1.9 3.9 1.4v2.9a2 2 0 0 1-2 2A15.3 15.3 0 0 1 4.6 5.8a2 2 0 0 1 2-2z'),
  website: (<><circle cx="12" cy="12" r="8.5" /><ellipse cx="12" cy="12" rx="3.7" ry="8.5" />{S('M3.6 12h16.8')}</>),
};

export const SOCIAL_LABEL: Record<SocialKind, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp', viber: 'Viber', telegram: 'Telegram', threads: 'Threads', pinterest: 'Pinterest',
  snapchat: 'Snapchat', spotify: 'Spotify', soundcloud: 'SoundCloud', behance: 'Behance', dribbble: 'Dribbble',
  github: 'GitHub', discord: 'Discord', twitch: 'Twitch', messenger: 'Messenger', email: 'Email', phone: 'Phone',
  website: 'Website',
};

export function Svg({ children, className = 'pf-ico' }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function SocialIcon({ kind }: { kind: SocialKind }) {
  return <Svg>{GLYPHS[kind] ?? GLYPHS.website}</Svg>;
}

/** North-east arrow: "opens somewhere else". */
export function GoGlyph() {
  return <Svg className="pf-ico pf-ico-go">{S('M7.5 16.5l9-9 M9.5 7.5h7v7')}</Svg>;
}

export function LinkGlyph() {
  return <Svg>{S('M10.2 13.8a3.8 3.8 0 0 0 5.4 0l2.9-2.9a3.8 3.8 0 0 0-5.4-5.4l-1 1 M13.8 10.2a3.8 3.8 0 0 0-5.4 0l-2.9 2.9a3.8 3.8 0 0 0 5.4 5.4l1-1')}</Svg>;
}

/** Four tiles: a Jhino app. */
export function AppGlyph() {
  return (
    <Svg>
      <rect x="4.2" y="4.2" width="6.6" height="6.6" rx="1.4" />
      <rect x="13.2" y="4.2" width="6.6" height="6.6" rx="3.3" />
      <rect x="4.2" y="13.2" width="6.6" height="6.6" rx="1.4" />
      <rect x="13.2" y="13.2" width="6.6" height="6.6" rx="1.4" />
    </Svg>
  );
}

export function CloseGlyph() {
  return <Svg>{S('M6.5 6.5l11 11 M17.5 6.5l-11 11')}</Svg>;
}
