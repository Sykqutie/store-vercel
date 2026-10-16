/* Entry point: owners to the dashboard, cashiers to POS, everyone else to login. */
(function () {
  'use strict';
  App.api('/me', { noRedirect: true })
    .then(function (me) { location.replace(me && me.role === 'cashier' ? '/pos' : '/dashboard'); })
    .catch(function () { location.replace('/login'); });
})();
