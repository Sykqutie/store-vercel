/* One-time installer (replaces install.php). Creates tables, the admin account and optional demo inventory items. */
(async function () {
  'use strict';
  var A = App;

  A.root.innerHTML =
    '<div class="auth-wrap"><div class="panel auth">' +
    '<img src="/logo-full.svg" alt="SmartMart — Shop easy. Live easy." width="210" style="align-self:center;max-width:100%;height:auto">' +
    '<h1>INSTALLER</h1><p>Create the database tables and your admin account.</p>' +
    '<div id="state"></div>' +
    '<form id="f" class="stack">' +
    '<label for="username">Admin username<input id="username" value="admin" maxlength="50" required></label>' +
    '<label for="password">Admin password (8+ characters)<input id="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></label>' +
    '<label style="flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-family:var(--font-b);font-size:14px;color:var(--fg)" for="seed"><input id="seed" type="checkbox" checked style="width:auto"> Add 10 demo inventory items</label>' +
    '<div class="alert" id="err" hidden></div>' +
    '<button class="btn primary wide" id="go" type="submit">Install</button>' +
    '<a class="btn wide" href="/login" style="text-align:center">Back to login</a></form>' +
    '</div></div>';

  var err = A.$('#err');

  async function checkStatus() {
    var st = A.$('#state');
    st.innerHTML = '<p class="mono mute">Checking database connection…</p>';
    try {
      var s = await A.api('/status', { noRedirect: true });
      if (!s.configured) {
        var env = s.env || {};
        var keys = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'NEON_DATABASE_URL'];
        var found = keys.filter(function (k) { return env[k]; });
        var dbg = found.length
          ? 'Found: ' + found.join(', ') + ' — but none worked. Redeploy again.'
          : 'No database variable found on this deployment.';
        st.innerHTML =
          '<div class="alert">DATABASE_URL is not set on this Vercel deployment. ' + A.esc(dbg) + '</div>' +
          '<ol style="margin:10px 0 10px 18px;font-size:14px;line-height:1.6">' +
          '<li>Vercel Dashboard → your project → <b>Storage</b> → <b>Create Database</b> → <b>Neon Postgres</b> (or <b>Settings → Environment Variables</b> → add <b>DATABASE_URL</b> manually for <b>Production</b>).</li>' +
          '<li><b>Deployments → Redeploy</b> — env changes need a new deployment (old URLs keep old env).</li>' +
          '<li>Open <a href="/api/status">/api/status</a> — it should show <span class="mono">configured:true</span>, then press Recheck.</li>' +
          '</ol>' +
          '<div class="btn-row"><button class="btn sm" id="recheck" type="button">Recheck</button>' +
          '<a class="btn sm" href="/api/status">View /api/status</a></div>' +
          '<p class="mono mute" style="margin-top:8px">See README “Deploy to Vercel”. Local .env never uploads to Vercel (.gitignore).</p>';
        A.$('#go').disabled = true;
        A.$('#recheck').addEventListener('click', checkStatus);
      } else if (!s.authSecret) {
        st.innerHTML = '<div class="alert">AUTH_SECRET is not set. Add it in Vercel (Settings → Environment Variables, 16+ random characters) and redeploy.</div>' +
          '<div class="btn-row"><button class="btn sm" id="recheck" type="button">Recheck</button></div>';
        A.$('#go').disabled = true;
        A.$('#recheck').addEventListener('click', checkStatus);
      } else if (s.dbError) {
        st.innerHTML = '<div class="alert">' + A.esc(s.dbError) + '</div>' +
          '<div class="btn-row"><button class="btn sm" id="recheck" type="button">Recheck</button></div>';
        A.$('#recheck').addEventListener('click', checkStatus);
      } else if (s.installed) {
        st.innerHTML = '<div class="alert ok">Already installed. <a href="/login">Go to login</a>.</div>';
        A.$('#go').disabled = true;
      } else {
        st.innerHTML = '';
        A.$('#go').disabled = false;
      }
    } catch (e) {
      st.innerHTML = '<div class="alert">' + A.esc(e.message || 'Could not reach the API.') + '</div>' +
        '<div class="btn-row"><button class="btn sm" id="recheck" type="button">Recheck</button></div>';
      var rb = A.$('#recheck');
      if (rb) rb.addEventListener('click', checkStatus);
    }
  }
  await checkStatus();

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
      A.$('#state').innerHTML = '<div class="alert ok">Database is ready' + (r.seeded ? ' with ' + r.seeded + ' demo inventory items' : '') + '. <a href="/login">Go to login</a>.</div>';
      A.$('#f').hidden = true;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      go.disabled = false;
    }
  });
})();
