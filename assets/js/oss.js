/* vlipa — renders the open-source project list from oss-data.js. */

(function () {
  'use strict';

  var data = window.VLIPA_OSS;
  if (!data) return;

  var grid = document.getElementById('ossGrid');
  var chips = document.getElementById('ossFilters');
  var search = document.getElementById('ossSearch');
  var countEl = document.getElementById('ossCount');
  var teaser = document.getElementById('ossTeaser');
  var active = 'all';

  function stars(n) {
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
  }

  function card(item) {
    var owner = item.repo.split('/')[0];
    var name = item.repo.split('/')[1];
    return '' +
      '<a class="repo" href="https://github.com/' + item.repo + '" target="_blank" rel="noopener noreferrer">' +
        '<div class="repo__head">' +
          '<span class="repo__name"><span class="repo__owner">' + owner + '/</span>' + name + '</span>' +
          '<span class="repo__stars">' +
            '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.2l2 4.1 4.5.7-3.3 3.2.8 4.5L8 11.6l-4 2.1.8-4.5L1.5 6l4.5-.7 2-4.1Z"/></svg>' +
            stars(item.stars) +
          '</span>' +
        '</div>' +
        '<p class="repo__desc">' + item.desc + '</p>' +
        '<div class="repo__meta">' +
          (item.lang ? '<span class="repo__lang">' + item.lang + '</span>' : '') +
          '<span>' + item.license + '</span>' +
        '</div>' +
      '</a>';
  }

  function matches(item) {
    if (active !== 'all' && item.cat.indexOf(active) === -1) return false;
    var q = search ? search.value.trim().toLowerCase() : '';
    if (!q) return true;
    return (item.repo + ' ' + item.desc + ' ' + (item.lang || '')).toLowerCase().indexOf(q) !== -1;
  }

  function render() {
    var list = data.repos.filter(matches);
    grid.innerHTML = list.length
      ? list.map(card).join('')
      : '<p class="repo__empty">No projects match that search.</p>';
    if (countEl) {
      countEl.textContent = list.length + (list.length === 1 ? ' project' : ' projects') +
        ' · figures from ' + data.updated;
    }
  }

  /* full list page */
  if (grid) {
    if (chips) {
      chips.innerHTML = data.categories.map(function (c) {
        return '<button class="chip' + (c.id === 'all' ? ' is-active' : '') +
               '" type="button" data-cat="' + c.id + '">' + c.label + '</button>';
      }).join('');

      chips.addEventListener('click', function (event) {
        var button = event.target.closest('[data-cat]');
        if (!button) return;
        active = button.dataset.cat;
        Array.prototype.forEach.call(chips.children, function (child) {
          child.classList.toggle('is-active', child === button);
        });
        render();
      });
    }

    if (search) search.addEventListener('input', render);
    render();
  }

  /* home page teaser: the six most-starred projects */
  if (teaser) {
    teaser.innerHTML = data.repos.slice()
      .sort(function (a, b) { return b.stars - a.stars; })
      .slice(0, 6)
      .map(card)
      .join('');
  }
})();
