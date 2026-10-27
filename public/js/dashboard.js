/* Dashboard (replaces dashboard.php): KPIs, 7-day revenue vs profit, stock by category, recent sales.
   Inventory alerts live only in the header notification bell. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var main = await A.mountShell('dashboard', 'owner');
  if (!main) return;
  main.innerHTML = '<div class="empty">Loading…</div>';

  var int = function (v) { return Math.round(v); };
  var IC = {
    peso: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l2 7H4L6 3Z"/><path d="M4 10v2a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5v-2"/><path d="M9 17l-1 4M15 17l1 4"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    out: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
    value: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    items: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>'
  };
  var fmtWhen = function (iso) {
    if (!iso) return null;
    try {
      var t = new Date(iso);
      if (isNaN(t.getTime())) return null;
      return t.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return null; }
  };

  // Offline: render the last cached inventory + the outbox queue instead of
  // a dead-end error. Revenue / profit / recent sales are server-only, but
  // stock levels and queued sales are available locally. Alerts remain in the
  // header bell only.
  async function renderOfflineDashboard() {
    var products = [], sales = [], invQueue = [];
    var cachedAt = null, lastSyncAt = null;
    var dbError = null;
    try {
      if (window.LocalDB) {
        try { products = await window.LocalDB.loadProducts(); } catch (e) { dbError = e; }
        try { cachedAt = await window.LocalDB.getMeta('products_cached_at'); } catch (e) { /* ignore */ }
        try { lastSyncAt = await window.LocalDB.getMeta('last_sync_at'); } catch (e) { /* ignore */ }
      }
      if (window.Sync) {
        try { sales = await window.Sync.getPendingSales(); } catch (e) { /* ignore */ }
        try { invQueue = await window.Sync.getInventoryQueue(); } catch (e) { /* ignore */ }
      }
    } catch (x) { dbError = x; }

    var skus = products.length;
    var units = 0, valueCents = 0, outCount = 0;
    var cats = {};
    products.forEach(function (p) {
      var st = Number(p.stock || 0);
      units += st;
      valueCents += Math.round(Number(p.price || 0) * 100) * st;
      if (st <= 0) outCount++;
      var cat = String(p.category || 'General');
      cats[cat] = (cats[cat] || 0) + st;
    });
    // LOW = 0 < stock <= threshold (matches the server alert rule).
    var lowCount = products.filter(function (p) {
      var st = Number(p.stock || 0);
      var th = (p.low_stock_threshold == null ? 5 : Number(p.low_stock_threshold));
      return st > 0 && st <= th;
    }).length;

    var queuedRevenueCents = 0, queuedItems = 0;
    sales.forEach(function (s) {
      (s.items || []).forEach(function (l) {
        queuedRevenueCents += Math.round(Number(l.price || 0) * 100) * Number(l.qty || 0);
        queuedItems += Number(l.qty || 0);
      });
    });

    var cachedTxt = fmtWhen(cachedAt);
    var syncTxt = fmtWhen(lastSyncAt);
    var freshSub = cachedTxt ? 'Cached ' + cachedTxt : 'No cache timestamp';
    if (syncTxt) freshSub += ' · Last sync ' + syncTxt;

    // First run on this device with nothing cached: explain, don't strand.
    if (!skus && !sales.length && !invQueue.length) {
      main.innerHTML =
        '<div class="offline-banner"><b>Offline mode.</b> Could not reach the server, and this device has no cached inventory yet.</div>' +
        '<div class="page-head"><div><h1>Command <span>center</span></h1><div class="sub">You are offline</div></div>' +
        '<div class="btn-row"><button class="btn primary" id="offRetry" type="button">Retry connection</button><a class="btn" href="/pos">Open POS</a></div></div>' +
        '<div class="panel pad"><div class="alert">Offline — live dashboard needs a connection. ' +
        (dbError ? esc(dbError.message || 'Offline storage unavailable.') + ' ' : '') +
        'Reconnect once so this device can cache inventory — afterwards the dashboard, POS and inventory open offline.</div>' +
        '<p style="margin-top:10px" class="mono mute">Tip: open POS or Inventory while online to build the cache.</p></div>';
      A.reveal(main);
      wireOfflineChrome();
      return;
    }

    var kpis = [
      { lb: 'Products (cached)', v: skus, f: int, d: Number(units).toLocaleString() + ' units on hand', ic: 'c-coral', svg: IC.box },
      { lb: 'Inventory value (cached)', v: valueCents / 100, f: money, d: 'Retail valuation · cached', ic: 'c-green', svg: IC.value },
      { lb: 'Low stock (cached)', v: lowCount, f: int, d: lowCount ? '<span class="warn">Needs restock</span>' : 'All healthy', ic: 'c-amber', svg: IC.warn },
      { lb: 'Out of stock (cached)', v: outCount, f: int, d: outCount ? '<span class="down">Urgent restock</span>' : 'None — all stocked', ic: 'c-red', svg: IC.out },
      { lb: 'Queued sales', v: sales.length, f: int, d: money(queuedRevenueCents / 100) + ' · ' + queuedItems + ' item(s) waiting', ic: 'c-cyan', svg: IC.receipt },
      { lb: 'Queued inventory', v: invQueue.length, f: int, d: invQueue.length ? 'Restocks waiting to sync' : 'Nothing queued', ic: 'c-teal', svg: IC.items }
    ];

    var queueHtml = sales.length
      ? sales.slice(0, 10).map(function (s) {
          var tot = 0;
          (s.items || []).forEach(function (l) { tot += Number(l.price || 0) * Number(l.qty || 0); });
          var pill = s.status === 'failed' ? '<span class="pill out">Failed</span>' : '<span class="pill low">Pending</span>';
          return '<tr><td class="mono">…' + esc(String(s.client_sale_id || '').slice(-8)) + '</td>' +
            '<td class="mono"><b>' + money(tot) + '</b></td>' +
            '<td>' + pill + '</td>' +
            '<td class="mono mute">' + esc(fmtWhen(s.created_at) || 'queued') + '</td>' +
            '<td><a class="btn sm" href="/receipt?local=' + encodeURIComponent(s.client_sale_id) + '">Receipt</a></td></tr>';
        }).join('') +
        (sales.length > 10 ? '<tr><td colspan="5" class="empty">+' + (sales.length - 10) + ' more queued — see Reports.</td></tr>' : '')
      : '<tr><td colspan="5" class="empty">Outbox is empty. Offline sales will appear here.</td></tr>';

    var catRows = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).slice(0, 6);
    var catHtml = catRows.length
      ? catRows.map(function (c) {
          return '<div class="li"><span class="t"><b>' + esc(c) + '</b></span><span class="pill tier">' + Number(cats[c]).toLocaleString() + ' units · cached</span></div>';
        }).join('')
      : '<div class="empty">No cached categories.</div>';

    main.innerHTML =
      '<div class="offline-banner"><b>Offline mode.</b> Live revenue needs a connection — showing last cached inventory' +
      (cachedTxt ? ' from ' + esc(cachedTxt) : '') + '. POS and the queue still work.</div>' +
      '<div class="page-head"><div><h1>Command <span>center</span></h1><div class="sub">You are offline · ' + esc(freshSub) + '</div></div>' +
      '<div class="btn-row"><a class="btn primary" href="/pos">Open POS offline</a><a class="btn" href="/inventory">View cached inventory</a>' +
      '<a class="btn" href="/report">Queued sales</a><button class="btn" id="offRetry" type="button">Retry</button>' +
      (sales.length + invQueue.length > 0 ? '<button class="btn" id="offSync" type="button">Sync now</button>' : '') + '</div></div>' +
      '<div class="kpis">' + kpis.map(function (k, i) {
        return '<div class="panel kpi ic"><span class="kico ' + k.ic + '" aria-hidden="true">' + k.svg + '</span>' +
          '<div class="kv"><span class="lb">' + k.lb + '</span><span class="v sm" id="okv' + i + '">0</span><span class="d">' + k.d + '</span></div></div>';
      }).join('') + '</div>' +
      '<div class="grid2"><div class="panel pad"><div class="ph"><h2>Queued sales · not yet in totals</h2><a class="btn sm" href="/report">Review</a></div>' +
      '<div class="tw"><table><thead><tr><th>Queue</th><th>Total</th><th>Status</th><th>Time</th><th></th></tr></thead><tbody>' + queueHtml + '</tbody></table></div>' +
      (invQueue.length ? '<p style="margin-top:10px" class="mono mute">' + invQueue.length + ' inventory change(s) also queued — they sync from Inventory.</p>' : '') +
      '<p style="margin-top:10px" class="mono mute">Server revenue, profit and recent transactions return when you reconnect.</p></div>' +
      '<div class="panel pad"><div class="ph"><h2>Stock by category · cached</h2></div><div class="list">' + catHtml + '</div></div></div>';

    kpis.forEach(function (k, i) { A.countTo(A.$('#okv' + i), k.v, k.f); });
    A.reveal(main);
    wireOfflineChrome();
  }

  function wireOfflineChrome() {
    var retry = A.$('#offRetry');
    if (retry) retry.addEventListener('click', function () { location.reload(); });
    var syncBtn = A.$('#offSync');
    if (syncBtn && window.Sync) syncBtn.addEventListener('click', function () {
      syncBtn.disabled = true;
      window.Sync.syncNow().then(function (r) {
        if (r && !r.offline && !r.auth) location.reload();
        else { syncBtn.disabled = false; A.toast(r && r.auth ? 'Session expired — sign in to sync.' : 'Still offline — kept in queue.', true); }
      }).catch(function (e) { syncBtn.disabled = false; A.toast(e.message, true); });
    });
    window.addEventListener('online', function () { location.reload(); });
    window.addEventListener('app-refresh', function () { location.reload(); });
  }

  var d;
  try { d = await A.api('/dashboard'); }
  catch (e) {
    var offline = /Failed to fetch|NetworkError|network|offline|Load failed/i.test(String((e && e.message) || e));
    if (offline) {
      await renderOfflineDashboard();
      return;
    }
    main.innerHTML = '<div class="panel pad"><div class="alert">' + esc(e.message) + '</div></div>'; return;
  }

  var s = d.stats, inv = d.inventory;
  var outCount = d.outCount || 0;
  var kpis = [
    { lb: "Today's sales", v: s.day_revenue, f: money, d: s.day_count + ' transactions', ic: 'c-cyan', svg: IC.peso },
    { lb: 'Transactions today', v: s.day_count, f: int, d: 'Week: ' + money(s.week_revenue), ic: 'c-teal', svg: IC.receipt },
    { lb: "Today's items sold", v: d.todayItems || 0, f: int, d: 'Units moved today', ic: 'c-purple', svg: IC.items },
    { lb: 'Products in inventory', v: inv.skus, f: int, d: Number(inv.units).toLocaleString() + ' units on hand', ic: 'c-coral', svg: IC.box },
    { lb: 'Inventory value', v: inv.value_amt, f: money, d: 'Retail valuation', ic: 'c-green', svg: IC.value },
    { lb: 'Low stock', v: d.lowCount, f: int, d: d.lowCount ? '<span class="warn">Needs restock</span>' : 'All healthy', ic: 'c-amber', svg: IC.warn },
    { lb: 'Out of stock', v: outCount, f: int, d: outCount ? '<span class="down">Urgent restock</span>' : 'None — all stocked', ic: 'c-red', svg: IC.out }
  ];

  var topHtml = d.top.length
    ? d.top.map(function (t) {
        return '<div class="li"><span class="t"><b>' + esc(t.product_name) + '</b></span><span class="pill tier">' + t.qty + ' sold</span></div>';
      }).join('')
    : '<div class="empty">No sales yet. Run your first transaction in POS.</div>';

  var recentHtml = d.recent.length
    ? d.recent.map(function (r) {
        return '<tr><td class="mono">' + esc(r.transaction_id) + '</td><td class="mono"><b>' + money(r.total_amount) + '</b></td>' +
          '<td><span class="pill t2">' + esc(r.payment_method || 'Cash') + '</span></td>' +
          '<td class="mono mute">' + A.fmtDT(r.sale_date) + '</td>' +
          '<td><a class="btn sm" target="_blank" rel="noopener" href="/receipt?id=' + r.id + '">Receipt</a></td></tr>';
      }).join('')
    : '<tr><td colspan="5" class="empty">No transactions yet.</td></tr>';

  main.innerHTML =
    '<div class="page-head"><div><h1>Command <span>center</span></h1><div class="sub">Welcome back, <b style="color:var(--fg)">' + esc(d.user) + '</b></div></div>' +
    '<div class="btn-row"><a class="btn primary" href="/pos">New sale</a><a class="btn" href="/inventory">Add inventory item</a><a class="btn" href="/report">Analytics</a></div></div>' +
    '<div class="kpis">' + kpis.map(function (k, i) {
      return '<div class="panel kpi ic"><span class="kico ' + k.ic + '" aria-hidden="true">' + k.svg + '</span>' +
        '<div class="kv"><span class="lb">' + k.lb + '</span><span class="v sm" id="kv' + i + '">0</span><span class="d">' + k.d + '</span></div></div>';
    }).join('') + '</div>' +
    '<div class="grid2"><div class="panel pad"><div class="ph"><h2>Revenue vs profit · last 7 days</h2></div><div class="chart-box"><canvas id="dashChart" role="img" aria-label="Revenue and profit for the last 7 days"></canvas></div></div>' +
    '<div class="panel pad"><div class="ph"><h2>Stock by category</h2></div><div class="chart-box" style="height:200px"><canvas id="catChart" role="img" aria-label="Units in stock by category"></canvas></div>' +
    '<div class="ph" style="margin-top:16px"><h2>Top sellers</h2></div><div class="list">' + topHtml + '</div></div></div>' +
    '<div class="panel pad"><div class="ph"><h2>Recent transactions</h2><a class="btn sm" href="/report">View all</a></div>' +
    '<div class="tw"><table><thead><tr><th>Txn</th><th>Total</th><th>Pay</th><th>Time</th><th></th></tr></thead><tbody>' + recentHtml + '</tbody></table></div></div>';

  kpis.forEach(function (k, i) { A.countTo(A.$('#kv' + i), k.v, k.f); });
  A.reveal(main);

  if (!window.Chart) { // CDN blocked: the rest of the page still works
    Array.prototype.forEach.call(document.querySelectorAll('.chart-box'), function (b) {
      b.innerHTML = '<div class="empty">Charts could not load. Check your internet connection.</div>';
    });
    return;
  }
  Chart.defaults.color = '#8D9CBF';
  Chart.defaults.borderColor = 'rgba(141,156,191,.14)';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";

  var ctx = A.$('#dashChart').getContext('2d');
  var grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(32,217,245,.85)');
  grad.addColorStop(1, 'rgba(22,135,255,.35)');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: d.chart.labels,
      datasets: [
        { label: 'Revenue', data: d.chart.revenue, backgroundColor: grad, borderRadius: 8, barPercentage: 0.55 },
        { label: 'Profit', data: d.chart.profit, type: 'line', borderColor: '#27E5A0', backgroundColor: 'rgba(39,229,160,.14)', fill: true, tension: 0.4, pointBackgroundColor: '#27E5A0' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1100, easing: 'easeOutQuart' },
      scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return '₱' + Number(v).toLocaleString(); } } } }
    }
  });

  new Chart(A.$('#catChart'), {
    type: 'doughnut',
    data: {
      labels: d.categories.length ? d.categories.map(function (c) { return c.category; }) : ['No data'],
      datasets: [{
        data: d.categories.length ? d.categories.map(function (c) { return c.units; }) : [1],
        backgroundColor: ['#1687FF', '#20D9F5', '#27E5A0', '#F4D35E', '#FF657A', '#A8C5FF'],
        borderColor: '#0D1930', borderWidth: 3
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } }
  });
  window.addEventListener('app-refresh', function () { location.reload(); });
})();
