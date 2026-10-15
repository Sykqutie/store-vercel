/* Inventory (replaces product.php): add or restock on the left, inventory table on the right. */
(async function () {
  'use strict';
  var A = App, esc = A.esc, money = A.money;
  var main = await A.mountShell('products');
  if (!main) return;

  var status = A.qs('status') === 'low' ? 'low' : A.qs('status') === 'out' ? 'out' : '';
  var timer;

  main.innerHTML =
    '<div class="two">' +
    '<div class="panel pad"><div class="ph"><h2>Add / restock inventory item</h2></div>' +
    '<form id="f" class="stack">' +
    '<label for="barcode">Barcode<span class="bc-row"><input id="barcode" maxlength="64" required style="flex:1;min-width:0"><button class="btn sm" id="gen" type="button" title="Generate a scannable barcode">Generate</button></span></label>' +
    '<label for="name">Item name<input id="name" maxlength="150" required></label>' +
    '<label for="category">Category<input id="category" maxlength="60" value="General" required></label>' +
    '<div class="row2"><label for="cost">Cost price (₱)<input id="cost" type="number" step="0.01" min="0" required></label>' +
    '<label for="price">Selling price (₱)<input id="price" type="number" step="0.01" min="0" required></label></div>' +
    '<div class="row2"><label for="stock">Quantity to add<input id="stock" type="number" step="1" min="0" required></label>' +
    '<label for="threshold">Low stock alert at<input id="threshold" type="number" step="1" min="0" value="5" required></label></div>' +
    '<div class="note">Saving an existing barcode adds the quantity to its stock and updates the details.</div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="save" type="submit">Save inventory item</button></form></div>' +
    '<div class="panel pad"><div class="ph"><h2>Inventory</h2><span class="mono mute" id="count"></span></div>' +
    '<div class="toolbar"><input id="q" type="search" placeholder="Search name, barcode or category" aria-label="Search inventory">' +
    '<div class="chips" id="chips"></div></div>' +
    '<div class="tw"><table><thead><tr><th>Barcode (scan)</th><th>Name</th><th class="n">Cost</th><th class="n">Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody id="body"></tbody></table></div></div></div>';

  var body = A.$('#body'), err = A.$('#err');

  function chips() {
    A.$('#chips').innerHTML = [['', 'All'], ['low', 'Low stock'], ['out', 'Out of stock']].map(function (c) {
      return '<button class="chip" type="button" data-s="' + c[0] + '" aria-pressed="' + (status === c[0]) + '">' + c[1] + '</button>';
    }).join('');
  }

  function paintBarcodes() {
    if (!window.JsBarcode) return;
    Array.prototype.forEach.call(body.querySelectorAll('svg.jsbarcode'), function (svg) {
      try {
        window.JsBarcode(svg, svg.getAttribute('data-code'), {
          format: 'CODE128', width: 1.6, height: 44, margin: 6,
          displayValue: false, background: '#ffffff', lineColor: '#000000'
        });
      } catch (e) {
        var span = document.createElement('span');
        span.className = 'mono';
        span.textContent = svg.getAttribute('data-code');
        svg.replaceWith(span);
      }
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
      '<h3>' + name + '</h3><div class="meta">' + esc(p.barcode) + ' · ' + esc(A.money(p.price)) + '</div>' +
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

  async function load() {
    var url = '/products?status=' + status + '&q=' + encodeURIComponent(A.$('#q').value.trim());
    try {
      var r = await A.api(url);
      A.$('#count').textContent = r.products.length + ' items';
      A.$('#body')._products = r.products;
      body.innerHTML = r.products.length ? r.products.map(function (p) {
        var low = p.stock <= p.low_stock_threshold;
        var badge = p.stock <= 0 ? '<span class="pill out">Out of stock</span>'
          : low ? '<span class="pill low">Low · ' + p.stock + '</span>'
          : '<span class="pill ok">' + p.stock + '</span>';
        return '<tr class="' + (low ? 'row-low' : '') + '"><td><span class="bc"><svg class="jsbarcode" data-code="' + esc(p.barcode) + '" role="img" aria-label="Barcode ' + esc(p.barcode) + '"></svg></span>' +
          '<span class="mono mute" style="font-size:11px">' + esc(p.barcode) + '</span></td>' +
          '<td><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.category) + '</span></td>' +
          '<td class="n mono mute">' + money(p.cost_price) + '</td><td class="n mono">' + money(p.price) + '</td>' +
          '<td class="mono"><b>' + p.stock + '</b></td><td>' + badge + '</td>' +
          '<td><div class="acts"><a class="btn sm" href="/edit-product?id=' + p.id + '">Edit</a><button class="btn sm" type="button" data-label="' + p.id + '">Label</button></div></td></tr>';
      }).join('') : '<tr><td colspan="7" class="empty">No inventory items found.</td></tr>';
      paintBarcodes();
    } catch (e) {
      body.innerHTML = '<tr><td colspan="7"><div class="alert">' + esc(e.message) + '</div></td></tr>';
    }
  }

  A.$('#chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-s]');
    if (!b) return;
    status = b.dataset.s;
    chips();
    load();
  });
  A.$('#q').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 250); });
  A.$('#gen').addEventListener('click', function () { A.$('#barcode').value = genBarcode(); A.$('#barcode').focus(); });
  body.addEventListener('click', function (e) {
    var b = e.target.closest('[data-label]');
    if (!b) return;
    var list = A.$('#body')._products || [];
    var found = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === b.getAttribute('data-label')) found = list[i];
    if (found) printLabel(found);
  });

  A.$('#f').addEventListener('submit', async function (e) {
    e.preventDefault();
    err.hidden = true;
    var btn = A.$('#save');
    btn.disabled = true;
    try {
      var r = await A.api('/products', {
        body: {
          barcode: A.$('#barcode').value, name: A.$('#name').value, category: A.$('#category').value,
          cost_price: A.$('#cost').value, price: A.$('#price').value,
          stock: A.$('#stock').value, low_stock_threshold: A.$('#threshold').value
        }
      });
      A.toast(r.created ? 'Inventory item added' : 'Inventory item restocked');
      A.$('#f').reset();
      A.$('#category').value = 'General';
      A.$('#threshold').value = '5';
      await load();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
    btn.disabled = false;
  });

  chips();
  await load();
  A.reveal(main);
})();
