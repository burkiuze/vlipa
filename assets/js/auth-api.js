/* vlipa — thin wrapper around the account endpoints in
   netlify/functions/auth.mjs. Every call sends and accepts the session cookie. */

(function () {
  'use strict';

  var BASE = '/api/auth/';

  function request(action, options) {
    var settings = Object.assign({ credentials: 'same-origin' }, options || {});

    return fetch(BASE + action, settings).then(function (response) {
      if (response.status === 204) return { ok: true, status: 204, data: {} };

      return response.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
        return { ok: response.ok, status: response.status, data: data };
      });
    });
  }

  function post(action, payload) {
    return request(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  /* Turns any failure into a sentence worth showing a person. The status code
     rides along on the unexpected ones, because "something went wrong" alone
     is useless when a live site is misbehaving. */
  function message(result) {
    if (result.data && result.data.error) return result.data.error;

    if (result.status === 404 || result.status === 405 || result.status === 501) {
      return 'The account service is not running on this host (' + result.status + ').';
    }
    if (result.status === 503) return 'Account storage is unavailable right now (503).';
    if (result.status === 502 || result.status === 504) {
      return 'The account service did not answer (' + result.status + '). Try again in a moment.';
    }
    return 'Something went wrong (' + result.status + '). Try again.';
  }

  window.VlipaAuth = {
    signup: function (payload) { return post('signup', payload); },
    login: function (payload) { return post('login', payload); },
    logout: function () { return post('logout', {}); },
    me: function () { return request('me', { method: 'GET' }); },
    message: message
  };
})();
