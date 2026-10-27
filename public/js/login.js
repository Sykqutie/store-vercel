/* Login page (replaces login.php). */
(async function () {
  'use strict';
  var A = App, esc = A.esc;

  A.root.innerHTML =
    '<div class="auth-wrap"><div class="panel auth">' +
    '<img src="/logo-full.svg" alt="SmartMart — Shop easy. Live easy." width="210" style="align-self:center;max-width:100%;height:auto">' +
    '<h1>Smart<span>Mart</span></h1>' +
    '<p>POS &amp; Inventory · Secure access</p>' +
    '<div id="notice"></div>' +
    '<form id="f" class="stack" autocomplete="on">' +
    '<label for="username">Username<input id="username" name="username" autocomplete="username" required autofocus></label>' +
    '<div class="pw"><label for="password">Password<input id="password" name="password" type="password" autocomplete="current-password" required></label>' +
    '<button type="button" class="btn sm" id="showPw" aria-label="Show password">Show</button></div>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="go" type="submit">Launch dashboard</button></form>' +
    '<div style="text-align:center;margin-top:10px"><a href="/forgot-password">Forgot Password?</a></div>' +
    '</div></div>';

  var form = A.$('#f'), err = A.$('#err');

  A.$('#showPw').addEventListener('click', function () {
    var f = A.$('#password'), show = f.type === 'password';
    f.type = show ? 'text' : 'password';
    this.textContent = show ? 'Hide' : 'Show';
  });

  // Already signed in? Skip the form.
  A.api('/me', { noRedirect: true }).then(function (me) {
    location.replace(me && me.role === 'cashier' ? '/pos' : '/dashboard');
  }).catch(function () {});

  // Setup hints for a fresh deployment. Re-runnable so a Recheck button can retry.
  function checkStatus() {
    var n = A.$('#notice');
    if (!n) return;
    A.api('/status', { noRedirect: true }).then(function (s) {
      if (!s.configured) {
        var env = s.env || {};
        var keys = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'NEON_DATABASE_URL'];
        var found = keys.filter(function (k) { return env[k]; });
        var dbg = found.length
          ? 'Found: ' + found.join(', ') + ' — but none worked on this deployment. Redeploy again.'
          : 'No database variable found on this deployment.';
        n.innerHTML =
          '<div class="alert">DATABASE_URL is not set on this Vercel deployment. ' + esc(dbg) +
          '<br><br>1) Supabase Dashboard → your project → <b>Connect → Connection string → URI</b> (choose the <b>Session pooler</b>). ' +
          'In Vercel: <b>Settings → Environment Variables → add <b>DATABASE_URL</b> for <b>Production</b></b>.' +
          '<br>2) <b>Deployments → Redeploy</b> (old deployments keep old env).' +
          '<br>3) Open <a href="/api/status">/api/status</a> — expect <span class="mono">configured:true</span>, then <a href="/install">run the installer</a>. See README “Deploy to Vercel”.</div>' +
          '<div class="btn-row" style="margin-top:8px"><button class="btn sm" id="nRecheck" type="button">Recheck</button>' +
          '<a class="btn sm" href="/api/status">View /api/status</a> <a class="btn sm" href="/install">Installer</a></div>';
        var rb = A.$('#nRecheck');
        if (rb) rb.addEventListener('click', checkStatus);
      } else if (!s.authSecret) {
        n.innerHTML = '<div class="alert">AUTH_SECRET is not set. Add it in Vercel (Settings → Environment Variables, 16+ random characters) and redeploy.</div>';
      } else if (s.dbError) {
        n.innerHTML = '<div class="alert">' + esc(s.dbError) + '</div>';
      } else if (!s.installed) {
        n.innerHTML = '<div class="alert info">First time here? <a href="/install">Run the installer</a> to create the database and your admin account.</div>';
      } else {
        n.innerHTML = '';
      }
    }).catch(function () { /* API unreachable — form will report on submit */ });
  }
  checkStatus();

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    err.hidden = true;
    var go = A.$('#go');
    go.disabled = true;
    try {
      var r = await A.api('/login', { body: { username: A.$('#username').value, password: A.$('#password').value }, noRedirect: true });
      location.href = r && r.role === 'cashier' ? '/pos' : '/dashboard';
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      go.disabled = false;
    }
  });
})();
