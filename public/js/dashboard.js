/* Dashboard (replaces dashboard.php): KPIs, 7-day revenue vs profit, stock by category, alerts, recent sales. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var main = await A.mountShell('dashboard');
  if (!main) return;
  main.innerHTML = '<div class="empty">Loading…</div>';

  var d;
  try { d = await A.api('/dashboard'); }
  catch (e) { main.innerHTML = '<div class="panel pad"><div class="alert">' + esc(e.message) + '</div></div>'; return; }

  var s = d.stats, inv = d.inventory;
  var int = function (v) { return Math.round(v); };
  var kpis = [
    { lb: 'Today revenue', v: s.day_revenue, f: money, d: s.day_count + ' transactions' },
    { lb: 'Today profit', v: s.day_profit, f: money, d: 'Week: ' + money(s.week_profit) },
    { lb: 'Week revenue', v: s.week_revenue, f: money, d: 'Month: ' + money(s.month_revenue) },
    { lb: 'Inventory SKUs', v: inv.skus, f: int, d: Number(inv.units).toLocaleString() + ' units on hand' },
    { lb: 'Stock value', v: inv.value_amt, f: money, d: 'Retail valuation' },
    { lb: 'Low stock', v: d.lowCount, f: int, d: d.lowCount ? '<span class="warn">Needs restock</span>' : 'All healthy' }
  ];

  var topHtml = d.top.length
    ? d.top.map(function (t) {
        return '<div class="li"><span class="t"><b>' + esc(t.product_name) + '</b></span><span class="pill tier">' + t.qty + ' sold</span></div>';
      }).join('')
    : '<div class="empty">No sales yet. Run your first transaction in POS.</div>';

  var lowHtml = d.low.length
    ? d.low.map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.barcode) + ' · ' + esc(p.category) + '</span></td>' +
          '<td class="mono">' + p.stock + '</td>' +
          '<td>' + (p.stock <= 0 ? '<span class="pill out">Out</span>' : '<span class="pill low">Low</span>') + '</td></tr>';
      }).join('')
    : '<tr><td colspan="3" class="empty">All stocks healthy</td></tr>';

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
    '<div class="kpis six">' + kpis.map(function (k, i) {
      return '<div class="panel kpi"><span class="lb">' + k.lb + '</span><span class="v sm" id="kv' + i + '">0</span><span class="d">' + k.d + '</span></div>';
    }).join('') + '</div>' +
    '<div class="grid2"><div class="panel pad"><div class="ph"><h2>Revenue vs profit · last 7 days</h2></div><div class="chart-box"><canvas id="dashChart" role="img" aria-label="Revenue and profit for the last 7 days"></canvas></div></div>' +
    '<div class="panel pad"><div class="ph"><h2>Stock by category</h2></div><div class="chart-box" style="height:200px"><canvas id="catChart" role="img" aria-label="Units in stock by category"></canvas></div>' +
    '<div class="ph" style="margin-top:16px"><h2>Top sellers</h2></div><div class="list">' + topHtml + '</div></div></div>' +
    '<div class="grid2 b"><div class="panel pad"><div class="ph"><h2>Low stock alerts</h2><a class="btn sm" href="/inventory?status=low">Restock</a></div>' +
    '<div class="tw"><table><thead><tr><th>Item</th><th>Stock</th><th>Status</th></tr></thead><tbody>' + lowHtml + '</tbody></table></div></div>' +
    '<div class="panel pad"><div class="ph"><h2>Recent transactions</h2><a class="btn sm" href="/report">View all</a></div>' +
    '<div class="tw"><table><thead><tr><th>Txn</th><th>Total</th><th>Pay</th><th>Time</th><th></th></tr></thead><tbody>' + recentHtml + '</tbody></table></div></div></div>';

  kpis.forEach(function (k, i) { A.countTo(A.$('#kv' + i), k.v, k.f); });
  A.reveal(main);

  if (!window.Chart) { // CDN blocked: the rest of the page still works
    Array.prototype.forEach.call(document.querySelectorAll('.chart-box'), function (b) {
      b.innerHTML = '<div class="empty">Charts could not load. Check your internet connection.</div>';
    });
    return;
  }
  Chart.defaults.color = '#8f9bbd';
  Chart.defaults.borderColor = 'rgba(120,160,255,.14)';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";

  var ctx = A.$('#dashChart').getContext('2d');
  var grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(53,224,255,.85)');
  grad.addColorStop(1, 'rgba(139,107,255,.35)');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: d.chart.labels,
      datasets: [
        { label: 'Revenue', data: d.chart.revenue, backgroundColor: grad, borderRadius: 8, barPercentage: 0.55 },
        { label: 'Profit', data: d.chart.profit, type: 'line', borderColor: '#3df2a8', backgroundColor: 'rgba(61,242,168,.14)', fill: true, tension: 0.4, pointBackgroundColor: '#3df2a8' }
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
        backgroundColor: ['#35e0ff', '#8b6bff', '#3df2a8', '#ffb547', '#ff5c7a', '#60a5fa'],
        borderColor: '#0d1428', borderWidth: 3
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } }
  });
})();
