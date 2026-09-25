/*
 * A person's two public pages on jhino.com/<username>:
 * - the links page (link in bio): links, socials, a video, their apps, in one of 30 designs;
 * - the profile page (a portfolio): cover, about, stats, services with prices, work, contact.
 * The server sends both; the owner picks which one opens at jhino.com/<username>.
 */

export type Tier = 'free' | 'plus' | 'pro';
export type Home = 'links' | 'profile';
/** Free pages carry a Jhino popup and badge, Plus a small badge, Pro nothing. */
export type Branding = 'popup' | 'badge' | 'none';

export type SocialKind =
  | 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'x' | 'linkedin' | 'whatsapp' | 'viber' | 'telegram'
  | 'threads' | 'pinterest' | 'snapchat' | 'spotify' | 'soundcloud' | 'behance' | 'dribbble' | 'github'
  | 'discord' | 'twitch' | 'messenger' | 'email' | 'phone' | 'website';

export interface Social { kind: SocialKind; url: string }

export type ProfileItem =
  /** href is Jhino's click-counting address (/go/<id>); url is where it ends up (for showing the domain). */
  | { id: string; type: 'link'; title: string; subtitle?: string; href: string; url: string; thumb?: string | null; highlight?: boolean; hidden?: boolean }
  | { id: string; type: 'header'; title: string; hidden?: boolean }
  | { id: string; type: 'text'; text: string; hidden?: boolean }
  /** A YouTube or Vimeo video, played in the page. embed is the player address. */
  | { id: string; type: 'video'; title: string; embed: string; href: string; hidden?: boolean }
  /** One of the person's Jhino apps (opens at its address). */
  | { id: string; type: 'app'; title: string; subtitle?: string; href: string; hidden?: boolean };

export interface Stat { value: string; label: string }
export interface Service { name: string; note: string; price: string }
export interface WorkImage { id: string; url: string; caption: string }

/** The profile page: a portfolio, nothing like the links page. */
export interface Portfolio {
  headline: string;
  about: string;
  coverUrl: string | null;
  cta: { label: string; url: string } | null;
  stats: Stat[];
  services: Service[];
  work: WorkImage[];
  palette: string;
  type: 'sans' | 'serif';
}

export interface ProfileData {
  username: string;
  name: string;
  bio: string;
  location: string;
  avatarUrl: string | null;
  theme: string;
  home: Home;
  branding: Branding;
  socials: Social[];
  items: ProfileItem[];
  portfolio: Portfolio;
}
