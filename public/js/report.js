/* Reports (replaces report.php): revenue cards, 7-day bar chart, searchable transactions, CSV export. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var main = await A.mountShell('report');
  if (!main) return;

  var chart;

  main.innerHTML =
    '<div class="page-head"><div><h1>Analytics <span>&amp; sales</span></h1><div class="sub">Revenue, profit and every transaction</div></div></div>' +
    '<div class="stat-grid" id="cards"></div>' +
    '<div class="panel pad"><div class="ph"><h2>Sales overview · last 7 days</h2></div><div class="chart-box" style="height:320px"><canvas id="salesChart" role="img" aria-label="Revenue for the last 7 days"></canvas></div></div>' +
    '<div class="panel pad"><div class="ph"><h2>Search transaction records</h2><a class="btn sm" id="export" href="/api/export-sales">Export CSV</a></div>' +
    '<form id="f" class="search-form">' +
    '<label for="date">Date<input id="date" type="date"></label>' +
    '<label for="search">Item or transaction ID<input id="search" type="search" placeholder="Search by item name or transaction ID"></label>' +
    '<button class="btn primary" type="submit">Search</button></form>' +
    '<div class="tw"><table><thead><tr><th>Transaction ID</th><th>Date &amp; time</th><th>Payment</th><th class="n">Total</th><th class="n">Net profit</th><th></th></tr></thead><tbody id="body"></tbody></table></div></div>';

  var params = new URLSearchParams(location.search);
  A.$('#date').value = params.get('date') || '';
  A.$('#search').value = params.get('search') || '';

  function filters() {
    var p = new URLSearchParams();
    if (A.$('#date').value) p.set('date', A.$('#date').value);
    if (A.$('#search').value.trim()) p.set('search', A.$('#search').value.trim());
    return p.toString();
  }

  async function load(first) {
    var qs = filters();
    A.$('#export').href = '/api/export-sales' + (qs ? '?' + qs : '');
    history.replaceState(null, '', '/report' + (qs ? '?' + qs : ''));
    var r;
    try { r = await A.api('/report' + (qs ? '?' + qs : '')); }
    catch (e) { A.$('#body').innerHTML = '<tr><td colspan="6"><div class="alert">' + esc(e.message) + '</div></td></tr>'; return; }

    var s = r.stats;
    A.$('#cards').innerHTML = [
      ['Daily revenue', money(s.day_revenue), 'Profit: ' + money(s.day_profit)],
      ['Weekly revenue', money(s.week_revenue), 'Profit: ' + money(s.week_profit)],
      ['Monthly revenue', money(s.month_revenue), 'Profit: ' + money(s.month_profit)],
      ['Top selling product', r.best ? esc(r.best.product_name) : 'N/A', r.best ? 'Total sold: ' + r.best.total_qty + ' units' : 'No sales yet']
    ].map(function (c) {
      return '<div class="panel kpi"><span class="lb">' + c[0] + '</span><span class="v sm">' + c[1] + '</span><span class="d">' + c[2] + '</span></div>';
    }).join('');

    A.$('#body').innerHTML = r.sales.length ? r.sales.map(function (x) {
      return '<tr><td class="mono">' + esc(x.transaction_id) + '</td><td class="mono mute">' + A.fmtDT(x.sale_date) + '</td>' +
        '<td><span class="pill t2">' + esc(x.payment_method) + '</span></td>' +
        '<td class="n mono">' + money(x.total_amount) + '</td><td class="n mono">' + money(x.profit) + '</td>' +
        '<td><div class="acts"><a class="btn sm" target="_blank" rel="noopener" href="/receipt?id=' + x.id + '">Receipt</a></div></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">No sales records found.</td></tr>';

    if (first && !window.Chart) {
      A.$('.chart-box').innerHTML = '<div class="empty">Charts could not load. Check your internet connection.</div>';
    }
    if (first && window.Chart) {
      Chart.defaults.color = '#8f9bbd';
      Chart.defaults.borderColor = 'rgba(120,160,255,.14)';
      Chart.defaults.font.family = "'JetBrains Mono', monospace";
      var ctx = A.$('#salesChart').getContext('2d');
      var g = ctx.createLinearGradient(0, 0, 0, 320);
      g.addColorStop(0, 'rgba(53,224,255,.85)');
      g.addColorStop(1, 'rgba(139,107,255,.35)');
      chart = new Chart(ctx, {
        type: 'bar',
        data: { labels: r.chart.labels, datasets: [{ label: 'Revenue (₱)', data: r.chart.revenue, backgroundColor: g, borderRadius: 8, barPercentage: 0.65, categoryPercentage: 0.7 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'Revenue' }, ticks: { callback: function (v) { return '₱' + Number(v).toLocaleString('en-PH'); } } },
            x: { title: { display: true, text: 'Date' } }
          },
          plugins: {
            tooltip: { callbacks: { label: function (c) { return 'Revenue: ₱' + Number(c.raw).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } } }
          }
        }
      });
    }
  }

  A.$('#f').addEventListener('submit', function (e) { e.preventDefault(); load(false); });
  await load(true);
  A.reveal(main);
})();
