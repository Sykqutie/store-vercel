/* User management (owner only): create cashiers, activate/deactivate, reset passwords. */
(async function () {
  'use strict';
  var A = App, esc = A.esc;
  var main = await A.mountShell('users', 'owner');
  if (!main) return;

  var me = A.me() || {};
  main.innerHTML =
    '<div class="page-head"><div><h1>Cash<span>iers</span></h1><div class="sub">POS-only accounts — no inventory, reports, or settings access</div></div></div>' +
    '<div class="panel pad" style="margin-bottom:16px"><div class="ph"><h2>My account (signed in as ' + esc(me.username || 'owner') + ')</h2></div>' +
    '<form id="meForm" class="stack">' +
    '<label for="meUsername">Change my username (leave blank to keep it)<input id="meUsername" maxlength="50" autocomplete="off" placeholder="' + esc(me.username || '') + '"></label>' +
    '<label for="meCurrent">Current password (required to save changes)<input id="meCurrent" type="password" maxlength="72" autocomplete="current-password" required></label>' +
    '<label for="meNew">New password (leave blank to keep it, 8+ characters)<input id="meNew" type="password" minlength="8" maxlength="72" autocomplete="new-password"></label>' +
    '<div class="note">Change the admin/owner login without signing out or touching the server. Your current password is always required.</div>' +
    '<div class="alert" id="meErr" hidden></div>' +
    '<div class="alert info" id="meOk" hidden></div>' +
    '<button class="btn primary wide" id="meSave" type="submit">Save my account changes</button></form></div>' +
    '<div class="two">' +
    '<div class="panel pad"><div class="ph"><h2>Create cashier account</h2></div>' +
    '<form id="f" class="stack">' +
    '<label for="username">Username (3+ characters)<input id="username" maxlength="50" required autocomplete="off"></label>' +
    '<label for="password">Temporary password (8+ characters)<input id="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></label>' +
    '<div class="note">The cashier signs in with these credentials and lands straight on the POS. Share the password securely and ask them to keep it private.</div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="save" type="submit">Create cashier</button></form></div>' +
    '<div class="panel pad"><div class="ph"><h2>Cashier accounts</h2><span class="mono mute" id="count"></span></div>' +
    '<div class="tw"><table><thead><tr><th>Username</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody id="body"></tbody></table></div></div></div>';

  var body = A.$('#body'), err = A.$('#err');

  A.$('#meForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var meErr = A.$('#meErr'), meOk = A.$('#meOk'), btn = A.$('#meSave');
    meErr.hidden = true; meOk.hidden = true;
    btn.disabled = true;
    try {
      var payload = { current_password: A.$('#meCurrent').value };
      var nu = A.$('#meUsername').value.trim();
      var np = A.$('#meNew').value;
      if (nu) payload.new_username = nu;
      if (np) payload.new_password = np;
      if (!nu && !np) throw new Error('Enter a new username and/or a new password.');
      var r = await A.api('/me', { method: 'PUT', body: payload });
      meOk.textContent = 'Saved. You are now signed in as ' + r.user.username + '. Refreshing header…';
      meOk.hidden = false;
      A.$('#meForm').reset();
      A.toast('Account updated: ' + r.user.username);
      setTimeout(function () { location.reload(); }, 900);
    } catch (ex) {
      meErr.textContent = ex.message;
      meErr.hidden = false;
    }
    btn.disabled = false;
  });

  async function load() {
    var r;
    try {
      r = await A.api('/users');
    } catch (e) {
      body.innerHTML = '<tr><td colspan="4"><div class="alert">' + esc(e.message) + '</div></td></tr>';
      return;
    }
    A.$('#count').textContent = r.users.length + ' account(s)';
    body.innerHTML = r.users.length ? r.users.map(function (u) {
      var pill = u.active ? '<span class="pill ok">Active</span>' : '<span class="pill out">Deactivated</span>';
      return '<tr><td><b>' + esc(u.username) + '</b><span class="sub">cashier</span></td>' +
        '<td>' + pill + '</td>' +
        '<td class="mono mute">' + A.fmtDT(u.created_at) + '</td>' +
        '<td><div class="acts">' +
        '<button class="btn sm" type="button" data-pw="' + u.id + '" data-name="' + esc(u.username) + '">Reset password</button>' +
        (u.active
          ? '<button class="btn sm danger" type="button" data-off="' + u.id + '" aria-label="Deactivate ' + esc(u.username) + '">Deactivate</button>'
          : '<button class="btn sm" type="button" data-on="' + u.id + '" aria-label="Activate ' + esc(u.username) + '">Activate</button>') +
        '</div></td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">No cashier accounts yet. Create the first one on the left.</td></tr>';
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
    var f = ov.querySelector('input');
    if (f) f.focus();
  }

  A.$('#f').addEventListener('submit', async function (e) {
    e.preventDefault();
    err.hidden = true;
    var btn = A.$('#save');
    btn.disabled = true;
    try {
      var r = await A.api('/users', {
        body: { username: A.$('#username').value.trim(), password: A.$('#password').value }
      });
      A.toast('Cashier ' + r.user.username + ' created');
      A.$('#f').reset();
      await load();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
    btn.disabled = false;
  });

  body.addEventListener('click', function (e) {
    var off = e.target.closest('[data-off]');
    var on = e.target.closest('[data-on]');
    var pw = e.target.closest('[data-pw]');
    if (off) {
      var id = Number(off.getAttribute('data-off'));
      modal('Deactivate account?', '<p class="note">The cashier is signed out on their next request and cannot sign in again until reactivated. Queued offline sales on their device stay queued.</p>', 'Deactivate', function () {
        return A.api('/users/' + id, { method: 'PUT', body: { active: false } }).then(function () { A.toast('Account deactivated'); load(); });
      });
    }
    if (on) {
      var id2 = Number(on.getAttribute('data-on'));
      A.api('/users/' + id2, { method: 'PUT', body: { active: true } })
        .then(function () { A.toast('Account activated'); load(); })
        .catch(function (ex) { A.toast(ex.message, true); });
    }
    if (pw) {
      var id3 = Number(pw.getAttribute('data-pw'));
      var name = pw.getAttribute('data-name');
      modal('Reset password', '<label>New password for ' + esc(name) + ' (8+ characters)<input id="mPw" type="password" minlength="8" maxlength="72" autocomplete="new-password"></label>', 'Set password', function (ov) {
        var v = ov.querySelector('#mPw').value;
        if (!v || v.length < 8) {
          ov.querySelector('#mErr').textContent = 'New password must be 8 to 72 characters.';
          return false;
        }
        return A.api('/users/' + id3, { method: 'PUT', body: { password: v } }).then(function () {
          A.toast('Password reset for ' + name);
          load();
        });
      });
    }
  });

  window.addEventListener('app-refresh', function () { load().then(function () { A.noteRefreshed(); }).catch(function () { A.noteRefreshed(); }); });
  await load();
  A.reveal(main);
})();
