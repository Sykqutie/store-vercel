'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const pwaSource = fs.readFileSync(path.join(root, 'public', 'js', 'pwa.js'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');

function matchSelector(el, selector) {
  if (selector[0] === '#') return el.id === selector.slice(1);
  if (selector === '[data-pwa-install]') return Object.prototype.hasOwnProperty.call(el.attributes, 'data-pwa-install');
  return false;
}

class FakeStyle {
  constructor() {
    this._css = '';
    this.display = '';
  }
  set cssText(value) {
    this._css = value;
    const display = /display\s*:\s*([^;]+)/.exec(value);
    this.display = display ? display[1].trim() : '';
  }
  get cssText() {
    return this._css;
  }
}

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.style = new FakeStyle();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.className = '';
    this.id = '';
    this.dataset = {};
    this._innerHTML = '';
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter((item) => item !== fn);
  }
  dispatchEvent(event) {
    (this.listeners[event.type] || []).slice().forEach((fn) => fn.call(this, event));
    return true;
  }
  focus() {}
  matches(selector) {
    return matchSelector(this, selector);
  }
  walk(callback) {
    for (const child of this.children) {
      callback(child);
      child.walk(callback);
    }
  }
  querySelectorAll(selector) {
    const found = [];
    this.walk((el) => {
      if (matchSelector(el, selector)) found.push(el);
    });
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    const re = /id="([^"]+)"/g;
    let match;
    while ((match = re.exec(value))) {
      const child = new FakeElement('span', this.ownerDocument);
      child.setAttribute('id', match[1]);
      this.appendChild(child);
    }
  }
  get innerHTML() {
    return this._innerHTML;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document', null);
    this.ownerDocument = this;
    this.hidden = false;
    this.body = new FakeElement('body', this);
  }
  createElement(tag) {
    return new FakeElement(tag, this);
  }
  getElementById(id) {
    return this.body.querySelector('#' + id);
  }
  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
  querySelector(selector) {
    return this.body.querySelector(selector);
  }
}

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settle() {
  await flush();
  await flush();
  await flush();
}

