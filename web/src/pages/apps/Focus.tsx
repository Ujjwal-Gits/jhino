import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, get } from '../../api';
import { focusTimer, useTimer } from '../../QuickTools';
import { ALARM_SOUNDS, AMBIENT, RING_FOR, ringAlarm, setAlarm, setAmbient, stopAlarm, stopAllAmbient, useSounds, type AlarmSound } from '../../alarm';
import { Icon, ago, Modal, useToast } from '../../ui';

/*
 * Focus studio: the pomodoro timer with a real alarm, plus music. Stations are the 24/7 YouTube streams that
 * are live right now on Lofi Girl and Chillhop (looked up by the server); Sounds are made in the browser; people can paste any YouTube video, playlist or channel live,
 * keep favourites, build their own playlists (played back to back), and see what they played recently.
 * The library is saved to their account (server/everyday.ts).
 */
export interface Media { type: 'video' | 'list' | 'live'; id: string; title: string; author: string; at?: string }
interface Library { playlists: { id: string; name: string; items: Media[] }[]; favs: Media[]; history: Media[] }

type Station = Media & { tag: string };
const pad = (n: number) => String(n).padStart(2, '0');
const msg = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const same = (a: Media, b: Media) => a.type === b.type && a.id === b.id;
const thumb = (m: Media) => (m.type === 'list' || /^UC[\w-]{22}$/.test(m.id) ? null : `https://i.ytimg.com/vi/${m.id}/mqdefault.jpg`);
/** A YouTube address as something we can play: a video, a playlist, or a channel's live stream. */
export function parseYouTube(raw: string): Media | null {
  const s = raw.trim();
  const list = /[?&]list=([\w-]{10,64})/.exec(s)?.[1];
  if (list && !/[?&]v=/.test(s)) return { type: 'list', id: list, title: '', author: '' };
  const ch = /youtube\.com\/channel\/(UC[\w-]{22})/.exec(s)?.[1];
  if (ch) return { type: 'live', id: ch, title: '', author: '' };
  const v = /(?:youtu\.be\/|[?&]v=|shorts\/|embed\/|live\/)([\w-]{11})/.exec(s)?.[1] ?? (/^[\w-]{11}$/.test(s) ? s : null);
  return v ? { type: /\/live\//.test(s) ? 'live' : 'video', id: v, title: '', author: '' } : null;
}
const embed = (m: Media, rest: string[] = []) => {
  const base = 'https://www.youtube-nocookie.com/embed/';
  if (m.type === 'list') return `${base}videoseries?list=${m.id}&autoplay=1&rel=0`;
  if (/^UC[\w-]{22}$/.test(m.id)) return `${base}live_stream?channel=${m.id}&autoplay=1`;
  return `${base}${m.id}?autoplay=1&rel=0${rest.length ? `&playlist=${rest.join(',')}` : ''}`;
};

function useLibrary() {
  const toast = useToast();
  const [lib, setLib] = useState<Library | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { get<Library>('/api/focus/library').then(setLib, () => setLib({ playlists: [], favs: [], history: [] })); }, []);
  const update = useCallback((f: (l: Library) => Library) => {
    setLib((cur) => {
      if (!cur) return cur;
      const next = f(cur);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { api('PUT', '/api/focus/library', next).catch((e) => toast(msg(e, 'Could not save your music.'), true)); }, 600);
      return next;
    });
  }, [toast]);
  return { lib, update };
}

