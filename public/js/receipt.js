/* Receipt: server receipt (?id=) or queued offline receipt (?local=). Prints cleanly. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var id = parseInt(A.qs('id'), 10);
  var localId = A.qs('local');

  function fail(msg) {
    A.root.innerHTML = '<div class="auth-wrap"><div class="panel auth"><div class="alert">' + esc(msg) + '</div><a class="btn wide" href="/pos" style="text-align:center">Back to POS</a></div></div>';
  }

  function paper(opts) {
    return '<div class="paper-wrap"><div class="paper">' +
      '<div class="c"><div class="store">' + esc(String(opts.store).toUpperCase()) + '</div>' +
      '<p style="margin:6px 0 0">Receipt ID: ' + esc(opts.txn) + '<br>' + esc(opts.when) +
      (opts.cashier ? '<br>Cashier: ' + esc(opts.cashier) : '') + '</p>' +
      (opts.pending ? '<p style="margin:6px 0 0"><b>PENDING SYNC</b> — saved offline, not yet in Reports.</p>' : '') + '</div><hr>' +
      opts.items + '<hr>' +
      '<div class="rw"><span>Subtotal</span><span>' + money(opts.total) + '</span></div>' +
      '<div class="rw"><span>VAT 12% (included)</span><span>' + money(opts.vat) + '</span></div>' +
      '<div class="rw tot"><span>TOTAL:</span><span>' + money(opts.total) + '</span></div><hr>' +
      '<div class="rw"><span>Paid by Cash</span><span>' + money(opts.tendered) + '</span></div>' +
      '<div class="rw"><span>Change</span><span>' + money(opts.change) + '</span></div>' +
      '<hr><div class="c"><p style="margin:0">Thank you for shopping!</p>' +
      '<div class="paper-actions no-print"><button class="btn" id="print" type="button">Print receipt</button><a class="btn primary" href="/pos">Back to POS</a></div></div>' +
      '</div></div>';
  }

  if (localId) {
    if (!window.LocalDB) { fail('Offline receipts are unavailable in this browser.'); return; }
    var sale;
    try {
      sale = await window.LocalDB.get('pending_sales', localId);
    } catch (e) {
      fail(e.message);
      return;
    }
    if (!sale) { fail('Queued sale not found. It may have synced already — check Reports.'); return; }
    var total = 0;
    sale.items.forEach(function (l) { total += Number(l.price || 0) * Number(l.qty || 0); });
    var vat = Math.round(total * 100 * 12 / 112) / 100;
    var items = sale.items.map(function (l) {
      var size = l.size_label ? '<span class="item-sub">' + esc(l.size_label) + '</span>' : '';
      return '<div class="rw"><span>' + l.qty + 'x ' + esc(l.name) + size + '</span><span>' + money(Number(l.price) * Number(l.qty)) + '</span></div>';
    }).join('');
    var store = 'SmartMart';
    try {
      var raw = localStorage.getItem('cstore_identity');
      if (raw) store = JSON.parse(raw).store || store;
    } catch (e) { /* ignore */ }
    A.root.innerHTML = paper({
      store: store,
      txn: sale.client_sale_id,
      when: new Date(sale.created_at).toLocaleString('en-PH'),
      cashier: null,
      pending: true,
      items: items,
      total: total,
      vat: vat,
      tendered: sale.amount_tendered,
      change: sale.amount_tendered - total
    });
    A.$('#print').addEventListener('click', function () { window.print(); });
    popStockToast();
    return;
  }

  if (!id) { fail('Receipt not found.'); return; }

  var r;
  try { r = await A.api('/sales/' + id); } catch (e) { fail(e.message); return; }
  var s = r.sale;

  var rows = r.items.map(function (i) {
    var size = i.size_label ? '<span class="item-sub">' + esc(i.size_label) + '</span>' : '';
    return '<div class="rw"><span>' + i.quantity + 'x ' + esc(i.product_name) + size + '</span><span>' + money(i.subtotal) + '</span></div>';
  }).join('');

  A.root.innerHTML =
    '<div class="paper-wrap"><div class="paper">' +
    '<div class="c"><div class="store">' + esc(String(r.store).toUpperCase()) + '</div>' +
    '<p style="margin:6px 0 0">Receipt ID: ' + esc(s.transaction_id) + '<br>' + esc(new Date(s.sale_date).toLocaleString('en-PH')) +
    (s.cashier ? '<br>Cashier: ' + esc(s.cashier) : '') + '</p></div><hr>' +
    rows + '<hr>' +
    '<div class="rw"><span>Subtotal</span><span>' + money(s.total_amount + s.discount) + '</span></div>' +
    (s.discount > 0 ? '<div class="rw"><span>Discount</span><span>−' + money(s.discount) + '</span></div>' : '') +
    '<div class="rw"><span>VAT 12% (included)</span><span>' + money(s.tax) + '</span></div>' +
    '<div class="rw tot"><span>TOTAL:</span><span>' + money(s.total_amount) + '</span></div><hr>' +
    '<div class="rw"><span>Paid by ' + esc(s.payment_method) + '</span><span>' + money(s.amount_tendered) + '</span></div>' +
    (s.payment_method === 'Cash' ? '<div class="rw"><span>Change</span><span>' + money(s.change_amount) + '</span></div>' : '') +
    '<hr><div class="c"><p style="margin:0">Thank you for shopping!</p>' +
    '<div class="paper-actions no-print"><button class="btn" id="print" type="button">Print receipt</button><a class="btn primary" href="/pos">Back to POS</a></div></div>' +
    '</div></div>';

  A.$('#print').addEventListener('click', function () { window.print(); });
  popStockToast();
})();

/* Low-stock toast stashed by the POS before redirecting here. */
function popStockToast() {
  try {
    if (window.StockAlerts) {
      var msg = window.StockAlerts.popStashedMessage();
      if (msg) window.App.toast(msg, true, 6000);
    }
  } catch (e) { /* toast is optional */ }
}
