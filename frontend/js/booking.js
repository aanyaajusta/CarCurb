/* booking.js — one booking: live progress, driver, invoice, how to pay, cancel, review, complaint. */
'use strict';
(async () => {
  if (!requireRole('customer')) return;
  const root = $('#root');
  const id = new URLSearchParams(location.search).get('id') || '';
  const path = '/bookings/' + encodeURIComponent(id);
  let b = null, rating = 5, lastKey = '';

  const keyOf = (x) => JSON.stringify([x.status, x.invoice, x.payment, x.driver, x.review, x.complaint, x.history.length]);

  function billCard() {
    if (!b.invoice) {
      return `<section class="card"><h2>Bill</h2><p style="margin:0">Estimated <strong>${money(b.estimate)}</strong>${b.pickup.requested && b.pickup.fee ? ` (service ${money(b.servicePrice)} + pickup and drop ${money(b.pickup.fee)})` : ''}.</p><p class="hint">The center will create the final invoice after inspection.</p></section>`;
    }
    const paid = b.payment.status === 'paid';
    let how = '';
    if (paid) how = `<div class="alert alert-ok" style="margin:12px 0 0">Paid ${money(b.payment.amount)} by ${esc(b.payment.method)} on ${fmtWhen(b.payment.paidAt)}. Received by ${esc(b.payment.receivedBy)}.</div>`;
    else if (b.pay) how = `<div class="alert alert-info" style="margin:12px 0 0"><p style="margin:0 0 8px">Pay <strong>${money(b.invoice.total)}</strong> to the center by UPI:</p><p style="margin:0 0 10px"><code id="upiId">${esc(b.pay.upiId)}</code> <button class="btn btn-ghost btn-sm" data-act="copy">Copy</button></p><a class="btn btn-sm" href="${esc(b.pay.upiLink)}">Open my UPI app</a><p class="hint" style="margin:8px 0 0">The center marks it as received. Prefer cash? Pay the driver or the center instead.</p></div>`;
    else how = `<div class="alert alert-info" style="margin:12px 0 0">Pay <strong>${money(b.invoice.total)}</strong> in cash ${b.pickup.requested ? 'to the driver on delivery or' : ''} at the center. The center records the payment.</div>`;
    return `<section class="card"><h2>Invoice</h2><table><tbody>${b.invoice.items.map((i) => `<tr><td>${esc(i.label)}</td><td style="text-align:right">${money(i.amount)}</td></tr>`).join('')}<tr><th>Total</th><th style="text-align:right;font-size:1rem;color:inherit">${money(b.invoice.total)}</th></tr></tbody></table>${how}</section>`;
  }
  function actionsCard() {
    let h = '';
    if (b.canCancel) h += `<p><button class="btn btn-danger" data-act="cancel">Cancel this booking</button></p>`;
    if (b.canReview) h += `<h3>How was the service?</h3><div class="rate" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= rating ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}" aria-pressed="${n === rating}">★</button>`).join('')}</div><label class="field"><span class="sr" style="position:absolute;left:-999px">Comment</span><textarea id="comment" maxlength="500" placeholder="Tell others about your experience (optional)"></textarea></label><button class="btn" data-act="review">Submit review</button>`;
    if (b.review) h += `<p style="margin:0">Your review: ${stars(b.review.rating)}${b.review.comment ? ' · ' + esc(b.review.comment) : ''}</p>`;
    if (b.complaint) h += `<div class="alert ${b.complaint.status === 'resolved' ? 'alert-ok' : 'alert-warn'}" style="margin-top:12px"><strong>Problem reported (${esc(b.complaint.status)})</strong><br>${esc(b.complaint.text)}${b.complaint.note ? `<br><em>Resolution: ${esc(b.complaint.note)}</em>` : ''}</div>`;
    else if (!['Rejected', 'Cancelled'].includes(b.status)) h += `<details style="margin-top:12px"><summary>Report a problem</summary><label class="field" style="margin-top:10px"><span>What went wrong?</span><textarea id="complaintText" maxlength="500"></textarea></label><button class="btn btn-ghost" data-act="complaint">Send to CarCurb</button></details>`;
    return h ? `<section class="card">${h}</section>` : '';
  }
  function render() {
    const dead = ['Rejected', 'Cancelled'].includes(b.status);
    root.innerHTML = `
      <p><a href="customer.html">← My bookings</a></p>
      <div class="row between"><h1 style="font-size:1.8rem;margin:0">${esc(b.serviceName)}</h1>${pill(b.status)}</div>
      <p class="muted">${esc(b.vehicle.model)} · ${esc(b.vehicle.reg)} · ${fmtDate(b.date)} at ${fmtTime(b.time)}</p>
      ${b.status === 'Rejected' ? `<div class="alert alert-error">The center could not take this booking.${b.rejectReason ? ' Reason: ' + esc(b.rejectReason) : ''} <a href="find.html">Find another center</a></div>` : ''}
      ${b.status === 'Cancelled' ? '<div class="alert alert-warn">You cancelled this booking.</div>' : ''}
      <div class="grid g2" style="align-items:start">
        <section class="card"><h2>Progress</h2>${dead ? '<p class="muted">No further steps.</p>' : timeline(b.flow, b.status, b.history)}</section>
        <div class="stack">
          <section class="card"><h2>Details</h2>
            <p style="margin:0 0 6px"><strong>${esc(b.center.name)}</strong><br><span class="muted">${esc(b.center.address)}</span></p>
            <p class="small" style="margin:0 0 10px"><a href="tel:${esc(b.center.phone)}">Call ${esc(b.center.phone)}</a> · <a href="${esc(b.center.mapsUrl)}" target="_blank" rel="noopener noreferrer">Open in Maps</a></p>
            ${b.pickup.requested ? `<p class="small" style="margin:0 0 6px"><strong>Pickup and drop:</strong> ${esc(b.pickup.address)}</p>` : '<p class="small muted" style="margin:0 0 6px">You will bring the car to the center.</p>'}
            ${b.driver ? `<p class="small" style="margin:0 0 6px"><strong>Driver:</strong> ${esc(b.driver.name)} · <a href="tel:${esc(b.driver.phone)}">${esc(b.driver.phone)}</a></p>` : ''}
            ${b.notes ? `<p class="small" style="margin:0"><strong>Your notes:</strong> ${esc(b.notes)}</p>` : ''}</section>
          ${dead ? '' : billCard()}${actionsCard()}
        </div></div>`;
  }
  async function load(first) {
    try {
      b = await api(path);
      const k = keyOf(b);
      if (first || k !== lastKey) { lastKey = k; render(); }
    } catch (e) { if (first) showError(root, e.message); }
  }

  root.addEventListener('click', async (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { rating = Number(star.dataset.star); const c = $('#comment'); const keep = c ? c.value : ''; render(); if ($('#comment')) $('#comment').value = keep; return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'copy') { try { await navigator.clipboard.writeText($('#upiId').textContent); toast('UPI ID copied'); } catch (x) { toast('Select and copy the UPI ID manually', true); } return; }
    if (act === 'cancel' && !confirm('Cancel this booking?')) return;
    const call = { cancel: () => api(path + '/cancel', { method: 'POST' }), review: () => api(path + '/review', { method: 'POST', body: { rating, comment: $('#comment').value } }), complaint: () => api(path + '/complaint', { method: 'POST', body: { text: $('#complaintText').value } }) }[act];
    const r = await run(btn, call);
    if (r) { b = r; lastKey = keyOf(b); render(); toast(act === 'cancel' ? 'Booking cancelled' : act === 'review' ? 'Thanks for your review' : 'Sent. CarCurb will look into it.'); }
  });

  await load(true);
  setInterval(() => { if (!document.hidden) load(false); }, 20000);
})();
