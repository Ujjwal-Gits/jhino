/*
 * A person's public page on jhino.com/<username>: the data the server sends, and what every design
 * (theme) renders. Themes only change how it looks; the markup is always ProfileView's.
 */

export type Tier = 'free' | 'plus' | 'pro';
export type Layout = 'links' | 'profile';
/** Free pages carry a Jhino popup and badge, Plus a small badge, Pro nothing. */
export type Branding = 'popup' | 'badge' | 'none';

export type SocialKind =
  | 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'x' | 'linkedin' | 'whatsapp' | 'viber' | 'telegram'
  | 'threads' | 'pinterest' | 'snapchat' | 'spotify' | 'soundcloud' | 'behance' | 'dribbble' | 'github'
  | 'discord' | 'twitch' | 'messenger' | 'email' | 'phone' | 'website';

export interface Social { kind: SocialKind; url: string }

export type ProfileItem =
  /** href is Jhino's click-counting address (/go/<id>); url is where it ends up (for showing the domain). */
  | { id: string; type: 'link'; title: string; subtitle?: string; href: string; url: string; thumb?: string | null; highlight?: boolean }
  | { id: string; type: 'header'; title: string }
  | { id: string; type: 'text'; text: string }
  /** A YouTube or Vimeo video, played in the page. embed is the player address. */
  | { id: string; type: 'video'; title: string; embed: string; href: string }
  /** One of the person's Jhino apps (opens at its address). */
  | { id: string; type: 'app'; title: string; subtitle?: string; href: string };

export interface ProfileData {
  username: string;
  name: string;
  bio: string;
  location: string;
  avatarUrl: string | null;
  theme: string;
  layout: Layout;
  branding: Branding;
  socials: Social[];
  items: ProfileItem[];
}
