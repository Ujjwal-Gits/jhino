/* Jhino websites: the one small script a published site loads (deferred). Menu button, carousels,
   click-to-play videos, the before/after slider, today's opening hours, sending forms, the photo
   unveil as sections scroll into view, the header laid over a full-photo hero, tabs, the story slider,
   photo notes, countdowns, closable announcements, copy buttons, share links and "Enquire" prefills.
   Everything is delegated from the document, so it works for blocks added later too. */
(function () {
  var d = document, root = d.documentElement;
  root.classList.add('js');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var editing = root.hasAttribute('data-edit'), preview = root.hasAttribute('data-preview');
  var started = Date.now();

  d.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest || editing) return;
    var nav = t.closest('.nav-t');
    if (nav) {
      var h = nav.closest('.site-h'), open = !h.classList.contains('open');
      h.classList.toggle('open', open);
      nav.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    var dir = t.closest('[data-dir]');
    if (dir) {
      var track = dir.closest('[data-car]').querySelector('.car-track');
      track.scrollBy({ left: track.clientWidth * 0.8 * Number(dir.getAttribute('data-dir')), behavior: reduce ? 'auto' : 'smooth' });
      return;
    }
    var v = t.closest('[data-embed]');
    if (v) {
      e.preventDefault();
      var f = d.createElement('iframe');
      f.src = v.getAttribute('data-embed');
      f.title = v.getAttribute('data-title') || 'Video';
      f.className = v.getAttribute('data-frame') || 'vid';
      f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      f.setAttribute('allowfullscreen', '');
      var vf = v.closest('[data-vf]');
      if (vf) vf.classList.add('playing');
      v.parentNode.replaceChild(f, v);
      f.focus();
      return;
    }
    var tab = t.closest('[data-tabs] [role=tab]');
    if (tab) { pickTab(tab); return; }
    var sl = t.closest('[data-sl]');
    if (sl) {
      var tr = sl.closest('[data-slider]').querySelector('.vc-track');
      tr.scrollBy({ left: tr.clientWidth * Number(sl.getAttribute('data-sl')), behavior: reduce ? 'auto' : 'smooth' });
      return;
    }
    var dot = t.closest('button[data-hs]');
    if (dot) { spot(dot, dot.getAttribute('aria-expanded') !== 'true'); return; }
    var hx = t.closest('[data-hs-close]');
    if (hx) { var n = hx.closest('.hs-note'); var db = n && d.querySelector('[data-hs="' + n.id + '"]'); if (db) { spot(db, false); db.focus(); } return; }
    if (!t.closest('.hs-note')) closeSpots();
    var ax = t.closest('[data-an-x]');
    if (ax) {
      var an = ax.closest('[data-an]'), sec = an.closest('.blk');
      store('set', 'jhino-an-' + an.getAttribute('data-an'), '1');
      if (sec) sec.hidden = true;
      return;
    }
    var cp = t.closest('[data-copy]');
    if (cp) { copy(cp.getAttribute('data-copy'), cp, cp.closest('.blk').querySelector('[data-copy-status]'), 'Copied'); return; }
    var sh = t.closest('[data-share]');
    if (sh) {
      var how = sh.getAttribute('data-share');
      if (how === 'copy') { e.preventDefault(); copy(pageUrl(), sh, sh.closest('.sh-share').querySelector('[data-share-status]'), 'Link copied'); }
      else if (how === 'native') { e.preventDefault(); navigator.share({ title: d.title, url: pageUrl() }).catch(function () {}); }
      return;
    }
    var enq = t.closest('[data-enq]');
    if (enq) {
      var target = d.getElementById((enq.getAttribute('href') || '').slice(1));
      var box = target && target.querySelector('textarea[name=message], textarea[name=notes]');
      if (!box) return;
      e.preventDefault();
      box.value = enq.getAttribute('data-enq') + '.\n';
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      var first = target.querySelector('input[name=name]') || box;
      setTimeout(function () { first.focus({ preventScroll: true }); }, reduce ? 0 : 450);
    }
  });

  /* ---- tabs: arrow keys move between tabs (and show them), Home and End jump ---- */
  function pickTab(tab, focus) {
    var list = tab.closest('[role=tablist]'), tabs = list.querySelectorAll('[role=tab]');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i] === tab, p = d.getElementById(tabs[i].getAttribute('aria-controls'));
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
      if (!p) continue;
      var was = !p.classList.contains('tb-off');
      p.classList.toggle('tb-off', !on);
      if (on && !was) { p.classList.remove('tb-in'); void p.offsetWidth; p.classList.add('tb-in'); }
    }
    if (focus) tab.focus();
    if (tab.scrollIntoView && list.scrollWidth > list.clientWidth) tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ---- photo notes: one open at a time ---- */
  function spot(btn, open) {
    if (open) closeSpots(btn);
    var n = d.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (n) n.hidden = !open;
  }
  function closeSpots(except) {
    var open = d.querySelectorAll('button[data-hs][aria-expanded=true]');
    for (var i = 0; i < open.length; i++) if (open[i] !== except) spot(open[i], false);
  }

  /* ---- small helpers: storage that may be blocked, copying, this page's address ---- */
  function store(op, k, v) { try { return op === 'set' ? localStorage.setItem(k, v) : localStorage.getItem(k); } catch (_) { return null; } }
  function pageUrl() { var c = d.querySelector('link[rel=canonical]'); return (c && c.href) || location.href.split('#')[0]; }
  function copy(text, btn, status, said) {
    function done(ok) {
      var label = btn.querySelector('span') || btn, was = label.textContent;
      if (status) status.textContent = ok ? said : 'Could not copy. Select the text and copy it.';
      if (!ok) return;
      btn.classList.add('done'); label.textContent = said;
      setTimeout(function () { btn.classList.remove('done'); label.textContent = was; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  d.addEventListener('input', function (e) {
    var r = e.target;
    if (r && r.classList && r.classList.contains('ba-range')) r.parentNode.style.setProperty('--pos', r.value + '%');
  });

  d.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!editing && t && t.getAttribute && t.getAttribute('role') === 'tab' && t.closest('[data-tabs]')) {
      var tabs = t.closest('[role=tablist]').querySelectorAll('[role=tab]'), i = Array.prototype.indexOf.call(tabs, t), j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j >= 0) { e.preventDefault(); pickTab(tabs[j], true); }
      return;
    }
    if (e.key !== 'Escape') return;
    var sp = d.querySelector('button[data-hs][aria-expanded=true]');
    if (sp) { spot(sp, false); sp.focus(); return; }
    var h = d.querySelector('.site-h.open');
    if (h) { h.classList.remove('open'); var b = h.querySelector('.nav-t'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); } }
  });

  /* ---- once the page is there: sliders, countdowns, closed announcements, share links ---- */
  function setup() {
    if (editing) return;
    var i, sls = d.querySelectorAll('[data-slider]');
    for (i = 0; i < sls.length; i++) slider(sls[i]);
    var ans = d.querySelectorAll('[data-an]');
    for (i = 0; i < ans.length; i++) if (store('get', 'jhino-an-' + ans[i].getAttribute('data-an'))) { var s = ans[i].closest('.blk'); if (s) s.hidden = true; }
    var url = encodeURIComponent(pageUrl()), title = encodeURIComponent(d.title);
    var go = { whatsapp: 'https://wa.me/?text=' + title + '%20' + url, facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + url, x: 'https://x.com/intent/post?url=' + url + '&text=' + title };
    var sh = d.querySelectorAll('a[data-share]');
    for (i = 0; i < sh.length; i++) sh[i].href = go[sh[i].getAttribute('data-share')] || '#';
    if (navigator.share) { var nv = d.querySelectorAll('.sh-native'); for (i = 0; i < nv.length; i++) nv[i].hidden = false; }
    tick();
  }
  function slider(box) {
    var track = box.querySelector('.vc-track'), slides = track.children, count = box.querySelector('[data-sl-i]');
    var prev = box.querySelector('[data-sl="-1"]'), next = box.querySelector('[data-sl="1"]'), queued = false;
    function update() {
      queued = false;
      var at = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      for (var i = 0; i < slides.length; i++) slides[i].classList.toggle('on', i === at);
      if (count) count.textContent = String(at + 1);
      if (prev) prev.disabled = at <= 0;
      if (next) next.disabled = at >= slides.length - 1;
    }
    track.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    box.classList.add('ready');
    update();
  }
  // Countdowns: whole seconds, text only (no motion). Past the time, the block shows its "after" line.
  var timer = 0;
  function tick() {
    var cds = d.querySelectorAll('[data-cd]:not(.cd-done)'), live = 0;
    for (var i = 0; i < cds.length; i++) {
      var left = Date.parse(cds[i].getAttribute('data-cd')) - Date.now();
      if (!(left > 0)) { cds[i].classList.add('cd-done'); continue; }
      live++;
      var s = Math.floor(left / 1000), v = { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
      var ns = cds[i].querySelectorAll('[data-u]');
      for (var j = 0; j < ns.length; j++) { var u = ns[j].getAttribute('data-u'), x = String(v[u]); if (u !== 'd' && x.length < 2) x = '0' + x; if (ns[j].textContent !== x) ns[j].textContent = x; }
    }
    clearTimeout(timer);
    if (live) timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 20);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', setup); else setup();

  function today() {
    var rows = d.querySelectorAll('[data-dow="' + new Date().getDay() + '"]');
    for (var i = 0; i < rows.length; i++) { rows[i].classList.add('today'); rows[i].setAttribute('aria-current', 'date'); }
    if (reduce) { var vs = d.querySelectorAll('video[autoplay]'); for (var j = 0; j < vs.length; j++) { vs[j].removeAttribute('autoplay'); vs[j].pause(); } }
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', today); else today();

  // Photos unveil once as they come into view (CSS draws the panel; this only says when).
  // Without IntersectionObserver, or with motion turned off, everything is simply shown.
  // Never hides anything for good: photos already in view show at once, a scroll check backs up the observer
  // (tall or scaled frames), and once a photo is shown its cover is removed from the page entirely.
  function show(el) {
    if (el.classList.contains('in')) return;
    el.classList.add('in');
    setTimeout(function () { el.classList.add('shown'); }, 1400);
  }
  function inView(el, k) { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.height > 0 && r.top < (window.innerHeight || root.clientHeight) * k; }
  function sweep() {
    var els = d.querySelectorAll('.rv:not(.in)');
    for (var i = 0; i < els.length; i++) if (inView(els[i], 0.94) || els[i].getBoundingClientRect().bottom < 0) show(els[i]);
  }
  function reveal() {
    var els = d.querySelectorAll('.rv:not(.in)'), i;
    if (editing || preview || reduce || !('IntersectionObserver' in window)) { for (i = 0; i < els.length; i++) { els[i].classList.add('in', 'shown'); } root.classList.add('rv-js'); return; }
    var io = new IntersectionObserver(function (es) {
      for (var j = 0; j < es.length; j++) if (es[j].isIntersecting) { show(es[j].target); io.unobserve(es[j].target); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    for (i = 0; i < els.length; i++) io.observe(els[i]);
    var queued = false;
    window.addEventListener('scroll', function () { if (!queued) { queued = true; setTimeout(function () { queued = false; sweep(); }, 120); } }, { passive: true });
    window.addEventListener('resize', sweep);
    sweep();
    setTimeout(sweep, 1500);
    root.classList.add('rv-js');
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', reveal); else reveal();
  window.addEventListener('beforeprint', function () { var els = d.querySelectorAll('.rv'); for (var i = 0; i < els.length; i++) els[i].classList.add('in'); });

  // A header over a full-photo hero turns solid once the page scrolls.
  var over = d.querySelector('.site-h.over'), ticking = false;
  function onScroll() {
    ticking = false;
    if (over) over.classList.toggle('scrolled', (window.scrollY || 0) > 24);
  }
  if (over) { window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true }); onScroll(); }

  d.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.hasAttribute || !f.hasAttribute('data-form')) return;
    e.preventDefault();
    var msg = f.querySelector('.form-msg'), btn = f.querySelector('button[type=submit]');
    if (editing || preview) { msg.textContent = 'This is a preview. On the published site this form sends to your Submissions.'; return; }
    var data = {};
    var els = f.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.name || el.disabled || ((el.type === 'radio' || el.type === 'checkbox') && !el.checked)) continue;
      data[el.name] = el.value;
    }
    data._t = Date.now() - started;
    btn.disabled = true;
    msg.textContent = 'Sending…';
    fetch(f.getAttribute('action'), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(data), credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        btn.disabled = false;
        if (x.ok) { f.reset(); f.classList.add('sent'); msg.textContent = f.getAttribute('data-success') || 'Thank you.'; }
        else msg.textContent = (x.j && x.j.message) || 'It could not be sent. Please try again.';
      }, function () { btn.disabled = false; msg.textContent = 'No connection. Please try again in a moment.'; });
  });
})();
