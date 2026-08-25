/* vlipa — the canvas captcha shared by the sign-in and sign-up forms.
   Drawn in the browser, so it only stops casual scripted submissions: the
   expected answer lives in the page. Real protection needs a challenge issued
   and verified server-side. */

(function () {
  'use strict';

  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var LENGTH = 5;

  function randomCode() {
    var out = '';
    var values = new Uint32Array(LENGTH);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(values);
    } else {
      for (var j = 0; j < LENGTH; j++) values[j] = Math.floor(Math.random() * 4294967296);
    }
    for (var i = 0; i < LENGTH; i++) out += ALPHABET[values[i] % ALPHABET.length];
    return out;
  }

  function create(options) {
    var canvas = options.canvas;
    var input = options.input;
    var reload = options.reload;
    var setError = options.setError;
    var code = '';

    /* The drawing size is read once. Reading it back from the element would
       compound the device-pixel scaling on every redraw and the canvas would
       grow without bound. */
    var W = parseInt(canvas.getAttribute('width'), 10) || 132;
    var H = parseInt(canvas.getAttribute('height'), 10) || 46;

    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    function draw() {
      code = randomCode();

      var ratio = Math.min(window.devicePixelRatio || 1, 3);
      var w = W;
      var h = H;

      if (canvas.width !== Math.round(w * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
      }

      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f6f6f4';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(10, 10, 10, .14)';
      ctx.lineWidth = 1;
      for (var n = 0; n < 4; n++) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * w, Math.random() * h);
        ctx.bezierCurveTo(Math.random() * w, Math.random() * h,
                          Math.random() * w, Math.random() * h,
                          Math.random() * w, Math.random() * h);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(10, 10, 10, .18)';
      for (var d = 0; d < 26; d++) {
        ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
      }

      var step = w / (code.length + 1);
      for (var i = 0; i < code.length; i++) {
        ctx.save();
        ctx.translate(step * (i + 1), h / 2 + (Math.random() * 6 - 3));
        ctx.rotate(Math.random() * 0.5 - 0.25);
        ctx.fillStyle = '#0a0a0a';
        ctx.font = '600 ' + (22 + Math.random() * 5).toFixed(0) +
                   'px Inter, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(code[i], 0, 0);
        ctx.restore();
      }
    }

    function validate() {
      var value = input.value.trim().toUpperCase();
      if (!value) return setError('Yukarıdaki kodu girin.');
      if (value !== code) return setError('Kod eşleşmiyor.');
      return setError('');
    }

    function refresh() {
      draw();
      input.value = '';
      setError('');
    }

    reload.addEventListener('click', function () {
      refresh();
      input.focus();
    });

    input.addEventListener('blur', function () {
      if (input.value.trim()) validate();
    });

    input.addEventListener('input', function () {
      if (input.hasAttribute('aria-invalid')) validate();
    });

    draw();

    return { validate: validate, refresh: refresh };
  }

  window.VlipaCaptcha = { create: create };
})();
