/* PWA bootstrap: service-worker registration, install prompt, online/offline indicator. */
(function () {
  'use strict';

  var deferredPrompt = null;
  var installedThisSession = false;
  var registration = null;
  var waitingWorker = null;
  var updateNotice = null;
  var lastUpdateCheck = 0;
  var lastOnlineCheck = 0;
  var updateCheckInterval = 60 * 1000;
  var reloading = false;
  var reloaded = false;

  function statusEls() {
    return {
      dot: document.getElementById('netDot'),
      label: document.getElementById('netLabel'),
      install: document.getElementById('pwaInstall')
    };
  }

  function paintOnline() {
    var online = navigator.onLine !== false;
    var els = statusEls();
    try {
      document.body.setAttribute('data-online', online ? 'online' : 'offline');
    } catch (e) { /* ignore */ }
    if (els.dot) {
      els.dot.classList.toggle('off', !online);
    }
    if (els.label) {
      els.label.textContent = online ? 'Online' : 'Offline';
    }
    if (window.Sync) {
      try { window.Sync.refreshBadge(); } catch (e) { /* ignore */ }
    }
  }

  function isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    } catch (e) {
      return false;
    }
  }

  function isIos() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isChromium() {
    var ua = navigator.userAgent || '';
    return /Edg\//.test(ua) || /EdgA\//.test(ua) || /EdgiOS\//.test(ua) ||
      /Chrome\//.test(ua) || /Chromium\//.test(ua);
  }

  function installSupported() {
    if (installedThisSession || isStandalone()) return false;
    if (deferredPrompt) return true;
    // Keep the button visible even before beforeinstallprompt fires. Chromium
    // browsers can install from their menu; iOS uses Share > Add to Home Screen.
    return isChromium() || isIos();
  }

  function installSteps() {
    if (isIos()) {
      return ['Tap the Share button in Safari.', 'Choose Add to Home Screen.', 'Tap Add.'];
    }
    var edge = /Edg\//.test(navigator.userAgent || '');
    return [
      'Open the ' + (edge ? 'Edge' : 'Chrome') + ' menu (' + (edge ? '…' : '⋮') + ').',
      'Choose ' + (edge ? 'Apps > Install this site as an app' : 'Install app') + '.',
      'Confirm Install.'
    ];
  }

  function showInstallHelp() {
    if (document.getElementById('pwaInstallHelp')) return;
    var ov = document.createElement('div');
    ov.className = 'overlay open';
    ov.id = 'pwaInstallHelp';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Install SmartMart');
    var title = document.createElement('h3');
    title.textContent = 'Install SmartMart';
    var note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Install the app for faster offline access and a home-screen icon.';
    var list = document.createElement('ol');
    installSteps().forEach(function (step) {
      var li = document.createElement('li');
      li.textContent = step;
      list.appendChild(li);
    });
    var actions = document.createElement('div');
    actions.className = 'mact';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn primary';
    close.textContent = 'Got it';
    actions.appendChild(close);
    sheet.appendChild(title);
    sheet.appendChild(note);
    sheet.appendChild(list);
    sheet.appendChild(actions);
    ov.appendChild(sheet);
    document.body.appendChild(ov);
    function closeHelp() {
      document.removeEventListener('keydown', onKey);
      ov.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') closeHelp();
    }
    close.addEventListener('click', closeHelp);
    ov.addEventListener('click', function (e) {
      if (e.target === ov) closeHelp();
    });
    document.addEventListener('keydown', onKey);
    close.focus();
  }

  function paintInstall() {
    var els = statusEls();
    var canInstall = installSupported();
    Array.prototype.forEach.call(document.querySelectorAll('[data-pwa-install]'), function (btn) {
      btn.hidden = !canInstall;
    });
    if (els.install) {
      els.install.hidden = !canInstall;
    }
  }

  function watchInstallButtons() {
    if (!window.MutationObserver || !document.body) return;
    var observer = new window.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if ((node.matches && node.matches('[data-pwa-install]')) ||
              (node.querySelector && node.querySelector('[data-pwa-install]'))) {
            paintInstall();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function cartHasItems() {
    if (window.CartStore && typeof window.CartStore.load === 'function') {
      try { return window.CartStore.load().length > 0; } catch (e) { return false; }
    }
    try {
      var raw = localStorage.getItem('cstore_cart_v1');
      if (!raw) return false;
      var cart = JSON.parse(raw);
      return Array.isArray(cart) && cart.length > 0;
    } catch (e) {
      return false;
    }
  }

  function isPosPage() {
    var path = location.pathname;
    return path === '/pos' || path === '/cashier' || path === '/html/pos.html';
  }

  function isSafeToReload() {
    if (window.POSState && typeof window.POSState.hasActiveSale === 'function') {
      try { if (window.POSState.hasActiveSale()) return false; } catch (e) { /* ignore */ }
    }
    if (isPosPage() && cartHasItems()) return false;
    return true;
  }

  function updateNoticeEls() {
    if (!updateNotice) return null;
    return {
      button: updateNotice.querySelector('#pwaUpdateNow'),
      note: updateNotice.querySelector('#pwaUpdateNote')
    };
  }

  function ensureUpdateNotice() {
    if (updateNotice && document.body && document.body.contains(updateNotice)) return updateNotice;
    if (!document.body) return null;
    var el = document.createElement('div');
    el.id = 'pwaUpdateNotice';
    el.className = 'panel';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    el.style.cssText = 'position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:45;width:min(540px,calc(100vw - 24px));display:none;gap:12px 16px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:14px 16px;text-align:left;background:var(--panel-solid);border:1px solid var(--cyan);box-shadow:0 20px 60px rgba(0,0,0,.55),0 0 30px rgba(32,217,245,.18)';
    el.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 240px">' +
      '<b style="font-family:var(--font-d);font-size:14px;letter-spacing:.02em">SmartMart update available</b>' +
      '<span style="font-size:12px;line-height:1.4;color:var(--mute)">A new version is ready. Reload SmartMart to apply the update.</span>' +
      '<span id="pwaUpdateNote" style="font-size:12px;line-height:1.4;color:var(--warn)" hidden></span>' +
      '</div>' +
      '<button class="btn primary" id="pwaUpdateNow" type="button">UPDATE NOW</button>';
    document.body.appendChild(el);
    updateNotice = el;
    var btn = el.querySelector('#pwaUpdateNow');
    if (btn) btn.addEventListener('click', applyUpdate);
    return el;
  }

  function paintUpdateNote() {
    var els = updateNoticeEls();
    if (!els || !els.note || !updateNotice || updateNotice.hidden) return;
    if (isSafeToReload()) {
      els.note.textContent = '';
      els.note.hidden = true;
    } else {
      els.note.textContent = 'Finish or clear the current sale before updating.';
      els.note.hidden = false;
    }
  }

  function showUpdateNotice(worker) {
    waitingWorker = worker || (registration && registration.waiting) || null;
    var el = ensureUpdateNotice();
    if (!el) return;
    el.hidden = false;
    el.style.display = 'flex';
    var els = updateNoticeEls();
    if (els.button && !reloading) {
      els.button.disabled = false;
      els.button.textContent = 'UPDATE NOW';
    }
    paintUpdateNote();
  }

  function hideUpdateNotice() {
    if (!updateNotice) return;
    updateNotice.hidden = true;
    updateNotice.style.display = 'none';
  }

  function onControllerChange() {
    if (!reloading) {
      waitingWorker = null;
      hideUpdateNotice();
      return;
    }
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  }

  function applyUpdate() {
    if (reloading) return;
    if (!isSafeToReload()) {
      paintUpdateNote();
      return;
    }
    var worker = waitingWorker || (registration && registration.waiting);
    if (!worker) {
      hideUpdateNotice();
      return;
    }
    reloading = true;
    reloaded = false;
    var els = updateNoticeEls();
    if (els.button) {
      els.button.disabled = true;
      els.button.textContent = 'UPDATING...';
    }
    if (els.note) {
      els.note.textContent = '';
      els.note.hidden = true;
    }
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch (e) {
      reloading = false;
      if (els.button) {
        els.button.disabled = false;
        els.button.textContent = 'UPDATE NOW';
      }
      if (els.note) {
        els.note.textContent = 'Could not apply the update. Try reloading the page.';
        els.note.hidden = false;
      }
    }
  }

  function handleWaitingWorker(worker) {
    if (!worker || !navigator.serviceWorker.controller) return;
    showUpdateNotice(worker);
  }

  function checkForUpdate(force) {
    if (!registration || typeof registration.update !== 'function' || !navigator.onLine) {
      return Promise.resolve(false);
    }
    var now = Date.now();
    if (!force && now - lastUpdateCheck < updateCheckInterval) return Promise.resolve(false);
    lastUpdateCheck = now;
    try {
      return registration.update().then(function () {
        if (registration.waiting && navigator.serviceWorker.controller) {
          handleWaitingWorker(registration.waiting);
        }
        return true;
      }).catch(function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function promptInstall() {
    if (!deferredPrompt) {
      showInstallHelp();
      return Promise.resolve(false);
    }
    var prompt = deferredPrompt;
    try {
      prompt.prompt();
      return prompt.userChoice.then(function (choice) {
        deferredPrompt = null;
        paintInstall();
        return choice && choice.outcome === 'accepted';
      }).catch(function () {
        deferredPrompt = null;
        paintInstall();
        return false;
      });
    } catch (e) {
      deferredPrompt = null;
      paintInstall();
      showInstallHelp();
      return Promise.resolve(false);
    }
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      // Register immediately: waiting for window.load delays offline caching and
      // can prevent beforeinstallprompt from firing on slow or blocked fonts.
      registration = navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (e) {
      return;
    }
    registration.then(function (reg) {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) handleWaitingWorker(reg.waiting);
      if (reg && reg.addEventListener) {
        reg.addEventListener('updatefound', function () {
          var worker = reg.installing;
          if (!worker || !worker.addEventListener) return;
          worker.addEventListener('statechange', function () {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              handleWaitingWorker(worker);
            }
          });
        });
      }
      // Throttled checks when the app is opened, focused, or reconnects.
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) checkForUpdate(false);
      });
      if (navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function () {
          paintInstall();
          checkForUpdate(true);
        }).catch(function () { /* ignore */ });
      }
    }).catch(function () { /* offline-first is best-effort */ });
  }

  function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    }
    registerSW();
    window.addEventListener('online', function () {
      paintOnline();
      var now = Date.now();
      if (now - lastOnlineCheck > 10000) {
        lastOnlineCheck = now;
        checkForUpdate(true);
      }
    });
    window.addEventListener('offline', paintOnline);
    window.addEventListener('cart-changed', paintUpdateNote);
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      paintInstall();
    });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      installedThisSession = true;
      paintInstall();
      if (window.App) {
        try { window.App.toast('App installed — find it on your home screen.'); } catch (e) { /* ignore */ }
      }
    });
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-pwa-install]') : null;
      if (b) {
        e.preventDefault();
        promptInstall();
      }
    });
    document.addEventListener('DOMContentLoaded', function () {
      paintOnline();
      paintInstall();
    });
    paintOnline();
    paintInstall();
    watchInstallButtons();
  }

  window.PWA = {
    promptInstall: promptInstall,
    paintOnline: paintOnline,
    paintInstall: paintInstall,
    getInstallable: function () { return !!deferredPrompt; }
  };

  init();
})();
