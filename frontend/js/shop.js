/* shop.js — public profile of one service center: services, timings, reviews. */
'use strict';
(async () => {
  const root = $('#root');
  const id = new URLSearchParams(location.search).get('id');
  try {
    const c = await api('/centers/' + encodeURIComponent(id));
    document.title = c.name + ' — CarCurb';
    const book = (sid) => `book.html?center=${encodeURIComponent(c.id)}&service=${encodeURIComponent(sid)}`;
    root.innerHTML = `
      <div class="row between"><h1 style="font-size:2rem;margin:0">${esc(c.name)}</h1>
        <div>${c.reviewCount ? `${stars(c.rating)} <span class="muted small">${c.rating} · ${c.reviewCount} review${c.reviewCount > 1 ? 's' : ''}</span>` : '<span class="muted small">New · no reviews yet</span>'}</div></div>
      <p class="muted">${esc(c.address)} · <a href="${esc(c.mapsUrl)}" target="_blank" rel="noopener noreferrer">Open in Maps</a> · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></p>
      <div class="row" style="margin-bottom:18px">
        <span class="chip">Open ${fmtTime(c.open)} to ${fmtTime(c.close)}</span>
        ${c.pickup.enabled ? `<span class="pill pill-ready">Pickup &amp; drop ${c.pickup.fee ? money(c.pickup.fee) : 'free'}</span>` : '<span class="chip">Drop-off at the center</span>'}
        <span class="chip">${c.acceptsUpi ? 'Pay by cash or UPI' : 'Pay by cash'}</span></div>
      <h2>Services</h2>
      ${c.services.length ? `<div class="table-wrap"><table><thead><tr><th>Service</th><th>Price</th><th></th></tr></thead><tbody>${c.services.map((s) => `<tr><td>${esc(s.name)}</td><td>${money(s.price)}</td><td style="text-align:right"><a class="btn btn-sm" href="${book(s.id)}">Book</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">This center has not listed services yet.</div>'}
      <p class="muted small" style="margin-top:8px">Prices are starting prices. The final bill is shown after inspection, before you pay.</p>
      <h2 style="margin-top:28px">Reviews</h2>
      ${c.reviews.length ? c.reviews.map((r) => `<div class="card">${stars(r.rating)} <strong>${esc(r.name)}</strong> <span class="muted small">· ${fmtWhen(r.at)}</span>${r.comment ? `<p style="margin:6px 0 0">${esc(r.comment)}</p>` : ''}</div>`).join('') : '<div class="empty">No reviews yet. Reviews appear after a customer’s car is delivered.</div>'}`;
  } catch (e) { showError(root, e.message); }
})();
