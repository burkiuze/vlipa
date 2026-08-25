/* vlipa — the page behind sign-in. Reads the session, or sends you back out. */

(function () {
  'use strict';

  var card = document.getElementById('accountCard');
  var loading = document.getElementById('accountLoading');
  var greeting = document.getElementById('accountGreeting');
  var emailOut = document.getElementById('accountEmail');
  var sinceOut = document.getElementById('accountSince');
  var initial = document.getElementById('accountInitial');
  var signOut = document.getElementById('signOut');

  function show(user) {
    var label = user.name || user.email.split('@')[0];
    greeting.textContent = 'Tekrar hoş geldiniz, ' + label + '.';
    emailOut.textContent = user.email;
    initial.textContent = label.charAt(0).toUpperCase();

    if (user.createdAt) {
      var date = new Date(user.createdAt);
      sinceOut.textContent = isNaN(date) ? '' : 'Üyelik başlangıcı: ' + date.toLocaleDateString('tr-TR');
    }

    loading.hidden = true;
    card.hidden = false;
  }

  window.VlipaAuth.me().then(function (result) {
    if (result.ok && result.data.user) { show(result.data.user); return; }
    window.location.replace('/login');
  }).catch(function () {
    loading.textContent = 'Hesap servisine ulaşılamadı.';
  });

  signOut.addEventListener('click', function () {
    signOut.disabled = true;
    window.VlipaAuth.logout().then(function () {
      window.location.replace('/login');
    }).catch(function () {
      signOut.disabled = false;
    });
  });
})();
