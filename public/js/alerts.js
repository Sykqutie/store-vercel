/* Inventory alerts: the single header notification-center dropdown.
   One feed covers low stock, out of stock, expiring soon and expired products.
   Critical alerts cannot be dismissed; warnings can be dismissed per owner. */
(function () {
  'use strict';

  var NEW_KEYS = 'cstore_alert_keys_v1';
  var READ_KEY = 'cstore_alert_read_v1';
  var fetching = false;
  var lastUpdated = null;
  var timer = null;
  var data = null;
  var filter = 'all';
  var showDismissed = false;
  var menuOpen = false;
  var inited = false;
  var listeners = [];
  var readKeys = {};

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

  function activeCount(d) {
    return (d && d.counts && d.counts.total != null) ? d.counts.total : 0;
  }

  function loadRead() {
    try {
      var keys = JSON.parse(localStorage.getItem(READ_KEY) || '[]');
      if (Array.isArray(keys)) keys.forEach(function (k) { readKeys[k] = 1; });
    } catch (e) { /* private mode */ }
  }

  function saveRead() {
    try { localStorage.setItem(READ_KEY, JSON.stringify(Object.keys(readKeys))); } catch (e) { /* private mode */ }
  }

  function pruneRead(d) {
    var valid = {};
    (d.alerts || []).forEach(function (a) { valid[a.key] = 1; });
    Object.keys(readKeys).forEach(function (k) {
      if (!valid[k]) delete readKeys[k];
    });
    saveRead();
  }

  function isRead(a) {
    return !!readKeys[a.key];
  }

  function markRead(key) {
    if (!key || readKeys[key]) return;
    readKeys[key] = 1;
    saveRead();
  }

  function markAllRead(d) {
    (d.alerts || []).forEach(function (a) {
      if (!a.dismissed) readKeys[a.key] = 1;
    });
    saveRead();
  }

  function unreadCount(d) {
    return (d.alerts || []).filter(function (a) {
      return !a.dismissed && !isRead(a);
    }).length;
  }

  function setBadge(d) {
    var e = els();
    if (!e.badge || !e.bell) return;
    var total = activeCount(d);
    if (total > 0) {
      e.badge.hidden = false;
      e.badge.textContent = total > 99 ? '99+' : String(total);
      e.badge.className = 'badge' + (d.counts.critical ? ' critical' : '');
      e.bell.setAttribute('aria-label', 'Notifications, ' + total + ' active inventory alerts');
    } else {
      e.badge.hidden = true;
      e.badge.textContent = '';
      e.badge.className = 'badge';
      e.bell.setAttribute('aria-label', 'Notifications, all clear');
    }
  }

  function typeLabel(a) {
    if (a.type === 'out') return 'OUT OF STOCK';
    if (a.type === 'expired') return 'EXPIRED';
    if (a.type === 'expiring') return 'EXPIRING SOON';
    return 'LOW STOCK';
  }

  function daysText(a) {
    if (a.days_left == null) return '';
    if (a.days_left < 0) {
      var ago = Math.abs(a.days_left);
      return 'Expired ' + ago + ' day' + (ago === 1 ? '' : 's') + ' ago';
    }
    if (a.days_left === 0) return 'Expires today';
    if (a.days_left === 1) return '1 day left';
    return a.days_left + ' days left';
  }

  function icon(a) {
    if (a.type === 'expiring' || a.type === 'expired') {
      return '<svg class="alert-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M12 14v3M12 20h.01"/></svg>';
    }
    if (a.type === 'out') {
      return '<svg class="alert-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>';
    }
    return '<svg class="alert-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>' +
      '<path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  }

  function message(a) {
    if (a.type === 'out') return 'This product is out of stock';
    if (a.type === 'low') return 'Stock is running low';
    return daysText(a);
  }

  function detail(a) {
    var A = window.App, esc = A.esc;
    var meta = a.category ? ' · ' + esc(a.category) : '';
    if (a.type === 'expiring' || a.type === 'expired') {
      return 'Expires <b>' + esc(A.fmtDate(a.expiry_date)) + '</b> · Stock <b>' + esc(a.stock) + '</b>' + meta;
    }
    return 'Stock <b>' + esc(a.stock) + '</b> · Alert at <b>' + esc(a.low_stock_threshold) + '</b>' + meta;
  }

  function pill(a) {
    var cls = a.type === 'expired' ? 'expired'
      : a.type === 'out' ? 'out'
        : a.type === 'low' ? 'low' : 'expiring';
    return '<span class="alert-tag ' + cls + '">' + typeLabel(a) + '</span>';
  }

  function sideHtml(a) {
    var key = window.App.esc(a.key);
    var out = '';
    if (a.dismissed) {
      out += '<button class="alert-row-restore" type="button" data-alert-restore="' + key + '">Restore</button>';
    } else if (a.dismissible) {
      out += '<button class="alert-row-x" type="button" data-alert-dismiss="' + key + '" aria-label="Dismiss alert" title="Dismiss">×</button>';
    }
    return out;
  }

  function row(a) {
    var A = window.App, esc = A.esc;
    var href = '/edit-product?id=' + encodeURIComponent(a.product_id);
    var unread = !a.dismissed && !isRead(a);
    return '<div class="alert-row ' + esc(a.type) + ' sev-' + esc(a.severity) + (a.dismissed ? ' dismissed' : '') + (unread ? ' unread' : '') + '"' +
      ' data-alert-href="' + esc(href) + '" data-alert-key="' + esc(a.key) + '" tabindex="0" role="link" aria-label="Open ' + esc(a.name) + ' in inventory">' +
      '<span class="alert-ico-wrap ' + esc(a.type) + ' sev-' + esc(a.severity) + '">' + icon(a) + '</span>' +
      '<span class="alert-main">' +
      '<span class="alert-row-top"><b class="alert-name">' + esc(a.name) + '</b>' + pill(a) + '</span>' +
      '<span class="alert-msg">' + esc(message(a)) + '</span>' +
      '<span class="alert-detail">' + detail(a) + '</span>' +
      '</span>' +
      '<span class="alert-row-side">' + (unread ? '<span class="alert-unread-dot" title="Unread" aria-hidden="true"></span>' : '') + sideHtml(a) + '</span>' +
      '</div>';
  }

  function filteredAlerts(d) {
    return (d.alerts || []).filter(function (a) {
      if (!showDismissed && a.dismissed) return false;
      if (filter === 'all') return true;
      if (filter === 'unread') return !a.dismissed && !isRead(a);
      return a.type === filter;
    });
  }

  function tabsHtml(d) {
    var c = d.counts || {};
    var tabs = [
      ['all', 'All', c.total || 0],
      ['unread', 'Unread', unreadCount(d)],
      ['low', 'Low Stock', c.low || 0],
      ['out', 'Out of Stock', c.out || 0],
      ['expiring', 'Expiring Soon', c.expiring || 0],
      ['expired', 'Expired', c.expired || 0]
    ];
    return '<div class="alert-tabs" role="tablist" aria-label="Notification filters">' + tabs.map(function (t) {
      return '<button class="alert-tab" type="button" role="tab" aria-selected="' + (filter === t[0]) + '" aria-pressed="' + (filter === t[0]) + '" data-afilter="' + t[0] + '">' +
        '<span>' + t[1] + '</span> <span class="alert-tab-n">' + t[2] + '</span></button>';
    }).join('') + '</div>';
  }

  function listHtml(d) {
    var list = filteredAlerts(d);
    if (list.length) return '<div class="alert-list">' + list.map(row).join('') + '</div>';
    if (!(d.alerts || []).length) {
      return '<div class="alert-empty"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--good)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14l-3-3"/></svg>' +
        '<p>You\'re all caught up!<br><span class="mute">No active low-stock, out-of-stock, expiring, or expired alerts.</span></p></div>';
    }
    return '<div class="alert-empty"><p>No notifications here.<br><span class="mute">' +
      (filter === 'unread' ? 'Everything in this list has been read.' : 'Try another filter.') + '</span></p></div>';
  }

  function menuHtml(d) {
    return '<span class="alert-menu-wrap">' +
      '<button class="icon-btn sm" id="alertMenuBtn" type="button" aria-label="Notification options" aria-haspopup="true" aria-expanded="' + menuOpen + '">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button>' +
      '<span class="alert-menu" role="menu" aria-label="Notification options"' + (menuOpen ? '' : ' hidden') + '>' +
      '<button type="button" role="menuitem" data-alert-read-all>Mark all as read</button>' +
      (d.counts && d.counts.dismissed ? '<button type="button" role="menuitem" data-alert-show-dismissed>' + (showDismissed ? 'Hide dismissed' : 'Show dismissed') + '</button>' : '') +
      '<button type="button" role="menuitem" data-alert-refresh>Refresh alerts</button>' +
      '</span></span>';
  }

  function renderPanel() {
    var e = els();
    if (!e.panel || !data) return;
    var A = window.App, esc = A.esc;
    var c = data.counts || {};
    var updated = data.generated_at ? new Date(data.generated_at) : lastUpdated;
    var when = updated ? updated.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not updated yet';
    var meta = (data.offline ? 'Offline · cached inventory · ' : 'Live inventory · ') + when;
    if (c.critical) meta += ' · ' + c.critical + ' critical';
    e.panel.innerHTML =
      '<div class="alert-head"><div class="alert-title"><h2>Notifications</h2>' +
      '<span class="alert-count"' + (c.total ? '' : ' hidden') + '>' + (c.total > 99 ? '99+' : (c.total || 0)) + '</span></div>' +
      '<div class="alert-head-actions">' +
      '<button class="icon-btn sm" id="alertRefresh" type="button" aria-label="Refresh inventory alerts" title="Refresh">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button>' +
      menuHtml(data) + '</div></div>' +
      '<p class="alert-meta" aria-live="polite">' + esc(meta) + (unreadCount(data) ? ' · ' + unreadCount(data) + ' unread' : '') + '</p>' +
      tabsHtml(data) +
      '<div class="alert-list-wrap">' +
      (c.dismissed ? '<div class="alert-dismissed-bar"><span>' + c.dismissed + ' dismissed warning(s)</span>' +
        '<button class="link-btn" type="button" data-alert-show-dismissed>' + (showDismissed ? 'Hide dismissed' : 'Show dismissed') + '</button></div>' : '') +
      listHtml(data) + '</div>' +
      '<div class="alert-foot"><a class="alert-all" href="/inventory">View All Inventory Alerts</a></div>';
  }

  function renderLoading() {
    var e = els();
    if (!e.panel || !isOpen()) return;
    e.panel.innerHTML =
      '<div class="alert-head"><div class="alert-title"><h2>Notifications</h2></div></div>' +
      '<div class="empty">Checking inventory…</div>';
  }

  function renderError(msg) {
    var e = els();
    if (!e.panel) return;
    var A = window.App, esc = A.esc;
    var cached = lastUpdated ? 'Last good update: ' + lastUpdated.toLocaleString('en-PH') + '.' : 'No inventory data yet.';
    e.panel.innerHTML =
      '<div class="alert-head"><div class="alert-title"><h2>Notifications</h2></div>' +
      '<div class="alert-head-actions"><button class="icon-btn sm" id="alertRefresh" type="button" aria-label="Retry loading alerts" title="Retry">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></button></div></div>' +
      '<div class="alert">' + esc(msg) + '</div><p class="note" style="margin-top:8px">' + esc(cached) + '</p>' +
      '<div class="alert-foot"><a class="alert-all" href="/inventory">View All Inventory Alerts</a></div>';
  }

  // Offline/cached alerts use the exact same rules as the server.
  function fromProducts(products) {
    var A = window.App;
    var alerts = [];
    (products || []).forEach(function (p) {
      var stock = Number(p.stock || 0);
      var threshold = p.low_stock_threshold == null ? 5 : Number(p.low_stock_threshold);
      var base = {
        product_id: p.id, id: p.id, name: p.name, barcode: p.barcode, category: p.category,
        stock: stock, low_stock_threshold: threshold,
        expiry_date: p.expiry_date || null,
        days_left: p.expiry_date ? A.daysUntil(p.expiry_date) : null,
        dismissed: false, dismissible: true
      };
      if (stock <= 0) {
        alerts.push(Object.assign({}, base, { key: 'out:' + p.id, type: 'out', severity: 'critical', status: 'OUT OF STOCK', dismissible: false }));
      } else if (stock <= threshold) {
        alerts.push(Object.assign({}, base, { key: 'low:' + p.id, type: 'low', severity: 'warning', status: 'LOW STOCK' }));
      }
      if (stock > 0 && base.expiry_date && base.days_left != null) {
        if (base.days_left < 0) {
          alerts.push(Object.assign({}, base, { key: 'expired:' + p.id + ':' + base.expiry_date, type: 'expired', severity: 'critical', status: 'EXPIRED', dismissible: false }));
        } else if (base.days_left <= 30) {
          var severity = base.days_left <= 1 ? 'critical' : base.days_left <= 7 ? 'urgent' : base.days_left <= 14 ? 'warning' : 'info';
          alerts.push(Object.assign({}, base, {
            key: 'expiring:' + p.id + ':' + base.expiry_date, type: 'expiring', severity: severity,
            status: 'EXPIRING SOON', dismissible: severity !== 'critical'
          }));
        }
      }
    });
    var rank = { critical: 0, urgent: 1, warning: 2, info: 3 };
    alerts.sort(function (a, b) {
      return (rank[a.severity] - rank[b.severity]) ||
        String(a.name).localeCompare(String(b.name)) ||
        String(a.type).localeCompare(String(b.type));
    });
    var countType = function (t) { return alerts.filter(function (a) { return a.type === t; }).length; };
    return {
      offline: true,
      generated_at: new Date().toISOString(),
      alerts: alerts,
      counts: {
        low: countType('low'), out: countType('out'), expiring: countType('expiring'),
        expired: countType('expired'), total: alerts.length,
        critical: alerts.filter(function (a) { return a.severity === 'critical'; }).length,
        dismissed: 0
      }
    };
  }

  function fromCache() {
    return window.LocalDB.loadProducts().then(fromProducts);
  }

  function emit(d) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](d); } catch (e) { /* listener is optional */ }
    }
    try { window.dispatchEvent(new window.CustomEvent('alerts-changed', { detail: d })); } catch (e) { /* ignore */ }
  }

  function rememberKeys(d) {
    var keys = (d.alerts || []).filter(function (a) { return !a.dismissed; }).map(function (a) { return a.key; });
    try { localStorage.setItem(NEW_KEYS, JSON.stringify(keys)); } catch (e) { /* private mode */ }
  }

  function detectNew(d) {
    var keys = (d.alerts || []).filter(function (a) { return !a.dismissed; }).map(function (a) { return a.key; });
    var prev = null;
    try { prev = JSON.parse(localStorage.getItem(NEW_KEYS) || 'null'); } catch (e) { /* ignore */ }
    if (Array.isArray(prev)) {
      var seen = {};
      prev.forEach(function (k) { seen[k] = 1; });
      var added = keys.filter(function (k) { return !seen[k]; });
      if (added.length) {
        var first = (d.alerts || []).filter(function (a) { return a.key === added[0]; })[0];
        var msg = added.length === 1 && first
          ? 'New inventory alert: ' + first.name + ' — ' + typeLabel(first)
          : added.length + ' new inventory alerts need attention.';
        try { window.App.toast(msg, true, 6500); } catch (e) { /* toast is optional */ }
        var b = els().badge;
        if (b) { b.classList.add('pulse'); setTimeout(function () { b.classList.remove('pulse'); }, 2600); }
      }
    }
    rememberKeys(d);
  }

  function render(d) {
    data = d;
    lastUpdated = new Date();
    pruneRead(d);
    setBadge(d);
    if (isOpen()) renderPanel();
    emit(d);
    return d;
  }

  function refresh() {
    if (fetching || !window.App) return Promise.resolve(data);
    var online = window.App.isOnline();
    if (isOpen() && !data) renderLoading();
    fetching = true;
    var p;
    if (online) {
      p = window.App.api('/alerts', { noRedirect: true });
    } else if (window.LocalDB) {
      p = fromCache();
    } else {
      fetching = false;
      if (isOpen()) renderError('You are offline and no cached inventory is available on this device.');
      return Promise.resolve(null);
    }
    return p.then(function (d) {
      fetching = false;
      detectNew(d);
      return render(d);
    }).catch(function (e) {
      fetching = false;
      var msg = String((e && e.message) || 'Could not load inventory alerts.');
      if (/401|sign in/i.test(msg)) {
        if (isOpen()) renderError('Your session expired. Please sign in again, then retry.');
        return null;
      }
      if (online && window.LocalDB) {
        return fromCache().then(function (d) {
          return render(d);
        }).catch(function () {
          if (data) {
            try { window.App.toast('Could not refresh alerts: ' + msg, true); } catch (x) { /* optional */ }
            return data;
          }
          if (isOpen()) renderError(msg);
          return null;
        });
      }
      if (data) {
        try { window.App.toast('Could not refresh alerts: ' + msg, true); } catch (x) { /* optional */ }
        return data;
      }
      if (isOpen()) renderError(msg);
      return null;
    });
  }

  function dismiss(key) {
    if (!window.App || !window.App.isOnline()) return Promise.reject(new Error('Dismissing needs a connection.'));
    return window.App.api('/alerts/dismiss', { body: { key: key } }).then(function (d) {
      markRead(key);
      try { window.App.toast('Alert dismissed. The product was not changed.'); } catch (e) { /* ignore */ }
      detectNew(d);
      return render(d);
    });
  }

  function restore(key) {
    if (!window.App || !window.App.isOnline()) return Promise.reject(new Error('Restoring needs a connection.'));
    return window.App.api('/alerts/restore', { body: { key: key } }).then(function (d) {
      try { window.App.toast('Alert restored.'); } catch (e) { /* ignore */ }
      rememberKeys(d);
      return render(d);
    });
  }

  function notifyChanged() {
    refresh();
  }

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

  function positionPanel() {
    var e = els();
    if (!e.panel || !e.bell) return;
    if (window.matchMedia && window.matchMedia('(max-width:900px)').matches) {
      var r = e.bell.getBoundingClientRect();
      var top = Math.max(12, Math.round(r.bottom + 8));
      e.panel.style.setProperty('--alert-panel-top', top + 'px');
    } else {
      e.panel.style.removeProperty('--alert-panel-top');
    }
  }

  function openPanel() {
    var e = els();
    if (!e.panel || !e.bell) return;
    positionPanel();
    e.panel.hidden = false;
    e.bell.setAttribute('aria-expanded', 'true');
    if (data) {
      try { renderPanel(); } catch (err) { /* ignore */ }
    } else {
      renderLoading();
    }
    refresh();
    var first = e.panel.querySelector('#alertRefresh');
    if (first) first.focus();
  }

  function closePanel(refocus) {
    var e = els();
    if (!e.panel || !e.bell) return;
    e.panel.hidden = true;
    menuOpen = false;
    e.bell.setAttribute('aria-expanded', 'false');
    if (refocus && e.bell) e.bell.focus();
  }

  function togglePanel() {
    if (isOpen()) closePanel(false);
    else openPanel();
  }

  function wirePanel() {
    var e = els();
    if (!e.panel || e.panel._wired) return;
    e.panel._wired = true;
    e.panel.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var menuBtn = ev.target.closest('#alertMenuBtn');
      if (menuBtn) {
        menuOpen = !menuOpen;
        renderPanel();
        return;
      }
      var readAll = ev.target.closest('[data-alert-read-all]');
      if (readAll) {
        menuOpen = false;
        if (data) markAllRead(data);
        renderPanel();
        return;
      }
      var tab = ev.target.closest('[data-afilter]');
      if (tab) {
        filter = tab.getAttribute('data-afilter');
        menuOpen = false;
        renderPanel();
        return;
      }
      var toggle = ev.target.closest('[data-alert-show-dismissed]');
      if (toggle) {
        showDismissed = !showDismissed;
        menuOpen = false;
        renderPanel();
        return;
      }
      var dismissBtn = ev.target.closest('[data-alert-dismiss]');
      if (dismissBtn) {
        dismissBtn.disabled = true;
        dismiss(dismissBtn.getAttribute('data-alert-dismiss')).catch(function (err) {
          dismissBtn.disabled = false;
          try { window.App.toast(err.message, true); } catch (x) { /* ignore */ }
        });
        return;
      }
      var restoreBtn = ev.target.closest('[data-alert-restore]');
      if (restoreBtn) {
        restoreBtn.disabled = true;
        restore(restoreBtn.getAttribute('data-alert-restore')).catch(function (err) {
          restoreBtn.disabled = false;
          try { window.App.toast(err.message, true); } catch (x) { /* ignore */ }
        });
        return;
      }
      if (ev.target.closest('#alertRefresh') || ev.target.closest('[data-alert-refresh]')) {
        menuOpen = false;
        refresh();
        return;
      }
      if (ev.target.closest('[data-alert-open]')) openPanel();
      var cardLink = ev.target.closest('[data-alert-href]');
      if (cardLink && !ev.target.closest('a,button')) {
        markRead(cardLink.getAttribute('data-alert-key'));
        window.location.href = cardLink.getAttribute('data-alert-href');
      }
    });
    e.panel.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var cardLink = ev.target.closest('[data-alert-href]');
      if (cardLink && !ev.target.closest('a,button')) {
        ev.preventDefault();
        markRead(cardLink.getAttribute('data-alert-key'));
        window.location.href = cardLink.getAttribute('data-alert-href');
      }
    });
  }

  function init() {
    if (inited) return;
    var e = els();
    if (!e.bell || !e.panel) return;
    inited = true;
    loadRead();
    wirePanel();
    e.bell.addEventListener('click', function (ev) {
      ev.stopPropagation();
      togglePanel();
    });
    e.bell.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closePanel(false);
    });
    document.addEventListener('click', function (ev) {
      if (!isOpen()) return;
      if (ev.target.closest && (ev.target.closest('#alertPanel') || ev.target.closest('#alertBell') || ev.target.closest('[data-alert-open]'))) return;
      closePanel(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && isOpen()) closePanel(true);
    });
    window.addEventListener('stock-changed', function () { refresh(); });
    window.addEventListener('sync-changed', function () { refresh(); });
    window.addEventListener('online', function () { refresh(); });
    window.addEventListener('resize', function () { if (isOpen()) positionPanel(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && window.App && window.App.isOnline()) refresh();
    });
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (!document.hidden && window.App && window.App.isOnline()) refresh();
    }, 60000);
    refresh();
  }

  window.StockAlerts = {
    init: init,
    refresh: refresh,
    notifyChanged: notifyChanged,
    dismiss: dismiss,
    restore: restore,
    fromProducts: fromProducts,
    data: function () { return data; },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    saleMessage: saleMessage,
    stashSaleMessage: stashSaleMessage,
    popStashedMessage: popStashedMessage,
    isOpen: isOpen,
    open: openPanel,
    close: closePanel
  };
})();
