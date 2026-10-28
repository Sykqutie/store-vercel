/* Inventory (owner only): add/restock table, queued restocks, outbox sync.
   Cashiers never reach this page — mountShell('products', 'owner') shows
   them a restricted page, their tabs only list POS, and the API rejects
   their inventory writes with 403. POS-only cashier accounts. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var main = await A.mountShell('products', 'owner');
  if (!main) return;

  var status = ['low', 'out', 'expiring', 'expired'].indexOf(A.qs('status')) >= 0 ? A.qs('status') : '';
  var timer;
  var all = [];
  var activeCategories = [];
  var categoryFilter = '';
  var categoryTouched = false;
  var suggestTimer;
  var suggestSeq = 0;
  var sizeTouched = false;
  var sizeSuggestTimer;
  var sizeSuggestSeq = 0;
  var offlineMode = !A.isOnline();
  var sortKey = 'name', sortDir = 1;

  main.innerHTML =
    '<div class="offline-banner" id="offBanner" hidden></div>' +
    '<div class="two">' +
    '<div class="panel pad"><div class="ph"><h2>Add / restock inventory item</h2></div>' +
    '<form id="f" class="stack">' +
    '<label for="barcode">Barcode<span class="bc-row"><input id="barcode" maxlength="64" required style="flex:1;min-width:0"><button class="btn sm" id="gen" type="button" title="Generate a scannable barcode">Generate</button></span></label>' +
    '<label for="name">Item name<input id="name" maxlength="150" required></label>' +
    '<label for="category">Category<input id="category" maxlength="60" list="categoryOptions" autocomplete="off" placeholder="Leave blank to auto-categorize"><datalist id="categoryOptions"></datalist></label>' +
    '<div class="note" id="catHint" aria-live="polite">Leave blank to auto-categorize. Suggestions never replace a category you type.</div>' +
    '<div class="row2"><label for="sizeValue">Size / volume value (optional)<input id="sizeValue" type="number" step="0.001" min="0.001" placeholder="e.g. 500"></label>' +
    '<label for="sizeUnit">Unit<select id="sizeUnit"><option value="">No size</option><option value="mL">mL</option><option value="L">L</option><option value="g">g</option><option value="kg">kg</option><option value="mg">mg</option><option value="pcs">pcs</option><option value="sachet">sachet</option></select></label></div>' +
    '<label for="sizeLabel">Display label (optional)<input id="sizeLabel" maxlength="60" placeholder="e.g. 500 mL or 12 mL sachet"></label>' +
    '<div class="note" id="sizeHint" aria-live="polite">Size is optional. Suggestions never replace size you enter.</div>' +
    '<div class="row2"><label for="cost">Cost price (₱)<input id="cost" type="number" step="0.01" min="0" required></label>' +
    '<label for="price">Selling price (₱)<input id="price" type="number" step="0.01" min="0" required></label></div>' +
    '<div class="row2"><label for="stock">Quantity to add<input id="stock" type="number" step="1" min="0" required></label>' +
    '<label for="threshold">Low stock alert at<input id="threshold" type="number" step="1" min="0" value="5" required></label></div>' +
    '<label for="expiry">Expiry date (optional)<input id="expiry" type="date"></label>' +
    '<label for="imageUrl">Image URL (optional)<input id="imageUrl" type="url" maxlength="512" placeholder="https://example.com/product.jpg"></label>' +
    '<div class="note">Leave blank to clear. Only http/https URLs allowed (max 512 characters).</div>' +
    '<div class="note">Saving an existing barcode adds the quantity to its stock and updates the details. Leave expiry blank for items without a printed date.</div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="save" type="submit">Save inventory item</button></form>' +
    '<div class="panel pad" id="queuePanel" style="margin-top:14px"><div class="ph"><h2>Queued inventory changes</h2><span class="mono mute" id="queueMeta"></span></div>' +
    '<div class="btn-row" style="margin-bottom:10px"><button class="btn sm" id="syncNow" type="button">Sync now</button></div>' +
    '<div id="queueList"><div class="empty">No queued changes.</div></div></div></div>' +
    '<div class="panel pad"><div class="ph"><h2>Inventory</h2><span class="inv-meta"><span class="mono mute" id="count"></span><span class="mono lk-total" id="invValue" aria-live="polite"></span><a class="btn sm" href="/categories">Manage categories</a></span></div>' +
    '<div class="toolbar"><input id="q" type="search" placeholder="Search name, barcode, size or category" aria-label="Search inventory">' +
    '<select id="catFilter" class="cat-select" aria-label="Filter by category"><option value="">All categories</option></select>' +
    '<div class="chips" id="chips"></div></div>' +
    '<div class="tw"><table id="invTable"><thead><tr><th>Barcode (scan)</th><th class="sortable" data-sort="name" role="columnheader">Name <span class="sort-ind" data-ind="name"></span></th><th class="n">Cost</th><th class="n sortable" data-sort="price" role="columnheader">Price <span class="sort-ind" data-ind="price"></span></th><th class="sortable" data-sort="stock" role="columnheader">Stock <span class="sort-ind" data-ind="stock"></span></th><th class="sortable" data-sort="expiry_date" role="columnheader">Expiry <span class="sort-ind" data-ind="expiry_date"></span></th><th>Status</th><th></th></tr></thead><tbody id="body"></tbody></table></div>' +
    '</div></div>';

  var body = A.$('#body'), err = A.$('#err');
  var banner = A.$('#offBanner'), queueList = A.$('#queueList'), queueMeta = A.$('#queueMeta');

  var netErr = function (e) { return /Failed to fetch|NetworkError|network|offline|Load failed/i.test(String((e && e.message) || e)); };

  function paintBanner() {
    offlineMode = !A.isOnline();
    if (offlineMode) {
      banner.hidden = false;
      banner.innerHTML = '<b>Offline mode.</b> Showing cached inventory. New restocks are queued and sync when you reconnect.';
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }

  function chips() {
    A.$('#chips').innerHTML = [['', 'All'], ['low', 'Low stock'], ['out', 'Out of stock'], ['expiring', 'Expiring ≤30 days'], ['expired', 'Expired']].map(function (c) {
      return '<button class="chip" type="button" data-s="' + c[0] + '" aria-pressed="' + (status === c[0]) + '">' + c[1] + '</button>';
    }).join('');
  }

  function categoryNames() {
    var seen = {};
    var out = [];
    all.forEach(function (p) {
      var name = String(p.category || '').trim();
      var key = name.toLowerCase();
      if (name && !seen[key]) { seen[key] = true; out.push(name); }
    });
    out.sort(function (a, b) { return a.localeCompare(b); });
    return out;
  }

  function choiceNames() {
    var seen = {};
    var out = [];
    var source = activeCategories.length ? activeCategories : categoryNames();
    source.forEach(function (name) {
      name = String(name || '').trim();
      var key = name.toLowerCase();
      if (name && !seen[key]) { seen[key] = true; out.push(name); }
    });
    out.sort(function (a, b) { return a.localeCompare(b); });
    return out;
  }

  function paintCategoryChoices() {
    var filter = A.$('#catFilter');
    var names = categoryNames();
    if (categoryFilter && names.map(function (n) { return n.toLowerCase(); }).indexOf(categoryFilter.toLowerCase()) < 0) {
      categoryFilter = '';
    }
    if (filter) {
      filter.innerHTML = '<option value="">All categories</option>' + names.map(function (name) {
        return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
      }).join('');
      filter.value = categoryFilter;
    }
    var list = A.$('#categoryOptions');
    if (list) {
      list.innerHTML = choiceNames().map(function (name) {
        return '<option value="' + esc(name) + '"></option>';
      }).join('');
    }
  }

  function setCategoryHint(text) {
    var hint = A.$('#catHint');
    if (hint) hint.textContent = text;
  }

  function resetCategoryField() {
    categoryTouched = false;
    suggestSeq++;
    clearTimeout(suggestTimer);
    A.$('#category').value = '';
    setCategoryHint('Leave blank to auto-categorize. Suggestions never replace a category you type.');
  }

  function scheduleSuggestion() {
    if (categoryTouched) return;
    var name = A.$('#name').value.trim();
    var barcode = A.$('#barcode').value.trim();
    clearTimeout(suggestTimer);
    if (!name && !barcode) {
      A.$('#category').value = '';
      setCategoryHint('Leave blank to auto-categorize. Suggestions never replace a category you type.');
      return;
    }
    if (!A.isOnline()) {
      setCategoryHint('Offline: this item will be categorized automatically when it syncs.');
      return;
    }
    var seq = ++suggestSeq;
    suggestTimer = setTimeout(function () {
      A.api('/categories/suggest?name=' + encodeURIComponent(name) + '&barcode=' + encodeURIComponent(barcode)).then(function (r) {
        if (seq !== suggestSeq || categoryTouched || !r || !r.suggestion) return;
        A.$('#category').value = r.suggestion;
        setCategoryHint(r.source === 'existing'
          ? 'Existing barcode category. You can change it before saving.'
          : r.source === 'keyword'
            ? 'Suggested from the item name. You can change it before saving.'
            : 'No keyword match, so Uncategorized will be used unless you choose a category.');
      }).catch(function () { });
    }, 300);
  }

  function setSizeHint(text) {
    var hint = A.$('#sizeHint');
    if (hint) hint.textContent = text;
  }

  function setSizeFields(size) {
    A.$('#sizeValue').value = size ? size.value : '';
    A.$('#sizeUnit').value = size ? size.unit : '';
    A.$('#sizeLabel').value = size ? size.label : '';
  }

  function resetSizeField() {
    sizeTouched = false;
    sizeSuggestSeq++;
    clearTimeout(sizeSuggestTimer);
    setSizeFields(null);
    setSizeHint('Size is optional. Suggestions never replace size you enter.');
  }

  function readSizeFields() {
    var value = A.$('#sizeValue').value.trim();
    var unit = A.$('#sizeUnit').value;
    var label = A.$('#sizeLabel').value.trim();
    if (!value && !unit) {
      return label
        ? { error: 'Choose a unit when entering a display label, or clear the label.' }
        : { value: '', unit: '', label: '' };
    }
    if (!value || !unit) return { error: 'Enter both a size value and unit, or leave both blank.' };
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0.001) return { error: 'Size value must be at least 0.001.' };
    if (n > 9999999.999) return { error: 'Size value is too large.' };
    return { value: value, unit: unit, label: label };
  }

  function scheduleSizeSuggestion() {
    if (sizeTouched) return;
    var name = A.$('#name').value.trim();
    var barcode = A.$('#barcode').value.trim();
    clearTimeout(sizeSuggestTimer);
    if (!name && !barcode) {
      setSizeFields(null);
      setSizeHint('Size is optional. Suggestions never replace size you enter.');
      return;
    }
    if (!A.isOnline()) {
      if (!sizeTouched) setSizeFields(null);
      setSizeHint('Offline: leave size blank to keep the saved size, or enter it manually.');
      return;
    }
    var seq = ++sizeSuggestSeq;
    sizeSuggestTimer = setTimeout(function () {
      A.api('/sizes/suggest?name=' + encodeURIComponent(name) + '&barcode=' + encodeURIComponent(barcode)).then(function (r) {
        if (seq !== sizeSuggestSeq || sizeTouched) return;
        if (!r || !r.suggestion) {
          setSizeFields(null);
          setSizeHint('No explicit size found. Add one if the package shows it.');
          return;
        }
        setSizeFields(r.suggestion);
        setSizeHint(r.source === 'existing'
          ? 'Existing barcode size. You can change it before saving.'
          : 'Suggested from the item name. Review it before saving.');
      }).catch(function () {
        if (seq !== sizeSuggestSeq || sizeTouched) return;
        setSizeFields(null);
        setSizeHint('Could not check for a size. Enter it manually if needed.');
      });
    }, 300);
  }

  function paintSvg(svg) {
    if (!window.JsBarcode || !svg) return false;
    try {
      window.JsBarcode(svg, svg.getAttribute('data-code'), {
        format: 'CODE128', width: 1.6, height: 44, margin: 6,
        displayValue: false, background: '#ffffff', lineColor: '#000000'
      });
      return true;
    } catch (e) {
      var span = document.createElement('span');
      span.className = 'mono';
      span.textContent = svg.getAttribute('data-code');
      svg.replaceWith(span);
      return false;
    }
  }

  function paintBarcodes() {
    Array.prototype.forEach.call(body.querySelectorAll('svg.jsbarcode'), function (svg) {
      paintSvg(svg);
    });
  }

  function printLabel(p) {
    var code = String(p.barcode).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var name = esc(p.name).replace(/'/g, '&#39;');
    var w = window.open('', '_blank', 'width=420,height=360');
    if (!w) { A.toast('Allow pop-ups to print labels', true); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Barcode · ' + esc(p.barcode) + '</title>' +
      '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.8.0/dist/JsBarcode.all.min.js"><\/script>' +
      '<style>body{font-family:Arial,sans-serif;text-align:center;padding:28px;color:#111}h3{margin:0 0 4px;font-size:16px}.meta{color:#555;font-size:13px;margin:4px 0 14px}svg{max-width:100%}button{margin-top:16px;padding:10px 22px;font-size:15px;cursor:pointer}@media print{button{display:none}}</style></head><body>' +
      '<h3>' + name + '</h3><div class="meta">' + esc(A.sizeText(p)) + ' · ' + esc(p.barcode) + ' · ' + esc(A.money(p.price)) + '</div>' +
      '<svg id="bc"></svg><div><button onclick="window.print()">Print label</button></div>' +
      '<script>JsBarcode("#bc", \'' + code + '\', { format: "CODE128", width: 2, height: 80, displayValue: true });<\/script>' +
      '</body></html>');
    w.document.close();
    w.focus();
  }

  function genBarcode() {
    var s = '4800';
    for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  function expiryDays(p) {
    return p.expiry_date ? A.daysUntil(p.expiry_date) : null;
  }

  function filtered() {
    var q = A.$('#q').value.trim().toLowerCase();
    var list = all.filter(function (p) {
      var days = expiryDays(p);
      if (status === 'low' && !(p.stock > 0 && p.stock <= p.low_stock_threshold)) return false;
      if (status === 'out' && !(p.stock <= 0)) return false;
      if (status === 'expiring' && !(p.stock > 0 && days != null && days >= 0 && days <= 30)) return false;
      if (status === 'expired' && !(p.stock > 0 && days != null && days < 0)) return false;
      if (categoryFilter && String(p.category).toLowerCase() !== categoryFilter.toLowerCase()) return false;
      if (q && String(p.name).toLowerCase().indexOf(q) < 0 && String(p.barcode).toLowerCase().indexOf(q) < 0 && String(p.category).toLowerCase().indexOf(q) < 0 && String(p.size_label || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var dir = sortDir;
    list.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (x == null) x = '';
      if (y == null) y = '';
      if (typeof x === 'string') x = x.toLowerCase();
      if (typeof y === 'string') y = y.toLowerCase();
      if (x < y) return -dir;
      if (x > y) return dir;
      return 0;
    });
    return list;
  }

  function paintInvValue(list) {
    var el = A.$('#invValue');
    if (!el) return;
    var total = 0;
    for (var i = 0; i < list.length; i++) total += Number(list[i].price || 0) * Number(list[i].stock || 0);
    el.textContent = '· Value ' + money(total);
    el.title = 'Total retail value of listed items in Philippine pesos';
  }

  function daysLabel(days) {
    if (days == null) return '';
    if (days < 0) return Math.abs(days) + 'd overdue';
    if (days === 0) return 'expires today';
    if (days === 1) return 'expires tomorrow';
    return days + 'd left';
  }

  function expiryCell(p) {
    if (!p.expiry_date) return '<span class="mute">—</span>';
    var days = expiryDays(p);
    var cls = days != null && days < 0 ? 'down' : days != null && days <= 7 ? 'warn' : days != null && days <= 30 ? '' : 'mute';
    return '<span class="mono ' + cls + '">' + esc(A.fmtDate(p.expiry_date)) + '</span><span class="sub ' + cls + '">' + esc(daysLabel(days)) + '</span>';
  }

  function statusPills(p) {
    var days = expiryDays(p);
    var out = [];
    if (p.stock <= 0) {
      out.push('<span class="pill out">Out</span>');
    } else {
      if (days != null && days < 0) out.push('<span class="pill out">Expired</span>');
      if (p.stock <= p.low_stock_threshold) out.push('<span class="pill low">Low · ' + p.stock + '</span>');
      if (days != null && days >= 0 && days <= 30) {
        out.push('<span class="pill ' + (days <= 7 ? 'urgent' : 'expiring') + '">' +
          (days <= 1 ? 'Expires now' : days <= 7 ? 'Expiring urgent' : 'Expiring') + '</span>');
      }
      if (!out.length) out.push('<span class="pill ok">' + p.stock + '</span>');
    }
    return out.join(' ');
  }

  function render() {
    var list = filtered();
    A.$('#count').textContent = list.length + ' items' + (offlineMode ? ' (cached)' : '');
    paintInvValue(list);
    Array.prototype.forEach.call(document.querySelectorAll('[data-ind]'), function (s) {
      s.textContent = s.getAttribute('data-ind') === sortKey ? (sortDir > 0 ? '▲' : '▼') : '';
    });
    A.$('#body')._products = list;
    body.innerHTML = list.length ? list.map(function (p) {
      var days = expiryDays(p);
      var low = p.stock > 0 && p.stock <= p.low_stock_threshold;
      var warnRow = p.stock <= 0 || low || (days != null && days <= 7);
      return '<tr class="' + (warnRow ? 'row-low' : '') + '"><td><span class="bc"><svg class="jsbarcode" data-code="' + esc(p.barcode) + '" role="img" aria-label="Barcode ' + esc(p.barcode) + '"></svg></span>' +
        '<span class="mono mute" style="font-size:11px">' + esc(p.barcode) + '</span></td>' +
        '<td><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.category) + ' · ' + esc(A.sizeText(p)) + '</span></td>' +
        '<td class="n mono mute">' + money(p.cost_price) + '</td><td class="n mono">' + money(p.price) + '</td>' +
        '<td class="mono"><b>' + p.stock + '</b></td><td>' + expiryCell(p) + '</td>' +
        '<td>' + statusPills(p) + '</td>' +
        '<td><div class="acts">' +
        '<a class="btn sm" href="/edit-product?id=' + p.id + '">Edit</a><button class="btn sm" type="button" data-label="' + p.id + '">Label</button><button class="btn sm danger" type="button" data-del="' + p.id + '" aria-label="Delete ' + esc(p.name) + '">Delete</button>' +
        '</div></td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">No inventory items found' + (offlineMode ? ' in cache' : '') + '.</td></tr>';
    paintBarcodes();
  }

  function renderQueue() {
    if (!window.Sync || !queueList) return;
    window.Sync.getInventoryQueue().then(function (q) {
      if (queueMeta) queueMeta.textContent = q.length ? q.length + ' queued' : '';
      if (!q.length) {
        queueList.innerHTML = '<div class="empty">No queued changes. Offline restocks appear here with Pending / Failed status.</div>';
        return;
      }
      queueList.innerHTML = '<div class="pend-list">' + q.map(function (r) {
        var pill = r.status === 'failed' ? '<span class="pill out">Failed</span>' : '<span class="pill low">Pending</span>';
        var desc = r.type === 'adjust'
          ? 'Set stock to <b>' + r.stock + '</b> · ' + esc(r.name)
          : 'Add <b>+' + r.stock + '</b> · ' + esc(r.name) + ' (' + esc(r.barcode) + ')' +
            (r.size_label ? ' · ' + esc(r.size_label) : '') +
            (r.expiry_date ? ' · expires ' + esc(A.fmtDate(r.expiry_date)) : '');
        var e = r.last_error ? '<div class="mono down" style="font-size:12px">' + esc(r.last_error) + '</div>' : '';
        return '<div class="pend"><div>' + pill + ' <span>' + desc + '</span></div>' + e +
          '<div class="acts">' +
          (r.status === 'failed' ? '<button class="btn sm" type="button" data-retry="' + r.qid + '">Retry</button>' : '') +
          '<button class="btn sm" type="button" data-discard="' + r.qid + '">Discard</button></div></div>';
      }).join('') + '</div>';
    }).catch(function () { /* optional */ });
  }

  async function load() {
    try {
      var r = await A.api('/products');
      all = r.products;
      offlineMode = false;
      if (window.LocalDB) {
        try { await window.LocalDB.saveProducts(all); } catch (e) { /* best-effort */ }
      }
    } catch (e) {
      if (netErr(e) && window.LocalDB) {
        try { all = await window.LocalDB.loadProducts(); } catch (x) { all = []; }
        if (!all.length) throw e;
        offlineMode = true;
        A.toast('Offline — showing cached inventory.', true);
      } else {
        throw e;
      }
    }
    if (A.isOnline()) {
      try {
        var cr = await A.api('/categories');
        activeCategories = (cr.categories || []).map(function (c) { return c.name; });
      } catch (e) { }
    }
    paintCategoryChoices();
    paintBanner();
    render();
    renderQueue();
  }

  async function queueOfflineOp(fields) {
    if (!window.Sync) throw new Error('Offline queue is unavailable in this browser.');
    var rec = await window.Sync.queueInventoryOp({
      type: 'restock',
      barcode: fields.barcode, name: fields.name, category: fields.category,
      cost_price: fields.cost_price, price: fields.price,
      stock: fields.stock, low_stock_threshold: fields.threshold,
      expiry_date: fields.expiry_date || null,
      size_value: fields.size_value, size_unit: fields.size_unit, size_label: fields.size_label
    });
    // Optimistic local update for existing barcodes (prevents oversell display).
    var hit = all.filter(function (p) { return String(p.barcode) === String(fields.barcode); })[0];
    if (hit && window.LocalDB) {
      hit.stock = Number(hit.stock || 0) + Number(fields.stock || 0);
      if (fields.expiry_date) hit.expiry_date = fields.expiry_date;
      if (fields.size_label) {
        hit.size_value = Number(fields.size_value);
        hit.size_unit = fields.size_unit;
        hit.size_label = fields.size_label;
      }
      try { await window.LocalDB.put('products', hit); } catch (e) { /* ignore */ }
      render();
    }
    renderQueue();
    return rec;
  }

  A.$('#chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-s]');
    if (!b) return;
    status = b.dataset.s;
    chips();
    render();
  });
  A.$('#q').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(render, 150); });
  A.$('#catFilter').addEventListener('change', function () {
    categoryFilter = this.value;
    render();
  });
  A.$('#name').addEventListener('input', function () { scheduleSuggestion(); scheduleSizeSuggestion(); });
  A.$('#barcode').addEventListener('input', function () { scheduleSuggestion(); scheduleSizeSuggestion(); });
  A.$('#category').addEventListener('input', function () {
    categoryTouched = this.value.trim() !== '';
    if (categoryTouched) {
      setCategoryHint('Manual category. Automatic suggestions will not replace it.');
    } else {
      setCategoryHint('Leave blank to auto-categorize. Suggestions never replace a category you type.');
      scheduleSuggestion();
    }
  });
  ['sizeValue', 'sizeUnit', 'sizeLabel'].forEach(function (id) {
    A.$('#' + id).addEventListener('input', function () {
      sizeTouched = true;
      if (id !== 'sizeLabel' && !A.$('#sizeValue').value.trim() && !A.$('#sizeUnit').value) {
        A.$('#sizeLabel').value = '';
      }
      setSizeHint('Manual size. Automatic suggestions will not replace it.');
    });
  });
  var genBtn = A.$('#gen');
  if (genBtn) genBtn.addEventListener('click', function () {
    A.$('#barcode').value = genBarcode();
    scheduleSuggestion();
    scheduleSizeSuggestion();
    A.$('#barcode').focus();
  });

  body.addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (del) { askDelete(Number(del.getAttribute('data-del'))); return; }
    var b = e.target.closest('[data-label]');
    if (!b) return;
    var list = A.$('#body')._products || [];
    var found = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === b.getAttribute('data-label')) found = list[i];
    if (found) printLabel(found);
  });
  var invHead = document.querySelector('#invTable thead');
  if (invHead) invHead.addEventListener('click', function (e) {
    var th = e.target.closest('[data-sort]');
    if (!th) return;
    var key = th.getAttribute('data-sort');
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = 1; }
    render();
  });

  function askDelete(id) {
    var list = A.$('#body')._products || [];
    var found = null;
    for (var i = 0; i < list.length; i++) if (Number(list[i].id) === id) found = list[i];
    if (!found) return;
    if (!A.isOnline()) { A.toast('Delete needs a connection.', true); return; }
    var ov = document.createElement('div');
    ov.className = 'overlay open';
    ov.innerHTML = '<div class="sheet" role="alertdialog" aria-modal="true" aria-label="Delete product">' +
      '<h3>Delete product?</h3>' +
      '<p>Remove <b>' + esc(found.name) + '</b> (' + esc(found.barcode) + ') from inventory? Past sales records keep the product name and are not affected. This cannot be undone.</p>' +
      '<div class="mact"><button class="btn" type="button" data-x="cancel">Cancel</button>' +
      '<button class="btn danger" type="button" data-x="yes">Delete</button></div>' +
      '<div class="err" id="delErr"></div></div>';
    document.body.appendChild(ov);
    var done = false;
    function close() { if (!done) { done = true; ov.remove(); } }
    ov.addEventListener('click', function (ev) {
      var x = ev.target.closest('[data-x]');
      if (!x && ev.target !== ov) return;
      if (!x || x.getAttribute('data-x') === 'cancel') { close(); return; }
      x.disabled = true;
      A.api('/products/' + id, { method: 'DELETE', body: {} }).then(function () {
        close();
        A.toast('Deleted ' + found.name);
        load().then(function () {
          if (window.StockAlerts) { try { window.StockAlerts.notifyChanged(); } catch (e) {} }
        }).catch(function () {});
      }).catch(function (ex) {
        var m = ov.querySelector('#delErr');
        if (m) m.textContent = ex.message;
        x.disabled = false;
      });
    });
    document.addEventListener('keydown', function esc2(ev) {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
    });
  }

  var formEl = A.$('#f');
  if (formEl) formEl.addEventListener('submit', async function (e) {
    e.preventDefault();
    err.hidden = true;
    var btn = A.$('#save');
    var sizeInput = readSizeFields();
    if (sizeInput.error) {
      err.textContent = sizeInput.error;
      err.hidden = false;
      setSizeHint(sizeInput.error);
      return;
    }
    btn.disabled = true;
    var imageUrlEl = A.$('#imageUrl');
    var fields = {
      barcode: A.$('#barcode').value, name: A.$('#name').value, category: A.$('#category').value,
      cost_price: A.$('#cost').value, price: A.$('#price').value,
      stock: A.$('#stock').value, threshold: A.$('#threshold').value,
      expiry_date: A.$('#expiry').value,
      size_value: sizeInput.value, size_unit: sizeInput.unit, size_label: sizeInput.label,
      image_url: imageUrlEl ? imageUrlEl.value : ''
    };
    var offlinePayload = {
      barcode: fields.barcode, name: fields.name, category: fields.category,
      cost_price: fields.cost_price, price: fields.price,
      stock: Number(fields.stock || 0), low_stock_threshold: Number(fields.threshold || 5),
      expiry_date: fields.expiry_date || null,
      size_value: fields.size_value, size_unit: fields.size_unit, size_label: fields.size_label,
      image_url: fields.image_url || null
    };
    try {
      if (!A.isOnline()) {
        await queueOfflineOp(offlinePayload);
        A.toast('Saved offline — will sync when online.');
        A.$('#f').reset();
        resetCategoryField();
        resetSizeField();
        A.$('#threshold').value = '5';
        await renderQueue();
      } else {
        try {
          var r = await A.api('/products', {
            body: {
              barcode: fields.barcode, name: fields.name, category: fields.category,
              cost_price: fields.cost_price, price: fields.price,
              stock: fields.stock, low_stock_threshold: fields.threshold,
              expiry_date: fields.expiry_date || null,
              size_value: fields.size_value, size_unit: fields.size_unit, size_label: fields.size_label,
              image_url: fields.image_url || null
            }
          });
          A.toast(r.created ? 'Inventory item added' : 'Inventory item restocked');
          A.$('#f').reset();
          resetCategoryField();
          resetSizeField();
          A.$('#threshold').value = '5';
          await load();
          if (window.StockAlerts) { try { window.StockAlerts.notifyChanged(); } catch (x) {} }
        } catch (ex) {
          if (netErr(ex)) {
            await queueOfflineOp(offlinePayload);
            A.toast('Connection lost — queued for sync.', true);
            A.$('#f').reset();
            resetCategoryField();
            resetSizeField();
            A.$('#threshold').value = '5';
          } else {
            throw ex;
          }
        }
      }
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
    btn.disabled = false;
  });

  var syncBtn = A.$('#syncNow');
  if (syncBtn) syncBtn.addEventListener('click', function () {
    if (!window.Sync) return;
    var b = syncBtn;
    b.disabled = true;
    window.Sync.syncNow().then(function (r) {
      b.disabled = false;
      renderQueue();
      if (r && r.offline) { A.toast('Still offline — kept in queue.', true); return; }
      if (r && (r.synced || r.failed)) {
        A.toast('Sync: ' + r.synced + ' synced, ' + r.failed + ' failed.', r.failed > 0);
        load().catch(function () {});
      } else {
        A.toast('Everything is already synced.');
      }
    }).catch(function (ex) { b.disabled = false; A.toast(ex.message, true); });
  });
  if (queueList) queueList.addEventListener('click', function (e) {
    var retry = e.target.closest('[data-retry]');
    var disc = e.target.closest('[data-discard]');
    if (!window.Sync) return;
    if (retry) {
      window.Sync.retryInventory(Number(retry.getAttribute('data-retry'))).then(function () { renderQueue(); load().catch(function () {}); }).catch(function (ex) { A.toast(ex.message, true); });
    }
    if (disc) {
      if (!window.confirm('Discard this queued change?')) return;
      window.Sync.discardInventory(Number(disc.getAttribute('data-discard'))).then(function () { renderQueue(); load().catch(function () {}); }).catch(function (ex) { A.toast(ex.message, true); });
    }
  });
  function showLoadError(msg) {
    body.innerHTML = '<tr><td colspan="7"><div class="alert">' + esc(msg) + '</div></td></tr>';
  }
  window.addEventListener('online', function () { paintBanner(); load().catch(function (e) { showLoadError(e.message); }); });
  window.addEventListener('offline', function () { paintBanner(); render(); });
  window.addEventListener('sync-changed', function () { renderQueue(); });
  window.addEventListener('app-refresh', function () { load().then(function () { A.noteRefreshed(); }).catch(function () { A.noteRefreshed(); }); });
  // Returning from POS (same-tab back navigation) can restore a stale page:
  // reload so stock is always fresh. Throttled focus refresh covers the rest.
  window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
  var lastFocusLoad = Date.now();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && A.isOnline() && Date.now() - lastFocusLoad > 60000) {
      lastFocusLoad = Date.now();
      load().catch(function () { /* keep current list */ });
    }
  });

  chips();
  paintBanner();
  try {
    await load();
  } catch (e) {
    showLoadError(e.message);
  }
  renderQueue();
  A.reveal(main);
})();
