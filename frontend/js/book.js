/* book.js — the booking form: service, vehicle, date + slot, pickup & drop, payment choice. */
'use strict';
(async () => {
  if (!requireRole('customer')) return;
  const root = $('#root');
  const qs = new URLSearchParams(location.search);
  let center, me, time = null;
  try {
    [center, me] = await Promise.all([api('/centers/' + encodeURIComponent(qs.get('center') || '')), api('/me')]);
  } catch (e) { showError(root, e.message); return; }
  if (!center.services.length) { root.innerHTML = '<div class="empty">This center has no services yet. <a href="find.html">Find another center</a></div>'; return; }

  const vehicles = me.vehicles || [];
  root.innerHTML = `
    <p><a href="shop.html?id=${encodeURIComponent(center.id)}">← ${esc(center.name)}</a></p>
    <h1 style="font-size:2rem">Book a service</h1><div id="msg"></div>
    <form id="form" class="stack" novalidate>
      <section class="card"><h2>1. Service</h2>
        <label class="field"><span>Service</span><select id="service">${center.services.map((s) => `<option value="${esc(s.id)}"${s.id === qs.get('service') ? ' selected' : ''}>${esc(s.name)} · ${money(s.price)}</option>`).join('')}</select></label></section>
      <section class="card"><h2>2. Your car</h2>
        ${vehicles.length ? `<label class="field"><span>Saved cars</span><select id="saved">${vehicles.map((v, i) => `<option value="${i}">${esc(v.model)} · ${esc(v.reg)}</option>`).join('')}<option value="new">Add a different car…</option></select></label>` : ''}
        <div id="newCar" class="grid g2" ${vehicles.length ? 'hidden' : ''}>
          <label class="field"><span>Car model</span><input id="model" maxlength="60" placeholder="e.g. Hyundai i20"></label>
          <label class="field"><span>Registration number</span><input id="reg" maxlength="15" placeholder="e.g. PB10 AB 1234"></label></div></section>
      <section class="card"><h2>3. Date and time</h2>
        <label class="field"><span>Date</span><input id="date" type="date" min="${todayLocal()}" value="${todayLocal()}"></label>
        <fieldset><legend>Time slot</legend><div id="slots" class="slots" role="group" aria-label="Available time slots"></div><p class="hint" id="slotHint"></p></fieldset></section>
      <section class="card"><h2>4. Pickup and drop</h2>
        ${center.pickup.enabled
          ? `<label class="check"><input type="checkbox" id="pickup"> <span>Collect my car from my address and bring it back (${center.pickup.fee ? money(center.pickup.fee) : 'free'})</span></label>
             <label class="field" id="addrBox" hidden><span>Pickup and drop address</span><textarea id="address" maxlength="250" placeholder="House number, street, area, landmark"></textarea></label>`
          : '<p class="muted" style="margin:0">This center does not offer pickup and drop. Please bring your car to the center.</p>'}</section>
      <section class="card"><h2>5. Contact and payment</h2>
        <label class="field"><span>Mobile number</span><input id="phone" type="tel" value="${esc(me.phone || '')}" placeholder="10-digit number"></label>
        <label class="field"><span>Notes for the center (optional)</span><textarea id="notes" maxlength="300" placeholder="Anything the mechanic should know"></textarea></label>
        <fieldset><legend>How will you pay?</legend>
          <label class="check"><input type="radio" name="pay" value="cash" checked> <span>Cash, at the center or to the driver on delivery</span></label>
          <label class="check"><input type="radio" name="pay" value="upi" ${center.acceptsUpi ? '' : 'disabled'}> <span>UPI to the center ${center.acceptsUpi ? '' : '(not available at this center)'}</span></label>
          <p class="hint">You pay after the work is done. CarCurb does not take any payment.</p></fieldset></section>
      <section class="card"><div class="row between"><strong>Estimated total</strong><strong id="total"></strong></div>
        <p class="hint" id="breakdown"></p><p class="hint">The final bill is created after inspection and shown to you before you pay.</p>
        <button class="btn" type="submit" style="width:100%">Request booking</button></section>
    </form>`;

  const price = () => center.services.find((s) => s.id === $('#service').value).price;
  function updateTotal() {
    const pick = $('#pickup') && $('#pickup').checked;
    const fee = pick ? center.pickup.fee : 0;
    $('#total').textContent = money(price() + fee);
    $('#breakdown').textContent = `Service ${money(price())}` + (pick ? ` + pickup and drop ${money(fee)}` : '');
  }
  async function loadSlots() {
    time = null;
    const box = $('#slots'), date = $('#date').value;
    $('#slotHint').textContent = '';
    if (!date) { box.innerHTML = ''; return; }
    box.innerHTML = '<span class="muted small">Loading slots…</span>';
    try {
      const slots = await api(`/centers/${encodeURIComponent(center.id)}/slots?date=${encodeURIComponent(date)}`);
      box.innerHTML = slots.map((s) => `<button type="button" class="slot" data-time="${s.time}" aria-pressed="false"${s.available ? '' : ' disabled'}>${fmtTime(s.time)}<small>${s.past ? 'passed' : s.available ? (s.capacity - s.booked) + ' left' : 'full'}</small></button>`).join('');
      if (!slots.some((s) => s.available)) $('#slotHint').textContent = 'No free slots on this date. Try another day.';
    } catch (e) { showError(box, e.message); }
  }
  $('#slots').addEventListener('click', (e) => {
    const b = e.target.closest('.slot');
    if (!b || b.disabled) return;
    time = b.dataset.time;
    document.querySelectorAll('.slot').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#date').addEventListener('change', loadSlots);
  $('#service').addEventListener('change', updateTotal);
  if ($('#pickup')) $('#pickup').addEventListener('change', () => { $('#addrBox').hidden = !$('#pickup').checked; updateTotal(); });
  if ($('#saved')) $('#saved').addEventListener('change', () => { $('#newCar').hidden = $('#saved').value !== 'new'; });

  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#msg'), btn = e.target.querySelector('button[type=submit]');
    msg.innerHTML = '';
    const useSaved = $('#saved') && $('#saved').value !== 'new';
    const vehicle = useSaved ? vehicles[Number($('#saved').value)] : { model: $('#model').value, reg: $('#reg').value };
    const fail = (m) => { showError(msg, m); window.scrollTo(0, 0); };
    if (!time) return fail('Pick a time slot.');
    btn.disabled = true;
    try {
      const b = await api('/bookings', { method: 'POST', body: {
        centerId: center.id, serviceId: $('#service').value, vehicle, date: $('#date').value, time,
        phone: $('#phone').value, notes: $('#notes').value, paymentPref: document.querySelector('input[name=pay]:checked').value,
        pickup: { requested: !!($('#pickup') && $('#pickup').checked), address: $('#address') ? $('#address').value : '' },
      } });
      location.href = 'booking.html?id=' + encodeURIComponent(b.id);
    } catch (err) { btn.disabled = false; fail(err.message); if (err.status === 409) loadSlots(); }
  });
  updateTotal();
  loadSlots();
})();
