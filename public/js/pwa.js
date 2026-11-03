/* PWA bootstrap: service-worker registration, install prompt, online/offline indicator. */
(function () {
  'use strict';

  var deferredPrompt = null;
  var installedThisSession = false;

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
    var registration;
    try {
      // Register immediately: waiting for window.load delays offline caching and
      // can prevent beforeinstallprompt from firing on slow or blocked fonts.
      registration = navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (e) {
      return;
    }
    registration.then(function (reg) {
      // Check for updates when the page becomes visible.
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && reg && typeof reg.update === 'function') {
          try { reg.update(); } catch (e) { /* ignore */ }
        }
      });
      if (reg && reg.addEventListener) {
        reg.addEventListener('updatefound', function () { /* new SW will activate on next load */ });
      }
      if (navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function () { paintInstall(); }).catch(function () { /* ignore */ });
      }
    }).catch(function () { /* offline-first is best-effort */ });
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
