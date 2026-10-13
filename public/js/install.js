/* One-time installer (replaces install.php). Creates tables, the admin account and optional demo products. */
(async function () {
  'use strict';
  var A = App;

  A.root.innerHTML =
    '<div class="auth-wrap"><div class="panel auth">' +
    '<h1>INSTALLER</h1><p>Create the database tables and your admin account.</p>' +
    '<div id="state"></div>' +
    '<form id="f" class="stack">' +
    '<label for="username">Admin username<input id="username" value="admin" maxlength="50" required></label>' +
    '<label for="password">Admin password (8+ characters)<input id="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></label>' +
    '<label style="flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-family:var(--font-b);font-size:14px;color:var(--fg)" for="seed"><input id="seed" type="checkbox" checked style="width:auto"> Add 10 demo products</label>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="go" type="submit">Install</button>' +
    '<a class="btn wide" href="/login" style="text-align:center">Back to login</a></form>' +
    '</div></div>';

  var err = A.$('#err');

  try {
    var s = await A.api('/status', { noRedirect: true });
    var st = A.$('#state');
    if (!s.configured) {
      st.innerHTML = '<div class="alert">DATABASE_URL is not set. Add a Postgres database in Vercel and redeploy.</div>';
      A.$('#go').disabled = true;
    } else if (!s.authSecret) {
      st.innerHTML = '<div class="alert">AUTH_SECRET is not set. Add it in Vercel (16+ random characters) and redeploy.</div>';
      A.$('#go').disabled = true;
    } else if (s.installed) {
      st.innerHTML = '<div class="alert ok">Already installed. <a href="/login">Go to login</a>.</div>';
      A.$('#go').disabled = true;
    }
  } catch (e) { /* the form will report errors on submit */ }

  A.$('#f').addEventListener('submit', async function (e) {
    e.preventDefault();
    err.hidden = true;
    var go = A.$('#go');
    go.disabled = true;
    try {
      var r = await A.api('/install', {
        noRedirect: true,
        body: { username: A.$('#username').value, password: A.$('#password').value, seed: A.$('#seed').checked }
      });
      A.$('#state').innerHTML = '<div class="alert ok">Database is ready' + (r.seeded ? ' with ' + r.seeded + ' demo products' : '') + '. <a href="/login">Go to login</a>.</div>';
      A.$('#f').hidden = true;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      go.disabled = false;
    }
  });
})();
