/* customer.js — the customer's list of bookings. */
'use strict';
(async () => {
  if (!requireRole('customer')) return;
  const list = $('#list');
  const card = (b) => `<a class="card" href="booking.html?id=${encodeURIComponent(b.id)}" style="display:block;color:inherit;text-decoration:none">
    <div class="row between"><strong>${esc(b.serviceName)}</strong>${pill(b.status)}</div>
    <p class="muted small" style="margin:4px 0 0">${esc(b.center.name)} · ${esc(b.vehicle.model)} (${esc(b.vehicle.reg)}) · ${fmtDate(b.date)}, ${fmtTime(b.time)}${b.pickup.requested ? ' · Pickup &amp; drop' : ''}</p>
    ${b.invoice ? `<p class="small" style="margin:6px 0 0">Invoice ${money(b.invoice.total)} · ${pill(b.payment.status)}</p>` : ''}
    ${b.canReview ? '<p class="small" style="margin:6px 0 0;color:var(--accent)"><strong>Rate this service</strong></p>' : ''}</a>`;
  try {
    const rows = await api('/bookings');
    const active = rows.filter((b) => !['Delivered', 'Rejected', 'Cancelled'].includes(b.status));
    const past = rows.filter((b) => !active.includes(b));
    if (!rows.length) { list.innerHTML = '<div class="empty">You have no bookings yet.<br><br><a class="btn" href="find.html">Find a service center</a></div>'; return; }
    list.innerHTML = (active.length ? '<h2>In progress</h2>' + active.map(card).join('') : '') + (past.length ? '<h2 style="margin-top:24px">Past bookings</h2>' + past.map(card).join('') : '');
  } catch (e) { showError(list, e.message); }
})();
