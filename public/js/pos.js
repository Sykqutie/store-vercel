/* POS (replaces pos.php): product grid, barcode scan, cart, payment, checkout, then receipt. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var main = await A.mountShell('pos');
  if (!main) return;

  var products = [];   // all products from the API
  var cart = [];       // [{ id, qty }]
  var method = 'Cash';
  var search = '';
  var VAT = 12;        // prices include VAT; shown for information only (the server computes the real values)

  main.innerHTML =
    '<div class="bill">' +
    '<div class="panel pad"><div class="ph"><h2>Select products</h2><span class="mono mute" id="count"></span></div>' +
    '<div class="toolbar"><input id="q" type="search" placeholder="Search by name or barcode" aria-label="Search products"></div>' +
    '<div class="toolbar" style="margin-bottom:6px"><input id="scan" style="flex:1 1 220px;max-width:380px" placeholder="Scan barcode, then press Enter" autocomplete="off" aria-label="Barcode"><button class="btn" id="scanBtn" type="button">Add</button></div>' +
    '<div class="mono mute" id="scanMsg" style="min-height:1.5em;margin-bottom:10px;font-size:12px"></div>' +
    '<div id="catalog" class="products"></div></div>' +
    '<aside class="panel pad cart"><div class="ph" style="margin-bottom:0"><h2>Current cart</h2></div>' +
    '<div id="lines" class="lines"></div>' +
    '<label for="disc">Discount<select id="disc"><option value="0">None</option><option value="5">Loyalty 5%</option><option value="10">Promo 10%</option><option value="20">Senior / PWD 20%</option></select></label>' +
    '<div class="seg" id="methods"><button type="button" data-m="Cash" aria-pressed="true">Cash</button><button type="button" data-m="GCash" aria-pressed="false">GCash</button><button type="button" data-m="Card" aria-pressed="false">Card</button></div>' +
    '<div id="cashRow"><label for="tender">Cash received<input id="tender" inputmode="decimal" autocomplete="off" placeholder="0.00"></label><div class="quick" id="quick"></div></div>' +
    '<div id="sum" class="sum"></div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="charge" type="button">Complete &amp; print receipt</button>' +
    '<button class="btn wide" id="clear" type="button">Clear cart</button></aside></div>';

  var el = {
    q: A.$('#q'), scan: A.$('#scan'), msg: A.$('#scanMsg'), catalog: A.$('#catalog'), lines: A.$('#lines'),
    disc: A.$('#disc'), tender: A.$('#tender'), sum: A.$('#sum'), charge: A.$('#charge'), err: A.$('#err'),
    quick: A.$('#quick'), cashRow: A.$('#cashRow'), count: A.$('#count')
  };

  var cents = function (n) { return Math.round(n * 100); };
  var byId = function (id) { return products.filter(function (p) { return p.id === id; })[0]; };
  var cartQty = function (id) { var l = cart.filter(function (x) { return x.id === id; })[0]; return l ? l.qty : 0; };
  var tendered = function () { return Number(String(el.tender.value).replace(/,/g, '')) || 0; };

  function totals() {
    var sub = 0;
    cart.forEach(function (l) { sub += cents(byId(l.id).price) * l.qty; });
    var disc = Math.round(sub * Number(el.disc.value) / 100);
    var total = sub - disc;
    return { sub: sub, disc: disc, total: total, vat: Math.round(total * VAT / (100 + VAT)) };
  }

  function say(text, ok) {
    el.msg.textContent = text;
    el.msg.className = 'mono ' + (ok === true ? 'up' : ok === false ? 'down' : 'mute');
  }

  function beep(ok) {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = ok ? 880 : 220; o.type = 'sine';
      g.gain.setValueAtTime(0.1, ctx.currentTime);
      o.start(); o.stop(ctx.currentTime + 0.14);
    } catch (e) { /* sound is optional */ }
  }

  function renderCatalog() {
    var q = search.toLowerCase();
    var list = products.filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) > -1 || p.barcode.toLowerCase().indexOf(q) > -1;
    });
    el.count.textContent = products.length + ' items';
    el.catalog.innerHTML = list.length ? list.map(function (p) {
      var left = p.stock - cartQty(p.id);
      var initials = p.name.split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
      return '<button class="pc" type="button" data-id="' + p.id + '"' + (left <= 0 ? ' disabled' : '') + '>' +
        '<span class="hx">' + esc(initials) + '</span><span class="nm">' + esc(p.name) + '</span>' +
        '<span class="pr">' + money(p.price) + '</span>' +
        '<span class="st">' + (p.stock <= 0 ? 'Out of stock' : left + ' left') + '</span></button>';
    }).join('') : '<div class="empty" style="grid-column:1/-1">No products match.</div>';
  }

  function renderCart() {
    el.lines.innerHTML = cart.length ? cart.map(function (l) {
      var p = byId(l.id);
      return '<div class="line"><div class="ln"><b>' + esc(p.name) + '</b><span class="mono mute" style="font-size:12px">' + money(p.price) + ' ea</span></div>' +
        '<div class="qty"><button type="button" data-act="dec" data-id="' + p.id + '" aria-label="Decrease quantity">−</button><span class="mono">' + l.qty + '</span><button type="button" data-act="inc" data-id="' + p.id + '" aria-label="Increase quantity">+</button></div>' +
        '<div class="mono lt">' + money(p.price * l.qty) + '</div>' +
        '<button class="x" type="button" data-act="rm" data-id="' + p.id + '" aria-label="Remove ' + esc(p.name) + '">×</button></div>';
    }).join('') : '<div class="empty">Tap a product to add it.</div>';
    renderSummary();
    renderCatalog();
  }

  function renderSummary() {
    var t = totals(), cash = method === 'Cash';
    el.cashRow.hidden = !cash;
    el.quick.innerHTML = t.total > 0 ? [['Exact', t.total / 100], ['100', 100], ['500', 500], ['1000', 1000]].map(function (a) {
      return '<button class="chip" type="button" data-amt="' + a[1] + '">' + a[0] + '</button>';
    }).join('') : '';
    var change = (cents(tendered()) - t.total) / 100;
    el.sum.innerHTML =
      '<div class="r"><span>Subtotal</span><span>' + money(t.sub / 100) + '</span></div>' +
      '<div class="r"><span>Discount</span><span>−' + money(t.disc / 100) + '</span></div>' +
      '<div class="r"><span>VAT ' + VAT + '% (included)</span><span>' + money(t.vat / 100) + '</span></div>' +
      (cash && t.total > 0 ? '<div class="r"><span>Change</span><span class="' + (change < 0 ? 'down' : 'up') + '">' + (change < 0 ? 'Short ' + money(-change) : money(change)) + '</span></div>' : '') +
      '<div class="r tot"><span>Total</span><span>' + money(t.total / 100) + '</span></div>';
    el.charge.disabled = !cart.length || (cash && cents(tendered()) < t.total);
  }

  function add(id) {
    var p = byId(id);
    if (!p) return;
    var have = cartQty(id);
    if (have >= p.stock) { A.toast('Only ' + p.stock + ' in stock', true); return false; }
    var l = cart.filter(function (x) { return x.id === id; })[0];
    if (l) l.qty++; else cart.push({ id: id, qty: 1 });
    renderCart();
    return true;
  }

  async function load() {
    var r = await A.api('/products');
    products = r.products;
    cart = cart.filter(function (l) { return byId(l.id); }).map(function (l) {
      return { id: l.id, qty: Math.min(l.qty, byId(l.id).stock) };
    }).filter(function (l) { return l.qty > 0; });
    renderCart();
  }

  async function scanAdd() {
    var code = el.scan.value.trim();
    el.scan.value = '';
    el.scan.focus();
    if (!code) return;
    say('Looking up ' + code + '…');
    try {
      var r = await A.api('/lookup?code=' + encodeURIComponent(code));
      var p = byId(r.product.id);
      if (!p) { products.push(r.product); }
      else { p.stock = r.product.stock; p.price = r.product.price; }
      if (add(r.product.id)) { say('Added: ' + r.product.name + ' (' + r.product.barcode + ')', true); beep(true); }
    } catch (e) {
      say(e.message, false);
      beep(false);
    }
  }

  async function checkout() {
    el.err.hidden = true;
    el.charge.disabled = true;
    try {
      var body = {
        items: cart.map(function (l) { return { id: l.id, qty: l.qty }; }),
        payment_method: method,
        discount_percent: Number(el.disc.value)
      };
      if (method === 'Cash') body.amount_tendered = tendered();
      var r = await A.api('/checkout', { body: body });
      location.href = '/receipt?id=' + r.id;
    } catch (e) {
      el.err.textContent = e.message;
      el.err.hidden = false;
      try { await load(); } catch (x) { /* keep the cart on screen */ }
      renderSummary();
    }
  }

  // ----- events -----
  el.catalog.addEventListener('click', function (e) {
    var b = e.target.closest('.pc');
    if (b && !b.disabled) add(Number(b.dataset.id));
  });
  el.lines.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var id = Number(b.dataset.id);
    if (b.dataset.act === 'inc') add(id);
    if (b.dataset.act === 'dec') {
      var l = cart.filter(function (x) { return x.id === id; })[0];
      if (l && --l.qty <= 0) cart = cart.filter(function (x) { return x.id !== id; });
      renderCart();
    }
    if (b.dataset.act === 'rm') { cart = cart.filter(function (x) { return x.id !== id; }); renderCart(); }
  });
  A.$('#methods').addEventListener('click', function (e) {
    var b = e.target.closest('[data-m]');
    if (!b) return;
    method = b.dataset.m;
    Array.prototype.forEach.call(A.$('#methods').children, function (x) { x.setAttribute('aria-pressed', x === b); });
    renderSummary();
  });
  el.quick.addEventListener('click', function (e) {
    var b = e.target.closest('[data-amt]');
    if (b) { el.tender.value = b.dataset.amt; renderSummary(); }
  });
  el.q.addEventListener('input', function () { search = el.q.value; renderCatalog(); });
  el.tender.addEventListener('input', renderSummary);
  el.disc.addEventListener('change', renderSummary);
  el.scan.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); scanAdd(); } });
  A.$('#scanBtn').addEventListener('click', scanAdd);
  el.charge.addEventListener('click', checkout);
  A.$('#clear').addEventListener('click', function () { cart = []; el.tender.value = ''; renderCart(); });

  try { await load(); }
  catch (e) { el.catalog.innerHTML = '<div class="alert" style="grid-column:1/-1">' + esc(e.message) + '</div>'; }
  A.reveal(main);
  el.scan.focus();
})();
