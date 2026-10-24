/* find.js — search the approved service centers, optionally sorted by distance. */
'use strict';
(() => {
  const list = $('#list'), qEl = $('#q'), statusEl = $('#status');
  let centers = [], pos = null;
  qEl.value = new URLSearchParams(location.search).get('q') || '';

  function km(a, b) { // straight-line distance between two coordinates (haversine formula)
    const r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  async function load() {
    list.innerHTML = '<p class="muted">Loading…</p>';
    try { centers = await api('/centers?q=' + encodeURIComponent(qEl.value.trim())); draw(); } catch (e) { showError(list, e.message); }
  }
  function card(c) {
    const chips = c.services.slice(0, 4).map((s) => `<span class="chip">${esc(s.name)} · ${money(s.price)}</span>`).join('') + (c.services.length > 4 ? `<span class="chip">+${c.services.length - 4} more</span>` : '');
    const rating = c.reviewCount ? `${stars(c.rating)} <span class="small muted">${c.rating} (${c.reviewCount})</span>` : '<span class="small muted">New · no reviews yet</span>';
    return `<article class="card"><div class="row between"><div><h2 style="margin:0"><a href="shop.html?id=${encodeURIComponent(c.id)}" style="color:inherit;text-decoration:none">${esc(c.name)}</a></h2>
      <p class="muted small" style="margin:2px 0 6px">${esc(c.area)}${c.km != null ? ' · ' + c.km.toFixed(1) + ' km away' : ''} · ${fmtTime(c.open)} to ${fmtTime(c.close)}</p></div><div>${rating}</div></div>
      <div>${chips || '<span class="muted small">No services listed yet</span>'}</div>
      <div class="row between" style="margin-top:12px"><span class="small">${c.pickup.enabled ? `<span class="pill pill-ready">Pickup &amp; drop ${c.pickup.fee ? money(c.pickup.fee) : 'free'}</span>` : '<span class="muted">Drop-off at the center</span>'}</span>
      <a class="btn btn-sm" href="shop.html?id=${encodeURIComponent(c.id)}">View and book</a></div></article>`;
  }
  function draw() {
    let rows = centers.map((c) => ({ ...c, km: pos && c.lat != null ? km(pos, c) : null }));
    if ($('#pickupOnly').checked) rows = rows.filter((c) => c.pickup.enabled);
    if (pos) rows.sort((a, b) => (a.km == null ? 1e9 : a.km) - (b.km == null ? 1e9 : b.km));
    statusEl.textContent = rows.length + (rows.length === 1 ? ' center found' : ' centers found') + (pos ? ', nearest first' : '');
    list.innerHTML = rows.length ? rows.map(card).join('') : '<div class="empty">No centers match. Try a different area or clear the search.</div>';
  }
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $('#pickupOnly').addEventListener('change', draw);
  $('#near').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('Your browser cannot share its location.', true); return; }
    statusEl.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(
      (p) => { pos = { lat: p.coords.latitude, lng: p.coords.longitude }; draw(); },
      () => { statusEl.textContent = ''; toast('Location is blocked. Allow it in your browser, or search by area instead.', true); },
      { timeout: 10000 });
  });
  load();
})();
