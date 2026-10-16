/* Offline sync manager: queues offline sales + inventory ops, syncs when online. */
(function () {
  'use strict';

  var syncing = false;
  var listeners = [];

  function isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  function emit() {
    try {
      window.dispatchEvent(new window.CustomEvent('sync-changed'));
    } catch (e) { /* older browsers */ }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* ignore */ }
    }
    refreshBadge();
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function mustDB() {
    if (!window.LocalDB) return Promise.reject(new Error('Offline storage is not ready.'));
    return Promise.resolve(true);
  }

  function getPendingSales() {
    return mustDB().then(function () { return window.LocalDB.all('pending_sales'); }).then(function (rows) {
      rows.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : 1; });
      return rows;
    });
  }

  function getInventoryQueue() {
    return mustDB().then(function () { return window.LocalDB.all('inventory_queue'); }).then(function (rows) {
      rows.sort(function (a, b) { return (a.qid || 0) - (b.qid || 0); });
      return rows;
    });
  }

  function pendingCount() {
    return Promise.all([getPendingSales().catch(function () { return []; }), getInventoryQueue().catch(function () { return []; })]).then(function (r) {
      var sales = r[0].filter(function (s) { return s.status !== 'synced'; });
      return { sales: r[0].length, salesPending: sales.length, inventory: r[1].length, total: sales.length + r[1].length };
    });
  }

  function refreshBadge() {
    pendingCount().then(function (c) {
      var badge = document.getElementById('syncBadge');
      if (badge) {
        if (c.total > 0) {
          badge.hidden = false;
          badge.textContent = c.total + ' pending';
          badge.setAttribute('data-count', String(c.total));
        } else {
          badge.hidden = true;
          badge.textContent = '';
        }
      }
      try {
        document.body.setAttribute('data-online', isOnline() ? 'online' : 'offline');
        document.body.setAttribute('data-pending', String(c.total));
      } catch (e) { /* ignore */ }
    }).catch(function () { /* badge is optional */ });
  }

  // Save an offline sale locally. Decrements cached stock so the POS
  // cannot oversell while offline. Survives refresh/close (IndexedDB).
  function queueSale(input) {
    return mustDB().then(function () {
      var items = (input.items || []).map(function (l) {
        return { id: Number(l.id), qty: Number(l.qty), name: String(l.name || ''), price: Number(l.price || 0), barcode: String(l.barcode || '') };
      }).filter(function (l) { return l.id > 0 && l.qty > 0; });
      if (!items.length) throw new Error('The cart is empty.');
      var tendered = Number(input.amount_tendered || 0);
      if (!isFinite(tendered) || tendered < 0) throw new Error('Enter a valid cash amount.');
      var sale = {
        client_sale_id: input.client_sale_id || window.LocalDB.uuid('sale'),
        created_at: new Date().toISOString(),
        items: items,
        amount_tendered: tendered,
        status: 'pending',
        attempts: 0,
        last_error: null,
        server_id: null,
        server_txn: null
      };
      return window.LocalDB.put('pending_sales', sale).then(function () {
        return window.LocalDB.decStock(items).catch(function () { /* stock cache is best-effort */ });
      }).then(function () {
        emit();
        return sale;
      });
    });
  }

  function queueInventoryOp(op) {
    return mustDB().then(function () {
      var rec = {
        type: op.type === 'adjust' ? 'adjust' : 'restock',
        product_id: op.product_id ? Number(op.product_id) : null,
        barcode: String(op.barcode || ''),
        name: String(op.name || ''),
        category: String(op.category || 'General'),
        cost_price: Number(op.cost_price || 0),
        price: Number(op.price || 0),
        stock: Number(op.stock || 0),
        low_stock_threshold: op.low_stock_threshold == null ? 5 : Number(op.low_stock_threshold),
        base_stock: op.base_stock == null ? null : Number(op.base_stock),
        client_op_id: op.client_op_id || window.LocalDB.uuid('inv'),
        created_at: new Date().toISOString(),
        status: 'pending',
        attempts: 0,
        last_error: null
      };
      if (!rec.barcode && !rec.product_id) throw new Error('Barcode is required for queued inventory changes.');
      return window.LocalDB.put('inventory_queue', rec).then(function () {
        emit();
        return rec;
      });
    });
  }

  function retrySale(clientId) {
    return window.LocalDB.get('pending_sales', clientId).then(function (s) {
      if (!s) throw new Error('Queued sale not found.');
      s.status = 'pending';
      s.attempts = 0;
      s.last_error = null;
      return window.LocalDB.put('pending_sales', s);
    }).then(function () { emit(); return syncNow(); });
  }

  function discardSale(clientId) {
    return window.LocalDB.del('pending_sales', clientId).then(function () {
      emit();
      return refreshProductsCache().catch(function () { /* offline */ });
    });
  }

  function retryInventory(qid) {
    return window.LocalDB.get('inventory_queue', qid).then(function (r) {
      if (!r) throw new Error('Queued change not found.');
      r.status = 'pending';
      r.attempts = 0;
      r.last_error = null;
      return window.LocalDB.put('inventory_queue', r);
    }).then(function () { emit(); return syncNow(); });
  }

  function discardInventory(qid) {
    return window.LocalDB.del('inventory_queue', qid).then(function () {
      emit();
      return refreshProductsCache().catch(function () { /* offline */ });
    });
  }

  function refreshProductsCache() {
    if (!window.App || !isOnline()) return Promise.resolve(false);
    return window.App.api('/products', { noRedirect: true }).then(function (r) {
      if (r && r.products && window.LocalDB) {
        return window.LocalDB.saveProducts(r.products).then(function () { return true; });
      }
      return false;
    });
  }

  function markSale(sale, patch) {
    Object.keys(patch).forEach(function (k) { sale[k] = patch[k]; });
    return window.LocalDB.put('pending_sales', sale);
  }

  function markInv(rec, patch) {
    Object.keys(patch).forEach(function (k) { rec[k] = patch[k]; });
    return window.LocalDB.put('inventory_queue', rec);
  }

  // Push everything to the server. Only deletes a record after the
  // server confirms it (2xx). Idempotency keys prevent duplicates.
  function syncNow() {
    if (syncing) return Promise.resolve({ skipped: true, synced: 0, failed: 0, remaining: 0 });
    if (!isOnline()) return Promise.resolve({ skipped: true, synced: 0, failed: 0, remaining: 0, offline: true });
    if (!window.App || !window.LocalDB) return Promise.resolve({ skipped: true, synced: 0, failed: 0, remaining: 0 });
    syncing = true;
    emit();
    var synced = 0, failed = 0;

    function syncOneSale(sale) {
      var body = {
        items: sale.items.map(function (l) { return { id: l.id, qty: l.qty }; }),
        amount_tendered: sale.amount_tendered,
        client_sale_id: sale.client_sale_id
      };
      return window.App.api('/checkout', { body: body, noRedirect: true }).then(function (r) {
        // Server confirmed: safe to remove from the outbox.
        return window.LocalDB.del('pending_sales', sale.client_sale_id).then(function () {
          synced++;
        });
      }).catch(function (e) {
        var msg = String((e && e.message) || 'Sync failed.');
        if (/401|sign in/i.test(msg)) {
          throw e; // not logged in: stop syncing, keep the queue
        }
        if (/Failed to fetch|NetworkError|network|offline|Load failed/i.test(msg)) {
          throw e; // went offline mid-sync: stop, keep the queue
        }
        // Validation / stock conflict: keep the record, mark failed for review.
        failed++;
        return markSale(sale, { status: 'failed', attempts: (sale.attempts || 0) + 1, last_error: msg });
      });
    }

    function syncOneInv(rec) {
      var p;
      if (rec.type === 'adjust' && rec.product_id) {
        var body = {
          name: rec.name, category: rec.category, cost_price: rec.cost_price,
          price: rec.price, stock: rec.stock, low_stock_threshold: rec.low_stock_threshold
        };
        if (rec.base_stock != null) body.base_stock = rec.base_stock;
        p = window.App.api('/products/' + rec.product_id, { method: 'PUT', body: body, noRedirect: true });
      } else {
        p = window.App.api('/products', {
          body: {
            barcode: rec.barcode, name: rec.name, category: rec.category,
            cost_price: rec.cost_price, price: rec.price,
            stock: rec.stock, low_stock_threshold: rec.low_stock_threshold
          },
          noRedirect: true
        });
      }
      return p.then(function () {
        return window.LocalDB.del('inventory_queue', rec.qid).then(function () { synced++; });
      }).catch(function (e) {
        var msg = String((e && e.message) || 'Sync failed.');
        if (/401|sign in/i.test(msg)) throw e;
        if (/Failed to fetch|NetworkError|network|offline|Load failed/i.test(msg)) throw e;
        failed++;
        return markInv(rec, { status: 'failed', attempts: (rec.attempts || 0) + 1, last_error: msg });
      });
    }

    return getPendingSales().then(function (sales) {
      var chain = Promise.resolve();
      sales.filter(function (s) { return s.status !== 'syncing'; }).forEach(function (sale) {
        chain = chain.then(function () { return syncOneSale(sale); });
      });
      return chain;
    }).then(function () {
      return getInventoryQueue();
    }).then(function (queue) {
      var chain = Promise.resolve();
      queue.forEach(function (rec) {
        chain = chain.then(function () { return syncOneInv(rec); });
      });
      return chain;
    }).then(function () {
      return refreshProductsCache().catch(function () { /* cache refresh is best-effort */ });
    }).then(function () {
      return Promise.all([getPendingSales().catch(function () { return []; }), getInventoryQueue().catch(function () { return []; })]);
    }).then(function (r) {
      var remaining = r[0].length + r[1].length;
      try {
        window.LocalDB.setMeta('last_sync_at', new Date().toISOString()).catch(function () {});
        window.LocalDB.setMeta('last_sync_result', JSON.stringify({ synced: synced, failed: failed, remaining: remaining })).catch(function () {});
      } catch (e) { /* ignore */ }
      syncing = false;
      emit();
      return { synced: synced, failed: failed, remaining: remaining };
    }).catch(function (e) {
      syncing = false;
      emit();
      var msg = String((e && e.message) || 'Sync failed.');
      if (/401|sign in/i.test(msg)) return { synced: synced, failed: failed, remaining: -1, auth: true };
      return { synced: synced, failed: failed, remaining: -1, offline: true, error: msg };
    });
  }

  function autoStart() {
    refreshBadge();
    window.addEventListener('online', function () {
      refreshBadge();
      syncNow().then(function (r) {
        if (r && r.synced > 0 && window.App) {
          try { window.App.toast('Back online — ' + r.synced + ' queued change(s) synced.'); } catch (e) { /* ignore */ }
        }
        refreshBadge();
      });
    });
    window.addEventListener('offline', function () { refreshBadge(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && isOnline()) syncNow().then(function () { refreshBadge(); });
    });
    // Gentle periodic retry (every 45s) when there is work to do.
    setInterval(function () {
      if (!isOnline() || syncing) return;
      pendingCount().then(function (c) {
        if (c.total > 0) syncNow().then(function () { refreshBadge(); });
      }).catch(function () { /* ignore */ });
    }, 45000);
    // First run shortly after load.
    setTimeout(function () {
      if (isOnline()) syncNow().then(function () { refreshBadge(); });
      else refreshBadge();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoStart);
  } else {
    autoStart();
  }

  window.Sync = {
    isOnline: isOnline,
    onChange: onChange,
    getPendingSales: getPendingSales,
    getInventoryQueue: getInventoryQueue,
    pendingCount: pendingCount,
    queueSale: queueSale,
    queueInventoryOp: queueInventoryOp,
    retrySale: retrySale,
    discardSale: discardSale,
    retryInventory: retryInventory,
    discardInventory: discardInventory,
    syncNow: syncNow,
    refreshBadge: refreshBadge,
    refreshProductsCache: refreshProductsCache,
    isSyncing: function () { return syncing; }
  };
})();
