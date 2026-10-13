/* Shared helpers: API client, escaping, formatting, toast, and the page shell (header + tabs). */
(function () {
  'use strict';

  var BG = '<div id="bg" aria-hidden="true"><i class="grid"></i><i class="glow g1"></i><i class="glow g2"></i><i class="scan"></i></div>';
  document.body.insertAdjacentHTML('afterbegin', BG);
  var root = document.getElementById('root');

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDT(d) {
    return new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function qs(name) { return new URLSearchParams(location.search).get(name); }

  // api('/products') or api('/checkout', { body: {...} }) or api('/products/3', { method: 'PUT', body })
  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || (opts.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    } else if (init.method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = '{}';
    }
    var res = await fetch('/api' + path, init);
    var data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (res.status === 401 && !opts.noRedirect) {
      location.href = '/login';
      throw new Error('Please sign in.');
    }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
    return data;
  }

  var toastTimer;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2800);
  }

  function countTo(el, val, fmt) {
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { el.textContent = fmt(val); return; }
    var t0 = performance.now();
    (function f(t) {
      var p = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(val * e);
      if (p < 1) requestAnimationFrame(f); else el.textContent = fmt(val);
    })(t0);
  }

  // Stagger the entrance of the page's top-level blocks.
  function reveal(main) {
    Array.prototype.forEach.call(main.children, function (c, i) { c.style.setProperty('--i', i); });
    main.classList.remove('enter');
    void main.offsetWidth;
    main.classList.add('enter');
  }

  var NAV = [
    ['dashboard', 'Dashboard', '/dashboard'],
    ['pos', 'POS', '/pos'],
    ['products', 'Products', '/products'],
    ['report', 'Reports', '/report']
  ];

  // Checks the session, draws header + tabs, returns the <main> element (or null when signed out).
  async function mountShell(active) {
    var me;
    try { me = await api('/me'); } catch (e) { return null; }
    var tabs = NAV.map(function (n) {
      return '<a class="tab" href="' + n[2] + '" aria-selected="' + (n[0] === active) + '">' + n[1] + '</a>';
    }).join('');
    root.innerHTML =
      '<header class="top"><div class="brand">' +
      '<img class="mark" src="/logo.svg" alt="SmartMart logo">' +
      '<div><h1>' + esc(String(me.store).toUpperCase()) + '</h1><p>Shop easy. Live easy.</p></div></div>' +
      '<div class="status"><span class="dot"></span><span>Online</span><time id="clock"></time></div></header>' +
      '<nav class="tabs" aria-label="Sections">' + tabs +
      '<span class="sp"></span><span class="who">' + esc(me.username) + '</span>' +
      '<button class="tab out" id="logout" type="button">Log out</button></nav>' +
      '<main id="main" class="view"></main>';
    document.getElementById('logout').addEventListener('click', function () {
      api('/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
    });
    function tick() {
      var c = document.getElementById('clock');
      if (c) c.textContent = new Date().toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
    }
    tick();
    setInterval(tick, 1000);
    return document.getElementById('main');
  }

  window.App = { $: $, esc: esc, money: money, fmtDT: fmtDT, qs: qs, api: api, toast: toast, countTo: countTo, reveal: reveal, mountShell: mountShell, root: root };
})();
