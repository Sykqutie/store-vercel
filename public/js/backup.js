/* Backup & Restore (owner only): create, download, delete, and restore data backups. */
(function () {
  'use strict';
  var A = App, esc = A.esc;

  function fmtSize(n) {
    n = Number(n || 0);
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function countsText(c) {
    if (!c) return '';
    return 'users ' + (c.users || 0) + ' · products ' + (c.products || 0) +
      ' · sales ' + (c.sales || 0) + ' · items ' + (c.sale_items || 0) +
      ' · movements ' + (c.stock_movements || 0);
  }

  function modal(title, bodyHtml, okLabel, onOk) {
    var ov = document.createElement('div');
    ov.className = 'overlay open';
    ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<h3>' + esc(title) + '</h3><div class="stack">' + bodyHtml + '<div class="err" id="mErr"></div></div>' +
      '<div class="mact"><button class="btn" type="button" data-x="cancel">Cancel</button>' +
      '<button class="btn primary" type="button" data-x="yes">' + esc(okLabel) + '</button></div></div>';
    document.body.appendChild(ov);
    var done = false;
    function close() { if (!done) { done = true; ov.remove(); } }
    ov.addEventListener('click', function (ev) {
      var x = ev.target.closest('[data-x]');
      if (!x && ev.target !== ov) return;
      if (!x || x.getAttribute('data-x') === 'cancel') { close(); return; }
      x.disabled = true;
      Promise.resolve(onOk(ov)).then(function (ok) {
        if (ok !== false) close();
        else x.disabled = false;
      }).catch(function (ex) {
        var m = ov.querySelector('#mErr');
        if (m) m.textContent = ex.message;
        x.disabled = false;
      });
    });
    document.addEventListener('keydown', function esc2(ev) {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
    });
    var f = ov.querySelector('input,select');
    if (f) f.focus();
  }

  function status(msg, bad) {
    var box = document.getElementById('bkStatus');
    if (!box) return;
    if (!msg) { box.innerHTML = ''; box.hidden = true; return; }
    box.innerHTML = '<div class="alert' + (bad ? '' : ' info') + '">' + esc(msg) + '</div>';
    box.hidden = false;
  }

  var cache = { backups: [], latest: null, ephemeral: false, persistent: false, uploadLimit: 0, storage: null, auto: null };

  function applyStorageState() {
    var blocked = !!(cache.storage && cache.storage.mode === 'unconfigured');
    ['#bkCreate', '#bkDownloadLatest', '#bkRestore', '#restoreUpload'].forEach(function (sel) {
      var el = A.$(sel);
      if (el) el.disabled = blocked;
    });
  }

  async function load() {
    var body = A.$('#bkBody'), latest = A.$('#bkLatest');
    try {
      var r = await A.api('/backups');
      cache = r;
    } catch (e) {
      cache = { backups: [], latest: null, ephemeral: false, persistent: false, uploadLimit: 0, storage: null, auto: null };
      if (latest) {
        latest.innerHTML = '<div class="alert">' + esc(e.message) +
          (e.setup && e.setup.length ? '<ol class="note">' + e.setup.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '') +
          '</div>';
      }
      if (body) body.innerHTML = '';
      A.noteRefreshed();
      return;
    }
    // Latest backup line + environment notices.
    if (latest) {
      var h = '';
      var st = cache.storage || {};
      if (st.mode === 'unconfigured') {
        h += '<div class="alert"><b>Persistent backups are not configured.</b> ' +
          (st.message ? esc(st.message) + ' ' : '') +
          'Backups are disabled until Supabase Storage is set up, so no backup can be lost to a redeploy in the meantime.' +
          (st.setup && st.setup.length ? '<ol class="note">' + st.setup.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '') +
          '</div>';
      } else if (st.mode === 'supabase') {
        h += '<div class="alert info">Backups are stored privately in Supabase Storage (bucket <b class="mono">' + esc(st.bucket) + '</b>) and persist across redeploys and restarts.</div>';
      } else if (cache.ephemeral) {
        h += '<div class="alert">Running on an ephemeral filesystem: server files are temporary and can disappear at any time. Always press Download right after creating a backup and keep a copy off this computer.</div>';
      }
      if (cache.latest) {
        h += '<div class="alert info">Latest backup: <b class="mono">' + esc(cache.latest.file) + '</b> · ' +
          esc(A.fmtDT(cache.latest.created_at)) + ' · ' + esc(fmtSize(cache.latest.size)) +
          (cache.latest.counts ? '<br><span class="mono mute">' + esc(countsText(cache.latest.counts)) + '</span>' : '') + '</div>';
      } else {
        h += '<div class="alert info">No backups yet. Create your first backup before making important changes.</div>';
      }
      if (cache.auto) {
        h += cache.auto.supported
          ? '<div class="note">Automatic backups: ' + esc(cache.auto.reason) + '</div>'
          : '<div class="note">Automatic backups: ' + esc(cache.auto.reason || 'off') +
            (cache.auto.alternative ? ' ' + esc(cache.auto.alternative) : '') + '</div>';
      }
      latest.innerHTML = h;
    }
    // Table of available backups.
    if (body) {
      body.innerHTML = cache.backups.length ? cache.backups.map(function (b) {
        var pill = b.valid ? '<span class="pill ok">Valid</span>' : '<span class="pill out">Invalid</span>';
        return '<tr><td><b class="mono">' + esc(b.file) + '</b><span class="sub">' + esc(b.kind) + '</span></td>' +
          '<td class="mono mute">' + esc(A.fmtDT(b.created_at)) + '</td>' +
          '<td class="mono">' + esc(fmtSize(b.size)) + '</td>' +
          '<td>' + pill + '</td>' +
          '<td><div class="acts">' +
          '<button class="btn sm" type="button" data-dl="' + esc(b.file) + '">Download</button>' +
          '<button class="btn sm danger" type="button" data-del="' + esc(b.file) + '">Delete</button>' +
          '</div></td></tr>';
      }).join('') : '<tr><td colspan="5" class="empty">No backups stored yet. Downloaded copies you saved earlier can be restored with the upload option below.</td></tr>';
    }
    // Restore-from-server dropdown.
    var sel = A.$('#restoreFile');
    if (sel) {
      var valid = cache.backups.filter(function (b) { return b.valid; });
      sel.innerHTML = valid.length
        ? valid.map(function (b) { return '<option value="' + esc(b.file) + '">' + esc(b.file) + '</option>'; }).join('')
        : '<option value="">No server backups available</option>';
    }
    applyStorageState();
    A.noteRefreshed();
  }

  function download(file) {
    // Token-free authed download: fetch with cookies, then save the blob.
    fetch('/api/backups/' + encodeURIComponent(file), { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 403 ? 'Owner access required.' : 'Download failed (' + res.status + ')');
      return res.blob();
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      A.toast('Backup downloaded — store a copy off this computer.');
    }).catch(function (e) {
      status(e.message, true);
      A.toast(e.message, true);
    });
  }

  async function doRestoreFromServer(file) {
    if (!file) { status('Choose a backup to restore.', true); return; }
    modal('Restore this backup?',
      '<p class="note"><b>Warning: restoration replaces current data</b> (products, stock, sales, accounts) with the contents of ' +
      '<b class="mono">' + esc(file) + '</b>. Newer records entered after that backup will be lost.</p>' +
      '<p class="note">A fresh safety backup of the current database is created automatically first. Nothing is deleted silently.</p>' +
      '<label>Type RESTORE to confirm<input id="mConfirm" autocomplete="off" placeholder="RESTORE"></label>',
      'Restore data', function (ov) {
        if (ov.querySelector('#mConfirm').value.trim() !== 'RESTORE') {
          ov.querySelector('#mErr').textContent = 'Type RESTORE to confirm.';
          return false;
        }
        status('Restoring ' + file + '…');
        return A.api('/backups/restore', { body: { file: file } }).then(function (r) {
          var msg = 'Restore complete: ' + countsText(r.counts) + '. Safety backup: ' + (r.safety ? r.safety.file : 'none') + '.';
          if (!r.sessionKept) msg += ' Your account was replaced — please sign in again.';
          status(msg);
          A.toast('Restore complete.');
          load();
        }).catch(function (e) { status(e.message, true); throw e; });
      });
  }

  async function doRestoreUpload(fileObj) {
    if (!fileObj) return;
    var limit = Number(cache.uploadLimit || 0);
    if (limit && fileObj.size > limit) {
      status('File is too large (' + fmtSize(fileObj.size) + '). This server accepts at most ' + fmtSize(limit) +
        ' for uploads; restore a server-stored backup instead.', true);
      return;
    }
    var text;
    try {
      text = await fileObj.text();
    } catch (e) {
      status('Could not read that file.', true);
      return;
    }
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      status('That file is not valid JSON and was rejected. Nothing was changed.', true);
      return;
    }
    modal('Restore uploaded file?',
      '<p class="note"><b>Warning: restoration replaces current data</b> with the contents of ' +
      '<b class="mono">' + esc(fileObj.name) + '</b>. A safety backup of the current database is created first.</p>' +
      '<label>Type RESTORE to confirm<input id="mConfirm" autocomplete="off" placeholder="RESTORE"></label>',
      'Restore data', function (ov) {
        if (ov.querySelector('#mConfirm').value.trim() !== 'RESTORE') {
          ov.querySelector('#mErr').textContent = 'Type RESTORE to confirm.';
          return false;
        }
        status('Restoring uploaded backup…');
        return A.api('/backups/restore', { body: { backup: parsed } }).then(function (r) {
          var msg = 'Restore complete: ' + countsText(r.counts) + '. Safety backup: ' + (r.safety ? r.safety.file : 'none') + '.';
          if (!r.sessionKept) msg += ' Your account was replaced — please sign in again.';
          status(msg);
          A.toast('Restore complete.');
          load();
        }).catch(function (e) { status(e.message, true); throw e; });
      });
  }

  async function init() {
    var main = await A.mountShell('backup', 'owner');
    if (!main) return;

    main.innerHTML =
      '<div class="page-head"><div><h1>Back<span>up</span></h1><div class="sub">Protect store data — owner only</div></div>' +
      '<div class="btn-row"><button class="btn primary" id="bkCreate" type="button">Create Backup</button>' +
      '<button class="btn" id="bkDownloadLatest" type="button">Download Backup</button></div></div>' +
      '<div id="bkStatus" hidden style="margin-bottom:16px"></div>' +
      '<div id="bkLatest" style="margin-bottom:16px"></div>' +
      '<div class="two">' +
      '<div class="panel pad"><div class="ph"><h2>Available backups</h2><span class="mono mute" id="bkCount"></span></div>' +
      '<div class="tw"><table><thead><tr><th>File</th><th>Date</th><th>Size</th><th>Check</th><th></th></tr></thead><tbody id="bkBody"></tbody></table></div>' +
      '<div class="note">Keep at least one copy outside this computer (external drive or secure cloud storage). Server files alone are not enough.</div></div>' +
      '<div class="panel pad"><div class="ph"><h2>Restore lost data</h2></div>' +
      '<div class="stack">' +
      '<label for="restoreFile">Restore from a server backup<select id="restoreFile"></select></label>' +
      '<button class="btn wide" id="bkRestore" type="button">Restore Backup</button>' +
      '<label for="restoreUpload">Or upload a backup file<input id="restoreUpload" type="file" accept=".json,application/json"></label>' +
      '<div class="note">Every restore is confirmed, safety-backed-up, verified, and reported. Invalid or corrupted files are rejected without touching your data.</div>' +
      '</div></div></div>';

    A.$('#bkCreate').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      status('Creating backup…');
      try {
        var r = await A.api('/backups', { body: { kind: 'manual' } });
        status('Backup created and verified: ' + r.backup.file + ' (' + fmtSize(r.backup.size) + '). ' +
          (r.storage && r.storage.mode === 'supabase'
            ? 'Stored in private Supabase Storage.'
            : r.ephemeral ? 'Download it now — server files are temporary.' : 'Download a copy to an external drive.'));
        A.toast('Backup created: ' + r.backup.file);
        await load();
      } catch (e) {
        status(e.message, true);
      }
      btn.disabled = false;
    });

    A.$('#bkDownloadLatest').addEventListener('click', function () {
      if (!cache.latest) { status('No backup to download yet. Create one first.', true); return; }
      download(cache.latest.file);
    });

    A.$('#bkBody').addEventListener('click', function (e) {
      var dl = e.target.closest('[data-dl]');
      var del = e.target.closest('[data-del]');
      if (dl) { download(dl.getAttribute('data-dl')); return; }
      if (del) {
        var f = del.getAttribute('data-del');
        modal('Delete backup?',
          '<p class="note">Delete <b class="mono">' + esc(f) + '</b> from the server? Your downloaded copies elsewhere are unaffected. The last remaining backup can never be deleted here.</p>',
          'Delete', function () {
            return A.api('/backups/' + encodeURIComponent(f), { method: 'DELETE' }).then(function () {
              A.toast('Backup deleted: ' + f);
              load();
            });
          });
      }
    });

    A.$('#bkRestore').addEventListener('click', function () {
      doRestoreFromServer(A.$('#restoreFile').value);
    });

    A.$('#restoreUpload').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      doRestoreUpload(f);
    });

    window.addEventListener('app-refresh', function () { load(); });
    await load();
    var c = A.$('#bkCount');
    A.reveal(main);
    if (c) {
      var obs = new MutationObserver(function () {
        c.textContent = cache.backups.length + ' file(s)';
      });
      obs.observe(A.$('#bkBody'), { childList: true });
    }
  }

  init();
})();
