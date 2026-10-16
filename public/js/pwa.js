/* PWA bootstrap: service-worker registration, install prompt, online/offline indicator. */
(function () {
  'use strict';

  var deferredPrompt = null;

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

  function paintInstall() {
    var els = statusEls();
    var standalone = false;
    try {
      standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    } catch (e) { /* ignore */ }
    // Show the Install button only when the browser offers a prompt and we are not installed.
    Array.prototype.forEach.call(document.querySelectorAll('[data-pwa-install]'), function (btn) {
      btn.hidden = !(deferredPrompt && !standalone);
    });
    if (els.install) {
      els.install.hidden = !(deferredPrompt && !standalone);
    }
  }

  function promptInstall() {
    if (!deferredPrompt) {
      if (window.App) {
        try { window.App.toast('Use your browser menu → Install / Add to Home Screen.'); } catch (e) { /* ignore */ }
      }
      return Promise.resolve(false);
    }
    try {
      deferredPrompt.prompt();
      return deferredPrompt.userChoice.then(function (choice) {
        deferredPrompt = null;
        paintInstall();
        return choice && choice.outcome === 'accepted';
      }).catch(function () {
        deferredPrompt = null;
        paintInstall();
        return false;
      });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (reg) {
        // Check for updates when the page becomes visible.
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden && reg && typeof reg.update === 'function') {
            try { reg.update(); } catch (e) { /* ignore */ }
          }
        });
        if (reg && reg.addEventListener) {
          reg.addEventListener('updatefound', function () { /* new SW will activate on next load */ });
        }
      }).catch(function () { /* offline-first is best-effort */ });
    });
  }

  function init() {
    registerSW();
    window.addEventListener('online', paintOnline);
    window.addEventListener('offline', paintOnline);
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      paintInstall();
    });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
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
  }

  window.PWA = {
    promptInstall: promptInstall,
    paintOnline: paintOnline,
    getInstallable: function () { return !!deferredPrompt; }
  };

  init();
})();
