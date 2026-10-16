/* POS with offline support: cached catalog, offline cart/checkout, outbox sync. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var main = await A.mountShell('pos');
  if (!main) return;

  var products = [];   // catalog items for sale (API when online, IndexedDB cache when offline)
  // POS cart (persisted locally; stock is always revalidated server-side at checkout).
  var cart = (window.CartStore ? window.CartStore.load() : []);
  var search = '';
  var VAT = 12;        // prices include VAT; shown for information only (the server computes the real values)
  var offlineMode = !A.isOnline();
  // Cashiers are POS-only: they can sell but never see inventory numbers
  // (exact stock counts, thresholds, costs). Owners keep the full detail.
  // Fail closed: unknown roles are treated as cashier.
  var isCashier = !(A.me() && A.me().role === 'owner');

  main.innerHTML =
    '<div class="offline-banner" id="offBanner" hidden></div>' +
    '<div class="bill">' +
    '<div class="panel pad"><div class="ph"><h2>' + (isCashier ? 'Select items' : 'Select inventory items') + '</h2><span class="mono mute" id="count"></span></div>' +
    '<div class="toolbar"><input id="q" type="search" placeholder="Search by name or barcode" aria-label="Search items"></div>' +
    '<div class="toolbar" style="margin-bottom:6px"><input id="scan" style="flex:1 1 220px;max-width:380px" placeholder="Scan barcode, then press Enter" autocomplete="off" aria-label="Barcode"><button class="btn" id="scanBtn" type="button">Add</button></div>' +
    '<div class="mono mute" id="scanMsg" style="min-height:1.5em;margin-bottom:10px;font-size:12px"></div>' +
    '<div id="catalog" class="products"></div></div>' +
    '<aside class="panel pad cart"><div class="ph" style="margin-bottom:0"><h2>Current cart</h2></div>' +
    '<div id="lines" class="lines"></div>' +
    '<div id="cashRow"><label for="tender">Cash received<input id="tender" inputmode="decimal" autocomplete="off" placeholder="0.00"></label><div class="quick" id="quick"></div></div>' +
    '<div id="sum" class="sum"></div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="charge" type="button">Complete &amp; print receipt</button>' +
    '<button class="btn wide" id="clear" type="button">Clear cart</button></aside></div>' +
    '<div class="panel pad" id="syncPanel"><div class="ph"><h2>Offline sales queue</h2><span class="mono mute" id="syncMeta"></span></div>' +
    '<div class="btn-row" style="margin-bottom:10px"><button class="btn sm" id="syncNow" type="button">Sync now</button>' +
    '<button class="btn sm" id="installBtn" type="button" data-pwa-install hidden>Install app</button></div>' +
    '<div id="pendList"><div class="empty">No queued sales. Offline sales are saved here and sync when you reconnect.</div></div></div>';

  var el = {
    q: A.$('#q'), scan: A.$('#scan'), msg: A.$('#scanMsg'), catalog: A.$('#catalog'), lines: A.$('#lines'),
    tender: A.$('#tender'), sum: A.$('#sum'), charge: A.$('#charge'), err: A.$('#err'),
    quick: A.$('#quick'), cashRow: A.$('#cashRow'), count: A.$('#count'),
    banner: A.$('#offBanner'), pendList: A.$('#pendList'), syncMeta: A.$('#syncMeta'), syncNow: A.$('#syncNow')
  };

  var cents = function (n) { return Math.round(n * 100); };
  var byId = function (id) { return products.filter(function (p) { return p.id === id; })[0]; };
  var cartQty = function (id) { var l = cart.filter(function (x) { return x.id === id; })[0]; return l ? l.qty : 0; };
  var tendered = function () { return Number(String(el.tender.value).replace(/,/g, '')) || 0; };
  var netErr = function (e) { return /Failed to fetch|NetworkError|network|offline|Load failed/i.test(String((e && e.message) || e)); };

  function totals() {
    var sub = 0;
    cart.forEach(function (l) {
      var p = byId(l.id);
      if (p) sub += cents(p.price) * l.qty;
    });
    return { sub: sub, total: sub, vat: Math.round(sub * VAT / (100 + VAT)) };
  }

  function paintBanner() {
    offlineMode = !A.isOnline();
    if (offlineMode) {
      el.banner.hidden = false;
      el.banner.innerHTML = isCashier
        ? '<b>Offline mode.</b> Sales are saved on this device and sync automatically when you reconnect.'
        : '<b>Offline mode.</b> Sales are saved on this device and sync automatically when you reconnect. Stock shown is the last cached stock minus queued sales.';
    } else {
      el.banner.hidden = true;
      el.banner.innerHTML = '';
    }
    el.charge.innerHTML = offlineMode ? 'Save sale offline' : 'Complete &amp; print receipt';
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
      return !q || String(p.name).toLowerCase().indexOf(q) > -1 || String(p.barcode).toLowerCase().indexOf(q) > -1;
    });
    el.count.textContent = products.length + ' items' + (offlineMode ? ' (cached)' : '');
    el.catalog.innerHTML = list.length ? list.map(function (p) {
      var left = p.stock - cartQty(p.id);
      var initials = String(p.name).split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
      // Cashiers see availability only — never exact stock numbers.
      var st = p.stock <= 0 ? 'Out of stock'
        : isCashier ? 'Available'
        : left + ' left';
      if (!isCashier && offlineMode && p.stock > 0) st += ' · cached';
      return '<button class="pc" type="button" data-id="' + p.id + '"' + (left <= 0 ? ' disabled' : '') + '>' +
        '<span class="hx">' + esc(initials) + '</span><span class="nm">' + esc(p.name) + '</span>' +
        '<span class="pr">' + money(p.price) + '</span>' +
        '<span class="st">' + st + '</span></button>';
    }).join('') : '<div class="empty" style="grid-column:1/-1">No items match.</div>';
  }

  function renderCart() {
    el.lines.innerHTML = cart.length ? cart.map(function (l) {
      var p = byId(l.id);
      if (!p) return '';
      return '<div class="line"><div class="ln"><b>' + esc(p.name) + '</b><span class="mono mute" style="font-size:12px">' + money(p.price) + ' ea</span></div>' +
        '<div class="qty"><button type="button" data-act="dec" data-id="' + p.id + '" aria-label="Decrease quantity">−</button><span class="mono">' + l.qty + '</span><button type="button" data-act="inc" data-id="' + p.id + '" aria-label="Increase quantity">+</button></div>' +
        '<div class="mono lt">' + money(p.price * l.qty) + '</div>' +
        '<button class="x" type="button" data-act="rm" data-id="' + p.id + '" aria-label="Remove ' + esc(p.name) + '">×</button></div>';
    }).join('') : '<div class="empty">Tap an item to add it.</div>';
    if (window.CartStore) { try { window.CartStore.save(cart); } catch (e) { /* ignore */ } }
    renderSummary();
    renderCatalog();
  }

  function renderSummary() {
    var t = totals();
    el.quick.innerHTML = t.total > 0 ? [['Exact', t.total / 100], ['100', 100], ['500', 500], ['1000', 1000]].map(function (a) {
      return '<button class="chip" type="button" data-amt="' + a[1] + '">' + a[0] + '</button>';
    }).join('') : '';
    var change = (cents(tendered()) - t.total) / 100;
    el.sum.innerHTML =
      '<div class="r"><span>Subtotal</span><span>' + money(t.sub / 100) + '</span></div>' +
      '<div class="r"><span>VAT ' + VAT + '% (included)</span><span>' + money(t.vat / 100) + '</span></div>' +
      (t.total > 0 ? '<div class="r"><span>Change</span><span class="' + (change < 0 ? 'down' : 'up') + '">' + (change < 0 ? 'Short ' + money(-change) : money(change)) + '</span></div>' : '') +
      '<div class="r tot"><span>Total</span><span>' + money(t.total / 100) + '</span></div>';
    el.charge.disabled = !cart.length || cents(tendered()) < t.total;
  }

  function add(id) {
    var p = byId(id);
    if (!p) return false;
    var have = cartQty(id);
    if (have >= p.stock) {
      A.toast(isCashier ? 'Not enough stock available' : 'Only ' + p.stock + ' in stock', true);
      return false;
    }
    var l = cart.filter(function (x) { return x.id === id; })[0];
    if (l) l.qty++; else cart.push({ id: id, qty: 1 });
    renderCart();
    return true;
  }

  function localTotal(sale) {
    var c = 0;
    (sale.items || []).forEach(function (l) { c += Math.round(Number(l.price || 0) * 100) * Number(l.qty || 0); });
    return c / 100;
  }

  function renderPending() {
    if (!window.Sync || !window.LocalDB) return;
    window.Sync.getPendingSales().then(function (sales) {
      return window.LocalDB.getMeta('last_sync_result').then(function (last) { return { sales: sales, last: last }; });
    }).then(function (r) {
      var sales = r.sales;
      var lastTxt = '';
      try {
        if (r.last) {
          var lj = JSON.parse(r.last);
          lastTxt = 'Last sync: ' + lj.synced + ' synced · ' + lj.failed + ' failed · ' + lj.remaining + ' left';
        }
      } catch (e) { /* ignore */ }
      el.syncMeta.textContent = (sales.length ? sales.length + ' queued · ' : '') + lastTxt;
      if (!sales.length) {
        el.pendList.innerHTML = '<div class="empty">No queued sales. Offline sales are saved here and sync when you reconnect. Synced sales move to Reports.</div>';
        return;
      }
      el.pendList.innerHTML = '<div class="pend-list">' + sales.map(function (s) {
        var pill = s.status === 'failed' ? '<span class="pill out">Failed</span>' : '<span class="pill low">Pending</span>';
        var err = s.last_error ? '<div class="mono down" style="font-size:12px">' + esc(s.last_error) + '</div>' : '';
        return '<div class="pend"><div><b class="mono">' + esc(s.client_sale_id.slice(-8)) + '</b> ' + pill +
          '<span class="sub">' + esc(new Date(s.created_at).toLocaleString('en-PH')) + ' · ' + s.items.length + ' line(s) · ' + money(localTotal(s)) + '</span></div>' +
          err +
          '<div class="acts"><a class="btn sm" href="/receipt?local=' + encodeURIComponent(s.client_sale_id) + '">Receipt</a>' +
          (s.status === 'failed' ? '<button class="btn sm" type="button" data-retry="' + esc(s.client_sale_id) + '">Retry</button>' : '') +
          '<button class="btn sm" type="button" data-discard="' + esc(s.client_sale_id) + '">Discard</button></div></div>';
      }).join('') + '</div>';
    }).catch(function () { /* queue panel is optional */ });
  }

  async function load() {
    try {
      var r = await A.api('/products');
      products = r.products;
      offlineMode = false;
      if (window.LocalDB) {
        try { await window.LocalDB.saveProducts(products); } catch (e) { /* cache is best-effort */ }
      }
    } catch (e) {
      if (netErr(e) && window.LocalDB) {
        try {
          products = await window.LocalDB.loadProducts();
        } catch (x) { products = []; }
        if (!products.length) throw e;
        offlineMode = true;
        A.toast(isCashier ? 'Offline — showing cached items.' : 'Offline — showing cached inventory.', true);
      } else {
        throw e;
      }
    }
    cart = cart.filter(function (l) { return byId(l.id); }).map(function (l) {
      var p = byId(l.id);
      return { id: l.id, qty: Math.min(l.qty, Math.max(0, p.stock)) };
    }).filter(function (l) { return l.qty > 0; });
    paintBanner();
    renderCart();
    renderPending();
  }

  async function scanAdd() {
    var code = el.scan.value.trim();
    el.scan.value = '';
    el.scan.focus();
    if (!code) return;
    // Offline: match the cached catalog locally.
    if (!A.isOnline()) {
      var hit = products.filter(function (p) { return String(p.barcode).toLowerCase() === code.toLowerCase(); })[0];
      if (hit) {
        if (add(hit.id)) { say('Added: ' + hit.name + ' (' + hit.barcode + ') · offline', true); beep(true); }
      } else {
        say('No cached item with barcode ' + code + ' (offline).', false);
        beep(false);
      }
      return;
    }
    say('Looking up ' + code + '…');
    try {
      var r = await A.api('/lookup?code=' + encodeURIComponent(code));
      var p = byId(r.product.id);
      if (!p) { products.push(r.product); }
      else { p.stock = r.product.stock; p.price = r.product.price; }
      if (add(r.product.id)) { say('Added: ' + r.product.name + ' (' + r.product.barcode + ')', true); beep(true); }
    } catch (e) {
      if (netErr(e)) {
        var h = products.filter(function (x) { return String(x.barcode).toLowerCase() === code.toLowerCase(); })[0];
        if (h && add(h.id)) { say('Added from cache: ' + h.name + ' (offline)', true); beep(true); }
        else { say('Offline — barcode not in cached items.', false); beep(false); }
      } else {
        say(e.message, false);
        beep(false);
      }
    }
  }

  function snapshot() {
    return cart.map(function (l) {
      var p = byId(l.id);
      return { id: l.id, qty: l.qty, name: p ? p.name : '', price: p ? p.price : 0, barcode: p ? p.barcode : '' };
    });
  }

  async function checkoutOffline(items, tender, clientId) {
    if (!window.Sync) {
      el.err.textContent = 'You are offline and offline sales are unavailable in this browser.';
      el.err.hidden = false;
      el.charge.disabled = false;
      return;
    }
    // Prevent negative stock against the cached levels.
    for (var i = 0; i < items.length; i++) {
      var p = byId(items[i].id);
      if (!p) { el.err.textContent = 'An item in the cart is no longer available.'; el.err.hidden = false; el.charge.disabled = false; return; }
      if (items[i].qty > p.stock) { el.err.textContent = isCashier ? 'Not enough stock available for ' + p.name + '.' : 'Only ' + p.stock + ' of ' + p.name + ' in cached stock.'; el.err.hidden = false; el.charge.disabled = false; return; }
    }
    try {
      var sale = await window.Sync.queueSale({ items: items, amount_tendered: tender, client_sale_id: clientId });
      items.forEach(function (l) {
        var prod = byId(l.id);
        if (prod) prod.stock = Math.max(0, prod.stock - l.qty);
      });
      // Stock-level toasts are an owner tool — cashiers never see them.
      if (!isCashier && window.StockAlerts) {
        try {
          window.StockAlerts.stashSaleMessage(window.StockAlerts.saleMessage(items.map(function (l) {
            var prod = byId(l.id);
            return prod ? { name: prod.name, stock: prod.stock, low_stock_threshold: prod.low_stock_threshold } : null;
          })));
        } catch (x) { /* toast is optional */ }
      }
      cart = [];
      el.tender.value = '';
      renderCart();
      renderPending();
      A.toast('Saved offline — will sync when online.');
      location.href = '/receipt?local=' + encodeURIComponent(sale.client_sale_id);
    } catch (e) {
      el.err.textContent = e.message;
      el.err.hidden = false;
      el.charge.disabled = false;
    }
  }

  async function checkout() {
    if (!cart.length) return;
    el.err.hidden = true;
    el.charge.disabled = true;
    var items = snapshot();
    var tender = tendered();
    var t = totals();
    if (cents(tender) < t.total) {
      el.err.textContent = 'Cash received is less than the total.';
      el.err.hidden = false;
      el.charge.disabled = false;
      return;
    }
    var clientId = window.LocalDB ? window.LocalDB.uuid('sale') : ('sale_' + Date.now().toString(36));
    if (!A.isOnline()) {
      await checkoutOffline(items, tender, clientId);
      return;
    }
    try {
      var body = {
        items: cart.map(function (l) { return { id: l.id, qty: l.qty }; }),
        payment_method: 'Cash',
        amount_tendered: tender,
        client_sale_id: clientId // idempotency: safe to retry, never double-charges
      };
      var r = await A.api('/checkout', { body: body });
      var freshOk = false;
      try {
        var fresh = await A.api('/products');
        products = fresh.products;
        freshOk = true;
        if (window.LocalDB) { try { await window.LocalDB.saveProducts(products); } catch (e) {} }
      } catch (e) { /* receipt still works */ }
      if (window.StockAlerts) {
        try {
          window.StockAlerts.notifyChanged();
          // Post-sale stock levels for the toast on the receipt page (owners only).
          if (!isCashier) window.StockAlerts.stashSaleMessage(window.StockAlerts.saleMessage(items.map(function (l) {
            var prod = byId(l.id);
            if (!prod) return null;
            var stock = freshOk ? prod.stock : Math.max(0, prod.stock - l.qty);
            return { name: prod.name, stock: stock, low_stock_threshold: prod.low_stock_threshold };
          })));
        } catch (x) { /* toast is optional */ }
      }
      location.href = '/receipt?id=' + r.id;
      if (window.CartStore) { try { window.CartStore.clear(); } catch (x) { /* ignore */ } }
      return;
    } catch (e) {
      if (netErr(e)) {
        await checkoutOffline(items, tender, clientId);
        return;
      }
      // Never leak exact stock numbers to cashiers (server messages carry them).
      var msg = String((e && e.message) || 'Checkout failed.');
      if (isCashier) msg = msg.replace(/Only \d+ of .*? left in stock\./, 'Not enough stock available for an item in the cart.');
      el.err.textContent = msg;
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
  el.quick.addEventListener('click', function (e) {
    var b = e.target.closest('[data-amt]');
    if (b) { el.tender.value = b.dataset.amt; renderSummary(); }
  });
  el.q.addEventListener('input', function () { search = el.q.value; renderCatalog(); });
  el.tender.addEventListener('input', renderSummary);
  el.scan.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); scanAdd(); } });
  A.$('#scanBtn').addEventListener('click', scanAdd);
  el.charge.addEventListener('click', checkout);
  A.$('#clear').addEventListener('click', function () { cart = []; el.tender.value = ''; renderCart(); });
  el.syncNow.addEventListener('click', function () {
    if (!window.Sync) return;
    el.syncNow.disabled = true;
    window.Sync.syncNow().then(function (r) {
      el.syncNow.disabled = false;
      renderPending();
      if (r && r.offline) { A.toast('Still offline — kept in queue.', true); return; }
      if (r && r.auth) { A.toast('Session expired — sign in to sync.', true); return; }
      if (r && (r.synced || r.failed)) {
        A.toast('Sync: ' + r.synced + ' synced, ' + r.failed + ' failed.', r.failed > 0);
        load().catch(function () {});
      } else {
        A.toast('Everything is already synced.');
      }
    }).catch(function (e) {
      el.syncNow.disabled = false;
      A.toast(e.message, true);
    });
  });
  el.pendList.addEventListener('click', function (e) {
    var retry = e.target.closest('[data-retry]');
    var disc = e.target.closest('[data-discard]');
    if (!window.Sync) return;
    if (retry) {
      window.Sync.retrySale(retry.getAttribute('data-retry')).then(function () { renderPending(); load().catch(function () {}); }).catch(function (ex) { A.toast(ex.message, true); });
    }
    if (disc) {
      if (!window.confirm('Discard this queued sale? Cached stock will refresh from the server.')) return;
      window.Sync.discardSale(disc.getAttribute('data-discard')).then(function () { renderPending(); load().catch(function () {}); }).catch(function (ex) { A.toast(ex.message, true); });
    }
  });
  window.addEventListener('online', function () { paintBanner(); load().catch(function () {}); });
  window.addEventListener('offline', function () { paintBanner(); });
  // Back-navigation may restore a stale page from bfcache: reload so the cart
  // (possibly added to from inventory lookup) and stock are always fresh.
  window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
  window.addEventListener('sync-changed', function () { renderPending(); });
  window.addEventListener('app-refresh', function () { load().then(function () { A.noteRefreshed(); }).catch(function () { A.noteRefreshed(); }); });

  paintBanner();
  try { await load(); }
  catch (e) { el.catalog.innerHTML = '<div class="alert" style="grid-column:1/-1">' + esc(e.message) + '</div>'; }
  renderPending();
  A.reveal(main);
  el.scan.focus();
})();
