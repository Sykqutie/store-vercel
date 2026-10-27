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
  // Date-only helpers (YYYY-MM-DD). The comparison uses the store computer's
  // local calendar day, which matches the store time zone used by the API.
  function daysUntil(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return null;
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isFinite(target)) return null;
    return Math.round((target - today) / 86400000);
  }
  function fmtDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return '—';
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function qs(name) { return new URLSearchParams(location.search).get(name); }

  function isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  function readIdentity() {
    try {
      var raw = localStorage.getItem('cstore_identity');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeIdentity(me) {
    try {
      localStorage.setItem('cstore_identity', JSON.stringify({ username: me.username, store: me.store, role: me.role || 'admin' }));
    } catch (e) { /* private mode */ }
  }

  // Global data-refresh button state (header). Pages listen for 'app-refresh'
  // and reply with 'app-refreshed' when their reload finishes.
  var refreshTimer = null;
  function stopRefreshSpin() {
    var b = document.getElementById('navRefresh');
    if (b) b.classList.remove('spinning');
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  }
  function noteRefreshed() {
    try { window.dispatchEvent(new window.CustomEvent('app-refreshed')); } catch (e) { /* ignore */ }
  }
  window.addEventListener('app-refreshed', stopRefreshSpin);

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
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.data = data;
      if (data && data.setup) err.setup = data.setup;
      throw err;
    }
    return data;
  }

  var toastTimer;
  function toast(msg, bad, ms) {
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
    toastTimer = setTimeout(function () { t.className = 'toast'; }, ms > 0 ? ms : 2800);
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

  var NAV_OWNER = [
    ['dashboard', 'Dashboard', '/dashboard'],
    ['pos', 'POS', '/pos'],
    ['products', 'Inventory', '/inventory'],
    ['categories', 'Categories', '/categories'],
    ['report', 'Reports', '/report'],
    ['users', 'Users', '/users'],
    ['backup', 'Backup', '/backup']
  ];
  var NAV_CASHIER = [
    ['pos', 'POS', '/pos']
  ]; // Cashiers are POS-only: no inventory, reports, dashboard, or users tabs.

  function session() {
    return readIdentity();
  }

  // Single logout path used by the header menu and the restricted page.
  // Clears the server cookie AND the cached identity, then goes to /login.
  // onFail(msg) runs only when we could not log out (offline or server error)
  // so the caller can re-enable its button and show the message.
  function doLogout(onFail) {
    if (!isOnline()) {
      toast('You are offline — log out needs a connection.');
      if (onFail) onFail('You are offline — reconnect, then try again. Your current session is still active.');
      return;
    }
    api('/logout', { method: 'POST', noRedirect: true }).then(function () {
      try { localStorage.removeItem('cstore_identity'); } catch (e) { /* ignore */ }
      location.href = '/login';
    }).catch(function (e) {
      var msg = String((e && e.message) || 'Log out failed. Please try again.');
      toast(msg, true);
      if (onFail) onFail(msg);
    });
  }

  // Checks the session, draws header + tabs, returns the <main> element.
  // required: 'owner' for owner-only pages (cashiers see a restricted page).
  // Offline: falls back to the last cached identity so installed pages still open.
  async function mountShell(active, required) {
    var me = null;
    var offline = false;
    try {
      me = await api('/me');
      writeIdentity(me);
    } catch (e) {
      if (e && e.message === 'Please sign in.') return null;
      var cached = readIdentity();
      if (!cached) {
        root.innerHTML =
          '<div class="auth-wrap"><div class="panel auth">' +
          '<h1>OFF<span style="color:var(--cyan)">LINE</span></h1>' +
          '<p>You are offline and no saved session was found on this device. Reconnect and sign in once — afterwards the app opens offline.</p>' +
          '<div class="btn-row" style="justify-content:center"><a class="btn primary" href="/login">Go to login</a></div>' +
          '</div></div>';
        return null;
      }
      me = cached;
      offline = true;
    }
    // Fail closed: unknown or legacy cached identities get cashier access
    // until a fresh /me confirms the owner role. The API enforces the rest.
    me.role = me.role === 'owner' ? 'owner' : 'cashier';
    if (required === 'owner' && me.role !== 'owner') {
      root.innerHTML =
        '<div class="auth-wrap"><div class="panel auth">' +
        '<h1>REST<span style="color:var(--cyan)">RICTED</span></h1>' +
        '<p>Signed in as <b>' + esc(me.username) + '</b> (cashier). This page is for store owners. To use an owner account, sign out first, then sign in again.</p>' +
        '<div class="btn-row" style="justify-content:center"><a class="btn primary" href="/pos">Back to POS</a>' +
        '<button class="btn" id="switchBtn" type="button">Sign in as different user</button></div>' +
        '<div class="alert" id="switchErr" hidden style="margin-top:10px"></div>' +
        '</div></div>';
      var switchBtn = document.getElementById('switchBtn');
      if (switchBtn) switchBtn.addEventListener('click', function () {
        switchBtn.disabled = true;
        doLogout(function (msg) {
          var e = document.getElementById('switchErr');
          if (e) { e.textContent = msg; e.hidden = false; }
          switchBtn.disabled = false;
        });
      });
      return null;
    }
    var NAV = me.role === 'cashier' ? NAV_CASHIER : NAV_OWNER;
    var tabs = NAV.map(function (n) {
      return '<a class="tab" href="' + n[2] + '" aria-selected="' + (n[0] === active) + '">' + n[1] + '</a>';
    }).join('');
    var initial = esc(String(me.username || '?').charAt(0).toUpperCase());
    var role = esc(me.role || 'owner');
    // Inventory alerts are an owner tool; cashiers get a clean checkout header.
    var bellHtml = me.role === 'owner'
      ? '<span class="bell-wrap"><button class="icon-btn" id="alertBell" type="button" aria-label="Inventory alerts" aria-haspopup="true" aria-expanded="false" aria-controls="alertPanel" title="Inventory alerts">' +
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>' +
        '<span class="badge" id="alertBadge" hidden></span></button>' +
        '<div class="alert-panel" id="alertPanel" role="region" aria-label="Inventory alerts" hidden></div></span>'
      : '';
    root.innerHTML =
      '<header class="top"><div class="brand">' +
      '<img class="mark" src="/logo.svg" alt="SmartMart logo">' +
      '<div><h1>' + esc(String(me.store || 'SmartMart').toUpperCase()) + '</h1><p>Shop easy. Live easy.</p></div></div>' +
      '<div class="status"><span class="dot" id="netDot"></span><span id="netLabel">' + (offline || !isOnline() ? 'Offline' : 'Online') + '</span>' +
      '<a class="icon-btn" href="/pos" title="Open POS checkout" aria-label="Open POS checkout">' +
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg></a>' +
      '<button class="icon-btn" id="navRefresh" type="button" title="Refresh data" aria-label="Refresh data">' +
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button>' +
      bellHtml +
      '<span class="profile-wrap"><button class="profile-btn" id="profileBtn" type="button" aria-label="Account menu" aria-haspopup="true" aria-expanded="false" aria-controls="profileMenu" title="Account">' +
      '<span class="avatar">' + initial + '</span><span class="who">' + esc(me.username) + '</span>' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>' +
      '<div class="profile-menu" id="profileMenu" role="menu" aria-label="Account" hidden>' +
      '<div class="profile-head"><span class="avatar lg">' + initial + '</span>' +
      '<div><b>' + esc(me.username) + (offline ? ' · offline' : '') + '</b><span class="sub">' + esc(String(me.store || 'SmartMart')) + '</span>' +
      '<span class="pill tier">' + role + '</span></div></div>' +
      '<button class="btn wide" id="logoutBtn" type="button">Log out</button></div></span>' +
      '<span class="pill t2" id="syncBadge" hidden></span>' +
      '<button class="btn sm" id="pwaInstall" type="button" data-pwa-install hidden>Install</button>' +
      '<time id="clock"></time></div></header>' +
      '<nav class="tabs" aria-label="Sections">' + tabs + '</nav>' +
      '<main id="main" class="view"></main>';
    document.getElementById('logoutBtn').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      doLogout(function () { btn.disabled = false; });
    });
    (function wireProfile() {
      var btn = document.getElementById('profileBtn');
      var menu = document.getElementById('profileMenu');
      if (!btn || !menu) return;
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var open = menu.hidden;
        if (window.StockAlerts) { try { window.StockAlerts.close(false); } catch (e) {} }
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open) {
          var lo = document.getElementById('logoutBtn');
          if (lo) lo.focus();
        }
      });
      document.addEventListener('click', function (ev) {
        if (menu.hidden) return;
        if (ev.target.closest && (ev.target.closest('#profileMenu') || ev.target.closest('#profileBtn'))) return;
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && !menu.hidden) {
          menu.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          btn.focus();
        }
      });
    })();
    (function wireRefresh() {
      var b = document.getElementById('navRefresh');
      if (!b) return;
      b.addEventListener('click', function () {
        if (b.classList.contains('spinning')) return;
        b.classList.add('spinning');
        try { window.dispatchEvent(new window.CustomEvent('app-refresh')); } catch (e) { /* ignore */ }
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(stopRefreshSpin, 10000); // safety: never spin forever
      });
    })();
    function tick() {
      var c = document.getElementById('clock');
      if (c) c.textContent = new Date().toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
    }
    tick();
    setInterval(tick, 1000);
    if (!offline && window.Sync) {
      try { window.Sync.refreshBadge(); } catch (e) { /* ignore */ }
    }
    if (window.PWA) {
      try { window.PWA.paintOnline(); } catch (e) { /* ignore */ }
    }
    if (window.Sync) {
      try { window.Sync.refreshBadge(); } catch (e) { /* ignore */ }
    }
    if (window.StockAlerts) {
      try { window.StockAlerts.init(); } catch (e) { /* alerts are optional */ }
    }
    return document.getElementById('main');
  }

  window.App = { $: $, esc: esc, money: money, fmtDT: fmtDT, fmtDate: fmtDate, daysUntil: daysUntil, qs: qs, api: api, toast: toast, countTo: countTo, reveal: reveal, mountShell: mountShell, root: root, isOnline: isOnline, noteRefreshed: noteRefreshed, me: session };
})();