function createEnvironment(options) {
  const opts = options || {};
  const document = new FakeDocument();
  const messages = [];
  const state = {
    reloads: 0,
    updateCalls: 0,
    cartItems: (opts.cart || []).map((item) => Object.assign({}, item)),
    busy: !!opts.busy,
    online: opts.online !== false,
    pathname: opts.pathname || '/dashboard',
    controller: opts.controller !== false
  };
  const windowListeners = {};
  const swListeners = {};
  const registrationListeners = {};

  const registration = {
    waiting: null,
    installing: null,
    update() {
      state.updateCalls += 1;
      return Promise.resolve();
    },
    addEventListener(type, fn) {
      (registrationListeners[type] = registrationListeners[type] || []).push(fn);
    },
    dispatchEvent(event) {
      (registrationListeners[event.type] || []).slice().forEach((fn) => fn.call(registration, event));
    }
  };

  const serviceWorker = {
    controller: state.controller ? { state: 'activated' } : null,
    ready: Promise.resolve(registration),
    register() {
      return Promise.resolve(registration);
    },
    addEventListener(type, fn) {
      (swListeners[type] = swListeners[type] || []).push(fn);
    },
    dispatchEvent(type) {
      (swListeners[type] || []).slice().forEach((fn) => fn({ type }));
    }
  };

  const navigator = {
    onLine: state.online,
    userAgent: 'test-agent',
    platform: 'test-platform',
    maxTouchPoints: 0,
    serviceWorker
  };

  const location = {
    pathname: state.pathname,
    reload() {
      state.reloads += 1;
    }
  };

  const localStorage = {
    _data: {},
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
    },
    setItem(key, value) {
      this._data[key] = String(value);
    }
  };

  const sandbox = {
    document,
    navigator,
    location,
    localStorage,
    MutationObserver: FakeMutationObserver,
    CustomEvent: class FakeCustomEvent {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    Promise,
    setTimeout,
    clearTimeout,
    console,
    matchMedia() {
      return { matches: false };
    },
    addEventListener(type, fn) {
      (windowListeners[type] = windowListeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      if (windowListeners[type]) windowListeners[type] = windowListeners[type].filter((item) => item !== fn);
    },
    dispatchEvent(event) {
      (windowListeners[event.type] || []).slice().forEach((fn) => fn.call(sandbox, event));
      return true;
    }
  };
  sandbox.window = sandbox;

  if (opts.useCartStore !== false) {
    sandbox.CartStore = {
      load() {
        return state.cartItems;
      }
    };
  } else if (state.cartItems.length) {
    localStorage.setItem('cstore_cart_v1', JSON.stringify(state.cartItems));
  }

  if (opts.usePosState !== false) {
    sandbox.POSState = {
      hasActiveSale() {
        return state.busy || state.cartItems.length > 0;
      }
    };
  }

  function makeWorker(workerState) {
    const workerListeners = {};
    const worker = {
      state: workerState || 'installed',
      addEventListener(type, fn) {
        (workerListeners[type] = workerListeners[type] || []).push(fn);
      },
      dispatchEvent(event) {
        (workerListeners[event.type] || []).slice().forEach((fn) => fn.call(worker, event));
      },
      postMessage(message) {
        messages.push(message);
        if (message && message.type === 'SKIP_WAITING') {
          registration.waiting = null;
          serviceWorker.dispatchEvent('controllerchange');
        }
      }
    };
    return worker;
  }

  const env = {
    sandbox,
    document,
    registration,
    serviceWorker,
    navigator,
    state,
    messages,
    makeWorker,
    notice() {
      return document.getElementById('pwaUpdateNotice');
    },
    fireWindow(type) {
      sandbox.dispatchEvent({ type });
    },
    fireDocument(type) {
      document.dispatchEvent({ type });
    },
    setOnline(value) {
      state.online = value;
      navigator.onLine = value;
    },
    async boot(waitingState) {
      if (waitingState) registration.waiting = makeWorker(waitingState);
      vm.runInNewContext(pwaSource, sandbox, { filename: 'public/js/pwa.js' });
      await settle();
      return env;
    }
  };
  return env;
}

test('no waiting worker means no update notification and no reload', async () => {
  const env = await createEnvironment().boot();
  assert.equal(env.notice(), null);
  assert.equal(env.state.reloads, 0);
  assert.equal(env.messages.length, 0);
});

test('a waiting worker shows the update notification for any role', async () => {
  const env = await createEnvironment().boot('installed');
  const notice = env.notice();
  assert.ok(notice, 'notification exists');
  assert.equal(notice.hidden, false);
  assert.equal(notice.style.display, 'flex');
  assert.match(notice.innerHTML, /SmartMart update available/);
  assert.match(notice.innerHTML, /A new version is ready\. Reload SmartMart to apply the update\./);
  const button = notice.querySelector('#pwaUpdateNow');
  assert.equal(button.textContent, 'UPDATE NOW');
  assert.equal(env.state.reloads, 0, 'detection never reloads automatically');
});

test('a waiting worker on a first install without a controller is ignored', async () => {
  const env = await createEnvironment({ controller: false }).boot('installed');
  assert.equal(env.notice(), null);
  assert.equal(env.state.reloads, 0);
});

test('updatefound detects an installed worker that is waiting to activate', async () => {
  const env = await createEnvironment().boot();
  assert.equal(env.notice(), null);
  const worker = env.makeWorker('installing');
  env.registration.installing = worker;
  env.registration.dispatchEvent({ type: 'updatefound' });
  worker.state = 'installed';
  worker.dispatchEvent({ type: 'statechange' });
  await settle();
  assert.ok(env.notice());
  assert.equal(env.notice().hidden, false);
});

test('UPDATE NOW activates the waiting worker once and reloads once', async () => {
  const env = await createEnvironment().boot('installed');
  const button = env.notice().querySelector('#pwaUpdateNow');
  button.dispatchEvent({ type: 'click', target: button });
  await settle();
  assert.deepEqual(env.messages.map((message) => message.type), ['SKIP_WAITING']);
  assert.equal(env.state.reloads, 1);
  button.dispatchEvent({ type: 'click', target: button });
  await settle();
  assert.equal(env.messages.length, 1, 'a second click must not post again');
  assert.equal(env.state.reloads, 1, 'a controller change must not reload twice');
});

test('UPDATE NOW is deferred while a POS cart contains items', async () => {
  const env = await createEnvironment({ pathname: '/pos', cart: [{ id: 7, qty: 2 }] }).boot('installed');
  const notice = env.notice();
  assert.ok(notice);
  const button = notice.querySelector('#pwaUpdateNow');
  const note = notice.querySelector('#pwaUpdateNote');
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /Finish or clear the current sale/);

  button.dispatchEvent({ type: 'click', target: button });
  await settle();
  assert.equal(env.messages.length, 0, 'unsafe update must not activate the worker');
  assert.equal(env.state.reloads, 0);

  env.state.cartItems = [];
  env.fireWindow('cart-changed');
  await settle();
  assert.equal(note.hidden, true);

  button.dispatchEvent({ type: 'click', target: button });
  await settle();
  assert.equal(env.messages.length, 1);
  assert.equal(env.state.reloads, 1);
});

