/* Edit product (replaces edit_product.php). URL: /edit-product?id=5 */
(async function () {
  'use strict';
  var A = App, esc = A.esc;
  var main = await A.mountShell('products');
  if (!main) return;

  var id = parseInt(A.qs('id'), 10);
  if (!id) { location.replace('/products'); return; }

  var p;
  try { p = (await A.api('/products/' + id)).product; }
  catch (e) {
    main.innerHTML = '<div class="panel pad narrow"><div class="alert">' + esc(e.message) + '</div><p style="margin-top:12px"><a class="btn" href="/products">Back to products</a></p></div>';
    return;
  }

  main.innerHTML =
    '<div class="panel pad narrow"><div class="ph"><h2>Edit product</h2><span class="mono mute">' + esc(p.barcode) + '</span></div>' +
    '<div class="bc-preview"><span class="bc"><svg id="bcSvg" data-code="' + esc(p.barcode) + '" role="img" aria-label="Barcode ' + esc(p.barcode) + '"></svg></span>' +
    '<div class="bc-meta"><span class="mono mute">Scannable at POS · CODE128</span><button class="btn sm" id="printBc" type="button">Print label</button></div></div>' +
    '<form id="f" class="stack">' +
    '<label for="name">Product name<input id="name" maxlength="150" required value="' + esc(p.name) + '"></label>' +
    '<label for="category">Category<input id="category" maxlength="60" required value="' + esc(p.category) + '"></label>' +
    '<div class="row2"><label for="cost">Cost price (₱)<input id="cost" type="number" step="0.01" min="0" required value="' + p.cost_price + '"></label>' +
    '<label for="price">Price (₱)<input id="price" type="number" step="0.01" min="0" required value="' + p.price + '"></label></div>' +
    '<div class="row2"><label for="stock">Stock quantity<input id="stock" type="number" step="1" min="0" required value="' + p.stock + '"></label>' +
    '<label for="threshold">Low stock threshold<input id="threshold" type="number" step="1" min="0" required value="' + p.low_stock_threshold + '"></label></div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="save" type="submit">Update product</button>' +
    '<a class="btn wide" href="/products" style="text-align:center">Cancel</a></form></div>';

  try {
    if (window.JsBarcode) {
      window.JsBarcode('#bcSvg', p.barcode, {
        format: 'CODE128', width: 2, height: 60, margin: 8,
        displayValue: true, background: '#ffffff', lineColor: '#000000'
      });
    }
  } catch (e) { /* keep text fallback */ }
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
    try {
      await A.api('/products/' + id, {
        method: 'PUT',
        body: {
          name: A.$('#name').value, category: A.$('#category').value, cost_price: A.$('#cost').value,
          price: A.$('#price').value, stock: A.$('#stock').value, low_stock_threshold: A.$('#threshold').value
        }
      });
      location.href = '/products';
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
  A.reveal(main);
})();
