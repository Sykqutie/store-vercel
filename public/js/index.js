/* Entry point: send signed-in users to the dashboard, everyone else to login (same as index.php). */
(function () {
  'use strict';
  App.api('/me', { noRedirect: true })
    .then(function () { location.replace('/dashboard'); })
    .catch(function () { location.replace('/login'); });
})();
