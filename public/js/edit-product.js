/* Edit inventory item (replaces edit_product.php). URL: /edit-product?id=5 */
(async function () {
  'use strict';
  var A = App, esc = A.esc;
  var main = await A.mountShell('products', 'owner');
  if (!main) return;

  var id = parseInt(A.qs('id'), 10);
  if (!id) { location.replace('/inventory'); return; }

  var p;
  var offlineItem = false;
  try { p = (await A.api('/products/' + id)).product; }
  catch (e) {
    var net = /Failed to fetch|NetworkError|network|offline|Load failed/i.test(String((e && e.message) || e));
    if (net && window.LocalDB) {
      try { p = await window.LocalDB.get('products', id); } catch (x) { p = null; }
    }
    if (!p) {
      main.innerHTML = '<div class="panel pad narrow"><div class="alert">' + esc(e.message) + '</div><p style="margin-top:12px"><a class="btn" href="/inventory">Back to inventory</a></p></div>';
      return;
    }
    offlineItem = true;
  }

  main.innerHTML =
    '<div class="offline-banner" id="offBanner"' + (offlineItem || !A.isOnline() ? '' : ' hidden') + '>' +
    ((offlineItem || !A.isOnline()) ? '<b>Offline mode.</b> Changes are queued with conflict protection and sync when you reconnect.' : '') + '</div>' +
    '<div class="panel pad narrow"><div class="ph"><h2>Edit inventory item</h2><span class="mono mute">' + esc(p.barcode) + '</span></div>' +
    '<div class="bc-preview"><span class="bc"><svg id="bcSvg" data-code="' + esc(p.barcode) + '" role="img" aria-label="Barcode ' + esc(p.barcode) + '"></svg></span>' +
    '<div class="bc-meta"><span class="mono mute">Scannable at POS · CODE128</span><button class="btn sm" id="printBc" type="button">Print label</button></div></div>' +
    '<form id="f" class="stack">' +
    '<label for="name">Item name<input id="name" maxlength="150" required value="' + esc(p.name) + '"></label>' +
    '<label for="category">Category<span class="bc-row"><input id="category" maxlength="60" list="categoryOptions" autocomplete="off" required value="' + esc(p.category) + '"><button class="btn sm" id="suggestCat" type="button">Suggest</button></span><datalist id="categoryOptions"></datalist></label>' +
    '<div class="note" id="catHint">The saved category is never changed automatically. Use Suggest only when you want a new recommendation.</div>' +
    '<div class="row2"><label for="cost">Cost price (₱)<input id="cost" type="number" step="0.01" min="0" required value="' + p.cost_price + '"></label>' +
    '<label for="price">Price (₱)<input id="price" type="number" step="0.01" min="0" required value="' + p.price + '"></label></div>' +
    '<div class="row2"><label for="stock">Stock quantity<input id="stock" type="number" step="1" min="0" required value="' + p.stock + '"></label>' +
    '<label for="threshold">Low stock threshold<input id="threshold" type="number" step="1" min="0" required value="' + p.low_stock_threshold + '"></label></div>' +
    '<label for="expiry">Expiry date (optional)<input id="expiry" type="date" value="' + esc(p.expiry_date || '') + '"></label>' +
    '<div class="note">Leave blank to remove the expiry date. Expired stock is blocked at POS and highlighted in Inventory.</div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="save" type="submit">Update inventory item</button>' +
    '<a class="btn wide" href="/inventory" style="text-align:center">Cancel</a></form></div>';

  try {
    if (window.JsBarcode) {
      window.JsBarcode('#bcSvg', p.barcode, {
        format: 'CODE128', width: 2, height: 60, margin: 8,
        displayValue: true, background: '#ffffff', lineColor: '#000000'
      });
    }
  } catch (e) { /* keep text fallback */ }

  var catNames = [String(p.category || '').trim()];
  if (A.isOnline()) {
    try {
      var cr = await A.api('/categories');
      catNames = catNames.concat((cr.categories || []).map(function (c) { return c.name; }));
    } catch (e) { }
  }
  var seenCats = {};
  A.$('#categoryOptions').innerHTML = catNames.filter(function (name) {
    name = String(name || '').trim();
    var key = name.toLowerCase();
    if (!name || seenCats[key]) return false;
    seenCats[key] = true;
    return true;
  }).sort(function (a, b) { return a.localeCompare(b); }).map(function (name) {
    return '<option value="' + esc(name) + '"></option>';
  }).join('');

  A.$('#category').addEventListener('input', function () {
    A.$('#catHint').textContent = this.value.trim()
      ? 'Manual category. The saved category is only changed when you save.'
      : 'Required. Ask the owner to choose or reactivate a category.';
  });
  A.$('#suggestCat').addEventListener('click', async function () {
    var btn = this;
    var name = A.$('#name').value.trim();
    if (!name) { A.$('#catHint').textContent = 'Enter an item name first.'; return; }
    if (!A.isOnline()) { A.$('#catHint').textContent = 'Suggestions need a connection.'; return; }
    btn.disabled = true;
    try {
      var r = await A.api('/categories/suggest?name=' + encodeURIComponent(name));
      if (r && r.suggestion) {
        A.$('#category').value = r.suggestion;
        A.$('#catHint').textContent = r.source === 'keyword'
          ? 'Suggested from the item name. Review it before saving.'
          : 'No keyword match, so Uncategorized is suggested.';
      }
    } catch (e) {
      A.$('#catHint').textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });
  A.$('#printBc').addEventListener('click', function () {
    var code = String(p.barcode).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var w = window.open('', '_blank', 'width=420,height=360');
    if (!w) return;
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Barcode · ' + esc(p.barcode) + '</title>' +
      '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.8.0/dist/JsBarcode.all.min.js"><\/script>' +
      '<style>body{font-family:Arial,sans-serif;text-align:center;padding:28px;color:#111}h3{margin:0 0 4px;font-size:16px}.meta{color:#555;font-size:13px;margin:4px 0 14px}svg{max-width:100%}button{margin-top:16px;padding:10px 22px;font-size:15px;cursor:pointer}@media print{button{display:none}}</style></head><body>' +
      '<h3>' + esc(p.name) + '</h3><div class="meta">' + esc(p.barcode) + '</div>' +
      '<svg id="bc"></svg><div><button onclick="window.print()">Print label</button></div>' +
      '<script>JsBarcode("#bc", \'' + code + '\', { format: "CODE128", width: 2, height: 80, displayValue: true });<\/script>' +
      '</body></html>');
    w.document.close();
    w.focus();
  });
  A.$('#f').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = A.$('#err'), btn = A.$('#save');
    err.hidden = true;
    btn.disabled = true;
    var fields = {
      name: A.$('#name').value, category: A.$('#category').value, cost_price: A.$('#cost').value,
      price: A.$('#price').value, stock: A.$('#stock').value, low_stock_threshold: A.$('#threshold').value,
      expiry_date: A.$('#expiry').value || null
    };
    // Offline (or lost connection): queue an adjust op with base_stock for conflict safety.
    if (!A.isOnline()) {
      try {
        if (!window.Sync) throw new Error('Offline queue is unavailable in this browser.');
        await window.Sync.queueInventoryOp({
          type: 'adjust', product_id: id, barcode: p.barcode,
          name: fields.name, category: fields.category, cost_price: fields.cost_price,
          price: fields.price, stock: Number(fields.stock), low_stock_threshold: Number(fields.low_stock_threshold),
          expiry_date: fields.expiry_date, base_stock: p.stock
        });
        A.toast('Saved offline — will sync when online.');
        location.href = '/inventory';
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
      return;
    }
    try {
      await A.api('/products/' + id, {
        method: 'PUT',
        body: Object.assign({}, fields, { base_stock: p.stock })
      });
      if (window.StockAlerts) { try { window.StockAlerts.notifyChanged(); } catch (x) {} }
      location.href = '/inventory';
    } catch (ex) {
      var net = /Failed to fetch|NetworkError|network|offline|Load failed/i.test(String((ex && ex.message) || ex));
      if (net && window.Sync) {
        try {
          await window.Sync.queueInventoryOp({
            type: 'adjust', product_id: id, barcode: p.barcode,
            name: fields.name, category: fields.category, cost_price: fields.cost_price,
            price: fields.price, stock: Number(fields.stock), low_stock_threshold: Number(fields.low_stock_threshold),
            expiry_date: fields.expiry_date, base_stock: p.stock
          });
          A.toast('Connection lost — change queued for sync.', true);
          location.href = '/inventory';
          return;
        } catch (qx) { /* fall through to error display */ }
      }
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
  A.reveal(main);
})();
