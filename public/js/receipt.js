/* Receipt (replaces receipt.php). URL: /receipt?id=12. No app header so it prints cleanly. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var id = parseInt(A.qs('id'), 10);

  function fail(msg) {
    A.root.innerHTML = '<div class="auth-wrap"><div class="panel auth"><div class="alert">' + esc(msg) + '</div><a class="btn wide" href="/pos" style="text-align:center">Back to POS</a></div></div>';
  }
  if (!id) { fail('Receipt not found.'); return; }

  var r;
  try { r = await A.api('/sales/' + id); } catch (e) { fail(e.message); return; }
  var s = r.sale;

  var items = r.items.map(function (i) {
    return '<div class="rw"><span>' + i.quantity + 'x ' + esc(i.product_name) + '</span><span>' + money(i.subtotal) + '</span></div>';
  }).join('');

  A.root.innerHTML =
    '<div class="paper-wrap"><div class="paper">' +
    '<div class="c"><div class="store">' + esc(String(r.store).toUpperCase()) + '</div>' +
    '<p style="margin:6px 0 0">Receipt ID: ' + esc(s.transaction_id) + '<br>' + esc(new Date(s.sale_date).toLocaleString('en-PH')) +
    (s.cashier ? '<br>Cashier: ' + esc(s.cashier) : '') + '</p></div><hr>' +
    items + '<hr>' +
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
})();
