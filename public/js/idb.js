/* Offline storage (IndexedDB): cached products, pending sales, inventory queue. No dependencies. */
(function () {
  'use strict';

  var DB_NAME = 'cstore-pos-v1';
  var VERSION = 1;

  function open() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      var req = window.indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pending_sales')) {
          var ps = db.createObjectStore('pending_sales', { keyPath: 'client_sale_id' });
          ps.createIndex('by-created', 'created_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('inventory_queue')) {
          var iq = db.createObjectStore('inventory_queue', { keyPath: 'qid', autoIncrement: true });
          iq.createIndex('by-created', 'created_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open offline database.')); };
      req.onblocked = function () { reject(new Error('Offline database is blocked. Close other tabs and retry.')); };
    });
  }

  var dbp = null;
  function db() {
    if (!dbp) dbp = open();
    return dbp;
  }

  function run(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode);
        var st = t.objectStore(store);
        var out;
        try {
          out = fn(st);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error || new Error('Offline database error.')); };
        t.onabort = function () { reject(t.error || new Error('Offline database error.')); };
      });
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Offline database error.')); };
    });
  }

  function all(store) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, 'readonly');
        var st = t.objectStore(store);
        var out = [];
        var cursor = st.openCursor();
        cursor.onsuccess = function () {
          var c = cursor.result;
          if (c) {
            out.push(c.value);
            c.continue();
          } else {
            resolve(out);
          }
        };
        cursor.onerror = function () { reject(cursor.error || new Error('Offline database error.')); };
      });
    });
  }

  function get(store, key) {
    return db().then(function (d) {
      return reqToPromise(d.transaction(store, 'readonly').objectStore(store).get(key));
    });
  }

  function put(store, val) {
    return db().then(function (d) {
      return reqToPromise(d.transaction(store, 'readwrite').objectStore(store).put(val));
    });
  }

  function del(store, key) {
    return db().then(function (d) {
      return reqToPromise(d.transaction(store, 'readwrite').objectStore(store).delete(key));
    });
  }

  function clearStore(store) {
    return db().then(function (d) {
      return reqToPromise(d.transaction(store, 'readwrite').objectStore(store).clear());
    });
  }

  function saveProducts(products) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(['products', 'meta'], 'readwrite');
        t.objectStore('products').clear();
        var ps = t.objectStore('products');
        (products || []).forEach(function (p) { ps.put(p); });
        t.objectStore('meta').put({ key: 'products_cached_at', value: new Date().toISOString(), count: (products || []).length });
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { reject(t.error || new Error('Could not cache products.')); };
      });
    });
  }

  function loadProducts() {
    return all('products').then(function (rows) {
      rows.sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      return rows;
    });
  }

  function getMeta(key) {
    return get('meta', key).then(function (r) { return r ? r.value : null; });
  }

  function setMeta(key, value) {
    return put('meta', { key: key, value: value });
  }

  function uuid(prefix) {
    var id;
    try {
      if (window.crypto && window.crypto.randomUUID) {
        id = window.crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      } else {
        id = 'xxxxxxxxxxxxxxxxxxxx'.replace(/x/g, function () {
          return Math.floor(Math.random() * 36).toString(36);
        });
      }
    } catch (e) {
      id = String(Date.now().toString(36)) + String(Math.floor(Math.random() * 1e9).toString(36));
    }
    return (prefix || 'off') + '_' + Date.now().toString(36) + '_' + id;
  }

  // Adjust cached stock levels immediately after an offline sale so the
  // POS cannot oversell while offline. Rolls back on sync conflicts.
  function decStock(items) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction('products', 'readwrite');
        var st = t.objectStore('products');
        var pending = items.length;
        if (!pending) { resolve(true); return; }
        items.forEach(function (it) {
          var g = st.get(it.id);
          g.onsuccess = function () {
            var p = g.result;
            if (p) {
              p.stock = Math.max(0, Number(p.stock || 0) - Number(it.qty || 0));
              st.put(p);
            }
            if (--pending === 0) resolve(true);
          };
          g.onerror = function () { reject(g.error || new Error('Could not update cached stock.')); };
        });
        t.onerror = function () { reject(t.error || new Error('Could not update cached stock.')); };
      });
    });
  }

  window.LocalDB = {
    open: db,
    all: all,
    get: get,
    put: put,
    del: del,
    clearStore: clearStore,
    saveProducts: saveProducts,
    loadProducts: loadProducts,
    getMeta: getMeta,
    setMeta: setMeta,
    uuid: uuid,
    decStock: decStock,
    _run: run
  };
})();
