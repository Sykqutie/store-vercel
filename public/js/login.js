/* Login page (replaces login.php). */
(async function () {
  'use strict';
  var A = App, esc = A.esc;

  A.root.innerHTML =
    '<div class="auth-wrap"><div class="panel auth">' +
    '<h1>SMART<span style="color:var(--cyan)">MART</span></h1>' +
    '<p>POS &amp; Inventory · Secure access</p>' +
    '<div id="notice"></div>' +
    '<form id="f" class="stack" autocomplete="on">' +
    '<label for="username">Username<input id="username" name="username" autocomplete="username" required autofocus></label>' +
    '<div class="pw"><label for="password">Password<input id="password" name="password" type="password" autocomplete="current-password" required></label>' +
    '<button type="button" class="btn sm" id="showPw" aria-label="Show password">Show</button></div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="go" type="submit">Launch dashboard</button></form>' +
    '</div></div>';

  var form = A.$('#f'), err = A.$('#err');

  A.$('#showPw').addEventListener('click', function () {
    var f = A.$('#password'), show = f.type === 'password';
    f.type = show ? 'text' : 'password';
    this.textContent = show ? 'Hide' : 'Show';
  });

  // Already signed in? Skip the form.
  A.api('/me', { noRedirect: true }).then(function () { location.replace('/dashboard'); }).catch(function () {});

  // Setup hints for a fresh deployment.
  A.api('/status', { noRedirect: true }).then(function (s) {
    var n = A.$('#notice');
    if (!s.configured) {
      n.innerHTML = '<div class="alert">DATABASE_URL is not set. Add a Postgres database in Vercel and redeploy. See the README.</div>';
    } else if (!s.authSecret) {
      n.innerHTML = '<div class="alert">AUTH_SECRET is not set. Add it in Vercel (16+ random characters) and redeploy.</div>';
    } else if (s.dbError) {
      n.innerHTML = '<div class="alert">' + esc(s.dbError) + '</div>';
    } else if (!s.installed) {
      n.innerHTML = '<div class="alert info">First time here? <a href="/install">Run the installer</a> to create the database and your admin account.</div>';
    }
  }).catch(function () {});

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    err.hidden = true;
    var go = A.$('#go');
    go.disabled = true;
    try {
      await A.api('/login', { body: { username: A.$('#username').value, password: A.$('#password').value }, noRedirect: true });
      location.href = '/dashboard';
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      go.disabled = false;
    }
  });
})();
