/* Sales Reports: period filters, summary cards, category + hourly charts, records table. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var main = await A.mountShell('report', 'owner');
  if (!main) return;

  var charts = {};
  var period = 'all';
  var view = 'reports';
  var netErr = function (e) { return /Failed to fetch|NetworkError|network|offline|Load failed/i.test(String((e && e.message) || e)); };
  var pesoTick = function (v) { return '₱' + Number(v).toLocaleString('en-PH'); };
  var pesoTip = function (c) { return '₱' + Number(c.raw).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  main.innerHTML =
    '<div class="offline-banner" id="offBanner" hidden></div>' +
    '<div class="page-head"><div><h1>Sales <span>reports</span></h1><div class="sub">Revenue, profit and every transaction</div></div>' +
    '<div class="btn-row"><button class="btn sm" id="printBtn" type="button">Print report</button><a class="btn sm" id="export" href="/api/export-sales">Export CSV</a></div></div>' +
    '<div class="panel pad" id="pendPanel" hidden><div class="ph"><h2>Not yet synced</h2><span class="mono mute" id="pendMeta"></span></div>' +
    '<div id="pendList"></div><div class="btn-row" style="margin-top:10px"><button class="btn sm" id="syncNow" type="button">Sync now</button><a class="btn sm" href="/pos">Review in POS</a></div></div>' +
    '<div class="viewtabs" role="tablist" aria-label="Report views">' +
    '<button class="tab" role="tab" id="tabReports" type="button" aria-selected="true">Sales Reports</button>' +
    '<button class="tab" role="tab" id="tabStats" type="button" aria-selected="false">Statistics</button></div>' +
    '<div class="chips-row" role="group" aria-label="Date range">' +
    [['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['all', 'All Time']].map(function (p) {
      return '<button class="chip" type="button" data-period="' + p[0] + '" aria-pressed="' + (period === p[0]) + '">' + p[1] + '</button>';
    }).join('') + '</div>' +
    '<div id="viewReports">' +
    '<div class="stat-grid" id="cards"></div>' +
    '<div class="panel pad"><div class="ph"><h2>Search transaction records</h2></div>' +
    '<form id="f" class="search-form">' +
    '<label for="date">Date<input id="date" type="date"></label>' +
    '<label for="search">Item, size, or transaction ID<input id="search" type="search" placeholder="Search by item name, size, or transaction ID"></label>' +
    '<button class="btn primary" type="submit">Search</button></form>' +
    '<div class="tw"><table><thead><tr><th>Transaction ID</th><th>Date &amp; time</th><th>Payment</th><th class="n">Total</th><th class="n">Net profit</th><th></th></tr></thead><tbody id="body"></tbody></table></div></div></div>' +
    '<div id="viewStats" hidden>' +
    '<div class="chart-grid">' +
    '<div class="panel pad"><div class="ph"><h2>Revenue · last 7 days</h2></div><div class="chart-box" id="boxTrend" style="height:300px"><canvas id="trendChart" role="img" aria-label="Revenue for the last 7 days"></canvas></div></div>' +
    '<div class="panel pad"><div class="ph"><h2>Sales by category</h2></div><div class="chart-box" id="boxCat" style="height:300px"><canvas id="catChart" role="img" aria-label="Sales by category"></canvas></div></div>' +
    '<div class="panel pad chart-tall"><div class="ph"><h2>Hourly sales</h2></div><div class="chart-box" id="boxHour" style="height:280px"><canvas id="hourChart" role="img" aria-label="Sales by hour of day"></canvas></div></div>' +
    '</div>' +
    '<div class="grid2" style="margin-top:18px">' +
    '<div class="panel pad"><div class="ph"><h2>Best-selling products</h2><span class="mono mute" id="topMeta"></span></div><div class="list" id="topList"></div></div>' +
    '<div class="panel pad"><div class="ph"><h2>Top in every category</h2><span class="mono mute" id="leadMeta"></span></div><div class="lead-grid" id="leadGrid"></div></div>' +
    '</div></div>';

  var params = new URLSearchParams(location.search);
  if (['today', 'week', 'month', 'all'].includes(params.get('period') || '')) period = params.get('period');
  A.$('#date').value = params.get('date') || '';
  A.$('#search').value = params.get('search') || '';
  paintChips();

  function paintChips() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-period]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-period') === period));
    });
  }

  function setView(v) {
    view = v;
    A.$('#tabReports').setAttribute('aria-selected', String(v === 'reports'));
    A.$('#tabStats').setAttribute('aria-selected', String(v === 'stats'));
    A.$('#viewReports').hidden = v !== 'reports';
    A.$('#viewStats').hidden = v !== 'stats';
    if (v === 'stats' && window.Chart) drawCharts(window._lastReport);
    if (v === 'stats') renderRankings(window._lastReport);
  }

  function paintBanner() {
    var b = A.$('#offBanner');
    if (!A.isOnline()) {
      b.hidden = false;
      b.innerHTML = '<b>Offline.</b> Showing queued offline sales below. Server revenue and transactions need a connection.';
    } else {
      b.hidden = true;
      b.innerHTML = '';
    }
  }

  function renderPending() {
    if (!window.Sync) return;
    window.Sync.getPendingSales().then(function (sales) {
      var panel = A.$('#pendPanel');
      if (!sales.length) { panel.hidden = true; return; }
      panel.hidden = false;
      A.$('#pendMeta').textContent = sales.length + ' sale(s) waiting — not in the totals below until synced';
      A.$('#pendList').innerHTML = '<div class="pend-list">' + sales.map(function (s) {
        var total = 0;
        (s.items || []).forEach(function (l) { total += Number(l.price || 0) * Number(l.qty || 0); });
        var pill = s.status === 'failed' ? '<span class="pill out">Failed</span>' : '<span class="pill low">Pending</span>';
        return '<div class="pend"><div><b class="mono">' + esc(s.client_sale_id.slice(-8)) + '</b> ' + pill +
          '<span class="sub">' + esc(new Date(s.created_at).toLocaleString('en-PH')) + ' · ' + money(total) + '</span></div>' +
          (s.last_error ? '<div class="mono down" style="font-size:12px">' + esc(s.last_error) + '</div>' : '') +
          '<div class="acts"><a class="btn sm" href="/receipt?local=' + encodeURIComponent(s.client_sale_id) + '">Receipt</a></div></div>';
      }).join('') + '</div>';
    }).catch(function () { /* optional */ });
  }

  function filters() {
    var p = new URLSearchParams();
    p.set('period', period);
    if (A.$('#date').value) p.set('date', A.$('#date').value);
    if (A.$('#search').value.trim()) p.set('search', A.$('#search').value.trim());
    return p.toString();
  }

  function destroyCharts() {
    Object.keys(charts).forEach(function (k) {
      try { charts[k].destroy(); } catch (e) { /* ignore */ }
      delete charts[k];
    });
  }

  // Canvas may have been replaced by an empty-state message; restore it first.
  function ensureCanvas(boxId, canvasId, label) {
    var box = document.getElementById(boxId);
    if (!box) return null;
    var c = document.getElementById(canvasId);
    if (!c) box.innerHTML = '<canvas id="' + canvasId + '" role="img" aria-label="' + label + '"></canvas>';
    return document.getElementById(canvasId);
  }

  function emptyBox(boxId, msg) {
    var box = document.getElementById(boxId);
    if (box) box.innerHTML = '<div class="empty">' + esc(msg) + '</div>';
  }

  function drawCharts(r) {
    if (!window.Chart || !r) return;
    destroyCharts();
    Chart.defaults.color = '#8D9CBF';
    Chart.defaults.borderColor = 'rgba(141,156,191,.14)';
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    var anim = { duration: 900, easing: 'easeOutQuart' };

    // 7-day revenue trend (existing server series).
    var trendC = ensureCanvas('boxTrend', 'trendChart', 'Revenue for the last 7 days');
    if (trendC && r.chart && r.chart.revenue.some(function (v) { return v > 0; })) {
      var ctx = trendC.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, 0, 300);
      g.addColorStop(0, 'rgba(32,217,245,.85)');
      g.addColorStop(1, 'rgba(22,135,255,.35)');
      charts.trend = new Chart(ctx, {
        type: 'bar',
        data: { labels: r.chart.labels, datasets: [{ label: 'Revenue (₱)', data: r.chart.revenue, backgroundColor: g, borderRadius: 8, barPercentage: 0.65, categoryPercentage: 0.7 }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: anim,
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'Revenue' }, ticks: { callback: pesoTick } },
            x: { title: { display: true, text: 'Date' } }
          },
          plugins: { tooltip: { callbacks: { label: pesoTip } } }
        }
      });
    } else if (trendC) {
      emptyBox('boxTrend', 'No revenue in the last 7 days.');
    }

    // Sales by category (doughnut, amounts in ₱).
    var catC = ensureCanvas('boxCat', 'catChart', 'Sales by category');
    if (catC) {
      if (r.byCategory && r.byCategory.length) {
        charts.cat = new Chart(catC, {
          type: 'doughnut',
          data: {
            labels: r.byCategory.map(function (c) { return c.category; }),
            datasets: [{
              data: r.byCategory.map(function (c) { return c.amt; }),
              backgroundColor: ['#1687FF', '#20D9F5', '#27E5A0', '#F4D35E', '#FF657A', '#A8C5FF', '#369BFF', '#27c489'],
              borderColor: '#0D1930', borderWidth: 3
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '62%', animation: anim,
            plugins: { legend: { position: 'right', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: pesoTip } } }
          }
        });
      } else {
        emptyBox('boxCat', 'No category sales in this period.');
      }
    }

    // Hourly sales (0–23 in store time zone).
    var hourC = ensureCanvas('boxHour', 'hourChart', 'Sales by hour of day');
    if (hourC) {
      var hours = [], revs = [];
      for (var h = 0; h < 24; h++) { hours.push(h + ':00'); revs.push(0); }
      (r.hourly || []).forEach(function (x) { revs[x.h] = x.revenue; });
      if (revs.some(function (v) { return v > 0; })) {
        var hx = hourC.getContext('2d');
        var hg = hx.createLinearGradient(0, 0, 0, 280);
        hg.addColorStop(0, 'rgba(39,229,160,.9)');
        hg.addColorStop(1, 'rgba(32,217,245,.3)');
        charts.hour = new Chart(hx, {
          type: 'bar',
          data: { labels: hours, datasets: [{ label: 'Revenue (₱)', data: revs, backgroundColor: hg, borderRadius: 4, barPercentage: 0.8 }] },
          options: {
            responsive: true, maintainAspectRatio: false, animation: anim,
            scales: {
              y: { beginAtZero: true, title: { display: true, text: 'Revenue' }, ticks: { callback: pesoTick } },
              x: { title: { display: true, text: 'Hour' } }
            },
            plugins: { tooltip: { callbacks: { label: pesoTip } } }
          }
        });
      } else {
        emptyBox('boxHour', 'No hourly sales in this period.');
      }
    }
  }

  // Best sellers + per-category leaders for the selected period.
  function renderRankings(r) {
    if (!A.$('#topList') || !r) return;
    var tops = r.topProducts || [];
    A.$('#topMeta').textContent = tops.length ? 'Top ' + tops.length + ' by units' : '';
    A.$('#topList').innerHTML = tops.length ? tops.map(function (t, i) {
      var medal = i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : '';
      return '<div class="li"><span class="t rank"><span class="rank-n ' + medal + '">' + (i + 1) + '</span><b>' + esc(t.product_name) + ' · ' + esc(A.sizeText(t)) + '</b></span>' +
        '<span class="pill tier">' + t.qty + ' sold · ' + money(t.revenue) + '</span></div>';
    }).join('') : '<div class="empty">No sales yet in this period.</div>';

    // Every known category: leader card, or an honest "No sales yet".
    var leaders = {};
    (r.categoryLeaders || []).forEach(function (l) { leaders[l.category] = l; });
    var cats = (r.allCategories || []).slice();
    Object.keys(leaders).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
    cats.sort();
    A.$('#leadMeta').textContent = cats.length ? cats.length + ' categories' : '';
    A.$('#leadGrid').innerHTML = cats.length ? cats.map(function (c) {
      var l = leaders[c];
      if (!l) {
        return '<div class="lead none"><span class="sub">' + esc(c) + '</span><span class="empty" style="padding:6px 0">No sales yet</span></div>';
      }
      var initials = String(l.product_name).split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
      return '<div class="lead"><span class="hx">' + esc(initials) + '</span>' +
        '<div class="lead-body"><span class="sub">' + esc(c) + '</span><b>' + esc(l.product_name) + '</b>' +
        '<span class="sub">' + esc(A.sizeText(l)) + ' · ' + l.qty + ' sold · ' + money(l.revenue) + '</span></div>' +
        '<span class="pill tier">Top</span></div>';
    }).join('') : '<div class="empty">No categories yet. Add inventory to begin.</div>';
  }

  async function load(first) {
    paintBanner();
    renderPending();
    var qs = filters();
    A.$('#export').href = '/api/export-sales' + (qs ? '?' + qs : '');
    history.replaceState(null, '', '/report' + (qs ? '?' + qs : ''));
    var r;
    try { r = await A.api('/report' + (qs ? '?' + qs : '')); }
    catch (e) {
      if (netErr(e)) {
        A.$('#cards').innerHTML = '';
        A.$('#body').innerHTML = '<tr><td colspan="6"><div class="alert">Offline — server reports need a connection. Queued sales above sync automatically when you reconnect.</div></td></tr>';
        destroyCharts();
        ['boxTrend', 'boxCat', 'boxHour'].forEach(function (id) { emptyBox(id, 'Charts need a connection.'); });
        A.noteRefreshed();
        return;
      }
      A.$('#body').innerHTML = '<tr><td colspan="6"><div class="alert">' + esc(e.message) + '</div></td></tr>';
      A.noteRefreshed();
      return;
    }
    window._lastReport = r;
    renderRankings(r);

    var sum = r.summary || { txns: 0, sales: 0, tax: 0, items: 0 };
    var cards = [
      ['Total transactions', sum.txns, 'desc', function (v) { return String(Math.round(v)); }, 'Sales in this period'],
      ['Total sales', sum.sales, 'desc', money, r.best ? 'Top: ' + r.best.product_name + ' · ' + A.sizeText(r.best) : 'No sales yet'],
      ['Total tax', sum.tax, 'desc', money, 'VAT 12% included'],
      ['Items sold', sum.items, 'desc', function (v) { return Number(v).toLocaleString(); }, 'Units moved']
    ];
    A.$('#cards').innerHTML = cards.map(function (c, i) {
      return '<div class="panel kpi"><span class="lb">' + c[0] + '</span><span class="v sm" id="rc' + i + '">0</span><span class="d">' + esc(c[4]) + '</span></div>';
    }).join('');
    cards.forEach(function (c, i) { A.countTo(A.$('#rc' + i), c[1], c[3]); });

    A.$('#body').innerHTML = r.sales.length ? r.sales.map(function (x) {
      return '<tr><td class="mono">' + esc(x.transaction_id) + '</td><td class="mono mute">' + A.fmtDT(x.sale_date) + '</td>' +
        '<td><span class="pill t2">' + esc(x.payment_method) + '</span></td>' +
        '<td class="n mono">' + money(x.total_amount) + '</td><td class="n mono">' + money(x.profit) + '</td>' +
        '<td><div class="acts"><a class="btn sm" target="_blank" rel="noopener" href="/receipt?id=' + x.id + '">Receipt</a></div></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">No sales records found for this period.</td></tr>';

    if (!window.Chart) {
      ['boxTrend', 'boxCat', 'boxHour'].forEach(function (id) { emptyBox(id, 'Charts could not load. Check your internet connection.'); });
    } else if (view === 'stats') {
      drawCharts(r);
    }
    A.noteRefreshed();
  }

  document.querySelector('.chips-row').addEventListener('click', function (e) {
    var b = e.target.closest('[data-period]');
    if (!b) return;
    period = b.getAttribute('data-period');
    paintChips();
    load(false);
  });
  A.$('#tabReports').addEventListener('click', function () { setView('reports'); });
  A.$('#tabStats').addEventListener('click', function () { setView('stats'); });
  A.$('#printBtn').addEventListener('click', function () { window.print(); });
  A.$('#f').addEventListener('submit', function (e) { e.preventDefault(); load(false); });
  A.$('#syncNow').addEventListener('click', function () {
    if (!window.Sync) return;
    window.Sync.syncNow().then(function (r) {
      renderPending();
      if (r && !r.offline && (r.synced || r.failed)) load(false);
    });
  });
  window.addEventListener('online', function () { paintBanner(); load(false); });
  window.addEventListener('offline', function () { paintBanner(); });
  window.addEventListener('sync-changed', function () { renderPending(); });
  window.addEventListener('app-refresh', function () { load(false); });
  await load(true);
  A.reveal(main);
})();
