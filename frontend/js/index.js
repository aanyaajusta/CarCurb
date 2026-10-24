/* index.js — landing page: the search box sends people to the Find page. */
'use strict';
document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  location.href = 'find.html' + (q ? '?q=' + encodeURIComponent(q) : '');
});
