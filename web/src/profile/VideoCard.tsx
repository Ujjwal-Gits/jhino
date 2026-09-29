/*
 * A video on a person's page: a clean 16:9 card (the picture, the title above it, a play button), with no
 * platform header, name or buttons on the page itself.
 *   YouTube and Vimeo play in the same box when tapped.
 *   Instagram and TikTok are upright: they play in an overlay, in the platform's own player, uncropped
 *   (their attribution inside the player stays, as their embed rules ask).
 * Nothing leaves the page.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';

type Platform = 'youtube' | 'vimeo' | 'tiktok' | 'instagram';
const NAME: Record<Platform, string> = { youtube: 'YouTube', vimeo: 'Vimeo', tiktok: 'TikTok', instagram: 'Instagram' };

function platformOf(embed: string): Platform {
  if (/youtube/.test(embed)) return 'youtube';
  if (/vimeo/.test(embed)) return 'vimeo';
  if (/tiktok/.test(embed)) return 'tiktok';
  return 'instagram';
}
/** The player address, set to start at once (the tap on the card is the visitor's choice to play). */
function autoplay(embed: string, platform: Platform): string {
  try {
    const u = new URL(embed);
    u.searchParams.set('autoplay', '1');
    if (platform === 'youtube') u.searchParams.set('playsinline', '1');
    return u.toString();
  } catch {
    return embed;
  }
}
/** YouTube pictures have stable addresses; the server sends one, samples may not. */
function youtubePicture(embed: string): string | null {
  const id = /\/embed\/([\w-]{11})/.exec(embed)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : null;
}

const PLAY_EVENT = 'jhino:video-play';

export function VideoCard({ title, embed, thumb, style, hidden }: { title: string; embed: string; thumb?: string | null; style?: CSSProperties; hidden?: boolean }) {
  const platform = platformOf(embed);
  const upright = platform === 'tiktok' || platform === 'instagram';
  const initial = thumb ?? (platform === 'youtube' ? youtubePicture(embed) : null);
  const [src, setSrc] = useState(initial);
  const [broken, setBroken] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const me = useId();
  // One video at a time: starting one stops a card playing in place (and its sound).
  useEffect(() => {
    const other = (e: Event) => { if ((e as CustomEvent<string>).detail !== me) setPlaying(false); };
    window.addEventListener(PLAY_EVENT, other);
    return () => window.removeEventListener(PLAY_EVENT, other);
  }, [me]);
  const start = () => {
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: me }));
    if (upright) setOpen(true); else setPlaying(true);
  };
  useEffect(() => { setSrc(initial); setBroken(false); setPlaying(false); }, [initial, embed]);
  // Closing the overlay puts focus back on the card that opened it (after the dialog has gone).
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // maxresdefault is not made for every YouTube video (YouTube then sends a 120 px grey picture): use hqdefault.
  const smaller = () => (src && src.includes('/maxresdefault.') ? src.replace('/maxresdefault.', '/hqdefault.') : null);
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => { if (e.currentTarget.naturalWidth <= 120 && smaller()) setSrc(smaller()); };
  const onError = () => { const s = smaller(); if (s) setSrc(s); else setBroken(true); };
  const label = title || `${NAME[platform]} video`;

  return (
    <div className="pf-video" style={style} data-hidden={hidden ? '' : undefined} data-platform={platform}>
      {title && <b>{title}</b>}
      <div className="pf-video-box">
        {playing ? (
          <iframe src={autoplay(embed, platform)} title={label} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button ref={button} type="button" className="pf-video-poster" onClick={start}
            aria-label={`Play ${label}`} aria-haspopup={upright ? 'dialog' : undefined}>
            {src && !broken
              ? <img src={src} alt="" loading="lazy" decoding="async" onLoad={onLoad} onError={onError} />
              : <span className="pf-video-empty" aria-hidden="true"><span>{NAME[platform]}</span></span>}
            <span className="pf-video-play" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" /></svg>
            </span>
          </button>
        )}
      </div>
      {open && <VideoOverlay title={label} platform={platform} embed={embed} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The upright player over the page: a modal dialog (the page behind is inert, so focus stays inside),
 * closed by Esc, the close button or a tap outside the player. The page does not scroll behind it.
 */
function VideoOverlay({ title, platform, embed, onClose }: { title: string; platform: Platform; embed: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
    close.current?.focus();
    const root = document.documentElement;
    const prev = { root: root.style.overflow, body: document.body.style.overflow };
    root.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    // Instagram's player says how tall it is; the frame follows (within the screen), so nothing scrolls inside.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'https://www.instagram.com' || typeof e.data !== 'string') return;
      try {
        const m = JSON.parse(e.data) as { type?: string; details?: { height?: number } };
        if (m.type === 'MEASURE' && typeof m.details?.height === 'number' && m.details.height > 200) setHeight(Math.round(m.details.height));
      } catch { /* not a message for us */ }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      root.style.overflow = prev.root;
      document.body.style.overflow = prev.body;
      if (d.open) d.close();
    };
  }, []);

  return (
    <dialog ref={dialog} className="pf-vo" data-platform={platform} aria-label={title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-vo-panel">
        <div className="pf-vo-bar">
          <b>{title}</b>
          <button ref={close} type="button" className="pf-vo-close" onClick={onClose} aria-label="Close video">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
          </button>
        </div>
        <div className="pf-vo-frame" style={height ? ({ '--pf-vo-h': `${height}px` } as CSSProperties) : undefined}>
          <iframe src={autoplay(embed, platform)} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      </div>
    </dialog>
  );
}
