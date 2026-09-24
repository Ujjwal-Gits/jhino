import { post } from './api';

/** One live connection per tab. Pages watch the apps they show and get committed changes. */
type Handler = (event: string, data: any) => void;
const EVENTS = ['kv', 'record', 'file', 'presence', 'activity', 'revoked', 'app-updated', 'role-changed', 'apps-changed', 'trash'];

class Live {
  private es: EventSource | null = null;
  private handlers = new Set<Handler>();
  private watched = new Set<string>();
  connId: string | null = null;
  private bootId: string | null = null;
  online = false;

  private wanted = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityHooked = false;

  /**
   * Browsers allow about six open connections per server over HTTP/1.1, and each
   * live stream holds one. Tabs in the background let go of theirs after a short
   * while and reconnect (and re-sync) when they are looked at again.
   */
  private hookVisibility() {
    if (this.visibilityHooked) return;
    this.visibilityHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.wanted) return;
      if (document.visibilityState === 'hidden') {
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => { this.close(); }, 15_000);
      } else {
        if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
        this.open();
      }
    });
  }

  start() {
    this.wanted = true;
    this.hookVisibility();
    this.open();
  }

  private close() {
    this.es?.close();
    this.es = null;
    if (this.online) { this.online = false; this.emit('offline', { paused: true }); }
  }

  private open() {
    if (this.es) return;
    const es = new EventSource('/api/events');
    this.es = es;
    es.addEventListener('hello', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      const reconnect = this.connId !== null;
      const restarted = this.bootId !== null && this.bootId !== d.bootId;
      this.connId = d.connId;
      this.bootId = d.bootId;
      this.online = true;
      // Re-watch first, then announce: pages resync only once no change can slip past.
      Promise.all([...this.watched].map((id) => this.sendWatch(id))).then(() => this.emit('online', { reconnect, restarted }));
    });
    for (const name of EVENTS) {
      es.addEventListener(name, (e) => this.emit(name, JSON.parse((e as MessageEvent).data)));
    }
    es.onerror = () => {
      if (this.online) { this.online = false; this.emit('offline', {}); }
    };
  }

  stop() {
    this.wanted = false;
    this.es?.close();
    this.es = null;
    this.connId = null;
    this.online = false;
  }

  on(h: Handler) { this.handlers.add(h); return () => { this.handlers.delete(h); }; }
  private emit(event: string, data: any) { this.handlers.forEach((h) => h(event, data)); }

  private sendWatch(appId: string): Promise<boolean> {
    if (!this.connId) return Promise.resolve(false);
    return post(`/api/apps/${appId}/watch`, { connId: this.connId }).then(() => true, () => false);
  }
  /** Start receiving an app's changes. `ready` resolves once the server confirmed (or after 3 s). */
  watch(appId: string) {
    this.watched.add(appId);
    const ready = new Promise<void>((resolve) => {
      let off = () => {};
      const done = () => { clearTimeout(t); off(); resolve(); };
      const t = setTimeout(done, 3000);
      if (this.connId) this.sendWatch(appId).then(done);
      else off = this.on((e) => { if (e === 'online') done(); }); // the hello handler sends the watch
    });
    return {
      ready,
      stop: () => {
        this.watched.delete(appId);
        if (this.connId) post(`/api/apps/${appId}/unwatch`, { connId: this.connId }).catch(() => {});
      },
    };
  }
}

export const live = new Live();
