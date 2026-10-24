/* center.js — the service center's booking dashboard. */
'use strict';
(async () => {
  if (!requireRole('center')) return;
  const list = $('#list');
  let bookings = [], drivers = [], center = null, tab = null;
  const GROUPS = {
    requests: (b) => b.status === 'Pending',
    active: (b) => !['Pending', 'Delivered', 'Rejected', 'Cancelled'].includes(b.status),
    done: (b) => b.status === 'Delivered',
    closed: (b) => ['Rejected', 'Cancelled'].includes(b.status),
  };
  const LABEL = { requests: 'New requests', active: 'In progress', done: 'Completed', closed: 'Rejected / cancelled' };

  async function load() {
    try {
      [center, bookings] = await Promise.all([api('/center/me'), api('/center/bookings')]);
      drivers = center.drivers.filter((d) => d.active);
      if (!tab) tab = bookings.some(GROUPS.requests) ? 'requests' : 'active';
      draw();
    } catch (e) { showError(list, e.message); }
  }

  function card(b) {
    let act = '';
    if (b.canAccept) act += `<button class="btn btn-sm" data-act="accept" data-id="${b.id}">Accept</button><button class="btn btn-danger btn-sm" data-act="reject" data-id="${b.id}">Reject</button>`;
    if (b.canAssign) act += `<span class="row"><select data-driver="${b.id}" aria-label="Driver" style="width:auto;min-height:32px;padding:4px 8px">${drivers.map((d) => `<option value="${esc(d.id)}"${b.driver && b.driver.id === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('') || '<option value="">No active drivers</option>'}</select><button class="btn btn-sm${b.driver ? ' btn-ghost' : ''}" data-act="assign" data-id="${b.id}">${b.driver ? 'Reassign' : 'Assign driver'}</button></span>`;
    if (b.next && b.next.actor === 'center') {
      const blocked = b.next.needsInvoice && !b.invoice;
      act += `<button class="btn btn-sm btn-dark" data-act="advance" data-id="${b.id}"${blocked ? ' disabled title="Create the invoice first"' : ''}>${esc(b.next.label)}</button>`;
    }
    if (b.canInvoice) act += `<button class="btn btn-sm btn-ghost" data-act="invoice" data-id="${b.id}">${b.invoice ? 'Edit invoice' : 'Create invoice'}</button>`;
    if (b.canRecordPayment) act += `<button class="btn btn-sm btn-ghost" data-act="pay" data-method="cash" data-id="${b.id}">Cash received</button><button class="btn btn-sm btn-ghost" data-act="pay" data-method="upi" data-id="${b.id}">UPI received</button>`;
    const wait = b.next && b.next.actor === 'driver' ? `<p class="small muted" style="margin:8px 0 0">Waiting for ${b.driver ? esc(b.driver.name) : 'a driver'} to: ${esc(b.next.label.toLowerCase())}.</p>` : '';
    const needDriver = b.pickup.requested && !b.driver && ['Confirmed'].includes(b.status) ? '<p class="small" style="margin:8px 0 0;color:var(--accent)">Assign a driver to schedule the pickup.</p>' : '';
    return `<article class="card"><div class="row between"><strong>${esc(b.serviceName)} · ${esc(b.vehicle.model)} (${esc(b.vehicle.reg)})</strong>${pill(b.status)}</div>
      <p class="small muted" style="margin:4px 0">${fmtDate(b.date)}, ${fmtTime(b.time)} · ${esc(b.customerName)} · <a href="tel:${esc(b.customerPhone)}">${esc(b.customerPhone)}</a> · ${b.paymentPref === 'upi' ? 'prefers UPI' : 'pays cash'}</p>
      ${b.pickup.requested ? `<p class="small" style="margin:0 0 4px"><strong>Pickup &amp; drop:</strong> ${esc(b.pickup.address)}${b.driver ? ` · Driver ${esc(b.driver.name)}` : ''}</p>` : '<p class="small muted" style="margin:0 0 4px">Customer brings the car.</p>'}
      ${b.notes ? `<p class="small" style="margin:0 0 4px"><strong>Notes:</strong> ${esc(b.notes)}</p>` : ''}
      ${b.rejectReason ? `<p class="small muted" style="margin:0 0 4px">Reason: ${esc(b.rejectReason)}</p>` : ''}
      ${b.invoice ? `<p class="small" style="margin:0 0 4px">Invoice <strong>${money(b.invoice.total)}</strong> · ${pill(b.payment.status)}${b.payment.status === 'paid' ? ` <span class="muted">(${esc(b.payment.method)}, received by ${esc(b.payment.receivedBy)})</span>` : ''}</p>` : ''}
      ${b.review ? `<p class="small" style="margin:0 0 4px">${stars(b.review.rating)} ${esc(b.review.comment)}</p>` : ''}
      ${wait}${needDriver}${act ? `<div class="row" style="margin-top:10px">${act}</div>` : ''}</article>`;
  }

  function draw() {
    const st = center.status;
    $('#title').textContent = center.name;
    $('#banner').innerHTML = st === 'approved' ? (center.services.length ? '' : '<div class="alert alert-info">Add your services in <a href="center-setup.html">Setup</a> so customers can book you.</div>')
      : `<div class="alert alert-${st === 'pending' ? 'warn' : 'error'}">${st === 'pending' ? 'Your center is waiting for CarCurb approval. Customers cannot see it yet. Meanwhile, finish your <a href="center-setup.html">setup</a>.' : 'Your center is ' + esc(st) + '. Please contact CarCurb support.'}</div>`;
    const revenue = bookings.reduce((s, b) => s + (b.payment.status === 'paid' ? b.payment.amount : 0), 0);
    $('#stats').innerHTML = [[bookings.filter(GROUPS.requests).length, 'New requests'], [bookings.filter(GROUPS.active).length, 'In progress'], [bookings.filter(GROUPS.done).length, 'Completed'], [money(revenue), 'Payments recorded']].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
    $('#tabs').innerHTML = Object.keys(GROUPS).map((k) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${LABEL[k]} (${bookings.filter(GROUPS[k]).length})</button>`).join('');
    const rows = bookings.filter(GROUPS[tab]);
    list.innerHTML = rows.length ? rows.map(card).join('') : '<div class="empty">Nothing here right now.</div>';
  }

  function openInvoice(b) {
    const dlg = $('#invDialog');
    const base = [[b.serviceName, b.servicePrice]];
    if (b.pickup.requested && b.pickup.fee > 0) base.push(['Pickup & drop', b.pickup.fee]);
    const extraRow = (l, a) => `<div class="row extra" style="margin-bottom:8px"><input class="x-label" placeholder="Item (e.g. Oil filter)" value="${esc(l || '')}" maxlength="60" style="flex:2;min-width:120px" aria-label="Item name"><input class="x-amt" type="number" min="1" step="1" placeholder="₹" value="${a || ''}" style="flex:1;min-width:80px" aria-label="Amount"></div>`;
    const existing = b.invoice ? b.invoice.items.slice(base.length) : [];
    dlg.innerHTML = `<form id="invForm"><h3>Invoice · ${esc(b.vehicle.reg)}</h3>
      <table><tbody>${base.map(([l, a]) => `<tr><td>${esc(l)}</td><td style="text-align:right">${money(a)}</td></tr>`).join('')}</tbody></table>
      <div id="extras" style="margin-top:10px">${existing.map((x) => extraRow(x.label, x.amount)).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="addExtra">+ Add parts or labour</button>
      <p class="row between" style="margin-top:12px"><strong>Total</strong><strong id="invTotal"></strong></p>
      <div class="row"><button class="btn" type="submit">Save invoice</button><button type="button" class="btn btn-ghost" id="invCancel">Cancel</button></div></form>`;
    const baseTotal = base.reduce((s, x) => s + x[1], 0);
    const total = () => { $('#invTotal').textContent = money(baseTotal + [...dlg.querySelectorAll('.x-amt')].reduce((s, i) => s + (Number(i.value) || 0), 0)); };
    total();
    dlg.addEventListener('input', total);
    $('#addExtra').onclick = () => { $('#extras').insertAdjacentHTML('beforeend', extraRow('', '')); dlg.querySelector('.extra:last-child .x-label').focus(); };
    $('#invCancel').onclick = () => dlg.close();
    $('#invForm').onsubmit = async (e) => {
      e.preventDefault();
      const extras = [...dlg.querySelectorAll('.extra')].map((r) => ({ label: r.querySelector('.x-label').value, amount: r.querySelector('.x-amt').value })).filter((x) => x.label.trim() || x.amount);
      const r = await run(e.submitter, () => api(`/center/bookings/${b.id}/invoice`, { method: 'POST', body: { extras } }));
      if (r) { dlg.close(); toast('Invoice saved. The customer has been notified.'); load(); }
    };
    dlg.showModal();
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; draw(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id, act = btn.dataset.act, post = (p, body) => api(`/center/bookings/${id}/${p}`, { method: 'POST', body });
    if (act === 'invoice') { openInvoice(bookings.find((x) => x.id === id)); return; }
    let call;
    if (act === 'accept') call = () => post('accept');
    else if (act === 'reject') { const reason = prompt('Reason for rejecting (optional):'); if (reason === null) return; call = () => post('reject', { reason }); }
    else if (act === 'assign') { const d = document.querySelector(`[data-driver="${id}"]`).value; call = () => post('assign', { driverId: d }); }
    else if (act === 'advance') call = () => post('advance');
    else if (act === 'pay') { if (!confirm(`Record ${btn.dataset.method === 'cash' ? 'cash' : 'UPI'} payment as received?`)) return; call = () => post('payment', { method: btn.dataset.method }); }
    const r = await run(btn, call);
    if (r) { toast('Updated'); load(); }
  });

  await load();
  setInterval(() => { if (!document.hidden && !$('#invDialog').open) load(); }, 30000);
})();