export function FocusStudio() {
  const t = useTimer();
  const snd = useSounds();
  const { lib, update } = useLibrary();
  const [stations, setStations] = useState<Station[] | null>(null);
  useEffect(() => { get<{ stations: Station[] }>('/api/focus/stations').then((r) => setStations(r.stations), () => setStations([])); }, []);
  const [tab, setTab] = useState<'stations' | 'sounds' | 'playlists' | 'favs' | 'history'>('stations');
  const [now, setNow] = useState<{ m: Media; src: string } | null>(null);
  const [url, setUrl] = useState('');
  const [addTo, setAddTo] = useState<Media | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const toast = useToast();
  const total = (t.mode === 'work' ? t.work : t.rest) * 60;
  const p = Math.min(1, Math.max(0, 1 - t.left / total));
  useEffect(() => { document.title = t.running ? `${pad(Math.floor(t.left / 60))}:${pad(t.left % 60)} ${t.mode === 'work' ? 'Focus' : 'Break'} | Jhino` : 'Focus studio | Jhino'; }, [t.left, t.running, t.mode]);

  const play = (m: Media, rest: string[] = []) => {
    setNow({ m, src: embed(m, rest) });
    update((l) => ({ ...l, history: [{ ...m, at: new Date().toISOString() }, ...l.history.filter((h) => !same(h, m))].slice(0, 60) }));
  };
  const isFav = (m: Media) => !!lib?.favs.some((f) => same(f, m));
  const fav = (m: Media) => update((l) => ({ ...l, favs: isFav(m) ? l.favs.filter((f) => !same(f, m)) : [{ ...m, at: undefined }, ...l.favs] }));
  const fromUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const m = parseYouTube(url);
    if (!m) { toast('Paste a YouTube video, playlist or channel link.', true); return; }
    const link = m.type === 'list' ? `https://www.youtube.com/playlist?list=${m.id}` : `https://www.youtube.com/watch?v=${m.id}`;
    if (!/^UC/.test(m.id)) { const r = await get<{ title: string; author: string }>(`/api/focus/meta?url=${encodeURIComponent(link)}`).catch(() => null); if (r) { m.title = r.title; m.author = r.author; } }
    if (!m.title) m.title = m.type === 'live' ? 'Live stream' : m.type === 'list' ? 'YouTube playlist' : 'YouTube video';
    setUrl(''); play(m);
  };

  const Row = ({ m, extra }: { m: Media; extra?: React.ReactNode }) => (
    <li className={`fs-item ${now && same(now.m, m) ? 'on' : ''}`}>
      <button className="fs-play" onClick={() => play(m)} aria-label={`Play ${m.title}`}>
        {thumb(m) ? <img src={thumb(m)!} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="fs-noimg"><Icon name={m.type === 'list' ? 'list' : 'live'} size={18} /></span>}
        <span className="ha-t"><b>{m.title || 'Untitled'}</b><small>{[m.type === 'live' ? 'Live' : m.type === 'list' ? 'Playlist' : '', m.author, m.at ? ago(m.at) : ''].filter(Boolean).join(' · ')}</small></span>
      </button>
      <button className={`icon-btn fs-heart ${isFav(m) ? 'on' : ''}`} aria-pressed={isFav(m)} aria-label={isFav(m) ? 'Remove from favourites' : 'Add to favourites'} onClick={() => fav(m)}><Heart on={isFav(m)} /></button>
      <button className="icon-btn" aria-label="Add to a playlist" onClick={() => setAddTo(m)}><Icon name="plus" size={16} /></button>
      {extra}
    </li>
  );
  const pl = lib?.playlists.find((x) => x.id === open);

  return (
    <div className="tp-focus">
      <div className="fs-col">
        <section className={`tp-card tp-clock ${t.mode}`}>
          <div className="tp-tabs" role="tablist">
            <button role="tab" aria-selected={t.mode === 'work'} onClick={() => t.mode !== 'work' && focusTimer.skip()}>Focus</button>
            <button role="tab" aria-selected={t.mode === 'rest'} onClick={() => t.mode !== 'rest' && focusTimer.skip()}>Break</button>
          </div>
          <div className="tp-ring" style={{ ['--p' as string]: `${p * 360}deg` }}>
            <span className="mono">{pad(Math.floor(t.left / 60))}:{pad(t.left % 60)}</span>
            <small>{t.running ? (t.mode === 'work' ? 'Stay on one thing' : 'Stand up, look away') : 'Ready'}</small>
          </div>
          {snd.ringing ? <button className="btn primary lg" onClick={stopAlarm}>Stop alarm</button> : (
            <div className="actions-row center">
              <button className="btn primary lg" onClick={() => t.setRunning(!t.running)}>{t.running ? 'Pause' : 'Start'}</button>
              <button className="btn lg" onClick={t.reset}>Reset</button>
              <button className="btn lg quiet" onClick={focusTimer.skip}>Skip</button>
            </div>
          )}
          <p className="tp-rounds">Rounds done <b className="mono">{t.rounds}</b> {t.rounds > 0 && <button className="link" onClick={focusTimer.clearRounds}>Clear</button>}</p>
        </section>
        <section className="tp-card">
          <h2>Lengths</h2>
          <div className="tp-presets">{([[25, 5, 'Classic'], [50, 10, 'Deep work'], [90, 20, 'Long block'], [15, 3, 'Sprint']] as const).map(([w, r, n]) => (
            <button key={n} className={t.work === w && t.rest === r ? 'on' : ''} disabled={t.running} onClick={() => focusTimer.set(w, r)}><b className="mono">{w}/{r}</b><small>{n}</small></button>
          ))}</div>
          <div className="qt-row">
            <label className="field sm"><span>Focus (min)</span><input className="input mono" type="number" min={1} max={180} value={t.work} disabled={t.running} onChange={(e) => t.setWork(Math.min(180, Math.max(1, Number(e.target.value) || 1)))} /></label>
            <label className="field sm"><span>Break (min)</span><input className="input mono" type="number" min={1} max={60} value={t.rest} disabled={t.running} onChange={(e) => t.setRest(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} /></label>
          </div>
          <h2>Alarm</h2>
          <div className="fs-sounds">{ALARM_SOUNDS.map(([k, l]) => (
            <button key={k} className={snd.settings.sound === k ? 'on' : ''} onClick={() => { setAlarm({ sound: k as AlarmSound }); ringAlarm({ sound: k as AlarmSound }); }}>{l}</button>
          ))}</div>
          <label className="field"><span>Volume <em className="mono">{Math.round(snd.settings.volume * 100)}%</em></span><input type="range" min={0.05} max={1} step={0.05} value={snd.settings.volume} onChange={(e) => setAlarm({ volume: Number(e.target.value) })} onPointerUp={() => ringAlarm({})} /></label>
          <div className="field"><span>Ring for</span><div className="tp-seg">{RING_FOR.map(([v, l]) => <button key={v} aria-pressed={snd.settings.ring === v} onClick={() => setAlarm({ ring: v })}>{l}</button>)}</div></div>
          <div className="actions-row"><button className="btn sm" onClick={() => (snd.ringing ? stopAlarm() : ringAlarm({}))}>{snd.ringing ? 'Stop' : 'Test the alarm'}</button></div>
          <p className="hint">The timer keeps going on other pages and after a reload. When it turns over you hear the alarm and get a notification.</p>
        </section>
      </div>

      <section className="tp-card fs-music">
        {now && <div className="tp-video"><iframe key={now.src} title={now.m.title || 'Music'} src={now.src} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>}
        {now && <div className="tp-row fs-now"><span className="ha-t"><b>{now.m.title}</b><small>{now.m.author}</small></span>
          <span className="actions-row"><button className={`icon-btn fs-heart ${isFav(now.m) ? 'on' : ''}`} aria-label="Favourite" aria-pressed={isFav(now.m)} onClick={() => fav(now.m)}><Heart on={isFav(now.m)} /></button><button className="icon-btn" aria-label="Add to a playlist" onClick={() => setAddTo(now.m)}><Icon name="plus" size={16} /></button><button className="btn sm quiet" onClick={() => setNow(null)}>Stop</button></span></div>}
        <form className="tp-inline" onSubmit={fromUrl}>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube video, playlist or live link" aria-label="YouTube link" />
          <button className="btn sm primary">Play</button>
        </form>
        <div className="tp-tabs fs-tabs" role="tablist">
          {([['stations', 'Stations'], ['sounds', 'Sounds'], ['playlists', 'Playlists'], ['favs', 'Favourites'], ['history', 'Recent']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setOpen(null); }}>{l}{k === 'favs' && lib?.favs.length ? <small className="mono">{lib.favs.length}</small> : null}</button>
          ))}
        </div>
        <div className="fs-scroll">
        {tab === 'stations' && (!stations ? <p className="pd-busy"><span className="spin" />Finding what is live…</p> : <ul className="fs-list">{stations.map((m) => <Row key={m.id} m={m} extra={<span className="fs-tag">{m.tag}</span>} />)}</ul>)}
        {tab === 'sounds' && (
          <div className="fs-amb">
            <p className="hint">Made right here in your browser, with no ads and no internet needed. Mix as many as you like; they keep playing as you move around Jhino.</p>
            {AMBIENT.map(([k, l]) => { const v = snd.ambient[k] ?? 0; return (
              <div key={k} className={`fs-amb-row ${v ? 'on' : ''}`}>
                <button className="btn sm" aria-pressed={!!v} onClick={() => setAmbient(k, v ? 0 : 0.4)}>{v ? <Icon name="pause" size={14} /> : <Icon name="play" size={14} />}{l}</button>
                <input type="range" min={0} max={1} step={0.05} value={v} aria-label={`${l} volume`} onChange={(e) => setAmbient(k, Number(e.target.value))} />
              </div>
            ); })}
            {Object.keys(snd.ambient).length > 0 && <button className="btn sm quiet" onClick={stopAllAmbient}>Stop all sounds</button>}
          </div>
        )}
        {tab === 'playlists' && (!lib ? null : pl ? (
          <div className="fs-pl">
            <div className="tp-row"><button className="btn sm quiet" onClick={() => setOpen(null)}><Icon name="back" size={14} />Playlists</button>
              <span className="actions-row">
                <button className="btn sm primary" disabled={!pl.items.length} onClick={() => { const v = pl.items.filter((i) => i.type === 'video'); if (v.length) play({ ...v[0], title: `${pl.name}: ${v[0].title}` }, v.slice(1).map((i) => i.id)); else play(pl.items[0]); }}><Icon name="play" size={14} />Play all</button>
                <button className="btn sm quiet" onClick={() => { const n = prompt('Rename playlist', pl.name); if (n?.trim()) update((l) => ({ ...l, playlists: l.playlists.map((x) => (x.id === pl.id ? { ...x, name: n.trim().slice(0, 80) } : x)) })); }}>Rename</button>
                <button className="btn sm quiet danger" onClick={() => { if (confirm(`Delete "${pl.name}"?`)) { update((l) => ({ ...l, playlists: l.playlists.filter((x) => x.id !== pl.id) })); setOpen(null); } }}>Delete</button>
              </span></div>
            <h3 className="fs-pl-name">{pl.name}</h3>
            {!pl.items.length ? <p className="tp-empty">Empty. Press + on any station, favourite or video to add it here.</p> : (
              <ul className="fs-list">{pl.items.map((m, i) => <Row key={m.type + m.id} m={m} extra={<>
                <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => update((l) => ({ ...l, playlists: l.playlists.map((x) => { if (x.id !== pl.id) return x; const it = [...x.items]; [it[i - 1], it[i]] = [it[i], it[i - 1]]; return { ...x, items: it }; }) }))}><Icon name="up" size={15} /></button>
                <button className="icon-btn" aria-label="Remove" onClick={() => update((l) => ({ ...l, playlists: l.playlists.map((x) => (x.id === pl.id ? { ...x, items: x.items.filter((_, j) => j !== i) } : x)) }))}><Icon name="close" size={15} /></button>
              </>} />)}</ul>
            )}
            <p className="hint">Play all plays the videos back to back. Playlists and live streams inside play one at a time.</p>
          </div>
        ) : (
          <>
            <form className="tp-inline" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const n = String(f.get('n') ?? '').trim(); if (!n) return; update((l) => ({ ...l, playlists: [...l.playlists, { id: Math.random().toString(36).slice(2, 10), name: n.slice(0, 80), items: [] }] })); e.currentTarget.reset(); }}>
              <input className="input" name="n" maxLength={80} placeholder="New playlist name, like Deep work" aria-label="New playlist name" />
              <button className="btn sm">Create</button>
            </form>
            {!lib.playlists.length ? <p className="tp-empty">Make playlists for work, sleep or the gym. Add anything from Stations, Favourites or a pasted link.</p> : (
              <ul className="tp-list fs-pls">{lib.playlists.map((x) => (
                <li key={x.id}><button onClick={() => setOpen(x.id)}><span className="ha-ic sm"><Icon name="list" size={16} /></span><span className="ha-t"><b>{x.name}</b><small>{x.items.length} {x.items.length === 1 ? 'item' : 'items'}</small></span></button></li>
              ))}</ul>
            )}
          </>
        ))}
        {tab === 'favs' && (!lib ? null : !lib.favs.length ? <p className="tp-empty">Press the heart on anything you play to keep it here.</p> : <ul className="fs-list">{lib.favs.map((m) => <Row key={m.type + m.id} m={m} />)}</ul>)}
        {tab === 'history' && (!lib ? null : !lib.history.length ? <p className="tp-empty">What you play shows here.</p> : <>
          <ul className="fs-list">{lib.history.map((m) => <Row key={m.type + m.id} m={m} />)}</ul>
          <button className="btn sm quiet" onClick={() => update((l) => ({ ...l, history: [] }))}>Clear recent</button>
        </>)}
        </div>
      </section>

      {addTo && lib && (
        <Modal title="Add to a playlist" onClose={() => setAddTo(null)}>
          <div className="modal-body">
          <p className="hint">{addTo.title}</p>
          <ul className="tp-list fs-pls">{lib.playlists.map((x) => { const has = x.items.some((i) => same(i, addTo)); return (
            <li key={x.id}><button disabled={has} onClick={() => { update((l) => ({ ...l, playlists: l.playlists.map((y) => (y.id === x.id ? { ...y, items: [...y.items, { ...addTo, at: undefined }] } : y)) })); toast(`Added to ${x.name}.`); setAddTo(null); }}>
              <span className="ha-ic sm"><Icon name={has ? 'check' : 'list'} size={16} /></span><span className="ha-t"><b>{x.name}</b><small>{has ? 'Already in it' : `${x.items.length} items`}</small></span></button></li>
          ); })}</ul>
          <form className="tp-inline" onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get('n') ?? '').trim(); if (!n) return; update((l) => ({ ...l, playlists: [...l.playlists, { id: Math.random().toString(36).slice(2, 10), name: n.slice(0, 80), items: [{ ...addTo, at: undefined }] }] })); toast(`Added to ${n}.`); setAddTo(null); }}>
            <input className="input" name="n" maxLength={80} placeholder="Or a new playlist" aria-label="New playlist name" autoFocus={!lib.playlists.length} /><button className="btn sm primary">Create and add</button>
          </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Heart({ on }: { on: boolean }) {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-9-9.3C2 7.4 4.3 4.5 7.4 4.5c2 0 3.5 1.1 4.6 2.7 1.1-1.6 2.6-2.7 4.6-2.7 3.1 0 5.4 2.9 4.4 6.2C19.5 15.4 12 20 12 20z" /></svg>;
}
