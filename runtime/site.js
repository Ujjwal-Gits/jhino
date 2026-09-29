/* Jhino websites: the one small script a published site loads (deferred). Menu button, carousels,
   click-to-play videos, the before/after slider, today's opening hours, and sending forms.
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
      f.className = 'vid';
      f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      f.setAttribute('allowfullscreen', '');
      v.parentNode.replaceChild(f, v);
      f.focus();
    }
  });

  d.addEventListener('input', function (e) {
    var r = e.target;
    if (r && r.classList && r.classList.contains('ba-range')) r.parentNode.style.setProperty('--pos', r.value + '%');
  });

  d.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var h = d.querySelector('.site-h.open');
    if (h) { h.classList.remove('open'); var b = h.querySelector('.nav-t'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); } }
  });

  function today() {
    var rows = d.querySelectorAll('[data-dow="' + new Date().getDay() + '"]');
    for (var i = 0; i < rows.length; i++) { rows[i].classList.add('today'); rows[i].setAttribute('aria-current', 'date'); }
    if (reduce) { var vs = d.querySelectorAll('video[autoplay]'); for (var j = 0; j < vs.length; j++) { vs[j].removeAttribute('autoplay'); vs[j].pause(); } }
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', today); else today();

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
