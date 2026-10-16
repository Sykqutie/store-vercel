/* Shared POS cart: the POS page owns the cart. Stored locally; stock is
   always revalidated against the server at checkout. */
(function () {
  'use strict';

  var KEY = 'cstore_cart_v1';

  // [{ id, qty }] — drops anything malformed so a bad write can never poison it.
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var id = Number(arr[i] && arr[i].id);
        var qty = Number(arr[i] && arr[i].qty);
        if (id > 0 && qty > 0 && isFinite(id) && isFinite(qty)) {
          out.push({ id: Math.floor(id), qty: Math.floor(qty) });
        }
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function save(cart) {
    try {
      localStorage.setItem(KEY, JSON.stringify(cart || []));
    } catch (e) { /* private mode: cart simply won't persist */ }
    try {
      window.dispatchEvent(new window.CustomEvent('cart-changed'));
    } catch (e) { /* ignore */ }
  }

  function clear() {
    save([]);
  }

  function count(cart) {
    var list = cart || load();
    var n = 0;
    for (var i = 0; i < list.length; i++) n += Number(list[i].qty) || 0;
    return n;
  }

  window.CartStore = { load: load, save: save, clear: clear, count: count };
})();
