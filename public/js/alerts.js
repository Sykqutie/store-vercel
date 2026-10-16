/* Stock alert notifications: header bell + dropdown panel fed by real inventory data. */
(function () {
  'use strict';

  var LIMIT_NOTE = 'Showing the most urgent items. See inventory for the full list.';
  var fetching = false;
  var lastUpdated = null;
  var timer = null;

  function els() {
    return {
      bell: document.getElementById('alertBell'),
      badge: document.getElementById('alertBadge'),
      panel: document.getElementById('alertPanel')
    };
  }

  function isOpen() {
    var p = els().panel;
    return !!(p && !p.hidden);
  }

  function setBadge(total) {
    var e = els();
    if (!e.badge || !e.bell) return;
    if (total > 0) {
      e.badge.hidden = false;
      e.badge.textContent = total > 99 ? '99+' : String(total);
      e.bell.setAttribute('aria-label', 'Stock alerts, ' + total + ' products need attention');
    } else {
      e.badge.hidden = true;
      e.badge.textContent = '';
      e.bell.setAttribute('aria-label', 'Stock alerts, all stocks healthy');
    }
  }

  function openPanel() {
    var e = els();
    if (!e.panel || !e.bell) return;
    e.panel.hidden = false;
    e.bell.setAttribute('aria-expanded', 'true');
    refresh();
    var first = e.panel.querySelector('#alertRefresh');
    if (first) first.focus();
  }

  function closePanel(refocus) {
    var e = els();
    if (!e.panel || !e.bell) return;
    e.panel.hidden = true;
    e.bell.setAttribute('aria-expanded', 'false');
    if (refocus && e.bell) e.bell.focus();
  }

  function togglePanel() {
    if (isOpen()) closePanel(false);
    else openPanel();
  }

  function warnIcon(kind) {
    var color = kind === 'out' ? 'var(--bad)' : 'var(--warn)';
    return '<svg class="alert-ico" style="color:' + color + '" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>' +
      '<path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  }

  function card(p) {
    var A = window.App, esc = A.esc;
    var kind = p.status === 'OUT OF STOCK' ? 'out' : 'low';
    var pill = kind === 'out' ? '<span class="pill out">Out of stock</span>' : '<span class="pill low">Low stock</span>';
    var supplier = (p.supplier_name || p.supplier_contact)
      ? '<span class="sub">Supplier: ' + esc([p.supplier_name, p.supplier_contact].filter(Boolean).join(' · ')) + '</span>'
      : '';
    return '<div class="alert-card ' + kind + '">' + warnIcon(kind) +
      '<div class="alert-body"><div class="alert-top"><b>' + esc(p.name) + '</b>' + pill + '</div>' +
      '<span class="sub">' + esc(p.category || 'General') + ' · ' + esc(p.barcode || ('# ' + p.id)) + '</span>' +
      '<span class="sub">Stock: <b>' + p.stock + '</b> (alert at ' + p.low_stock_threshold + ')' + '</span>' +
      supplier +
      '<a class="alert-link" href="/edit-product?id=' + p.id + '">Restock</a></div></div>';
  }

  function section(title, count, kind, items) {
    if (!items.length) return '';
    var pill = kind === 'out' ? '<span class="pill out">' + count + '</span>' : '<span class="pill low">' + count + '</span>';
    return '<div class="alert-sec"><div class="alert-sec-head"><span>' + title + '</span>' + pill + '</div>' +
      items.map(card).join('') + '</div>';
  }

  function render(data, meta) {
    var e = els();
    if (!e.panel) return;
    var A = window.App, esc = A.esc;
    // Deduplicate by product id (defensive: API already returns distinct rows).
    var seen = {}, out = [], low = [];
    (data.out_of_stock || []).forEach(function (p) {
      if (!seen[p.id]) { seen[p.id] = 1; out.push(p); }
    });
    (data.low_stock || []).forEach(function (p) {
      if (!seen[p.id]) { seen[p.id] = 1; low.push(p); }
    });
    var total = (data.counts && data.counts.total != null) ? data.counts.total : out.length + low.length;
    setBadge(total);
    lastUpdated = new Date();

    var body;
    if (!out.length && !low.length) {
      body = '<div class="alert-empty"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--good)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14l-3-3"/></svg>' +
        '<p>All stocks healthy.<br><span class="mute">Nothing at or below its alert threshold.</span></p></div>';
    } else {
      body = section('Out of stock', data.counts ? data.counts.out : out.length, 'out', out) +
        section('Low stock', data.counts ? data.counts.low : low.length, 'low', low) +
        (data.truncated ? '<p class="note" style="margin-top:10px">' + LIMIT_NOTE + '</p>' : '');
    }
    e.panel.innerHTML =
      '<div class="alert-head"><h2>Low Stock Alerts</h2>' +
      '<button class="icon-btn sm" id="alertRefresh" type="button" aria-label="Refresh stock alerts" title="Refresh">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button></div>' +
      '<p class="alert-meta">' + esc(meta) + '</p>' +
      '<div class="alert-list">' + body + '</div>' +
      '<a class="btn wide" href="/inventory" style="text-align:center;margin-top:12px">View All Products in Inventory</a>';
    document.getElementById('alertRefresh').addEventListener('click', function () { refresh(); });
  }

  function renderLoading() {
    var e = els();
    if (!e.panel || !isOpen()) return;
    e.panel.innerHTML =
      '<div class="alert-head"><h2>Low Stock Alerts</h2></div>' +
      '<div class="empty">Checking stock…</div>';
  }

  function renderError(msg) {
    var e = els();
    if (!e.panel) return;
    var A = window.App, esc = A.esc;
    var cached = lastUpdated ? 'Last good update: ' + lastUpdated.toLocaleString('en-PH') + '.' : 'No stock data yet.';
    e.panel.innerHTML =
      '<div class="alert-head"><h2>Low Stock Alerts</h2>' +
      '<button class="icon-btn sm" id="alertRefresh" type="button" aria-label="Retry loading stock alerts" title="Retry">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button></div>' +
      '<div class="alert">' + esc(msg) + '</div><p class="note" style="margin-top:8px">' + esc(cached) + '</p>' +
      '<a class="btn wide" href="/inventory" style="text-align:center;margin-top:12px">View All Products in Inventory</a>';
    document.getElementById('alertRefresh').addEventListener('click', function () { refresh(); });
  }

  function fromCache() {
    // Offline fallback: apply the same rules to the cached catalog.
    return window.LocalDB.loadProducts().then(function (products) {
      var out = [], low = [];
      products.forEach(function (p) {
        var item = {
          id: p.id, barcode: p.barcode, name: p.name, category: p.category,
          stock: p.stock, low_stock_threshold: p.low_stock_threshold,
          supplier_name: null, supplier_contact: null,
          status: p.stock <= 0 ? 'OUT OF STOCK' : 'LOW STOCK'
        };
        if (p.stock <= 0) out.push(item);
        else if (p.stock <= p.low_stock_threshold) low.push(item);
      });
      out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      low.sort(function (a, b) { return a.stock - b.stock || String(a.name).localeCompare(String(b.name)); });
      return {
        counts: { out: out.length, low: low.length, total: out.length + low.length },
        out_of_stock: out.slice(0, 100),
        low_stock: low.slice(0, 100),
        truncated: out.length > 100 || low.length > 100
      };
    });
  }

  function refresh() {
    if (fetching || !window.App) return Promise.resolve(false);
    var online = window.App.isOnline();
    if (isOpen()) renderLoading();
    fetching = true;
    var p;
    if (online) {
      p = window.App.api('/alerts/low-stock', { noRedirect: true });
    } else if (window.LocalDB) {
      p = fromCache();
    } else {
      fetching = false;
      // Offline with no cached catalog: still show the panel with a retry button.
      if (isOpen()) renderError('You are offline and no cached inventory is available on this device.');
      return Promise.resolve(false);
    }
    return p.then(function (data) {
      fetching = false;
      render(data, online
        ? 'Updated just now · live from database'
        : 'Offline · from cached inventory');
      return true;
    }).catch(function (e) {
      fetching = false;
      var msg = String((e && e.message) || 'Could not load stock alerts.');
      if (/401|sign in/i.test(msg)) {
        // Session expired: never leave the open panel empty — show retry.
        if (isOpen()) renderError('Your session expired. Please sign in again, then retry.');
        return false;
      }
      // Online request failed but we may have a cache to show instead.
      if (online && window.LocalDB) {
        return fromCache().then(function (data) {
          render(data, 'Live update failed — showing cached inventory');
          return true;
        }).catch(function () {
          if (isOpen()) renderError(msg);
          return false;
        });
      }
      if (isOpen()) renderError(msg);
      return false;
    });
  }

  function notifyChanged() {
    // Called after sales, checkouts, restocks and edits. Debounced by refresh().
    refresh();
  }

  // Build a short toast message for items that hit a threshold after a sale.
  // postSale: [{ name, stock, low_stock_threshold }]. Returns null when quiet.
  function saleMessage(postSale) {
    if (!postSale || !postSale.length) return null;
    var seen = {}, out = [], low = [];
    postSale.forEach(function (it) {
      if (!it || seen[it.name]) return;
      seen[it.name] = 1;
      if (it.stock <= 0) out.push(it.name);
      else if (it.stock <= it.low_stock_threshold) low.push(it.name + ' (' + it.stock + ' left)');
    });
    if (!out.length && !low.length) return null;
    var parts = [];
    if (out.length) parts.push('OUT OF STOCK: ' + out.join(', '));
    if (low.length) parts.push('Low stock: ' + low.join(', '));
    return 'Stock alert — ' + parts.join(' · ');
  }

  // Checkout redirects to the receipt page instantly, so a toast fired on the
  // POS page would never be seen. Stash the message; receipt.js pops it.
  function stashSaleMessage(msg) {
    if (!msg) return;
    try { sessionStorage.setItem('stockAlert', msg); } catch (e) { /* private mode */ }
  }

  function popStashedMessage() {
    try {
      var msg = sessionStorage.getItem('stockAlert');
      sessionStorage.removeItem('stockAlert');
      return msg;
    } catch (e) {
      return null;
    }
  }

  function init() {
    var e = els();
    if (!e.bell || !e.panel) return;
    e.bell.addEventListener('click', function (ev) {
      ev.stopPropagation();
      togglePanel();
    });
    e.bell.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closePanel(false);
    });
    document.addEventListener('click', function (ev) {
      if (!isOpen()) return;
      if (ev.target.closest && (ev.target.closest('#alertPanel') || ev.target.closest('#alertBell'))) return;
      closePanel(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && isOpen()) closePanel(true);
    });
    window.addEventListener('stock-changed', function () { refresh(); });
    window.addEventListener('sync-changed', function () { refresh(); });
    window.addEventListener('online', function () { refresh(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && window.App && window.App.isOnline()) refresh();
    });
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (!document.hidden && window.App && window.App.isOnline()) refresh();
    }, 90000);
    refresh(); // badge count on every page load, no click needed
  }

  window.StockAlerts = {
    init: init,
    refresh: refresh,
    notifyChanged: notifyChanged,
    saleMessage: saleMessage,
    stashSaleMessage: stashSaleMessage,
    popStashedMessage: popStashedMessage,
    isOpen: isOpen,
    close: closePanel
  };
})();
