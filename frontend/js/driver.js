/* driver.js — jobs assigned to this driver by their service center. */
'use strict';
(async () => {
  if (!requireRole('driver')) return;
  const list = $('#list');

  function card(j) {
    const delivery = j.type === 'delivery';
    let act = '';
    if (j.next) {
      if (j.status === 'Out for Delivery') {
        act = `<button class="btn" data-act="deliver" data-id="${j.id}" data-cash="${j.amountDue > 0}">${j.amountDue > 0 ? `Delivered and collected ${money(j.amountDue)} cash` : 'Delivered'}</button>${j.amountDue > 0 ? `<button class="btn btn-ghost" data-act="deliver" data-id="${j.id}" data-cash="false">Delivered, not paid in cash</button>` : ''}`;
      } else act = `<button class="btn" data-act="step" data-id="${j.id}">${esc(j.next.label)}</button>`;
    }
    return `<article class="card"><div class="row between"><strong>${delivery ? 'Deliver' : 'Pick up'}: ${esc(j.vehicle.model)} (${esc(j.vehicle.reg)})</strong>${pill(j.status)}</div>
      <p class="small muted" style="margin:4px 0">${fmtDate(j.date)}, ${fmtTime(j.time)} · ${esc(j.serviceName)} · ${esc(j.centerName)}</p>
      <p style="margin:6px 0 2px"><strong>${esc(j.customerName)}</strong> · <a href="tel:${esc(j.customerPhone)}">${esc(j.customerPhone)}</a></p>
      <p style="margin:0 0 8px">${esc(j.address)}<br><a class="small" href="${esc(j.mapsUrl)}" target="_blank" rel="noopener noreferrer">Get directions</a></p>
      ${j.notes ? `<p class="small" style="margin:0 0 8px"><strong>Notes:</strong> ${esc(j.notes)}</p>` : ''}
      ${delivery ? (j.paid ? '<p class="small" style="margin:0 0 8px"><span class="pill pill-ok">Already paid</span></p>' : j.amountDue ? `<p class="small" style="margin:0 0 8px">Amount due: <strong>${money(j.amountDue)}</strong> (${j.paymentPref === 'upi' ? 'customer chose UPI' : 'cash on delivery'})</p>` : '') : ''}
      ${!j.next ? `<p class="small muted" style="margin:0">${j.status === 'Delivered' ? 'Completed.' : 'Nothing to do right now. The center is working on the car.'}</p>` : `<div class="row">${act}</div>`}</article>`;
  }

  async function load() {
    try {
      const jobs = await api('/driver/jobs');
      const todo = jobs.filter((j) => j.next), wait = jobs.filter((j) => !j.next && j.status !== 'Delivered'), done = jobs.filter((j) => j.status === 'Delivered');
      if (!jobs.length) { list.innerHTML = '<div class="empty">No jobs yet. Your service center will assign pickups and deliveries to you.</div>'; return; }
      list.innerHTML = (todo.length ? '<h2>Needs you now</h2>' + todo.map(card).join('') : '<div class="empty">Nothing to do right now.</div>')
        + (wait.length ? '<h2 style="margin-top:24px">With the workshop</h2>' + wait.map(card).join('') : '')
        + (done.length ? '<h2 style="margin-top:24px">Completed</h2>' + done.slice(-5).map(card).join('') : '');
    } catch (e) { showError(list, e.message); }
  }
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'deliver' && btn.dataset.cash === 'true' && !confirm('Confirm you collected the cash from the customer?')) return;
    const r = await run(btn, () => api(`/driver/jobs/${encodeURIComponent(btn.dataset.id)}/advance`, { method: 'POST', body: { cashCollected: btn.dataset.cash === 'true' } }));
    if (r) { toast('Updated'); load(); }
  });
  await load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
})();
