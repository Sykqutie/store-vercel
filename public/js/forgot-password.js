/* Owner Account Recovery page (public, no sign-in required).
   Informational ONLY — there is no online password reset in SmartMart.
   This page guides the administrator to the local `npm run recover`
   utility and surfaces database-configuration problems using the public
   /status endpoint (which reveals no account details). It never collects
   or sends passwords, and calls no reset endpoint. */
(function () {
  'use strict';
  var A = App, esc = A.esc;

  A.root.innerHTML =
    '<div class="auth-wrap"><div class="panel auth">' +
    '<img src="/logo-full.svg" alt="SmartMart — Shop easy. Live easy." width="210" style="align-self:center;max-width:100%;height:auto">' +
    '<h1>ACCO<span style="color:var(--cyan)">VERY</span></h1>' +
    '<p>Owner account recovery · Secure access</p>' +
    '<div id="dbstate"></div>' +
    '<div class="stack" style="text-align:left">' +
    '<p><b>Step 1.</b> On the <b>server computer</b> (the PC hosting SmartMart), open <b class="mono">PowerShell</b> in the project folder.</p>' +
    '<p><b>Step 2.</b> Run <b class="mono">npm run recover</b> and follow the prompts: pick the owner account, type a new password twice (8–72 characters), then type <b class="mono">RESET</b> to confirm. No owner exists yet? The tool creates it after you type <b class="mono">CREATE</b>.</p>' +
    '<p><b>Step 3.</b> Return here and sign in with the new password.</p>' +
    '<div class="note">Safety: the new password is hashed with bcrypt and only the owner row is updated — username, role, cashier accounts, products, inventory, sales, and reports are untouched. ' +
    'There is no online or email reset, so this page cannot be abused to take over the store. Cashiers cannot recover accounts here: ask the store owner to reset your password under Users.</div>' +
    '<div class="btn-row" style="justify-content:center"><a class="btn primary" href="/login">Back to login</a></div>' +
    '</div></div></div>';

  // Database readiness hint. /status is already public (the login page uses
  // it) and discloses no usernames, so this is safe on a public page.
  A.api('/status', { noRedirect: true }).then(function (s) {
    var box = A.$('#dbstate');
    if (!box) return;
    if (!s.configured) {
      box.innerHTML = '<div class="alert">DATABASE_URL is not set. The recovery tool needs it: add a Postgres database (local Docker or Neon/Supabase), put its URL in <span class="mono">.env</span>, and restart the server. See the README.</div>';
    } else if (s.dbError) {
      box.innerHTML = '<div class="alert">' + esc(s.dbError) + ' Fix the database first (local setup: run <span class="mono">docker start smartmart-pg</span>), then run the recovery tool.</div>';
    } else if (!s.installed) {
      box.innerHTML = '<div class="alert info">No accounts exist yet — instead of recovery, <a href="/install">run the installer</a> to create the database and your owner account.</div>';
    }
  }).catch(function () { /* offline: the static steps above still apply */ });
})();
