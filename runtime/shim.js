/*
 * Jhino runtime bridge. Loaded first inside every uploaded app (sandboxed, opaque origin).
 *
 * - localStorage and window.storage become server-backed: reads are instant from a
 *   snapshot, writes are sent to Jhino with a revision check and synced to everyone.
 * - When someone else changes data, apps that listen for it (storage event or
 *   jhino.onChange) get told; other apps are refreshed as soon as the person pauses.
 * - window.jhino exposes record collections for apps built for Jhino.
 * All requests go through a MessageChannel handed over by the Jhino page after a
 * per-launch handshake. The server checks every request again.
 */
(function () {
  'use strict';
  var B = window.__JHINO_BOOT__;
  try { delete window.__JHINO_BOOT__; } catch (e) { window.__JHINO_BOOT__ = undefined; }
  var bootEl = document.getElementById('__jhino_boot');
  if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
  if (!B || B.v !== 1) return;

  var addListener = window.addEventListener.bind(window);
  var user = B.user;
  var canWrite = function () { return user.role === 'owner' || user.role === 'editor'; };

  /* ---------------- bridge to the Jhino page ---------------- */
  var port = null, outbox = [], seq = 0, waiters = {};
  var readyResolve, readyPromise = new Promise(function (r) { readyResolve = r; });

  function post(msg) { if (port) port.postMessage(msg); else outbox.push(msg); }
  function note(type, data) { post({ note: type, data: data || null }); }
  function call(op, args, timeoutMs) {
    return new Promise(function (resolve) {
      var id = ++seq;
      // timeoutMs 0 = no timeout (file uploads can take minutes).
      var t = timeoutMs === 0 ? null : setTimeout(function () {
        if (waiters[id]) { delete waiters[id]; resolve({ error: 'CONNECTION_LOST', message: 'Jhino did not answer in time.' }); }
      }, timeoutMs || 20000);
      waiters[id] = function (res) { clearTimeout(t); resolve(res); };
      post({ id: id, op: op, args: args || {} });
    });
  }

  addListener('message', function (e) {
    var d = e.data;
    if (port || e.source !== window.parent || !d || d.jhino !== 'port' || d.nonce !== B.nonce || !e.ports || !e.ports[0]) return;
    e.stopImmediatePropagation();
    port = e.ports[0];
    port.onmessage = function (ev) {
      var m = ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.re && waiters[m.re]) { var w = waiters[m.re]; delete waiters[m.re]; w(m.result || {}); return; }
      if (m.event) onEvent(m.event, m.data || {});
    };
    outbox.splice(0).forEach(function (x) { port.postMessage(x); });
    if (d.scroll) restoreScroll(d.scroll);
    readyResolve();
    // Changes that arrived while this page was loading (for example during an automatic refresh) were not seen yet.
    setTimeout(function () { kvResync(); }, 300);
  }, true);

  var helloTries = 0;
  (function hello() {
    if (port || helloTries++ > 40 || window.parent === window) return;
    window.parent.postMessage({ jhino: 'hello', nonce: B.nonce }, '*');
    setTimeout(hello, 250);
  })();

  function restoreScroll(s) {
    var go = function () { window.scrollTo(s[0] || 0, s[1] || 0); };
    if (document.readyState === 'complete') { go(); setTimeout(go, 120); }
    else addListener('load', function () { go(); setTimeout(go, 120); });
  }

  /* ---------------- merging when two people changed the same thing ---------------- */
  var FAIL = {};
  function parse(s) { try { return JSON.parse(s); } catch (e) { return FAIL; } }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function idOf(x) {
    if (!isObj(x)) return null;
    var k = x.id != null ? x.id : x._id != null ? x._id : x.uuid != null ? x.uuid : null;
    return k == null ? null : 'k:' + String(k);
  }
  function mergeVal(b, m, t) {
    if (same(m, t)) return m;
    if (same(m, b)) return t;
    if (same(t, b)) return m;
    if (isObj(m) && isObj(t)) {
      var bo = isObj(b) ? b : {}, out = {};
      var keys = Object.keys(t).concat(Object.keys(m).filter(function (k) { return !(k in t); }));
      keys.forEach(function (k) {
        var inM = k in m, inT = k in t, inB = k in bo;
        if (!inM) { if (!(inB && same(t[k], bo[k]))) out[k] = t[k]; return; }
        if (!inT) { if (!(inB && same(m[k], bo[k]))) out[k] = m[k]; return; }
        out[k] = mergeVal(inB ? bo[k] : undefined, m[k], t[k]);
      });
      return out;
    }
    if (Array.isArray(m) && Array.isArray(t)) return mergeList(Array.isArray(b) ? b : [], m, t);
    return m; // both changed one plain value: the latest save wins
  }
  function mergeList(b, m, t) {
    var all = b.concat(m, t);
    if (all.length && all.every(function (x) { return idOf(x) !== null; })) {
      var map = function (arr) { var r = new Map(); arr.forEach(function (x) { r.set(idOf(x), x); }); return r; };
      var bm = map(b), mm = map(m), out = [], used = new Set();
      t.forEach(function (tv) {
        var id = idOf(tv);
        if (!mm.has(id)) {
          if (bm.has(id) && same(bm.get(id), tv)) return; // I deleted it and they did not touch it
          out.push(tv);
        } else out.push(mergeVal(bm.get(id), mm.get(id), tv));
        used.add(id);
      });
      m.forEach(function (mv, i) {
        var id = idOf(mv);
        if (used.has(id)) return;
        if (bm.has(id) && same(bm.get(id), mv)) return; // they deleted it and I did not touch it
        var pos = i === 0 ? 0 : out.length;
        for (var j = i - 1; j >= 0; j--) {
          var pid = idOf(m[j]);
          var at = out.findIndex(function (x) { return idOf(x) === pid; });
          if (at >= 0) { pos = at + 1; break; }
        }
        out.splice(pos, 0, mv);
        used.add(id);
      });
      return out;
    }
    if (all.every(function (x) { return x === null || typeof x !== 'object'; })) {
      var key = function (x) { return typeof x + ':' + String(x); };
      var bs = new Set(b.map(key)), ms = new Set(m.map(key)), ts = new Set(t.map(key));
      return t.filter(function (x) { return !(bs.has(key(x)) && !ms.has(key(x))); })
        .concat(m.filter(function (x) { return !bs.has(key(x)) && !ts.has(key(x)); }));
    }
    return m;
  }
  function merge3(base, mine, theirs) {
    if (mine === theirs) return mine;
    if (mine === base) return theirs;
    if (theirs === base) return mine;
    if (mine === null) return theirs; // I deleted, they changed: keep their change
    if (theirs === null) return mine;
    var m = parse(mine), t = parse(theirs), b = base === null ? undefined : parse(base);
    if (m === FAIL || t === FAIL) return mine;
    return JSON.stringify(mergeVal(b === FAIL ? undefined : b, m, t));
  }

  /* ---------------- the synced key/value store ---------------- */
  // stores[ns][scope] : Map key -> { v: current, base: last confirmed, rev, busy }
  var stores = { ls: { s: new Map(), p: new Map() }, ws: { s: new Map(), p: new Map() } };
  ['ls', 'ws'].forEach(function (ns) {
    ['s', 'p'].forEach(function (sc) {
      var src = (B.data && B.data[ns] && B.data[ns][sc]) || {};
      Object.keys(src).forEach(function (k) { stores[ns][sc].set(k, { v: src[k][0], base: src[k][0], rev: src[k][1], busy: false }); });
    });
  });
  var privRes = (B.privateKeys || []).map(function (p) {
    return new RegExp('^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  });
  function lsScope(k) { for (var i = 0; i < privRes.length; i++) if (privRes[i].test(k)) return 'p'; return 's'; }
  function entry(ns, sc, k, create) {
    var m = stores[ns][sc], e = m.get(k);
    if (!e && create) { e = { v: null, base: null, rev: 0, busy: false }; m.set(k, e); }
    return e;
  }

  var dirty = new Set(), inflight = 0, failures = 0, flushTimer = null, lastState = '';
  function status() {
    var s = inflight || dirty.size ? (failures ? 'retry' : 'saving') : 'saved';
    if (s !== lastState) { lastState = s; note('status', { state: s }); }
  }
  function markDirty(ns, sc, k, delay) {
    dirty.add(JSON.stringify([ns, sc, k]));
    status();
    if (!flushTimer) flushTimer = setTimeout(function () { flushTimer = null; flush(); }, delay == null ? 120 : delay);
  }
  function flush() {
    dirty.forEach(function (id) {
      var p = JSON.parse(id), e = entry(p[0], p[1], p[2]);
      if (!e || e.busy) return;
      dirty.delete(id);
      if (e.v === e.base) return;
      push(p[0], p[1], p[2], e);
    });
    status();
  }
  var warnedReadOnly = false;
  function readOnly() {
    if (!warnedReadOnly) { warnedReadOnly = true; note('readonly'); setTimeout(function () { warnedReadOnly = false; }, 4000); }
  }
  /* ---------------- files the app picks: stored on the server, shared by everyone ---------------- */
  // Uploaded files are referenced with a relative link. It resolves against each viewer's own
  // (private, per-launch) address, so the same saved link works for everyone who has the app.
  var FILE_LINK = '__jhino/files/';
  var uploadsActive = 0;
  function uploadBlob(blob, name, onProgress) {
    var uploadId = rid();
    progressCbs[uploadId] = function (p) { if (onProgress) onProgress(p); note('upload', { name: name, loaded: p.loaded, total: p.total }); };
    uploadsActive++; inflight++; status();
    note('upload', { name: name, loaded: 0, total: blob.size });
    return call('files.upload', { file: blob, name: name, uploadId: uploadId }, 0).then(function (r) {
      delete progressCbs[uploadId];
      uploadsActive--; inflight--; status();
      note('upload', { name: name, done: true, error: r.error ? (r.message || r.error) : null });
      if (r.error) { if (r.error === 'FORBIDDEN') readOnly(); throw fail(r); }
      return FILE_LINK + r.file.id;
    });
  }
  function extOf(type) { var t = String(type).split('/')[1] || 'bin'; return t.replace('jpeg', 'jpg').replace('quicktime', 'mov').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'; }

  // Big data: URLs inside saved values (for example a photo the app shrank on a canvas) move to file storage.
  var BIG_DATA = /data:([a-z]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]{150000,})/g;
  var lifted = new Map();
  function dataKey(type, b64) { return type + ':' + b64.length + ':' + b64.slice(0, 48) + b64.slice(-48) + b64.slice(b64.length >> 1, (b64.length >> 1) + 48); }
  function liftDataUrls(value) {
    var jobs = [], seen = {};
    value.replace(BIG_DATA, function (whole, type, b64) {
      var key = dataKey(type, b64);
      if (seen[key]) return whole;
      seen[key] = true;
      if (!lifted.has(key)) {
        var bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        lifted.set(key, uploadBlob(new Blob([bytes], { type: type }), 'saved-' + Date.now().toString(36) + '.' + extOf(type)).catch(function (err) { lifted.delete(key); throw err; }));
      }
      jobs.push(lifted.get(key).then(function (link) { return [whole, link]; }, function () { return null; }));
      return whole;
    });
    return Promise.all(jobs).then(function (pairs) {
      var out = value;
      pairs.forEach(function (p) { if (p) out = out.split(p[0]).join(p[1]); });
      return out;
    });
  }

  function push(ns, sc, k, e) {
    var value = e.v;
    if (value && value.length > 150000) {
      BIG_DATA.lastIndex = 0;
      if (BIG_DATA.test(value)) {
        BIG_DATA.lastIndex = 0;
        e.busy = true; inflight++;
        liftDataUrls(value).then(function (small) {
          e.busy = false; inflight--;
          if (e.v === value) e.v = small; // the app has not changed it meanwhile
          pushNow(ns, sc, k, e);
        });
        return;
      }
    }
    pushNow(ns, sc, k, e);
  }
  function pushNow(ns, sc, k, e) {
    var value = e.v;
    if (value === e.base) { status(); return; }
    e.busy = true; inflight++;
    call('kv.set', { ns: ns, scope: sc === 'p' ? 'private' : 'shared', key: k, value: value, baseRev: e.rev }).then(function (r) {
      e.busy = false; inflight--;
      if (r.ok) {
        failures = 0; e.rev = r.rev; e.base = value;
        if (e.v !== value) markDirty(ns, sc, k);
      } else if (r.error === 'REVISION_CONFLICT') {
        failures = 0;
        var mine = e.v, merged = merge3(e.base, mine, r.value);
        e.base = r.value; e.rev = r.rev; e.v = merged;
        if (merged !== r.value) markDirty(ns, sc, k);
        if (merged !== mine) changed(ns, sc, k, mine, merged, null);
      } else if (r.error === 'FORBIDDEN' || r.error === 'VALIDATION_FAILED' || r.error === 'QUOTA_EXCEEDED' || r.error === 'NOT_FOUND') {
        var had = e.v; e.v = e.base;
        if (r.error === 'FORBIDDEN') readOnly(); else note('error', { message: r.message || 'This change could not be saved.' });
        if (had !== e.v) changed(ns, sc, k, had, e.v, null);
      } else {
        failures++;
        markDirty(ns, sc, k, Math.min(30000, 800 * Math.pow(2, failures)));
      }
      status();
    });
  }

  /* ---------------- telling the app about changes ---------------- */
  var appListens = false, kvListeners = [], recordSubs = {}, fileSubs = [], activitySubs = [], trashSubs = [], progressCbs = {};
  window.addEventListener = function (type) {
    if (type === 'storage') appListens = true;
    return EventTarget.prototype.addEventListener.apply(this || window, arguments);
  };
  var lastTouch = 0, wantRefresh = false, typedIn = new Set();
  ['keydown', 'input', 'pointerdown', 'wheel', 'touchstart'].forEach(function (t) {
    addListener(t, function (e) {
      lastTouch = Date.now();
      if (t === 'input' && e.isTrusted && e.target && 'value' in e.target) typedIn.add(e.target);
    }, true);
  });
  // Text a person typed and has not submitted yet: never throw it away with an automatic refresh.
  function hasDraft() {
    var found = false;
    typedIn.forEach(function (el) {
      if (!el.isConnected) { typedIn.delete(el); return; }
      if (/^(checkbox|radio|range|color|file)$/i.test(el.type || '')) return;
      // A field back at its starting value (for example a form reset after saving, with Qty back to 1) is not a draft.
      var v = String(el.value || '');
      if (v.trim() !== '' && v !== String(el.defaultValue == null ? '' : el.defaultValue)) found = true;
    });
    return found;
  }

  function changed(ns, sc, key, oldV, newV, by) {
    if (ns === 'ls') {
      try { window.dispatchEvent(new StorageEvent('storage', { key: key, oldValue: oldV, newValue: newV, url: location.href })); } catch (e) { /* ignore */ }
    }
    kvListeners.slice().forEach(function (fn) {
      try { fn({ type: ns === 'ls' ? 'localStorage' : 'storage', key: key, value: newV, shared: sc === 's', by: by }); } catch (e) { console.error(e); }
    });
    var handled = kvListeners.length > 0 || (ns === 'ls' && (appListens || typeof window.onstorage === 'function'));
    if (!handled) refreshSoon();
  }

  function refreshSoon() {
    if (wantRefresh) return;
    wantRefresh = true;
    note('stale');
    setTimeout(tryRefresh, 250);
  }
  function editing() {
    var a = document.activeElement;
    if (!a || a === document.body) return false;
    // Focus moved out of the app (for example to the Jhino bar): the field keeps activeElement but nobody is typing.
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
    if (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
    return a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(a.type || '');
  }
  function tryRefresh(force) {
    if (!wantRefresh) return;
    var busy = dirty.size || inflight || (!force && (editing() || hasDraft() || Date.now() - lastTouch < 1500 || document.querySelector('dialog[open]')));
    if (busy) { setTimeout(function () { tryRefresh(force); }, 600); return; }
    note('reloading', { scroll: [window.scrollX, window.scrollY] });
    setTimeout(function () { location.reload(); }, 30);
  }

  function applyRemote(ns, scope, key, value, rev, by) {
    var sc = scope === 'private' ? 'p' : 's';
    if (ns === 'ls' && lsScope(key) !== sc) return;
    var e = entry(ns, sc, key, true);
    if (rev <= e.rev) return;
    if (e.busy || dirty.has(JSON.stringify([ns, sc, key]))) return; // our save will meet it and merge
    var old = e.v;
    e.v = value; e.base = value; e.rev = rev;
    if (old !== value) changed(ns, sc, key, old, value, by);
  }

  function onEvent(type, d) {
    if (type === 'kv') applyRemote(d.ns, d.scope, d.key, d.value, d.rev, d.by || null);
    else if (type === 'kv-batch') (d.items || []).forEach(function (it) { applyRemote(d.ns, d.scope, it.key, it.value, it.rev, d.by || null); });
    else if (type === 'record') {
      (recordSubs[d.collection] || []).slice().forEach(function (fn) {
        try { fn({ op: d.op, record: d.record, by: d.by || null }); } catch (e) { console.error(e); }
      });
    } else if (type === 'resync') {
      kvResync().then(function () {
        Object.keys(recordSubs).forEach(function (c) {
          recordSubs[c].slice().forEach(function (fn) { try { fn({ op: 'resync' }); } catch (e) { console.error(e); } });
        });
        fileSubs.slice().forEach(function (fn) { try { fn({ op: 'resync' }); } catch (e) { console.error(e); } });
        activitySubs.slice().forEach(function (fn) { try { fn({ op: 'resync' }); } catch (e) { console.error(e); } });
      });
    } else if (type === 'file') {
      var f = d.file ? withUrl(d.file) : null;
      fileSubs.slice().forEach(function (fn) { try { fn({ op: d.op, file: f, by: d.by || null }); } catch (e) { console.error(e); } });
    } else if (type === 'navigate') {
      if (typeof d.hash === 'string' && /^#[A-Za-z0-9_/-]{1,160}$/.test(d.hash)) location.hash = d.hash;
    } else if (type === 'trash') {
      trashSubs.slice().forEach(function (fn) { try { fn({ op: d.op || 'change' }); } catch (e) { console.error(e); } });
    } else if (type === 'activity') {
      activitySubs.slice().forEach(function (fn) { try { fn({ op: 'new', line: d }); } catch (e) { console.error(e); } });
    } else if (type === 'upload-progress') {
      var cb = progressCbs[d.uploadId];
      if (cb) { try { cb({ loaded: d.loaded, total: d.total }); } catch (e) { console.error(e); } }
    } else if (type === 'role') {
      user.role = d.role;
    } else if (type === 'refresh-now') {
      wantRefresh = true; tryRefresh(true);
    } else if (type === 'new-version') {
      wantVersion = true; tryVersion();
    }
  }

  /** Fetch the saved data again and apply whatever is newer (changes, and deletions, made while this page was away). */
  function kvResync() {
    return call('kv.snapshot').then(function (r) {
      if (!r || !r.data) return;
      ['ls', 'ws'].forEach(function (ns) {
        ['s', 'p'].forEach(function (sc) {
          var src = r.data[ns][sc] || {};
          Object.keys(src).forEach(function (k) { applyRemote(ns, sc === 'p' ? 'private' : 'shared', k, src[k][0], src[k][1], null); });
        });
      });
    });
  }

  // The owner published a new version: switch to it as soon as this person pauses, keeping their place.
  var wantVersion = false;
  function tryVersion() {
    if (!wantVersion) return;
    var busy = dirty.size || inflight || editing() || hasDraft() || Date.now() - lastTouch < 1500 || document.querySelector('dialog[open]');
    if (busy) { setTimeout(tryVersion, 700); return; }
    wantVersion = false;
    note('version-ready', { hash: location.hash.slice(0, 200), scroll: [window.scrollX, window.scrollY] });
  }

  /* ---------------- localStorage ---------------- */
  function lsKeys() {
    var out = [];
    stores.ls.s.forEach(function (e, k) { if (e.v !== null && lsScope(k) === 's') out.push(k); });
    stores.ls.p.forEach(function (e, k) { if (e.v !== null && lsScope(k) === 'p') out.push(k); });
    return out;
  }
  function lsGet(k) { k = String(k); var e = entry('ls', lsScope(k), k); return e && e.v !== null ? e.v : null; }
  function lsSet(k, v) {
    k = String(k); v = String(v);
    var sc = lsScope(k);
    if (sc === 's' && !canWrite()) { readOnly(); return; }
    var e = entry('ls', sc, k, true);
    if (e.v === v) return;
    e.v = v; markDirty('ls', sc, k);
  }
  function lsRemove(k) {
    k = String(k);
    var sc = lsScope(k), e = entry('ls', sc, k);
    if (!e || e.v === null) return;
    if (sc === 's' && !canWrite()) { readOnly(); return; }
    e.v = null; markDirty('ls', sc, k);
  }
  var lsApi = {
    getItem: lsGet, setItem: lsSet, removeItem: lsRemove,
    clear: function () { lsKeys().forEach(lsRemove); },
    key: function (i) { var ks = lsKeys(); return i >= 0 && i < ks.length ? ks[i] : null; },
  };
  function storageProxy(api, getKeys, get, set, remove) {
    return new Proxy({}, {
      get: function (_t, p) {
        if (p === 'length') return getKeys().length;
        if (Object.prototype.hasOwnProperty.call(api, p)) return api[p];
        if (typeof p !== 'string') return undefined;
        var v = get(p); return v === null ? undefined : v;
      },
      set: function (_t, p, v) { if (typeof p === 'string') set(p, v); return true; },
      deleteProperty: function (_t, p) { if (typeof p === 'string') remove(p); return true; },
      has: function (_t, p) { return typeof p === 'string' && (p in api || get(p) !== null); },
      ownKeys: function () { return getKeys(); },
      getOwnPropertyDescriptor: function (_t, p) {
        if (typeof p !== 'string') return undefined;
        var v = get(p);
        return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
      },
    });
  }
  var localStore = storageProxy(lsApi, lsKeys, lsGet, lsSet, lsRemove);

  // sessionStorage stays in this tab only (as in a normal browser).
  var sess = new Map();
  var sessApi = {
    getItem: function (k) { k = String(k); return sess.has(k) ? sess.get(k) : null; },
    setItem: function (k, v) { sess.set(String(k), String(v)); },
    removeItem: function (k) { sess.delete(String(k)); },
    clear: function () { sess.clear(); },
    key: function (i) { return Array.from(sess.keys())[i] || null; },
  };
  var sessionStore = storageProxy(sessApi, function () { return Array.from(sess.keys()); }, sessApi.getItem, sessApi.setItem, sessApi.removeItem);

  function defineGlobal(name, value) {
    try { Object.defineProperty(window, name, { configurable: true, enumerable: true, get: function () { return value; } }); }
    catch (e) { try { window[name] = value; } catch (e2) { /* ignore */ } }
  }
  defineGlobal('localStorage', localStore);
  defineGlobal('sessionStorage', sessionStore);
  try {
    var jar = {};
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function () { return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; '); },
      set: function (v) {
        var first = String(v).split(';')[0], i = first.indexOf('=');
        if (i > 0) { var name = first.slice(0, i).trim(), val = first.slice(i + 1).trim(); if (/max-age=0|expires=thu, 01 jan 1970/i.test(v)) delete jar[name]; else jar[name] = val; }
      },
    });
  } catch (e) { /* ignore */ }

  /* ---------------- window.storage (the Claude artifact storage API) ---------------- */
  function wsScope(shared) { return shared ? 's' : 'p'; }
  defineGlobal('storage', {
    get: function (key, shared) {
      var e = entry('ws', wsScope(shared), String(key));
      return Promise.resolve(e && e.v !== null ? { key: String(key), value: e.v, shared: !!shared } : null);
    },
    set: function (key, value, shared) {
      key = String(key);
      var v = typeof value === 'string' ? value : JSON.stringify(value);
      if (shared && !canWrite()) { readOnly(); return Promise.reject(new Error('You can view this app but not change it.')); }
      var sc = wsScope(shared), e = entry('ws', sc, key, true);
      if (e.v !== v) { e.v = v; markDirty('ws', sc, key); }
      return Promise.resolve({ key: key, value: v, shared: !!shared });
    },
    delete: function (key, shared) {
      key = String(key);
      if (shared && !canWrite()) { readOnly(); return Promise.reject(new Error('You can view this app but not change it.')); }
      var sc = wsScope(shared), e = entry('ws', sc, key);
      if (e && e.v !== null) { e.v = null; markDirty('ws', sc, key); }
      return Promise.resolve({ key: key, deleted: true, shared: !!shared });
    },
    list: function (prefix, shared) {
      var keys = [];
      stores.ws[wsScope(shared)].forEach(function (e, k) { if (e.v !== null && (!prefix || k.indexOf(prefix) === 0)) keys.push(k); });
      return Promise.resolve({ keys: keys, prefix: prefix, shared: !!shared });
    },
  });

  /* ---------------- window.jhino (for apps built for Jhino) ---------------- */
  function fail(r) {
    var err = new Error(r.message || r.error || 'Request failed');
    err.code = r.error || 'UNKNOWN';
    if (r.record) err.current = r.record;
    return err;
  }
  function req(op, args) { return call(op, args).then(function (r) { if (r.error) throw fail(r); return r; }); }
  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  var runBase = (location.pathname.match(/^\/run\/[^/]+\//) || ['/'])[0];
  function fileUrl(id, opts) { return runBase + '__jhino/files/' + encodeURIComponent(id) + (opts && opts.download ? '?download=1' : ''); }
  function withUrl(f) { if (f && f.id) { f.url = fileUrl(f.id); f.downloadUrl = fileUrl(f.id, { download: true }); } return f; }

  window.jhino = Object.freeze({
    version: 1,
    /** False when the platform keeps files as links only (no uploads). */
    uploadsAllowed: B.uploads !== false,
    ready: function () { return readyPromise; },
    me: function () { return Promise.resolve({ id: user.id, name: user.name, email: user.email, role: user.role }); },
    onChange: function (fn) {
      kvListeners.push(fn);
      return function () { kvListeners = kvListeners.filter(function (x) { return x !== fn; }); };
    },
    /** Everyone who can open this app: [{ id, name, role }] */
    people: function () { return req('people').then(function (r) { return r.people; }); },
    /** Who did what in this app: list({ limit, before }) -> { activity, seen, me }; seen(id); subscribe(fn). */
    activity: Object.freeze({
      list: function (opts) { opts = opts || {}; return req('activity.list', { limit: opts.limit, before: opts.before }); },
      seen: function (id) { return req('activity.seen', { upTo: Number(id) || 0 }).then(function () { return true; }); },
      subscribe: function (fn) {
        activitySubs.push(fn);
        return Promise.resolve(function () { activitySubs = activitySubs.filter(function (x) { return x !== fn; }); });
      },
    }),
    /** Deleted items and files: list() -> { items, canPurge }; restore(ids); purge(ids) or purge('all'); subscribe(fn). */
    trash: Object.freeze({
      list: function () { return req('trash.list'); },
      restore: function (ids) { return req('trash.restore', { ids: ids }); },
      purge: function (ids) { return req('trash.purge', ids === 'all' ? { all: true } : { ids: ids }); },
      subscribe: function (fn) {
        trashSubs.push(fn);
        return Promise.resolve(function () { trashSubs = trashSubs.filter(function (x) { return x !== fn; }); });
      },
    }),
    /** Keep the browser address in step with what is open (for example "#section/item"), so it can be shared or opened in a new tab. */
    setLocation: function (hash) { if (typeof hash === 'string') note('location', { hash: hash.slice(0, 200) }); },
    openInNewTab: function (hash) { note('open-tab', { hash: typeof hash === 'string' ? hash.slice(0, 200) : '' }); },
    /** From a single-item tab, open the whole app at this item. */
    openFull: function (hash) { note('open-full', { hash: typeof hash === 'string' ? hash.slice(0, 200) : '' }); },
    /** The browser tab's title. */
    setTitle: function (t) { note('title', { title: String(t || '').slice(0, 120) }); },
    files: Object.freeze({
      /** Upload a File/Blob to this app. opts.onProgress({ loaded, total }). Resolves to { id, name, type, size, url, downloadUrl }. */
      upload: function (file, opts) {
        opts = opts || {};
        if (!(file instanceof Blob)) return Promise.reject(fail({ error: 'VALIDATION_FAILED', message: 'Pass a File or Blob.' }));
        var uploadId = rid();
        if (typeof opts.onProgress === 'function') progressCbs[uploadId] = opts.onProgress;
        return call('files.upload', { file: file, name: opts.name || file.name || 'file', uploadId: uploadId }, 0).then(function (r) {
          delete progressCbs[uploadId];
          if (r.error) throw fail(r);
          return withUrl(r.file);
        });
      },
      list: function () { return req('files.list').then(function (r) { return r.files.map(withUrl); }); },
      url: fileUrl,
      delete: function (id) { return req('files.delete', { id: id }).then(function () { return true; }); },
      subscribe: function (fn) {
        fileSubs.push(fn);
        return Promise.resolve(function () { fileSubs = fileSubs.filter(function (x) { return x !== fn; }); });
      },
    }),
    data: Object.freeze({
      list: function (collection, opts) {
        opts = opts || {};
        return req('records.list', { collection: collection, limit: opts.limit, after: opts.after }).then(function (r) { return { items: r.items, next: r.next }; });
      },
      get: function (collection, id) { return req('records.get', { collection: collection, id: id }).then(function (r) { return r.record; }); },
      create: function (collection, data, opts) {
        var key = (opts && opts.idempotencyKey) || rid(), tries = 0;
        var attempt = function () {
          return call('records.create', { collection: collection, data: data, idempotencyKey: key }).then(function (r) {
            if (r.error === 'CONNECTION_LOST' && tries++ < 3) return new Promise(function (ok) { setTimeout(ok, 800 * tries); }).then(attempt);
            if (r.error) throw fail(r);
            return r.record;
          });
        };
        return attempt();
      },
      update: function (collection, id, patch, opts) {
        return req('records.update', { collection: collection, id: id, data: patch, expectedRevision: opts && opts.expectedRevision }).then(function (r) { return r.record; });
      },
      delete: function (collection, id, opts) {
        return req('records.delete', { collection: collection, id: id, expectedRevision: opts && opts.expectedRevision }).then(function () { return true; });
      },
      subscribe: function (collection, fn) {
        (recordSubs[collection] = recordSubs[collection] || []).push(fn);
        return Promise.resolve(function () { recordSubs[collection] = (recordSubs[collection] || []).filter(function (x) { return x !== fn; }); });
      },
    }),
  });

  // A picked photo, video or document read as a data: URL is uploaded instead; the app gets a link.
  // Small images (under 150 KB) stay as they are, so apps that edit pixels keep working.
  var NativeReader = window.FileReader;
  if (NativeReader && NativeReader.prototype && NativeReader.prototype.readAsDataURL) {
    var nativeReadAsDataURL = NativeReader.prototype.readAsDataURL;
    var fire = function (target, type, loaded, total) {
      try { target.dispatchEvent(new ProgressEvent(type, { lengthComputable: true, loaded: loaded, total: total })); } catch (err) { /* ignore */ }
    };
    NativeReader.prototype.readAsDataURL = function (blob) {
      var big = blob instanceof Blob && blob.size > 0 && (blob.size > 150 * 1024 || /^(video|audio)\//.test(blob.type) || blob.type === 'application/pdf');
      // With uploads switched off by the platform, the file stays inside the saved data as before.
      if (!big || window.parent === window || B.uploads === false) return nativeReadAsDataURL.call(this, blob);
      var fr = this;
      var set = function (k, v) { try { Object.defineProperty(fr, k, { configurable: true, get: function () { return v; } }); } catch (err) { /* ignore */ } };
      set('readyState', 1); set('result', null); set('error', null);
      var total = blob.size;
      setTimeout(function () { fire(fr, 'loadstart', 0, total); }, 0);
      uploadBlob(blob, blob.name || ('file.' + extOf(blob.type)), function (p) { fire(fr, 'progress', p.loaded, total); }).then(function (link) {
        set('readyState', 2); set('result', link);
        fire(fr, 'load', total, total); fire(fr, 'loadend', total, total);
      }, function (err) {
        set('readyState', 2); set('error', err);
        if (err && err.code !== 'FORBIDDEN') note('error', { message: 'Could not upload ' + (blob.name || 'the file') + ': ' + (err.message || 'unknown error') });
        fire(fr, 'error', 0, total); fire(fr, 'loadend', 0, total);
      });
    };
  }

  /* ---------------- IndexedDB, saved on the server ---------------- */
  // Browsers switch IndexedDB off in sandboxed frames. Apps that use it get a full IndexedDB
  // (fake-indexeddb, loaded just before this file) whose changes are saved like localStorage:
  // one synced key per record, "__idb/<db>/<store>/<key>", and one per database for its structure.
  // A change by someone else refreshes the app when the person pauses, and the app reloads the saved data.
  (function () {
    var F = window.__JHINO_FAKE_IDB__;
    try { delete window.__JHINO_FAKE_IDB__; } catch (e) { window.__JHINO_FAKE_IDB__ = undefined; }
    if (!F || !F.indexedDB) return;
    var factory = F.indexedDB, PFX = '__idb/';
    ['IDBCursor', 'IDBCursorWithValue', 'IDBDatabase', 'IDBFactory', 'IDBIndex', 'IDBKeyRange', 'IDBObjectStore',
      'IDBOpenDBRequest', 'IDBRequest', 'IDBTransaction', 'IDBVersionChangeEvent'].forEach(function (n) { if (F[n]) defineGlobal(n, F[n]); });
    defineGlobal('indexedDB', factory);

    // Short, stable names for keys (cyrb53).
    function h(str) {
      var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
    }

    /* values <-> JSON, keeping dates, binary data, files, maps and sets */
    function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
    function unb64(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
    var blobSrc = new WeakMap();
    function readBlob(b) {
      // Big files are uploaded by the FileReader bridge above and come back as a link; small ones stay inline.
      if (!blobSrc.has(b)) blobSrc.set(b, new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { no(r.error || new Error('Could not read a file.')); }; r.readAsDataURL(b); }));
      return blobSrc.get(b);
    }
    function enc(v, jobs) {
      if (v === undefined) return { __jt: 'undef' };
      if (typeof v === 'number' && !isFinite(v)) return { __jt: 'num', v: String(v) };
      if (typeof v === 'bigint') return { __jt: 'big', v: String(v) };
      if (v === null || typeof v !== 'object') return v;
      if (v instanceof Date) return { __jt: 'date', v: v.getTime() };
      if (typeof Blob !== 'undefined' && v instanceof Blob) {
        var o = { __jt: 'blob', type: v.type, v: '' };
        if (typeof File !== 'undefined' && v instanceof File) { o.name = v.name; o.lm = v.lastModified; }
        jobs.push(readBlob(v).then(function (src) { o.v = src; }));
        return o;
      }
      if (v instanceof ArrayBuffer) return { __jt: 'ab', v: b64(new Uint8Array(v)) };
      if (ArrayBuffer.isView(v)) return { __jt: 'ta', t: v.constructor.name, v: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
      if (v instanceof Map) { var m = []; v.forEach(function (val, k) { m.push([enc(k, jobs), enc(val, jobs)]); }); return { __jt: 'map', v: m }; }
      if (v instanceof Set) { var s = []; v.forEach(function (x) { s.push(enc(x, jobs)); }); return { __jt: 'set', v: s }; }
      if (v instanceof RegExp) return { __jt: 're', s: v.source, f: v.flags };
      if (Array.isArray(v)) return v.map(function (x) { return enc(x, jobs); });
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = enc(v[k], jobs); });
      return out;
    }
    function fetchBytes(link) {
      try {
        var x = new XMLHttpRequest();
        x.open('GET', runBase + String(link).replace(/^.*?(__jhino\/files\/)/, '$1'), false);
        x.overrideMimeType('text/plain; charset=x-user-defined');
        x.send();
        if (x.status !== 200) return new Uint8Array(0);
        var t = x.responseText, out = new Uint8Array(t.length);
        for (var i = 0; i < t.length; i++) out[i] = t.charCodeAt(i) & 0xff;
        return out;
      } catch (e) { return new Uint8Array(0); }
    }
    function toBlob(o) {
      var bytes, src = o.v || '';
      if (src.indexOf('data:') === 0) {
        var comma = src.indexOf(',');
        bytes = /;base64$/.test(src.slice(0, comma)) ? unb64(src.slice(comma + 1)) : new TextEncoder().encode(decodeURIComponent(src.slice(comma + 1)));
      } else bytes = src ? fetchBytes(src) : new Uint8Array(0);
      var b = o.name != null && typeof File === 'function' ? new File([bytes], o.name, { type: o.type, lastModified: o.lm }) : new Blob([bytes], { type: o.type });
      blobSrc.set(b, Promise.resolve(src)); // saving it again does not upload it again
      return b;
    }
    function dec(v) {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(dec);
      switch (v.__jt) {
        case 'undef': return undefined;
        case 'num': return Number(v.v);
        case 'big': return typeof BigInt === 'function' ? BigInt(v.v) : Number(v.v);
        case 'date': return new Date(v.v);
        case 'blob': return toBlob(v);
        case 'ab': return unb64(v.v).buffer;
        case 'ta': { var bytes = unb64(v.v); if (v.t === 'DataView') return new DataView(bytes.buffer); var C = window[v.t]; return typeof C === 'function' ? new C(bytes.buffer) : bytes; }
        case 'map': return new Map(v.v.map(function (p) { return [dec(p[0]), dec(p[1])]; }));
        case 'set': return new Set(v.v.map(dec));
        case 're': return new RegExp(v.s, v.f);
      }
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = dec(v[k]); });
      return out;
    }
    // A copy at the moment of the write (as IndexedDB does); files are kept as they are (they cannot change).
    function snap(v) {
      if (v === null || typeof v !== 'object') return v;
      if (v instanceof Date) return new Date(v.getTime());
      if (typeof Blob !== 'undefined' && v instanceof Blob) return v;
      if (v instanceof ArrayBuffer) return v.slice(0);
      if (ArrayBuffer.isView(v)) return v.slice ? v.slice() : new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
      if (v instanceof Map) { var m = new Map(); v.forEach(function (val, k) { m.set(snap(k), snap(val)); }); return m; }
      if (v instanceof Set) { var s = new Set(); v.forEach(function (x) { s.add(snap(x)); }); return s; }
      if (Array.isArray(v)) return v.map(snap);
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = snap(v[k]); });
      return out;
    }

    /* saved keys */
    var schemas = {}, mirrors = {}, ours = new WeakSet(), pending = new WeakMap(), chain = Promise.resolve();
    function recKey(db, store, key) { return PFX + h(db) + '/' + h(store) + '/' + h(JSON.stringify(enc(key, []))); }
    function mirror(db, store) { var d = mirrors[db] = mirrors[db] || {}; return d[store] = d[store] || new Map(); }
    var warned = false;
    function kvPut(k, v) {
      if (!canWrite()) { if (!warned) { warned = true; readOnly(); } return; }
      var e = entry('ws', 's', k, true);
      if (e.v === v) return;
      e.v = v; markDirty('ws', 's', k);
    }
    function kvDel(k) {
      var e = entry('ws', 's', k);
      if (!e || e.v === null) return;
      if (!canWrite()) { if (!warned) { warned = true; readOnly(); } return; }
      e.v = null; markDirty('ws', 's', k);
    }

    /* recording what a transaction changes; saved only when it commits */
    function opsOf(tx) { var list = pending.get(tx); if (!list) { list = []; pending.set(tx, list); } return list; }
    function record(tx, op) { if (tx && !ours.has(tx) && tx.mode !== 'readonly') opsOf(tx).push(op); }
    function commit(db, ops) {
      if (!ops || !ops.length) return;
      chain = chain.then(function () {
        var jobs = [], writes = [];
        ops.forEach(function (op) {
          var m = mirror(db, op.store);
          if (op.t === 'put') {
            var k = recKey(db, op.store, op.key);
            m.set(k, op.key);
            writes.push([k, { k: enc(op.key, []), v: enc(op.value, jobs) }]);
          } else if (op.t === 'del') {
            var ks = [];
            if (F.IDBKeyRange && op.query instanceof F.IDBKeyRange) m.forEach(function (key, k2) { try { if (op.query.includes(key)) ks.push(k2); } catch (e) { /* not comparable */ } });
            else ks.push(recKey(db, op.store, op.query));
            ks.forEach(function (k3) { m.delete(k3); writes.push([k3, null]); });
          } else if (op.t === 'clear') {
            m.forEach(function (_key, k4) { writes.push([k4, null]); });
            m.clear();
          }
        });
        return Promise.all(jobs).then(function () {
          writes.forEach(function (w) { if (w[1] === null) kvDel(w[0]); else kvPut(w[0], JSON.stringify(w[1])); });
        });
      }).catch(function (e) { note('error', { message: 'A change could not be saved: ' + ((e && e.message) || e) }); });
    }
    function saveSchema(conn) {
      var raw = conn._rawDatabase;
      if (!raw) return;
      var stores = [];
      raw.rawObjectStores.forEach(function (s, name) {
        if (s.deleted) return;
        var idx = [];
        s.rawIndexes.forEach(function (ix, iname) { if (!ix.deleted) idx.push({ name: iname, keyPath: ix.keyPath, unique: !!ix.unique, multiEntry: !!ix.multiEntry }); });
        stores.push({ name: name, keyPath: s.keyPath, autoIncrement: !!s.autoIncrement, indexes: idx });
      });
      var s2 = { name: conn.name, version: raw.version, stores: stores };
      schemas[conn.name] = s2;
      chain = chain.then(function () { kvPut(PFX + h(conn.name), JSON.stringify(s2)); });
    }

    var DB = F.IDBDatabase.prototype, OS = F.IDBObjectStore.prototype, CU = F.IDBCursor.prototype, FA = F.IDBFactory.prototype;
    var origTx = DB.transaction;
    DB.transaction = function (names, mode) {
      var tx = origTx.apply(this, arguments), conn = this;
      if (tx.mode !== 'readonly') {
        tx.addEventListener('complete', function () {
          if (ours.has(tx)) return;
          commit(conn.name, pending.get(tx));
          pending.delete(tx);
          if (tx.mode === 'versionchange') saveSchema(conn);
        });
        tx.addEventListener('abort', function () { pending.delete(tx); });
      }
      return tx;
    };
    var origDelStore = DB.deleteObjectStore;
    DB.deleteObjectStore = function (name) {
      var raw = this._rawDatabase, tx = raw && raw.transactions.filter(function (t) { return t.mode === 'versionchange'; }).pop();
      var r = origDelStore.apply(this, arguments);
      record(tx, { t: 'clear', store: name });
      return r;
    };
    ['put', 'add'].forEach(function (fn) {
      var orig = OS[fn];
      OS[fn] = function (value, key) {
        var req = orig.apply(this, arguments), tx = this.transaction;
        if (!ours.has(tx)) {
          var op = { t: 'put', store: this.name, value: snap(value), key: key };
          req.addEventListener('success', function () { op.key = req.result; });
          record(tx, op);
        }
        return req;
      };
    });
    var origDelete = OS.delete;
    OS.delete = function (query) { var req = origDelete.apply(this, arguments); record(this.transaction, { t: 'del', store: this.name, query: snap(query) }); return req; };
    var origClear = OS.clear;
    OS.clear = function () { var req = origClear.apply(this, arguments); record(this.transaction, { t: 'clear', store: this.name }); return req; };
    function cursorStore(c) { var s = c.source; return s && s.objectStore ? s.objectStore : s; }
    var origUpdate = CU.update;
    CU.update = function (value) {
      var req = origUpdate.apply(this, arguments), store = cursorStore(this);
      if (store) record(store.transaction, { t: 'put', store: store.name, value: snap(value), key: snap(this.primaryKey) });
      return req;
    };
    var origCurDel = CU.delete;
    CU.delete = function () {
      var key = snap(this.primaryKey), req = origCurDel.apply(this, arguments), store = cursorStore(this);
      if (store) record(store.transaction, { t: 'del', store: store.name, query: key });
      return req;
    };
    var origDeleteDb = FA.deleteDatabase;
    FA.deleteDatabase = function (name) {
      var req = origDeleteDb.apply(this, arguments);
      req.addEventListener('success', function () {
        chain = chain.then(function () {
          var p = PFX + h(String(name));
          stores.ws.s.forEach(function (e, k) { if ((k === p || k.indexOf(p + '/') === 0) && e.v !== null) kvDel(k); });
          delete schemas[name]; delete mirrors[name];
        });
      });
      return req;
    };

    /* put the saved databases back before the app's own code opens them */
    var groups = {};
    stores.ws.s.forEach(function (e, k) {
      if (k.indexOf(PFX) !== 0 || e.v === null) return;
      var parts = k.slice(PFX.length).split('/');
      var g = groups[parts[0]] = groups[parts[0]] || { schema: null, recs: {} };
      if (parts.length === 1) { try { g.schema = JSON.parse(e.v); } catch (x) { /* damaged: skipped */ } }
      else if (parts.length === 3) (g.recs[parts[1]] = g.recs[parts[1]] || []).push([k, e.v]);
    });
    Object.keys(groups).forEach(function (dh) {
      var g = groups[dh], s = g.schema;
      if (!s || typeof s.name !== 'string' || !Array.isArray(s.stores)) return;
      schemas[s.name] = s;
      var req = factory.open(s.name, Math.max(1, Number(s.version) || 1));
      req.onupgradeneeded = function () {
        var db = req.result;
        ours.add(req.transaction);
        s.stores.forEach(function (st) {
          var os = db.createObjectStore(st.name, { keyPath: st.keyPath === undefined ? null : st.keyPath, autoIncrement: !!st.autoIncrement });
          (st.indexes || []).forEach(function (ix) { try { os.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry }); } catch (x) { console.warn('[jhino] index not restored', ix.name, x); } });
          var m = mirror(s.name, st.name);
          (g.recs[h(st.name)] || []).forEach(function (pair) {
            try {
              var r = JSON.parse(pair[1]), key = dec(r.k), val = dec(r.v);
              if (st.keyPath != null) os.put(val); else os.put(val, key);
              m.set(pair[0], key);
            } catch (x) { console.warn('[jhino] a saved record could not be restored', x); }
          });
        });
      };
      req.onsuccess = function () { req.result.close(); };
      req.onerror = function () { console.warn('[jhino] could not restore the database', s.name, req.error); };
    });
  })();

  // Save anything waiting before the page goes away.
  addListener('pagehide', function () { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } flush(); });
  addListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
})();