test('UPDATE NOW is deferred while checkout is in progress even with an empty cart', async () => {
  const env = await createEnvironment({ pathname: '/pos', busy: true }).boot('installed');
  const notice = env.notice();
  const button = notice.querySelector('#pwaUpdateNow');
  button.dispatchEvent({ type: 'click', target: button });
  await settle();
  assert.equal(env.messages.length, 0);
  assert.equal(env.state.reloads, 0);
  assert.equal(notice.querySelector('#pwaUpdateNote').hidden, false);
});

test('reconnecting triggers one throttled update check', async () => {
  const env = await createEnvironment().boot();
  const afterOpen = env.state.updateCalls;
  assert.ok(afterOpen >= 1, 'checks for an update when the app opens');
  env.fireWindow('online');
  await settle();
  assert.equal(env.state.updateCalls, afterOpen + 1);
  env.fireWindow('online');
  await settle();
  assert.equal(env.state.updateCalls, afterOpen + 1, 'repeated online events are throttled');
});

test('offline startup skips update checks until the app reconnects', async () => {
  const env = await createEnvironment({ online: false }).boot();
  assert.equal(env.state.updateCalls, 0);
  env.setOnline(true);
  env.fireWindow('online');
  await settle();
  assert.equal(env.state.updateCalls, 1);
});

test('service worker keeps skipWaiting behind the controlled message and never caches API responses', () => {
  assert.match(swSource, /store-pos-v30/);
  const skipWaitingCalls = swSource.match(/self\.skipWaiting\(\)/g) || [];
  assert.equal(skipWaitingCalls.length, 1, 'only the explicit message may call skipWaiting');
  assert.match(swSource, /event\.data\.type === 'SKIP_WAITING'[\s\S]*self\.skipWaiting\(\)/);
  assert.match(swSource, /if \(isApi\(url\)\) return;/);
  const installBlock = /addEventListener\('install'[\s\S]*?\n\}\);/.exec(swSource);
  assert.ok(installBlock);
  assert.doesNotMatch(installBlock[0], /skipWaiting/);
});

test('the page only reloads from controllerchange, never from update detection', () => {
  const reloads = pwaSource.match(/location\.reload\(\)/g) || [];
  assert.equal(reloads.length, 1);
  assert.match(pwaSource, /addEventListener\('controllerchange', onControllerChange\)/);
});
